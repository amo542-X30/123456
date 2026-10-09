import { supabase } from './supabase';
import { getDeviceName } from './utils';
import type { Passkey, UserSettings } from './types';

const passkeyFunctionUrl = `${import.meta.env.BASE_URL.replace(/\/+$/, '')}/api/passkey-auth`;

type PasskeyAction = 'registration-options' | 'registration-verify' | 'authentication-options' | 'authentication-verify';

function toBase64Url(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function callPasskeyFunction(action: PasskeyAction, body: Record<string, unknown> = {}, requireSession = true) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (requireSession) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  }

  const response = await fetch(passkeyFunctionUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, ...body }),
  });
  const result = await response.json() as { error?: string; [key: string]: unknown };
  if (!response.ok) throw new Error(result.error || 'Passkey request failed');
  return result;
}

function serializeCredential(credential: PublicKeyCredential): Record<string, unknown> {
  const response = credential.response as AuthenticatorAttestationResponse | AuthenticatorAssertionResponse;
  const serialized: Record<string, unknown> = {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
    },
  };

  if ('attestationObject' in response) {
    serialized.response = {
      ...serialized.response as Record<string, unknown>,
      attestationObject: toBase64Url(response.attestationObject),
      transports: response.getTransports?.() || [],
    };
  } else {
    serialized.response = {
      ...serialized.response as Record<string, unknown>,
      authenticatorData: toBase64Url(response.authenticatorData),
      signature: toBase64Url(response.signature),
      userHandle: response.userHandle ? toBase64Url(response.userHandle) : null,
    };
  }

  return serialized;
}

export function isWebAuthnSupported(): boolean {
  return typeof window !== 'undefined' &&
    window.PublicKeyCredential !== undefined &&
    typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function';
}

export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function getPasskeys(): Promise<Passkey[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('passkeys')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to fetch passkeys: ${error.message}`);
  return data || [];
}

export async function registerPasskey(): Promise<void> {
  if (!isWebAuthnSupported()) throw new Error('WebAuthn is not supported on this device/browser');
  if (!await isPlatformAuthenticatorAvailable()) throw new Error('No biometric/platform authenticator available on this device');

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const options = await callPasskeyFunction('registration-options');
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: fromBase64Url(String(options.challenge)),
      rp: { name: 'AM0SP Private Vault', id: String(options.rpId) },
      user: {
        id: new TextEncoder().encode(user.id),
        name: user.email || 'user',
        displayName: user.email || 'User',
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000,
      attestation: 'none',
    },
  }) as PublicKeyCredential | null;
  if (!credential) throw new Error('Passkey registration was cancelled');

  await callPasskeyFunction('registration-verify', {
    challenge: options.challenge,
    response: serializeCredential(credential),
    deviceName: getDeviceName(),
  });
}

export async function authenticateWithPasskey(): Promise<void> {
  if (!isWebAuthnSupported()) throw new Error('WebAuthn is not supported on this device/browser');

  const options = await callPasskeyFunction('authentication-options', {}, false);
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: fromBase64Url(String(options.challenge)),
      rpId: String(options.rpId),
      userVerification: 'required',
      timeout: 60000,
    },
  }) as PublicKeyCredential | null;
  if (!credential) throw new Error('Passkey authentication was cancelled');

  const result = await callPasskeyFunction('authentication-verify', {
    challenge: options.challenge,
    response: serializeCredential(credential),
  }, false);
  const tokenHash = String(result.tokenHash || '');
  if (!tokenHash) throw new Error('Passkey authentication failed');

  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  if (error) throw new Error('Passkey authentication failed');
}

export async function removePasskey(passkeyId: string): Promise<void> {
  const { error } = await supabase.from('passkeys').delete().eq('id', passkeyId);
  if (error) throw new Error(`Failed to remove passkey: ${error.message}`);
}

export async function getUserSettings(): Promise<UserSettings | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase.from('user_settings').select('*').eq('user_id', user.id).maybeSingle();
  if (error) throw new Error(`Failed to fetch settings: ${error.message}`);

  if (!data) {
    const { data: newSettings, error: insertError } = await supabase.from('user_settings').insert({ user_id: user.id }).select().maybeSingle();
    if (insertError) throw new Error(`Failed to create settings: ${insertError.message}`);
    return newSettings;
  }
  return data;
}

export async function updateUserSettings(settings: Partial<UserSettings>): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase.from('user_settings').upsert({
    user_id: user.id,
    terminal_effects: settings.terminal_effects,
    animation_intensity: settings.animation_intensity,
    reduced_motion: settings.reduced_motion,
  });
  if (error) throw new Error(`Failed to update settings: ${error.message}`);
}

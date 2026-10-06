import { supabase } from './supabase';
import { getDeviceName } from './utils';
import type { Device, SecurityEvent } from './types';

export async function recordDeviceLogin(sessionId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const deviceName = getDeviceName();
  const userAgent = navigator.userAgent;

  // Check if this session is already recorded to avoid duplicates on reload
  const { data: existing } = await supabase
    .from('devices')
    .select('id')
    .eq('session_id', sessionId)
    .maybeSingle();

  if (existing) {
    // Update last_active_at for the existing device entry
    await supabase
      .from('devices')
      .update({ last_active_at: new Date().toISOString() })
      .eq('id', existing.id);
    return;
  }

  const { error } = await supabase
    .from('devices')
    .insert({
      session_id: sessionId,
      user_agent: userAgent,
      device_name: deviceName,
      is_current: false,
    });

  if (error) throw new Error(`Failed to record device: ${error.message}`);

  await logSecurityEvent('new_device_login', `New device login: ${deviceName}`, deviceName);
}

export async function getDevices(): Promise<Device[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('devices')
    .select('*')
    .eq('user_id', user.id)
    .order('login_at', { ascending: false });

  if (error) throw new Error(`Failed to fetch devices: ${error.message}`);
  return data || [];
}

export async function revokeDevice(deviceId: string): Promise<void> {
  const { error } = await supabase
    .from('devices')
    .delete()
    .eq('id', deviceId);

  if (error) throw new Error(`Failed to revoke device: ${error.message}`);

  await logSecurityEvent('session_revoked', 'A device session was revoked');
}

export async function revokeAllOtherDevices(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const currentSessionId = session?.access_token;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  let query = supabase.from('devices').delete().eq('user_id', user.id);
  if (currentSessionId) {
    query = query.neq('session_id', currentSessionId);
  }

  const { error } = await query;
  if (error) throw new Error(`Failed to revoke other devices: ${error.message}`);

  await logSecurityEvent('session_revoked', 'All other device sessions were revoked');
}

export async function logSecurityEvent(
  eventType: string,
  description: string,
  deviceName?: string
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from('security_events').insert({
    user_id: user.id,
    event_type: eventType,
    description,
    device_name: deviceName || null,
  });
}

export async function getSecurityEvents(): Promise<SecurityEvent[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('security_events')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw new Error(`Failed to fetch security events: ${error.message}`);
  return data || [];
}

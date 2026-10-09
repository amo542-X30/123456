import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "npm:@simplewebauthn/server@13.2.2";

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required Edge Function secret: ${name}`);
  return value;
}

const supabaseUrl = requiredEnv("SUPABASE_URL");
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const admin = createClient(supabaseUrl, serviceRoleKey);

const APP_ORIGIN = requiredEnv("APP_ORIGIN");
const APP_RPID = new URL(APP_ORIGIN).hostname;

const ALLOWED_ORIGINS = [APP_ORIGIN];

// M2: In-memory rate limiter keyed by client IP.
// Allows 10 passkey requests per minute per IP. Entries expire after 60s.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// Periodic cleanup of stale rate-limit entries (runs on every request, cheap)
function pruneRateLimit() {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}

function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

function corsHeaders(origin: string) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
    "Vary": "Origin",
  };
}

function response(body: unknown, status = 200, origin: string = ALLOWED_ORIGINS[0]) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

function base64UrlEncode(value: Uint8Array): string {
  let binary = "";
  value.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

// M3: Delete expired passkey challenges on each request to prevent unbounded growth.
async function cleanupExpiredChallenges() {
  await admin
    .from("passkey_challenges")
    .delete()
    .lt("expires_at", new Date().toISOString());
}

async function getAuthenticatedUser(req: Request) {
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  const { data: { user } } = await admin.auth.getUser(token);
  return user;
}

async function createChallenge(userId: string | null, purpose: "registration" | "authentication") {
  const challenge = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const { error } = await admin.from("passkey_challenges").insert({
    challenge,
    user_id: userId,
    purpose,
  });
  if (error) throw new Error("Could not create authentication challenge");
  return challenge;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? ALLOWED_ORIGINS[0];

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders(origin) });
  }

  // M2: Rate limit all passkey requests by IP
  pruneRateLimit();
  const clientIp = getClientIp(req);
  if (!checkRateLimit(clientIp)) {
    return response({ error: "Too many requests. Please try again in a minute." }, 429, origin);
  }

  try {
    const body = await req.json();
    const action = body.action as string;

    // M3: Clean up expired challenges — skip on latency-sensitive auth paths.
    if (action !== 'authentication-options' && action !== 'authentication-verify') {
      try { await cleanupExpiredChallenges(); } catch { /* non-blocking */ }
    }

    if (action === "registration-options") {
      const user = await getAuthenticatedUser(req);
      if (!user) return response({ error: "Not authenticated" }, 401, origin);
      const challenge = await createChallenge(user.id, "registration");
      return response({ challenge, rpId: APP_RPID }, 200, origin);
    }

    if (action === "authentication-options") {
      const challenge = await createChallenge(null, "authentication");
      return response({ challenge, rpId: APP_RPID }, 200, origin);
    }

    if (action === "registration-verify") {
      const user = await getAuthenticatedUser(req);
      if (!user) return response({ error: "Not authenticated" }, 401, origin);
      const challenge = String(body.challenge || "");
      const { data: challengeRow } = await admin
        .from("passkey_challenges")
        .select("id")
        .eq("challenge", challenge)
        .eq("purpose", "registration")
        .eq("user_id", user.id)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (!challengeRow) return response({ error: "Challenge expired" }, 400, origin);

      const verification = await verifyRegistrationResponse({
        response: body.response,
        expectedChallenge: challenge,
        expectedOrigin: APP_ORIGIN,
        expectedRPID: APP_RPID,
        requireUserVerification: true,
      });
      if (!verification.verified || !verification.registrationInfo) {
        return response({ error: "Passkey verification failed" }, 400, origin);
      }

      const credential = verification.registrationInfo.credential;
      const { error } = await admin.from("passkeys").insert({
        user_id: user.id,
        credential_id: credential.id,
        public_key: base64UrlEncode(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ?? [],
        device_name: body.deviceName || "This device",
      });
      if (error) return response({ error: "Could not save passkey" }, 400, origin);
      await admin.from("passkey_challenges").delete().eq("id", challengeRow.id);
      return response({ verified: true }, 200, origin);
    }

    if (action === "authentication-verify") {
      const challenge = String(body.challenge || "");
      const credentialId = String(body.response?.id || "");

      // Parallel: fetch challenge row and passkey row at the same time
      const [challengeResult, passkeyResult] = await Promise.all([
        admin
          .from("passkey_challenges")
          .select("id")
          .eq("challenge", challenge)
          .eq("purpose", "authentication")
          .gt("expires_at", new Date().toISOString())
          .maybeSingle(),
        admin
          .from("passkeys")
          .select("id, user_id, credential_id, public_key, counter, transports")
          .eq("credential_id", credentialId)
          .maybeSingle(),
      ]);

      const challengeRow = challengeResult.data;
      if (!challengeRow) return response({ error: "Authentication failed" }, 400, origin);
      const passkey = passkeyResult.data;
      if (!passkey?.public_key) return response({ error: "Authentication failed" }, 400, origin);

      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response: body.response,
          expectedChallenge: challenge,
          expectedOrigin: APP_ORIGIN,
          expectedRPID: APP_RPID,
          requireUserVerification: true,
          credential: {
            id: passkey.credential_id,
            publicKey: base64UrlDecode(passkey.public_key),
            counter: passkey.counter,
            transports: passkey.transports ?? [],
          },
        });
      } catch {
        return response({ error: "Authentication failed" }, 400, origin);
      }
      if (!verification.verified) return response({ error: "Authentication failed" }, 400, origin);

      // Parallel: update counter, delete challenge, and fetch user email — all independent
      const [,, userResult] = await Promise.all([
        admin.from("passkeys").update({ counter: verification.authenticationInfo.newCounter }).eq("id", passkey.id),
        admin.from("passkey_challenges").delete().eq("id", challengeRow.id),
        admin.auth.admin.getUserById(passkey.user_id),
      ]);

      if (userResult.error || !userResult.data.user?.email) {
        return response({ error: "Authentication failed" }, 400, origin);
      }

      const { data: link, error: linkError } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email: userResult.data.user.email,
      });
      const tokenHash = link?.properties?.hashed_token;
      if (linkError || !tokenHash) return response({ error: "Authentication failed" }, 400, origin);
      return response({ tokenHash }, 200, origin);
    }

    return response({ error: "Unsupported action" }, 400, origin);
  } catch {
    return response({ error: "Passkey authentication request failed" }, 500, origin);
  }
});

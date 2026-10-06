/*
# Add secure biometric authentication support

1. New Tables
- `passkey_challenges` stores short-lived, single-use WebAuthn challenges. It is only accessed by the server-side passkey function and is protected by RLS with no client policies.

2. Modified Tables
- `passkeys.public_key` stores the registered credential public key used to verify biometric assertions.
- `passkeys.counter` stores the authenticator signature counter to detect cloned or replayed credentials.
- `passkeys.transports` stores the authenticator transport hints used during verification.

3. Security
- Enable RLS on `passkey_challenges` with no anon/authenticated policies; only the service-role Edge Function can access challenge records.
- Keep existing owner-scoped passkey policies unchanged.
- Challenges expire after five minutes and are consumed by the server after verification.

4. Important Notes
- Existing passkey rows remain intact; older rows will be shown as requiring re-registration because they do not contain verification material.
- No user files, account rows, or existing passkey records are deleted.
*/

ALTER TABLE public.passkeys
  ADD COLUMN IF NOT EXISTS public_key text,
  ADD COLUMN IF NOT EXISTS counter bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transports text[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS public.passkey_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge text NOT NULL UNIQUE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('registration', 'authentication')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.passkey_challenges ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_passkey_challenges_challenge ON public.passkey_challenges(challenge);
CREATE INDEX IF NOT EXISTS idx_passkey_challenges_expires_at ON public.passkey_challenges(expires_at);

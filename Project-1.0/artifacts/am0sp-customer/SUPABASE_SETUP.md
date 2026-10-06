# AM0SP Customer Web App — Supabase setup

## Current connection status

The new project's `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are configured in Replit Secrets. `VITE_APP_URL` is set to the current development origin for password-reset redirects. No values from the excluded archive `.env` were reused.

On October 6, 2026, the Supabase Auth settings endpoint returned HTTP 200 with the configured public key, and a read-only `folders` table request returned HTTP 200. The customer app rendered its existing login screen. This verifies the app can reach Auth and the table endpoint; it does not verify every migration, row-level policy, or storage policy.

Read-only Edge Function preflights found that `media-proxy` returned HTTP 404 and `passkey-auth` did not allow the current development origin. Deploy `media-proxy`, then set `APP_ORIGIN` in the Supabase Edge Function secrets to the exact current `VITE_APP_URL` and redeploy `passkey-auth`. Before publishing, update `VITE_APP_URL` and Supabase Auth's allowed redirects to the production origin.

## Database and storage

Apply the migrations in `supabase/migrations/` in filename order to the new project's SQL Editor, or link the project with the Supabase CLI and run `supabase db push`:

1. `20260930095216_001_am0sp_initial_schema.sql`
2. `20260930100742_002_auto_user_settings.sql`
3. `20261002053408_20261002090000_passkey_authentication_support.sql`
4. `20261003024548_20261003000000_fix_security_audit_critical_and_high.sql`
5. `20261003024713_20261003010000_revoke_public_execute_handle_new_user.sql`
6. `20261005000000_006_ensure_private_vault_bucket.sql`

Supabase Auth manages customer accounts. The application tables are:

- `folders` — per-user folder hierarchy.
- `files` — per-user metadata; file bytes are stored in Storage.
- `devices` — customer sign-in device records.
- `security_events` — customer security-event history.
- `passkeys` — WebAuthn public credential data.
- `passkey_challenges` — short-lived challenges accessible only to the server-side passkey function.
- `user_settings` — per-user appearance preferences.

The migrations enable row-level security and scope customer access to `auth.uid()`. The `am0sp-vault` Storage bucket is private; object policies restrict each authenticated user to objects under their own user-ID path. There is no public backup bucket.

After migration, run `supabase/verify_storage_access.sql` in the SQL Editor for the same project. Expect a `PRIVATE` bucket, enabled object RLS, and four owner-scoped policies. The bucket migration ensures the bucket exists and is private without modifying existing objects.

## Connect the customer app

Configure these non-secret client values in the app's environment, then restart the web workflow:

- `VITE_SUPABASE_URL` — exact project URL from the new project's API settings.
- `VITE_SUPABASE_ANON_KEY` — the project's publishable/anon key. This is public client configuration and is protected by RLS.
- `VITE_APP_URL` — exact customer-app origin used for password-reset redirects; use `http://localhost:5173` for local Vite development.

`.env.example` documents the expected variable names. Never put a `service_role` key or other privileged credential in frontend code, a `VITE_` variable, or a checked-in environment file.

In Supabase Auth settings, set the app's Site URL and allow the exact redirect URL `<VITE_APP_URL>/reset-password`. Add only the real customer-app development and production origins.

## Edge Functions

The customer app uses:

- `media-proxy` for authenticated, ownership-checked media access.
- `passkey-auth` for WebAuthn registration and authentication.

Deploy both from `supabase/functions/` after linking the Supabase CLI to the new project. `supabase/config.toml` requires a user JWT for `media-proxy`; `passkey-auth` disables gateway JWT verification so it can start a login ceremony, then performs its own action-specific checks.

Set `APP_ORIGIN` as an Edge Function secret to the exact trusted app origin. The Supabase Edge Function environment supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` server-side. Do not copy the service-role key into Replit environment variables, frontend code, or a browser bundle.

## Future Admin Panel

The later Admin Panel should use this same Supabase project and the shared schema/migrations. It is not part of this app. Any privileged admin operations need a separately designed server-side authorization and policy model; the service-role key must never be exposed in its browser bundle.

---
name: Cloudflare Worker secrets
description: Wrangler secret-binding and local runtime behavior for this imported B2 Worker.
---

For this Worker, `wrangler secret bulk` reported successful uploads but left the Worker secret list empty. Individual `wrangler secret put` calls persisted the bindings; verify with `wrangler secret list` before relying on them.

**Why:** The production routes initially returned a missing-session-configuration response even after bulk-upload success, so success output alone did not prove the bindings were active.

**How to apply:** For this Worker, upload each secret individually, confirm the expected names appear in `wrangler secret list`, and smoke-test an invalid bearer token to confirm session validation is configured.

Secret presence in Replit does not prove Wrangler can authenticate to Cloudflare; the configured token may still be invalid or revoked.

**Why:** A production deploy attempt was rejected by Cloudflare as an invalid access token even though the Replit secret existed.

**How to apply:** Check Wrangler authentication with a read-only Cloudflare API operation before attempting a production deploy.

The browser app's `VITE_SUPABASE_ANON_KEY` and the Worker's `SUPABASE_ANON_KEY` must use the same current public client key. Before deploying, confirm the key succeeds against `/auth/v1/settings`; a synthetic password login should reach credential validation rather than return “Invalid API key.”

**Why:** A stale key was present in both the deployed bundle and Worker; route checks alone did not distinguish that from an invalid customer session.

**How to apply:** If the key is rejected, update the Replit client secret through the secure flow, mirror it to the Worker secret, rebuild the static bundle, and deploy without changing Supabase settings.

The local Wrangler Workerd binary did not support the project's current compatibility date. For local smoke tests, override the date to one supported by the installed binary; do not change the production config date solely to accommodate the local runtime.

**Why:** Local Workerd lagged the project's compatibility date even though the remote deployment accepted it.

**How to apply:** Use a command-line compatibility-date override only for local `wrangler dev` tests when needed.

The browser's passkey call to the Supabase Edge Function failed its CORS origin check even though server-side calls succeeded. Proxy passkey requests through the same-origin Worker, add the Worker-held anon key upstream, and forward only the user's authorization header when present.

**Why:** Browser preflight did not allow the production app origin, causing a generic “Load failed” before passkey authentication started.

**How to apply:** For this Worker-hosted customer app, use a same-origin API route for passkey Edge Function calls; keep Supabase settings unchanged.

Avoid `HeadObject` after a successful B2 upload when the key may be write-scoped; it adds an unnecessary read permission requirement to file creation.

**Why:** A post-upload permission failure can turn a successful `PutObject` into a generic storage failure and trigger cleanup.

**How to apply:** Use the measured request length for the upload response; reserve `HeadObject` for reads that actually need object metadata.

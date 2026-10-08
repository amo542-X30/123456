---
name: Cloudflare Worker secrets
description: Wrangler secret-binding and local runtime behavior for this imported B2 Worker.
---

For this Worker, `wrangler secret bulk` reported successful uploads but left the Worker secret list empty. Individual `wrangler secret put` calls persisted the bindings; verify with `wrangler secret list` before relying on them.

**Why:** The production routes initially returned a missing-session-configuration response even after bulk-upload success, so success output alone did not prove the bindings were active.

**How to apply:** For this Worker, upload each secret individually, confirm the expected names appear in `wrangler secret list`, and smoke-test an invalid bearer token to confirm session validation is configured.

The local Wrangler Workerd binary did not support the project's current compatibility date. For local smoke tests, override the date to one supported by the installed binary; do not change the production config date solely to accommodate the local runtime.

**Why:** Local Workerd lagged the project's compatibility date even though the remote deployment accepted it.

**How to apply:** Use a command-line compatibility-date override only for local `wrangler dev` tests when needed.

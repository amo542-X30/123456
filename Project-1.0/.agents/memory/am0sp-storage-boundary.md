---
name: AM0SP storage boundary
description: Requirements for adding B2 storage without disrupting existing Supabase-backed files.
---

For the AM0SP customer app, new uploads use B2. Existing Supabase-stored files must remain accessible in Supabase and must not be migrated, copied, or deleted as part of B2 work. Keep Supabase Auth, Passkeys, database schema, and UI unchanged; limit storage work to B2-specific behavior.

The B2 application key authorized, but bucket discovery returned no bucket. Configure the non-secret `B2_BUCKET_NAME` shared environment variable rather than relying on bucket enumeration.

**Why:** the user explicitly set these boundaries, and the current B2 key did not expose a bucket name through discovery.

**How to apply:** Route storage operations using each file's stored bucket metadata, preserve the Supabase path for legacy files, and use `B2_BUCKET_NAME` for the B2 target.

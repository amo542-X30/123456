---
name: Existing Supabase setup
description: The customer app's Supabase backend is already provisioned; focus on app-flow verification.
---

The user says the target Supabase project already has its database migrations, the private `am0sp-vault` bucket with RLS policies, `media-proxy`, and `passkey-auth` deployed and verified. Do not ask the user to set these up or re-enter them.

**Why:** the user explicitly corrected earlier project-state assumptions and asked to continue by verifying customer app flows.

**How to apply:** use the existing Supabase configuration for non-destructive flow checks. Ask before tests that create users, send email, or write/delete customer data; never request passwords or privileged keys in chat.

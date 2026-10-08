---
name: Cloudflare static builds
description: Deployment constraints for the AM0SP customer frontend in the nested pnpm workspace.
---

Cloudflare Workers Builds do not inherit Replit Secrets. For this app, build in Replit with the required `VITE_*` values and have Wrangler upload the completed static assets. Install only the nested customer app rather than every sibling service; unrelated API dependencies can fail on the Replit package firewall. Pin Wrangler to a version supported by the active Node runtime, or upgrade the runtime deliberately.

**Why:** Cloudflare's remote build environment cannot read Replit Secrets. A full workspace install also hit a firewall 403 on an unrelated API dependency, and the latest Wrangler release rejected the project's Node 20 runtime.

**How to apply:** Require and pass the Replit `VITE_*` values into the filtered customer build, keep its lockfile frozen, then deploy the result with Wrangler. Check Wrangler's `engines.node` before upgrades; use Node 22+ if moving to a newer Wrangler release.

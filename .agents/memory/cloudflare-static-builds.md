---
name: Cloudflare static builds
description: Deployment constraints for the AM0SP customer frontend in the nested pnpm workspace.
---

For static deployments of the nested customer app, install only that workspace package rather than every sibling service; unrelated API dependencies can fail on the Replit package firewall. Pin Wrangler to a version supported by the active Node runtime, or upgrade the runtime deliberately.

**Why:** A full workspace install hit a firewall 403 on an unrelated API dependency, and the latest Wrangler release rejected the project's Node 20 runtime.

**How to apply:** Keep the deploy build filtered to the customer app with its lockfile frozen. Check Wrangler's `engines.node` before upgrades; use Node 22+ if moving to a newer Wrangler release.

---
name: Nested artifact workflows
description: Working-directory behavior when an artifact service runs code from an imported project nested in the workspace.
---

Artifact-owned service commands run from that artifact's directory, not the workspace root. When a service needs to execute code in an imported project nested elsewhere, calculate relative paths from the artifact directory and verify them by starting the managed workflow.

**Why:** A project path written relative to the workspace root was resolved beneath the artifact directory and prevented the API service from starting.

**How to apply:** Before redirecting an artifact workflow to a nested project, determine the service's working directory and form the command paths relative to it.

When root-level tooling is needed but a full workspace install is blocked by an unrelated leaf dependency, install just the root package with `pnpm install --filter workspace --frozen-lockfile`.

**Why:** A full install hit the package firewall on an unrelated transitive package, while the filtered root install made the declared Wrangler tool available without changing the lockfile.

**How to apply:** For root scripts such as Cloudflare dry-runs, filter installation to the root package instead of changing unrelated dependencies to force a full install.

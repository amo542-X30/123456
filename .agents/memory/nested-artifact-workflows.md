---
name: Nested artifact workflows
description: Working-directory behavior when an artifact service runs code from an imported project nested in the workspace.
---

Artifact-owned service commands run from that artifact's directory, not the workspace root. When a service needs to execute code in an imported project nested elsewhere, calculate relative paths from the artifact directory and verify them by starting the managed workflow.

**Why:** A project path written relative to the workspace root was resolved beneath the artifact directory and prevented the API service from starting.

**How to apply:** Before redirecting an artifact workflow to a nested project, determine the service's working directory and form the command paths relative to it.

---
name: Preview forwarding
description: Diagnosing a healthy artifact server whose Replit preview proxy returns 502.
---

The AM0SP customer app’s Vite server responded on its artifact port while the shared preview proxy continued returning 502. Restarting the artifact workflow and correcting/removing root `.replit` port mappings did not restore forwarding.

**Why:** repeated workflow restarts do not repair a stale application-router mapping and can waste time.

**How to apply:** verify the artifact port and direct HTTP response, then check for partial root `[[ports]]` mappings. Artifact services should use the application router; if explicit mappings exist, map all artifact ports or none. Restart once after a routing correction. If the proxy still returns 502 while the artifact port returns 200, stop source changes and treat it as a platform forwarding issue.

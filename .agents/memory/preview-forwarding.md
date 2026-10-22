---
name: Preview forwarding
description: Diagnosing a healthy artifact server whose Replit preview proxy returns 502.
---

The AM0SP customer app’s Vite server responded on its artifact port while the shared preview proxy returned 404 (“no previewable artifacts”). The artifact was registered, its managed workflow was running, and switching to a standard Vite port did not restore forwarding.

**Why:** a healthy artifact server and registered artifact do not guarantee the shared application router has a working route; repeated workflow restarts or source changes can waste time.

**How to apply:** verify the artifact port and direct HTTP response, then check for partial root `[[ports]]` mappings. Artifact services should use the application router; if explicit mappings exist, map all artifact ports or none. Restart once after a routing correction. If the proxy still returns 502/404 while the artifact port returns 200, stop source changes and treat it as a platform forwarding issue.

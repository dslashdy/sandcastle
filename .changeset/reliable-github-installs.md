---
"@ai-hero/sandcastle": patch
---

Build package artifacts during `prepare` so installing Sandcastle directly from a GitHub commit produces the required `dist/` files. Husky setup is now skipped for dependency installs and only runs in a local checkout. The Daytona SDK is also available as a dev-only build dependency so the optional Daytona provider can compile during git installs without making it mandatory for package consumers.

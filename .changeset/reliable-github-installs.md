---
"@ai-hero/sandcastle": patch
---

Build package artifacts during `prepare` so installing Sandcastle directly from a GitHub commit produces the required `dist/` files. Husky setup is now skipped for dependency installs and only runs in a local checkout. The optional Daytona provider now has local type declarations so git installs can compile without installing optional peer packages.

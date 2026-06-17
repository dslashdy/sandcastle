---
"@ai-hero/sandcastle": patch
---

Add Docker persistent home support for project-local Claude/Codex login. Docker scaffolds now generate a `.sandcastle/login.mts` helper, use `docker({ persistentHome: true })`, and can save a GitHub PAT to `.sandcastle/.env` during init.

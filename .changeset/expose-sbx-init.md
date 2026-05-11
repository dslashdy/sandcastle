---
"@ai-hero/sandcastle": patch
---

Expose SBX in `sandcastle init` as an agent-aware runtime provider for Claude Code and Codex. SBX writes Sandcastle's generated Dockerfile, builds it with Docker without host UID/GID alignment, loads it into SBX's template store, and scaffolds templates with `sbx({ agent: "claude", template: "sandcastle:<repo>" })` or `sbx({ agent: "codex", template: "sandcastle:<repo>" })`. Init now also accepts `--sandbox`, and `sandcastle sbx build-template` rebuilds/reloads the SBX template after Dockerfile changes.

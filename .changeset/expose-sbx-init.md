---
"@ai-hero/sandcastle": patch
---

Expose SBX in `sandcastle init` as an agent-aware runtime provider for Claude Code and Codex. SBX writes Sandcastle's generated Dockerfile, builds it with Docker, and scaffolds templates with `sbx({ agent: "claude", template: "sandcastle:<repo>" })` or `sbx({ agent: "codex", template: "sandcastle:<repo>" })`. Init now also accepts `--sandbox`.

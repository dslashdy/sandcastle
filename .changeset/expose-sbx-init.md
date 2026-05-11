---
"@ai-hero/sandcastle": patch
---

Expose SBX in `sandcastle init` as an agent-aware runtime provider for Claude Code and Codex. SBX scaffolds templates with `sbx({ agent: "claude" })` or `sbx({ agent: "codex" })`, skips Dockerfile/Containerfile generation, and does not prompt for image builds. Init now also accepts `--sandbox`.

---
"@ai-hero/sandcastle": minor
---

`sandcastle init` now supports fully non-interactive setup. Every interactive prompt has a paired CLI flag (`--issue-tracker`, `--create-label`, `--build-image`, `--install-template-deps`) on top of the existing `--agent` / `--template` / `--sandbox` / `--model` / `--image-name`. When stdin is not a TTY and a flag is missing for a prompt that would otherwise fire, init fails fast with a message naming the missing flag instead of crashing on the prompt library.

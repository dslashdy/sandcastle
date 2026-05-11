---
"@ai-hero/sandcastle": patch
---

Add an SBX sandbox provider that creates `sbx create shell` sandboxes by default, can opt into agent-specific SBX sandboxes such as `sbx({ agent: "claude" })`, executes commands with `sbx exec`, copies files with `sbx cp`, and exposes `@ai-hero/sandcastle/sandboxes/sbx`. Also relax Git setup timeouts so slower local sandbox runtimes can complete sequential Git config commands reliably.

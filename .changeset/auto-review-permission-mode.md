---
"@ai-hero/sandcastle": minor
---

Add `permissionMode` to `claudeCode()` and `approvalsReviewer` to `codex()` — provider-level options for AI-mediated per-tool approval, an alternative to full bypass for AFK host runs (`noSandbox()` + `run()`).

`claudeCode({ permissionMode: "auto" })` emits `--permission-mode auto` instead of `--dangerously-skip-permissions`. Accepts any of Claude's permission modes: `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`.

`codex({ approvalsReviewer: "auto_review" })` swaps `--dangerously-bypass-approvals-and-sandbox` for `-a on-request -s danger-full-access -c approvals_reviewer="auto_review"` so Codex's reviewer agent evaluates each approval prompt.

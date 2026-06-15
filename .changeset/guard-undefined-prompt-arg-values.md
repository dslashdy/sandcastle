---
"@ai-hero/sandcastle": patch
---

Guard `substitutePromptArgs` against `undefined`/`null` values in `promptArgs`. Previously, a present-but-nullish value (e.g. `{ TITLE: undefined }` from an orchestrator's `JSON.parse` output) bypassed the existence check and crashed with an unguarded `TypeError` on `.toString()`. Now surfaces a clean `PromptError` naming the offending key. `findMissingPromptArgKeys` also treats present-but-nullish values as missing, so the interactive prompt-fill flow asks the user to supply the value rather than failing through.

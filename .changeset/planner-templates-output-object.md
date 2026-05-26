---
"@ai-hero/sandcastle": patch
---

The `parallel-planner` and `parallel-planner-with-review` init templates now parse the planner's `<plan>` output with `Output.object` and a Zod schema instead of a bespoke regex helper. The templates depend on Zod, but any [Standard Schema](https://standardschema.dev) validator (Valibot, ArkType, …) works; `sandcastle init` now reminds you to install one. A missing tag or malformed plan JSON now throws `StructuredOutputError`.

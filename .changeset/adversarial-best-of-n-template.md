---
"@ai-hero/sandcastle": patch
---

Add an `adversarial-best-of-n` init template. It resolves issues one at a time with a best-of-N pipeline: N cross-model candidates are generated on separate branches, a deterministic gate (linters, type checker, tests, property suite, and complexity/nesting/dependency preconditions) discards failures, survivors are ranked lexicographically with tolerance bands, and the single whole winner gets at most one bounded critic-driven repair before a fast-forward merge. The deterministic gate decides what ships — the critic may veto a winner to human review but can never approve one.

Each per-issue workflow runs entirely in containers: the generator/critic/reviser nodes each get their own sandbox, and the deterministic gate runs its toolchain inside a per-issue container built from the sandbox image. The template's Dockerfile bundles that toolchain (ruff, mypy, pytest, hypothesis, complexipy) via a new `{{TEMPLATE_TOOLS}}` scaffold placeholder, so no Python tools are required on the host.

---
"@ai-hero/sandcastle": patch
---

Add an `adversarial-best-of-n` init template. It resolves issues one at a time with a best-of-N pipeline: N cross-model candidates are generated on separate branches, a deterministic gate (linters, type checker, tests, property suite, and complexity/nesting/dependency preconditions) discards failures, survivors are ranked lexicographically with tolerance bands, and the single whole winner gets at most one bounded critic-driven repair before a fast-forward merge. The deterministic gate decides what ships — the critic may veto a winner to human review but can never approve one.

Each per-issue workflow runs entirely in containers: the generator/critic/reviser nodes each get their own sandbox, and the deterministic gate runs its toolchain inside a per-issue container built from the sandbox image. The template's Dockerfile bundles that toolchain (ruff, mypy, pytest, hypothesis, complexipy) via a new `{{TEMPLATE_TOOLS}}` scaffold placeholder, so no Python tools are required on the host.

The generated orchestrator also uses the selected backlog manager's task-list command for `fetchIssues()`, including GitHub Issues with the `Sandcastle` label, instead of scaffolding a Linear API TODO.

The adversarial template now implements its deterministic complexity gate with `complexipy` and a Python AST nesting pass, so candidates no longer hit a scaffolded `complexityReport()` TODO. Docker sandbox setup also retries global git config writes, avoiding `.gitconfig` lock races when parallel candidates share a persistent agent home.

The generated adversarial orchestrator now logs the exact model assigned to each generator candidate before launching them, and no longer defaults the critic to the inaccessible `claude-sonnet-4-8` model.

After the deterministic gate selects a winner, the generated adversarial orchestrator now merges the issue branch back into the local branch that launched the run and then closes the backlog item with the selected backlog manager's close command.

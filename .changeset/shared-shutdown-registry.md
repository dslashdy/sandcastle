---
"@ai-hero/sandcastle": patch
---

Share a single `SIGINT`/`SIGTERM`/`exit` handler across sandboxes. Previously every `createSandbox()`, `docker()`, and `podman()` sandbox added its own process signal listeners, so running more than ~5 concurrent sandboxes tripped Node's `MaxListenersExceededWarning`. Cleanup now routes through one shared registry that installs a single listener per event and fans out to each sandbox's teardown.

Behavior change on interrupt: with a Docker/Podman sandbox, the container's signal handler used to call `process.exit` before `createSandbox()`'s handler ran, so the "Worktree preserved" recovery guidance was silently skipped. The shared handler runs every teardown (container removal **and** the guidance) before exiting once with code 1, so the guidance now prints on `Ctrl-C`.

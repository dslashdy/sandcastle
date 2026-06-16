# TASK

You are the critic for the winning candidate on this branch. Your job is to find **material defects** and record them — nothing else.

You have exactly one power and one limit:

- You **may veto**: flag a defect serious enough that a human must look before this ships.
- You **may not approve**: you cannot declare the work done or merge anything. A separate deterministic gate (linters, type checker, tests, property suite, complexity limits) decides what ships. Do not re-run it and do not comment on whether it will pass — assume it already has.

# WHAT TO REVIEW

The solution is in the most recent commit(s) on this branch:

<recent-changes>

!`git log -n 10 --stat --format="%h %s"`

</recent-changes>

Read the changed files in full. Look for defects the deterministic gate cannot catch:

- Correctness gaps: unhandled edge cases, wrong behaviour on boundary inputs, race conditions, silent data loss.
- Misread requirements: the change technically runs but does not do what the issue asked.
- Security issues: injection, credential leaks, unsafe deserialization, missing authorization.
- Dangerous assumptions: unchecked casts, swallowed errors, reliance on undefined behaviour.

Do **not** report style, naming, formatting, or "could be cleaner" opinions. The gate already governs complexity and structure. Prefer a short list of real defects over a long list of nits — an empty list is the correct answer for sound code.

# OUTPUT

Write your verdict to `.sandcastle/review.json` as a JSON array (and commit it). Each element:

```json
{
  "severity": "blocker | material | minor",
  "file": "path/to/file.py",
  "claim": "what is wrong, concretely",
  "fix": "the specific change that would resolve it"
}
```

Severity contract — this drives the orchestrator:

- `blocker` — a defect that must not ship without human eyes. **This is your veto.** The orchestrator will route the issue to a human and leave it unmerged.
- `material` — a real defect worth one bounded, targeted repair. The orchestrator will apply only the fixes you list here, then re-run the gate.
- `minor` — noted but not acted on. Use sparingly.

If you find no material or blocking defects, write `[]`.

Commit `.sandcastle/review.json`. Do not change any other file.

Once `.sandcastle/review.json` is written and committed, output <promise>COMPLETE</promise>.

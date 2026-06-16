# TASK

Apply a single, bounded repair to the code on this branch. Fix **only** the defects listed below — nothing else.

<defects>

{{REVIEW_JSON}}

</defects>

These are the `material` items from the critic's review (also committed at `.sandcastle/review.json`).

# RULES

- Address every listed defect, and only those. Do not refactor, rename, reformat, or "improve" anything that is not named here. Unrelated edits will get this work bounced back to a human.
- Apply the smallest change that resolves each `claim`. The critic's `fix` is a strong suggestion — follow it unless you find a clearly better minimal fix for the same defect.
- Keep functions simple and shallow. The deterministic gate enforces a cognitive-complexity ceiling and a nesting limit; **a repair that pushes any function over the ceiling will be thrown away entirely**, losing your work. When in doubt, prefer the change that keeps complexity low.
- Do not add a third-party dependency unless a defect cannot be fixed without one; if you must, record a one-line justification per package in `.sandcastle/deps-rationale.md`.

# FEEDBACK LOOP

After making the fixes, run the project's checks (for Python: `ruff check`, `mypy`, `pytest` including property tests) and make sure they pass.

# COMMIT

Commit the repair on this branch with a message that references the defects you fixed. Do not touch any other branch or the issue.

Once the listed defects are fixed and committed, output <promise>COMPLETE</promise>.

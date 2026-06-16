# TASK

Resolve this issue with a complete, production-quality change on the current branch.

<issue id="{{ISSUE_ID}}">

## {{ISSUE_TITLE}}

{{ISSUE_BODY}}

</issue>

You are one of several independent attempts at this issue. Solve it your own way — there is no shared plan to follow.

# CONTEXT

Recent history on this branch:

<recent-commits>

!`git log -n 10 --format="%h %ad %s" --date=short`

</recent-commits>

# EXPLORATION

Explore the repo and load the parts relevant to this issue into your context — especially the existing tests around the code you will touch. Match the surrounding style and conventions.

# EXECUTION

Work test-first:

1. RED — write a failing test that pins the behaviour the issue asks for. Where the requirement is a property ("for all inputs …"), write a hypothesis property test, not just examples.
2. GREEN — write the simplest implementation that passes.
3. REPEAT until the issue is fully resolved.
4. REFACTOR — leave the code clear. Prefer small, flat functions over deep nesting and clever one-liners.

# FEEDBACK LOOPS

Before committing, run your project's checks and make them pass — for a Python project that means `ruff check`, `mypy`, and `pytest` (including any property tests). A change that does not pass these locally will be discarded downstream.

# DEPENDENCIES

Avoid adding third-party dependencies. If one is genuinely necessary, add it to the project's manifest **and** write a one-line justification per dependency to `.sandcastle/deps-rationale.md` (naming each package). An unexplained new dependency will be rejected.

# COMMIT

Commit your work on this branch with a clear message describing what you changed and why. Do not open or close the issue, and do not touch any other branch.

# RULES

- Resolve only this issue.
- Make the change correct and minimal — no unrelated edits, no scope creep.

Once the issue is fully resolved and committed, output <promise>COMPLETE</promise>.

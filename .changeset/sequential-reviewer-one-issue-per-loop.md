---
"@ai-hero/sandcastle": patch
---

Fix the `sequential-reviewer` template processing the entire backlog in a single pass: the implementer now runs for one iteration so each outer loop handles one issue on its own branch, and the loop stops once the backlog is exhausted. Also fix the empty review diff in both `sequential-reviewer` and `parallel-planner-with-review` templates — `review-prompt.md` now diffs the branch against `{{TARGET_BRANCH}}` (the fork point) instead of `{{SOURCE_BRANCH}}`, which equals the branch itself and always produced an empty diff.

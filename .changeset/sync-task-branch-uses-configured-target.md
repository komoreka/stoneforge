---
"@stoneforge/smithy": patch
---

fix(smithy): syncTaskBranch pre-merge sync uses workspace-configured target branch

`syncTaskBranch` (the pre-merge sync that runs before CodeReview sees a task)
called `worktreeManager.getDefaultBranch()` to determine which branch to merge
into the task's worktree. That method uses git detection only (resolves to
`master`), ignoring the workspace's `merge.targetBranch` config and the task's
own `targetBranch` metadata. The result: branches correctly rooted on `dev` had
`master`-only commits injected before review.

The fix applies the same priority order used by task dispatch:
task metadata → `merge.targetBranch` workspace config → git detection.

Also fixes two hardcoded "master" strings in the CodeReview prompt that
were copied verbatim regardless of the configured target branch.

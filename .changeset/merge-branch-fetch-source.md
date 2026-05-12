---
"@stoneforge/smithy": patch
---

fix(smithy): fetch remote-only source branch before squash merge

`mergeBranch()` called `git fetch origin` (which updates `origin/*` tracking refs)
but then ran `git merge --squash <sourceBranch>` against the bare local ref. Agent
task branches created by workers exist only on the remote and were never checked out
locally, causing git to report "not something we can merge".

After `git fetch origin`, if `sourceBranch` has no local ref, a targeted
`git fetch origin <branch>:<branch>` now creates one. The fetch is silenced when
the branch doesn't exist on the remote either — the subsequent merge step produces
the appropriate error in that case.

---
"@stoneforge/smithy": minor
"@stoneforge/core": minor
---

fix: five bugs from 2026-05-12 dogfooding bundle

**Bug 3 — sf task handoff re-dispatches to original worker**
`sf task handoff` now accepts `--to <agent-id>`. When provided, the task is
atomically assigned to the target agent instead of returning to the free pool,
preventing the dispatch daemon from immediately re-assigning it back to the
original worker. Without `--to`, a tip is printed reminding callers to use
`sf task assign` if direct routing is needed.

**Bug 3/5 — pre-assigned OPEN tasks never reach workers**
The daemon's `pollPersistentWorkerDispatch` now runs a pre-pass (Pass 1) each
cycle. For every idle persistent worker with an OPEN assigned task and an
active session, it delivers a direct session notification (30s cooldown).
This covers tasks assigned via `sf task assign`, `sf task handoff --to`, or a
Director inbox message that preceded the daemon's last poll cycle.

**Bug 5 — dispatch race window**
`pollPersistentWorkerDispatch` re-fetches each candidate task immediately before
calling `dispatchService.dispatch()`. If another operation (Director, CLI)
assigned the task in the window between the `api.ready()` snapshot and the
dispatch, the task is skipped and removed from the snapshot.

**Bug 2 — sf task merge leaves GitHub PR as closed-no-merge**
After local squash+push, `sf task merge` now calls `gh pr close` with an
explanatory comment when a PR URL is present in orchestrator metadata. This
provides an explicit paper trail instead of silent auto-close on branch
deletion. (Full GitHub merge-API integration is deferred to a follow-on PR.)

**Bug 7 — no OPS task type**
Added `OPS: 'ops'` to `TaskTypeValue` in `@stoneforge/core`. OPS tasks are
operational/non-code work (Azure data operations, access changes, etc.) that
should bypass the worktree+commit+PR lifecycle. Dispatch and steward logic
can now filter on `taskType === 'ops'`.

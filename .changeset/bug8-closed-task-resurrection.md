---
"@stoneforge/smithy": patch
---

fix(smithy): prevent closed tasks from resurrecting to open/review

Three independent paths could reverse an operator's explicit task close:

**reconcileClosedUnmergedTasks** — now only reconciles tasks closed while the
steward was *actively* merging (`testing`, `merging`). All other states are
excluded: `failed`, `conflict`, `test_failed` indicate the steward gave up;
`pending` means the steward had not yet started — any operator close at that
point is intentional. The previous filter included both `failed` and `pending`,
which combined with stale `orchestratorMeta.assignedAgent` (Bug 5) caused agents
to receive dispatch notifications for already-closed, already-verified work
(observed compound failure: el-671g4 pattern).

**handoffTask** — now throws if the task is already closed, matching the existing
guard on `completeTask`. Previously any worker that held a stale task reference
could hand it off to another worker, resetting status to OPEN.

**assignToAgent / startTask** — both now throw on closed tasks, providing a
defensive layer against accidental re-dispatch or re-start of closed work.

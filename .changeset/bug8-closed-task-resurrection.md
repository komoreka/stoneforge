---
"@stoneforge/smithy": patch
---

fix(smithy): prevent closed tasks from resurrecting to open/review

Three independent paths could reverse an operator's explicit task close:

**reconcileClosedUnmergedTasks** — now only reconciles tasks closed while still
in an active merge state (`pending`, `testing`, `merging`). Terminal failure states
(`failed`, `conflict`, `test_failed`) are excluded: the merge steward already gave
up, so a subsequent operator close is intentional and must not be reversed. The
previous filter included `failed`, causing closed tasks to silently reappear in
REVIEW after the grace period expired.

**handoffTask** — now throws if the task is already closed, matching the existing
guard on `completeTask`. Previously any worker that held a stale task reference
could hand it off to another worker, resetting status to OPEN.

**assignToAgent / startTask** — both now throw on closed tasks, providing a
defensive layer against accidental re-dispatch or re-start of closed work.

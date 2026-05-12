---
"@stoneforge/smithy": patch
---

fix(smithy): resync stale orchestratorMeta.branch when canonical assignee diverges

`assignToAgent()` generates branch/worktree paths from the agent name at dispatch
time, but `sf task assign` (quarry layer) only updates `task.assignee` — not the
orchestrator metadata. This left `orchestratorMeta.assignedAgent` and
`orchestratorMeta.branch` pointing at the first dispatch recipient (e.g., CodeAdmin)
even after the Director re-routed the task to a different worker (e.g., CodeDelivery),
causing `sf task sync` and `sf task merge` to reference a branch that was never
created (el-4vorj pattern).

Pass 1 of `pollPersistentWorkerDispatch` now detects the divergence
(`task.assignee != orchestratorMeta.assignedAgent`) on OPEN tasks and calls
`taskAssignment.assignToAgent()` to regenerate branch/worktree for the canonical
assignee before sending the pre-assignment notification. The resync is non-fatal:
if it fails, the notification still fires with the stale metadata rather than
silently dropping the notification.

---
"@stoneforge/smithy": patch
---

fix(smithy): getAgentTasks uses root task.assignee as sole canonical field

`orchestratorMeta.assignedAgent` diverges from `task.assignee` when tasks are
assigned via `sf task assign` (quarry-layer direct update that does not propagate
to orchestrator metadata). The previous OR condition in `getAgentTasks` and
`determineAssignmentStatus` caused a task to appear in two workers' active-task
queues simultaneously after reassignment, triggering double Pass-1 dispatch
notifications and two workers attempting the same task.

`task.assignee` is now the sole canonical field for assignment lookups.
`orchestratorMeta.assignedAgent` is retained as historical audit data only.

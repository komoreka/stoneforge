---
"@stoneforge/smithy": patch
---

fix(smithy): orphan recovery dispatches highest-priority task first

`recoverOrphanedAssignments` was selecting the first element from `getAgentTasks` without sorting, so the task recovered depended on storage insertion order rather than priority. A P3 task created before a P1 task would be dispatched first.

Adds an ascending sort by `task.priority` before selecting the task to recover, matching the intent of priority-based scheduling. Adds a regression test with a P3 task created before a P1 task to confirm the P1 task is always recovered first.

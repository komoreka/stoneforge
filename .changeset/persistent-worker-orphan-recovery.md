---
"@stoneforge/smithy": patch
---

fix(smithy): orphan recovery now spawns sessions for persistent workers

Persistent workers were excluded from `recoverOrphanedAssignments` (only `workerMode: 'ephemeral'` were scanned). When a director assigned a task to a persistent worker that had no active session, nothing in the daemon would spawn one — `pollWorkerAvailability` skips persistent workers by design (they don't auto-claim from the unassigned queue), and `processPersistentAgentMessage` only forwards inbox messages to existing sessions. The result: persistent workers with director-assigned tasks would sit idle indefinitely.

Removes the `workerMode: 'ephemeral'` filter from `recoverOrphanedAssignments` so both ephemeral and persistent workers get re-spawned when they have assigned tasks but no active session. The rest of the recovery path (rate-limit checks, resume vs. fresh spawn, resumeCount tracking, recovery-steward escalation on stuck tasks) is mode-agnostic and works unchanged for both. `pollWorkerAvailability` is unchanged — persistent workers still don't auto-claim from the queue.

---
"@stoneforge/smithy": patch
---

fix(smithy): persistent workers now receive their own prompt and are recovered by orphan recovery

Two related bugs caused persistent workers to silently stall after their first task:

**Bug 1 — wrong prompt.** `buildTaskPrompt` hardcoded `workerMode: 'ephemeral'` when loading the role prompt, so persistent workers received the ephemeral worker instructions ("Auto-shutdown: your session ends automatically") instead of the persistent worker instructions. The result: a persistent worker would exit after completing its task, exactly as an ephemeral worker would.

**Bug 2 — orphan recovery blind spot.** `recoverOrphanedAssignments` filtered workers to `workerMode: 'ephemeral'`, so a persistent worker with a director-assigned task and no active session was never respawned. `pollWorkerAvailability` skips persistent workers by design (they don't auto-claim from the queue), and `processPersistentAgentMessage` only forwards inbox items to existing sessions. The result: persistent workers with tasks assigned sat idle indefinitely.

Fixes both by (1) looking up the spawned worker's actual `workerMode` in `buildTaskPrompt` before selecting the role prompt, and (2) removing the `workerMode: 'ephemeral'` filter from `recoverOrphanedAssignments` so both worker modes are scanned. The rest of the orphan recovery path (rate-limit checks, resumeCount tracking, recovery-steward escalation) is mode-agnostic and works unchanged for persistent workers.

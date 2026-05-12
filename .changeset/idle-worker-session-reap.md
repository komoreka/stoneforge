---
"@stoneforge/smithy": patch
---

fix(smithy): auto-recover idle persistent worker sessions with pending work

Persistent worker sessions can silently stall while their process remains alive
(e.g. lost Claude authentication showing "Not logged in"). Because the process
is alive, orphan recovery skips them — and the sessions never make progress.

The fix adds `reapIdlePersistentWorkerSessions()` to the poll cycle, running
just before orphan recovery. Any persistent worker session idle beyond
`idleWorkerSessionThresholdMs` (default: 30 minutes) that has assigned tasks or
unread inbox items is stopped. Orphan recovery, which runs in the same cycle
immediately after, respawns it with a fresh context and task prompt.

New config fields on `DispatchDaemonConfig`:
- `idleWorkerSessionThresholdMs` — idle threshold in ms (default: 1 800 000)
- `idleWorkerSessionReapEnabled` — opt-out flag (default: true)

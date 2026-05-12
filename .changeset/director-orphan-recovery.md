---
"@stoneforge/smithy": patch
---

fix(smithy): orphan recovery now auto-respawns directors whose sessions have terminated

Before this fix, the dispatch daemon had no recovery path for directors. When a director's
session ended (context-window exhaustion, process crash, or service restart without clean
shutdown), `sessionStatus` would stay `running` (ghost) or flip to `idle` — either way, no
new task assignments reached persistent workers and the whole system stalled silently until
an operator ran `sf agent start` manually.

`recoverOrphanedAssignments` now includes a Phase 0 that scans all directors, calls
`getActiveSession` (which performs a PID liveness check and cleans up dead session records),
and respawns any director that has no active session. The initial prompt is built the same
way as the sessions route (`sf agent start`) — framed role prompt from the project override
or built-in `director.md`, director ID injection, and workflow preset context — so the
respawned director behaves identically to one started manually.

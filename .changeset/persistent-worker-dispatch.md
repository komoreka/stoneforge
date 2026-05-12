---
"@stoneforge/smithy": minor
---

feat(smithy): daemon auto-dispatches tasks to idle persistent workers

Adds `pollPersistentWorkerDispatch()`, called each poll cycle after
`pollInboxes`. For every idle persistent worker (no active tasks, no
unread inbox items), it assigns the highest-priority unassigned task
and sends an inbox notification to the worker's existing session. The
Director's own assignment loop continues to work alongside this — the
daemon is an additional dispatch path, not a replacement.

Controlled by `persistentWorkerDispatchEnabled` config (default: true).

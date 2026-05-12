---
"@stoneforge/smithy": patch
---

fix(smithy): don't mark persistent worker inbox items as read when message delivery fails

`processPersistentAgentMessage` called `sessionManager.messageSession()` but
never checked the return value. `messageSession` catches all PTY write errors
internally and returns `{success: false}` rather than throwing. As a result,
inbox items were unconditionally marked as read even when the PTY write failed
(e.g., buffer full or degraded session after long uptime), silently dropping
the message.

The fix checks the delivery result: on failure, log a warning and leave the
inbox item unread so the next poll cycle retries delivery. Combined with
`reapIdlePersistentWorkerSessions`, a stuck session is eventually killed and
respawned with fresh context, at which point the pending inbox items are
delivered to the new session.

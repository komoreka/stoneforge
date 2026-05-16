---
"@stoneforge/smithy": patch
---

fix(smithy): break self-addressed dispatch loops (GUARD 1 + GUARD 2)

Production incident: the dispatch daemon repeatedly sent "Task assigned to you"
reminders to the same worker every 1-2 seconds, with the visible sender labelled
as the recipient itself (`[Message from el-bhgi]: ...` arriving in `el-bhgi`'s
session). A single stuck task burned 40+ worker evaluations in under a minute
before the operator intervened.

Root cause: Pass 1 and Pass 2 of `pollPersistentWorkerDispatch` were both
constructing the session-message payload with `senderId: workerId`, where
`workerId` is also the recipient. The message-format prefix
(`[Message from {senderId}]`) then made every dispatch look like the worker
talking to itself, and the worker dutifully responded "Ignoring" to each one
while the daemon kept reminding.

**GUARD 1 — Self-dispatch prevention.** Both Pass 1 and Pass 2 now omit
`senderId`, falling through to `messageSession`'s `'system'` default. A defensive
check in `messageSession` itself now rejects any message whose `senderId` equals
the session's owning `agentId` — daemon-originated notifications must never be
addressed from an agent to themselves, and this guard catches any future
regression at the lowest layer before it can reach the PTY.

**GUARD 2 — Loop-guard threshold.** Pass 1 tracks per-(worker, task) the count
of consecutive notifications sent while task status and assignee remain
unchanged. After `LOOP_GUARD_THRESHOLD` (3) identical-state notifications, the
loop-guard hard-suppresses further dispatch on that pair and logs one
`[LOOP-GUARD] Suppressed dispatch to <worker> on <task> after N consecutive
notifications without state change. Likely Bug 5/Bug 9 divergence; operator
action required (sf task close or sf task assign).` line for operator grep.
The counter resets automatically when task state transitions, so legitimate
re-dispatches after a status change continue normally.

**Does GUARD 1 also resolve the "deferred-state dispatch" variant?** Partially.
The deferred-state ping pattern produces the same `senderId == recipientId`
shape, so GUARD 1's rejection at the session-manager layer would block any
deferred-state ping that tried to address itself. The underlying decision to
fire a ping at all for a deferred task is still Bug 9 territory and may need
its own follow-up depending on whether deferred tasks are intentionally
re-pinged when un-deferred.

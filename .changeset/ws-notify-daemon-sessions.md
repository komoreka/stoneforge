---
"@stoneforge/smithy": patch
---

fix(smithy): XTerminal now updates when daemon spawns a new session for persistent agents

When the dispatch daemon spawned a new session (orphan recovery, task dispatch) for a
persistent worker or director, WebSocket clients (XTerminal) were never notified. Only
SSE clients (StreamViewer, used by ephemeral workers) received the `notifyClientsOfNewSession`
call. As a result, the terminal stayed blank or showed the previous session's output until
the user manually refreshed the browser.

The fix adds `notifyClientsOfNewSession` to the `onSessionStarted` callback in
`services.ts`, which is already called for every daemon-spawned session. WebSocket clients
now receive a `session-started` message, which causes XTerminal to clear the terminal and
start streaming the new session's PTY output in real time.

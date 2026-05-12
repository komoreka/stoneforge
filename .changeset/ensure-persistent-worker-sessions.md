---
"@stoneforge/smithy": minor
---

fix(smithy): ensure persistent workers always have sessions after restart

After a daemon restart, orphan recovery only re-spawns sessions for
persistent workers whose tasks are in `open` or `in_progress` status. Workers
whose tasks had moved to `review` (or who had no tasks at all) were silently
skipped, leaving them unable to receive new inbox messages from the director.

Adds `ensurePersistentWorkerSessions()`, called in the poll cycle after orphan
recovery. For every non-disabled persistent worker with no active session, it
spawns a standby session using the persistent worker role prompt in the main
project directory. Orphan recovery retains priority: task-specific sessions
(worktree + task prompt) are spawned first; this function only fires for
workers that orphan recovery would have skipped.

Also exposes the method on the `DispatchDaemon` interface for testability and
manual invocation. Controlled by `persistentWorkerSessionEnsureEnabled` config
flag (default: true).

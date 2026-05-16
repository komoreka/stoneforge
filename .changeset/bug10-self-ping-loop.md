---
"@stoneforge/smithy": patch
---

fix(smithy): per-(worker, task) cooldown for pre-assigned notifications

Pass 1 of `pollPersistentWorkerDispatch` was suppressing duplicate notifications
on a per-worker basis with a 30-second window. For a worker that had been
assigned a task they hadn't yet started, every 30 seconds another "Task assigned
to you" notification would fire — yielding ~20 duplicate pings within 10
minutes for the same task (Bug 10 — self-ping loop).

The cooldown key is now `${workerId}:${taskId}` rather than `workerId`, and the
window is 5 minutes rather than 30 seconds. A worker who has been notified about
a particular task will not be re-pinged about that same task on subsequent poll
cycles for 5 minutes. New assignments to the same worker for a *different* task
are not suppressed by the prior ping. A stuck OPEN task still gets a periodic
reminder, but at a rate workers can actually act on rather than treat as noise.

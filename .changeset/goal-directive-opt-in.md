---
"@stoneforge/smithy": minor
---

feat(smithy): opt-in `/goal` directive for worker prompts (requires Claude Code v2.1.139+)

Adds a `goalDirectiveEnabled` flag to `DispatchDaemonConfig` (default: `false`).
When enabled, worker task prompts begin with a Claude Code `/goal` slash command
that gives the worker an explicit completion condition. Claude Code then auto-
continues the conversation across turns until a Haiku evaluator decides the goal
is satisfied.

The goal condition is observable from the conversation transcript:

> Task <id> reaches one of these terminal states: (a) status is 'review' or
> 'closed' (worker ran `sf task complete`), or (b) task is reassigned to a
> different agent (worker ran `sf task handoff`). Verify with:
> `sf task view <id>`

**Why opt-in:** the daemon already has its own resume-loop heuristic
(`maxResumeAttemptsBeforeRecovery`, default 3). If the daemon resumes a worker
that's also being kept alive by `/goal`, the two systems will fight — workers
may run longer than the daemon expects, triggering spurious recovery-steward
spawns. Enable this flag for one workspace at a time, and consider raising
`maxResumeAttemptsBeforeRecovery` if you observe interaction issues.

**Cost note:** `/goal` runs a Haiku evaluation per worker turn. Cost is small
per call but cumulative across many persistent workers; budget accordingly.

---
"@stoneforge/smithy": minor
---

feat(smithy): in-process HealthMonitor for worker auth-loss + dispatch-loop detection

Adds a detection-only service that runs on every daemon poll cycle to catch
three failure modes that previously produced operator token-burn and silent
worker outages:

1. **Worker auth-loss** — subscribes to PTY events on every active worker
   session and watches a 4 KB rolling output buffer for markers
   (`Please run /login`, `Not logged in`, `Session expired`,
   `Authentication required`). When matched, surfaces a finding to the
   Director — `sf agent show` reports `status: running` for these workers
   but they are silently no-op.

2. **Self-addressed daemon pings** — regression sentinel for GUARD-1 (PR #27).
   Scans each active agent's inbox for messages where sender equals
   recipient within a 5-minute window; flags at ≥2 such messages. Post-#27
   this should be zero, but a regression surfaces immediately rather than
   waiting for an operator to notice token burn.

3. **Repeat-identical dispatches** — scans each agent's inbox for messages
   with identical sender + content reference received ≥3 times within
   60 seconds. The classic Bug 5 (orchestrator metadata divergence) / Bug 9
   (session-affinity misroute) signature.

**Surfacing:** findings deliver to the Director via `messageSession` (when
the Director's session is active) and the operation log (always). Each
`(agentId, issueType)` pair is throttled to one surface per 10 minutes.

**Detection-only invariants:**
- Never auto-closes tasks
- Never auto-stops or restarts agents
- Never modifies task state, assignee, or orchestrator metadata
- Operator decides response

**Config:** `healthMonitorEnabled` defaults to `true`. Set to `false` to
disable (e.g., for test harnesses or workspaces where the monitor's
director-surfacing overhead is unwanted).

Replaces the previously-spec'd standalone Python tool. In-process design
avoids needing to ship two prerequisite PRs (session-log persistence,
`sf inbox --json`).

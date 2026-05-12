---
"@stoneforge/smithy-web": patch
---

feat(smithy-web): add per-agent board view to agents page

Adds a "Board" tab to the `/agents` page showing a horizontal per-agent
swim-lane layout. Each column displays the agent's active session status
(running/idle/suspended/terminated/starting) with a live pulse indicator,
followed by task cards for all non-closed assigned tasks.

Task cards show: priority color dot (P1–P5), title, status badge, and
branch name. Cards are sorted by status (in_progress first, review next)
then by priority. Blocked tasks surface a warning indicator in the
column header.

Clicking a column header opens the agent's terminal in the workspaces view.

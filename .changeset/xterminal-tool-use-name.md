---
"@stoneforge/smithy-web": patch
---

fix(smithy-web): XTerminal agent event handler reads correct SpawnedSessionEvent fields

`handleAgentEvent` used `event.data?.name` for `tool_use` events, but
`SpawnedSessionEvent` serializes the tool name at `event.tool.name`. The
`data` field does not exist on `SpawnedSessionEvent`, so every tool call
rendered as `[Tool: unknown]` in the agent terminal pane.

Also aligns the other event field accesses with the actual shape:
`event.message` (not `event.content` / `event.output`) for assistant,
tool_result, system, and error events.

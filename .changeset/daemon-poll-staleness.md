---
"@stoneforge/smithy": minor
"@stoneforge/smithy-web": patch
---

feat(smithy): detect and surface dispatch daemon poll-loop staleness

A wedged dispatch daemon — process alive, HTTP responsive, but `runPollCycle` hung — would quietly stop dispatching, scheduling, and recovering with no signal to the operator. The daemon now tracks `lastPollStartedAt` and `lastPollCompletedAt`, and exposes a `pollStale` flag in `getDispatchHealth()` (true when either a cycle is in flight past the threshold, or the last completion is older than the threshold). Default threshold is `max(60_000, 10 × pollIntervalMs)`, configurable via the new `pollStaleThresholdMs` config field.

The `DispatchHealthBanner` in smithy-web renders a distinct red wedge-daemon banner when `pollStale` is true (vs. the existing amber stuck-queue banner), advising the operator to restart `sf serve smithy`. When both conditions are true, the wedge banner takes priority since a stuck queue is unresolvable while the daemon is dead.

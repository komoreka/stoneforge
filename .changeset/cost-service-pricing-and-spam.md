---
"@stoneforge/core": patch
"@stoneforge/smithy": patch
---

fix(cost-service): add pricing entries for Sonnet 4.6 / Opus 4.7 + suppress repeat warnings

The pricing table was missing entries for `claude-sonnet-4-6` and `claude-opus-4-7`,
causing every cost-calculation cycle to emit a "No pricing found for model" warning
and fall back to default Sonnet pricing. With the metrics enrichment running on
every poll, this produced hundreds of duplicate log lines per minute.

Two changes:

- **Pricing entries added** for `claude-sonnet-4-6` (Sonnet tier: $3 / $15 / $0.30 /
  $3.75 per 1M tokens) and `claude-opus-4-7` (Opus tier: $15 / $75 / $1.50 / $18.75).
  Values match the previously-published rates for the same tier; should be revised
  if Anthropic publishes different rates for these specific versions.

- **Warning deduplication** in `cost-service`: each unique model name now emits
  the "no pricing found" warning at most once per service instance (per daemon
  process lifetime). New unknown models still surface a warning on first encounter,
  preserving the diagnostic signal without the log flood.

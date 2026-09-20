# Analytics history split

The log envelope stamped `getPlayerGuid()` (raw GUID) until the deploy of
`feature/analytics-instrumentation`, and `getEffectivePlayerId()` after it.

For a signed-in player those are DIFFERENT STRINGS, so any query spanning that
boundary sees one human as two players.

**Funnel and cohort queries must start at the deploy date. Fill it in below when
this ships.**

- Deploy date: `TBD — fill in at release`
- Version: `TBD — fill in at release`

Pre-deploy rows are deliberately not backfilled (see the spec's Non-goals).

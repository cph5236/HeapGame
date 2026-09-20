# Analytics history split

This branch's deploy creates **two independent discontinuities** in `run:end`
history. A query spanning the deploy can hit either one, or both, depending on
what it selects — so "this query doesn't touch player identity" is not a reason
to skip the date filter below.

## 1. Player id changes

The log envelope stamped `getPlayerGuid()` (raw GUID) until the deploy of
`feature/analytics-instrumentation`, and `getEffectivePlayerId()` after it.

For a signed-in player those are DIFFERENT STRINGS, so any query spanning that
boundary sees one human as two players.

## 2. New AE columns start at zero, not null

This branch also appends `double2..double6` and `blob8` to `run:end` rows
(score, height, kills, durationMs, pickupBonus, cause — see
`shared/logging/aeProjection.ts`). Rows written before the deploy don't have
them. **AE returns `0` for an unset double, not `null`.** So `AVG(double2)` or
`SUM(double6)` over a window straddling the deploy silently averages/sums in
zeros for every pre-deploy row instead of erroring or excluding them.

**Funnel, cohort, and column-based (`double2..6`/`blob8`) queries must all start
at the deploy date. Fill it in below when this ships — this is a
release-checklist item, not optional cleanup:**

- Deploy date: `TBD — fill in at release`
- Version: `TBD — fill in at release`

Pre-deploy rows are deliberately not backfilled (see the spec's Non-goals).

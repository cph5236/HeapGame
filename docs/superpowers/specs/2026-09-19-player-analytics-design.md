# Player Analytics — New Users and the First-Session Funnel — Design

**Date:** 2026-09-19
**Branch:** `feature/player-analytics`
**Status:** approved, ready for implementation planning

## Problem

There is no way to answer "how many new players did we get today?", let alone
"do new players play more than one round?". Heap has been live on Google Play
since V0.2.27 and we are flying blind on acquisition and first-session
retention.

The Cloudflare dashboard cannot answer this. D1's dashboard reports *database*
metrics — rows read/written, storage, query latency — and has no view into table
contents; there is no query builder or charting over your own rows. Workers
Analytics is the same story for request metrics. Anything about players has to
come from a query we write.

Two useful things already exist and are not being used:

- **`player_auth.created_at`** (`heap_scores`) is written exactly once per
  player, `INSERT OR IGNORE`, on their first authenticated write. One row per
  player, never updated — a signup table in all but name, with real history
  going back to the write-auth launch in V0.2.16.
- **A full gameplay event union** in `shared/logging/events.ts`
  (`user:created`, `run:start`, `run:end`, `score:submitted`, `placement:made`,
  `pickup:grab`, `share:run`, `upgrade:purchased`), already emitted from both
  gameplay scenes and already routed to Analytics Engine in production.

The events do not reach us because they are opt-in and default off, and the two
data sets cannot currently be joined because they are keyed differently.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| New-user definition | `COUNT(*)` over `player_auth.created_at`, bucketed | Zero new writes, and it works over existing history from day one |
| Analytics consent | Flip to **default-on**, keep the opt-out toggle | The toggle is buried in Settings; almost nobody finds it, so the current denominator is a self-selected near-zero sample |
| Log envelope id | Stamp `getEffectivePlayerId()`, not `getPlayerGuid()` | Cohorts key on the effective id; without this the join silently drops every GPGS-signed-in player |
| Pickup volume | Roll `pickup:grab` into the `run:end` payload | Turns N data points per run into zero additional ones |
| `placement:made` | Leave as-is | ~1 per run, so it costs nothing, and staying separate preserves *when* in the run it happened |
| Funnel shape | Cohort **aggregates**, not per-player traces | AE downsamples; aggregates stay honest, individual traces do not |
| AE query location | Local CLI script, **not** a Worker route | The Cloudflare API token can read all account analytics; keeping it off the Worker keeps the blast radius on the operator's machine |
| Long-term retention | Out of scope — let data age out at 90 days | Deliberate; see Non-goals |

## Phase 1 — New-user counts from D1

### Endpoint

`GET /metrics/new-players?bucket=hour|day|week&since=<iso>&until=<iso>`, mounted
in `server/src/platform/routes/metrics.ts` and gated by `adminGate` in
`app.ts` alongside the other admin surfaces. Platform, not game: it reads
`player_auth`, which knows nothing about heaps.

`created_at` is stored as `new Date().toISOString()`
(`server/src/platform/playerAuth.ts`), so bucketing is `strftime` over the
column directly. Verified against SQLite — the `T` separator and trailing `Z`
are both accepted, and `2026-09-19T12:34:56.789Z` yields `2026-09-19`,
`2026-09-19T12:00:00Z` and `2026-W37` respectively:

| bucket | expression |
|---|---|
| `hour` | `strftime('%Y-%m-%dT%H:00:00Z', created_at)` |
| `day`  | `strftime('%Y-%m-%d', created_at)` |
| `week` | `strftime('%Y-W%W', created_at)` |

```sql
SELECT strftime(<expr>, created_at) AS bucket, COUNT(*) AS count
FROM player_auth
WHERE created_at >= ?1 AND created_at < ?2
GROUP BY bucket
ORDER BY bucket;
```

Response: `{ bucket: 'day', rows: [{ bucket: '2026-09-18', count: 42 }, …] }`.

`bucket` is validated against the three literals and mapped to a hardcoded
format string — never interpolated from user input. `since`/`until` are bind
parameters and default to the last 30 days.

### Access path

A `MetricsDB` interface over `DB_SCORES` with `D1MetricsDB` and `MockMetricsDB`
implementations, matching the existing repo pattern. **No cache decorator** —
this is a low-frequency admin read, and a stale count is worse than a slow one.

### Surface

A section in the existing admin UI (`admin/`) rendering the series as a chart,
with a bucket selector. Runs against production from the operator's machine
behind `X-Admin-Secret`, like every other admin surface.

### Known limitations, accepted

- `created_at` is the first authenticated **write**, not first launch. A player
  who installs and never submits a score, saves a customization, or redeems a
  code never appears. This undercounts installs and is the correct denominator
  for "players who did something", not "players who opened the app".
- A player who later signs into Google Play Games mints a different effective
  id and produces a **second** row. One human, two new-user events.
- Good for daily and weekly trend. Noisy at hourly resolution.

Phase 2 gives us `user:created` as an independent event-based signal to
cross-check these against.

## Phase 2 — Make the funnel measurable

### 2a. Analytics on by default

`getVerboseLogging()` in `src/systems/save/core.ts` currently returns
`parsed.verboseLogging ?? false`. Flip the default to `true`, leaving the stored
value authoritative when present so an existing opt-out is never overridden.

The Settings toggle at `src/scenes/SettingsScene.ts` stays exactly as it is —
same label, same position, same behaviour. It becomes an opt-*out*.

Errors and warnings are unaffected: they have always been sent regardless of
this flag, and the settings copy ("Errors are always reported.") already says so.

### 2b. Effective player id in the envelope

`src/logging/index.ts` builds the envelope with `getPlayerGuid()`. Change to
`getEffectivePlayerId()` so the log stream and `player_auth` share a key.

This is the same bare-`getPlayerGuid()` trap that broke leaderboard cosmetics in
PR #93 and that CLAUDE.md calls out by name.

**History splits at the deploy.** Rows written before it carry the raw GUID;
rows after carry the effective id. For a signed-in player these are different
strings, so any query spanning the boundary sees one player as two. Funnel
queries must start from the deploy date; the implementation plan should record
that date in the runbook.

The `'pre-init'` fallback stays — `getEffectivePlayerId()` can throw before
SaveData hydrates, and the existing try/catch already handles it.

### 2c. Privacy surfaces

Ship **with** the change, not after:

- `PRIVACY_POLICY.md` — state that gameplay analytics are collected by default
  and describe the opt-out path (Settings → "Send anonymous gameplay analytics").
- Google Play Console **Data Safety** form — the collected-by-default data types
  must match what we now actually collect.

## Phase 3 — Pickup roll-up

### The volume problem

Every log entry is one `writeDataPoint` (`AnalyticsEngineSink.ts`).
`pickup:grab` fires once per grab in `PickupManager.ts`, many times per run.
With analytics default-on this becomes the single largest consumer of the
Analytics Engine quota.

### Extract the emit site first

`run:end` is emitted from **four** near-identical copy-pasted sites —
`GameScene.ts` (3×) and `InfiniteGameScene.ts` (1×) — each re-deriving
`killCount` by hand. Adding fields to four hand-maintained copies is how you get
a silently partial dataset that looks fine.

Extract one helper that takes the varying parts (`heapId`, `mode`, `cause`,
`runResult`, `height`, `elapsedMs`) and derives the rest. Do this **before**
adding fields, as a behaviour-preserving change with the existing tests green.

### The tally

`PickupManager` keeps a per-run tally, reset at run start:

```ts
private grabs: Record<string, number> = {};
private grabBonus = 0;
```

Incremented where `pickup:grab` is emitted today; the per-grab
`getLogger().event(...)` call is removed. A getter exposes
`{ pickups, pickupBonus }` for the run-end helper, which adds them to the
payload. `pickup:grab` is deleted from the `GameEvent` union in
`shared/logging/events.ts`.

Two details that are easy to get wrong:

- **Sum the awarded bonus, not the base.** The current event sends
  `pickup.def.scoreBonus`, but the value actually awarded is
  `Math.round(def.scoreBonus * RARITY_SCORE_MULT[rarity])`. Carrying the bug
  forward would make pickup value systematically low.
- **Tally on grab, not from `carried`.** `getCarriedItems()` exists and
  ScoreScene uses it, but shield items are granted without ever entering
  `carried`. Reading the tally off `carried` would erase shields from the data.

Payload size is not a concern: 20 salvage items is a few hundred bytes against
a 2KB `maxEntryBytes` cap.

**Accepted loss:** per-pickup timing within a run, and per-rarity breakdown.
Keying the tally by `itemId` alone is the deliberate choice; if rarity turns out
to matter, the key can become `itemId:rarity` without changing anything else.

## Phase 4 — Cohort funnel queries

### Quota context

| | Workers Free | Workers Paid ($5/mo) |
|---|---|---|
| Data points | 100,000 / **day** | 10M / month (~333k/day) + $0.25/M |
| Read queries | 10,000 / day | 1M / month + $1.00/M |
| Retention | 3 months | 3 months — **same** |

With the pickup roll-up, a session costs roughly 15–20 data points, putting the
free-plan ceiling in the low thousands of sessions per day. **Stay on free.**
Revisit at ~70k points/day. Note that the paid plan buys headroom and monthly
rather than daily buckets — it does *not* buy retention.

Cloudflare currently does not bill for Analytics Engine at all.

### Sampling is not optional to handle

AE downsamples at volume. Every aggregate must use `SUM(_sample_interval)`,
never `COUNT()`. A raw `COUNT()` over sampled data is wrong, and wrong in a way
that looks plausible.

This is exactly why the funnel is specified as cohort aggregates. "What fraction
of Monday's new players started a second run" stays accurate under sampling.
"Did *this specific player* play twice" does not — their events may simply have
been sampled away. We do not build the per-player trace.

### The join

D1 cannot join across databases (`player_auth` is in `heap_scores`, logs live in
AE), and AE cannot join to D1 at all. The join happens in the script:

1. Query the metrics endpoint for cohort member ids in a date range.
2. Query the AE SQL API for `run:start` counts per player over the window.
3. Bucket players by run count and report the distribution.

Cohorts are chunked when passed as a filter — a day's worth of ids will not fit
in a single `IN (…)` clause at scale, and the script must page rather than
assume it fits.

### Script

`npm run metrics` — a Node script under `scripts/`, reading
`CF_ACCOUNT_ID` and `CF_ANALYTICS_TOKEN` (Account Analytics Read) from
`.env.local`, plus `ADMIN_SECRET` for the D1 side. POSTs to
`https://api.cloudflare.com/client/v4/accounts/<id>/analytics_engine/sql`.

Deliberately **not** a Worker route: that token can read all account analytics,
and there is no reason to hand it to an internet-facing Worker when the only
consumer is the operator. `.env.local` is already gitignored.

Initial reports: new players per bucket; runs-per-new-player distribution;
percentage of new players reaching run 2; median first-session run count.

## Non-goals

- **A D1 rollup cron for >90-day cohorts.** AE hard-deletes at 90 days and this
  is *not* retroactive — data aged out is gone. Accepted deliberately: the
  rollup can be added at any point going forward, and at Heap's current scale
  the 90-day window answers every question we currently have. There are no
  `[triggers]` in `wrangler.toml` today; adding this means adding that too.
- **Per-player trace / session replay.** Ruled out by sampling, above.
- **Install attribution / funnel before first launch.** That is Play Console's
  job and it already reports it.
- **Backfilling the envelope id change.** Pre-deploy rows keep the old key.

## Testing

- `MockMetricsDB` + route tests for bucketing, the `bucket` allowlist, date
  filtering, and the admin gate (`server/tests/`).
- A test asserting `getVerboseLogging()` defaults true **and** that a stored
  `false` still wins — the opt-out must survive the default flip.
- Envelope test asserting `getEffectivePlayerId()` is stamped, including the
  GPGS-signed-in case where it differs from the raw GUID.
- Run-end helper: the extraction lands with existing tests green, then a test
  per emit site asserting all four carry `pickups`/`pickupBonus`.
- `PickupManager` tally: reset between runs, shield items counted, awarded
  bonus (rarity-multiplied) summed rather than the base.
- `npm run build` before done — TS errors that tests miss.

## Risks

| Risk | Mitigation |
|---|---|
| Default-on analytics blows the free quota | Pickup roll-up lands in the same release; watch data points for a week before considering $5 |
| Envelope id change splits history | Record the deploy date in the runbook; funnel queries start there |
| One of four `run:end` sites misses the new fields | Extract the helper first, as its own commit, before adding fields |
| Play Data Safety form drifts from reality | Ships in the same PR as the default flip |
| `COUNT()` used instead of `SUM(_sample_interval)` | Called out here and in the script's own comments |

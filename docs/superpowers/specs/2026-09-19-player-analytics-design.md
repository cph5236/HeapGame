# Player Analytics — New Users, Funnel and Churn Analysis — Design

**Date:** 2026-09-19
**Branch:** `feature/player-analytics`
**Status:** approved, ready for implementation planning

## Problem

There is no way to answer "how many new players did we get today?", let alone
"do new players play more than one round?" or "why do they stop?". Heap has been
live on Google Play since V0.2.27 and we are flying blind on acquisition and
first-session retention.

The Cloudflare dashboard cannot answer this. D1's dashboard reports *database*
metrics — rows read/written, storage, query latency — and has no view into table
contents; there is no query builder or charting over your own rows. Workers
Analytics is the same story for request metrics. Anything about players has to
come from queries we write and a surface we build.

Three things already exist and are not being used:

- **`player_auth.created_at`** (`heap_scores`) is written exactly once per
  player, `INSERT OR IGNORE`, on their first authenticated write. One row per
  player, never updated — a signup table in all but name, with real history
  going back to the write-auth launch in V0.2.16.
- **A gameplay event union** in `shared/logging/events.ts` (`user:created`,
  `run:start`, `run:end`, `score:submitted`, `placement:made`, `pickup:grab`,
  `share:run`, `upgrade:purchased`), emitted from 13 sites and already routed to
  Analytics Engine in production.
- **A 13-step tutorial** with stable step ids and a director exposing
  `onStepEnter` / `onComplete` / `skip()`.

The events do not reach us because they are opt-in and default off. The two data
sets cannot be joined because they are keyed differently. And the tutorial —
the prime suspect for early churn — emits nothing at all.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| New-user definition | `COUNT(*)` over `player_auth.created_at`, bucketed | Zero new writes, works over existing history from day one |
| Analytics consent | Flip to **default-on**, keep the opt-out toggle | The toggle is buried in Settings; almost nobody finds it, so today's denominator is a self-selected near-zero sample |
| Log envelope id | Stamp `getEffectivePlayerId()`, not `getPlayerGuid()` | Cohorts key on the effective id; without this the join silently drops every GPGS-signed-in player |
| Tutorial | **Deferred to a later plan** | Still the highest-value signal for "why they stop", but the tutorial *entry* flow is being restructured (menu tour first, tutorial as a skippable selected heap). Instrumenting twice costs more than waiting once. |
| AE index derivation | Widen `userGuidIndex` before the envelope change | It slices to 32 chars assuming a UUID; a GPGS id is not one, and `MAX_ID_LEN` is 64 — truncation would silently break the join for signed-in players |
| Pickup volume | Roll `pickup:grab` into the `run:end` payload | Turns N data points per run into zero additional ones |
| `placement:made` | Leave as-is | ~1 per run, costs nothing, and staying separate preserves *when* in the run it happened |
| Per-player traces | **In scope** | AE only downsamples at high volume; at Heap's scale traces are complete, and player id is the AE index — the cheapest query shape available |
| AE access | Admin-gated Worker proxy with a **fixed query set** | The views need to be interactive; a fixed set means the account token cannot be turned into a general analytics read primitive |
| Long-term retention | Out of scope — let data age out at 90 days | Deliberate; see Non-goals |

## Phase 1 — New-user counts from D1

### Endpoint

`GET /metrics/new-players?bucket=hour|day|week&since=<iso>&until=<iso>`, in
`server/src/platform/routes/metrics.ts`, gated by `adminGate` in `app.ts`
alongside the other admin surfaces. Platform, not game: it reads `player_auth`,
which knows nothing about heaps.

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

`bucket` is validated against the three literals and mapped to a hardcoded
format string — never interpolated from user input. `since`/`until` are bind
parameters, defaulting to the last 30 days.

A companion `GET /metrics/cohort?since=&until=` returns the member ids of a
cohort, paged, for the funnel joins in Phase 5.

### Access path

A `MetricsDB` interface over `DB_SCORES` with `D1MetricsDB` and `MockMetricsDB`
implementations, matching the existing repo pattern. **No cache decorator** —
low-frequency admin read, and a stale count is worse than a slow one.

### Known limitations, accepted

- `created_at` is the first authenticated **write**, not first launch. A player
  who installs and never submits a score, saves a customization or redeems a
  code never appears. This undercounts installs and is the right denominator
  for "players who did something", not "players who opened the app".
- A player who later signs into Google Play Games mints a different effective
  id and produces a **second** row. One human, two new-user events.
- Good for daily and weekly trend. Noisy at hourly resolution.

Phase 2 gives `user:created` as an independent event-based signal to
cross-check these against.

## Phase 2 — Make the funnel measurable

### 2a. Analytics on by default

`getVerboseLogging()` in `src/systems/save/core.ts` returns
`parsed.verboseLogging ?? false`. Flip the default to `true`, leaving a stored
value authoritative when present so an existing opt-out is never overridden.

The Settings toggle in `src/scenes/SettingsScene.ts` stays exactly as it is —
same label, same position, same behaviour. It becomes an opt-*out*.

Errors and warnings are unaffected: they have always been sent regardless of
this flag, and the settings copy ("Errors are always reported.") already says so.

### 2b. Effective player id in the envelope

`src/logging/index.ts` builds the envelope with `getPlayerGuid()`. Change to
`getEffectivePlayerId()` so the log stream and `player_auth` share a key. This
is the same bare-`getPlayerGuid()` trap that broke leaderboard cosmetics in
PR #93 and that CLAUDE.md calls out by name.

**The AE index must be widened in the same change.** `AnalyticsEngineSink.ts`
derives its index as `uuid.replace(/-/g, '').slice(0, 32)`, with a comment
asserting that AE indexes cap at 32 bytes and that the input is always a UUID.
Both premises fail here: Cloudflare's documented index limit is **96 bytes**, and
a GPGS player id is not a UUID — hyphen-stripping is a no-op on it, and
`MAX_ID_LEN` (server/src/constants.ts) allows 64 characters. Slicing to 32 would
silently truncate a signed-in player's id, irreversibly, so the cohort→events
join would fail for exactly the Play Store audience Phase 5 exists to measure —
and two ids sharing a 32-character prefix would collide into one "player".

This is not a live bug today, because the envelope still stamps a raw GUID. It
becomes one the moment the envelope changes, so the widening ships in the same
commit, not as a follow-up.

**History splits at the deploy.** Rows written before it carry the raw GUID;
rows after carry the effective id. For a signed-in player these are different
strings, so any query spanning the boundary sees one player as two. Funnel
queries must start from the deploy date; the implementation plan records that
date in the runbook, and the admin UI shows it as the earliest selectable date.

The `'pre-init'` fallback stays — `getEffectivePlayerId()` can throw before
SaveData hydrates, and the existing try/catch already handles it.

### 2c. Privacy surfaces

Ship **with** the change, not after:

- `PRIVACY_POLICY.md` — state that gameplay analytics are collected by default
  and describe the opt-out path (Settings → "Send anonymous gameplay analytics").
- Google Play Console **Data Safety** form — collected-by-default data types
  must match what we now actually collect.

## Phase 3 — Tutorial instrumentation — DEFERRED

The tutorial is uninstrumented: none of the 13 `getLogger().event` call sites is
in `TutorialScene`. A churned player's tutorial outcome — finished, skipped, or
abandoned mid-step — is invisible, and it remains the most likely explanation
for first-session churn.

**Deferred deliberately, not dropped.** The tutorial's *entry* flow is being
reworked (new players routed through the menu coach-mark tour first, with the
tutorial becoming a selectable heap they can decline). Step-level instrumentation
inside `TutorialScene` would probably survive that intact, but the funnel's
denominator would change meaning and the rework introduces a new, arguably more
interesting drop-off point (tour → tutorial choice). Building it once against the
final flow beats building it twice.

Pick this up after the entry restructure lands. The design stands as written: three
events (`tutorial:step` with `stepId` + `index`, `tutorial:complete`, `tutorial:skip`
carrying the step the player was on) hung off `TutorialDirector`'s existing
`onStepEnter` / `onComplete` / `skip()` callbacks, using the stable step ids already
in `src/data/tutorialFixture.ts`. At most ~15 data points per player, once ever.

Consequences for the rest of this spec while it stays deferred:
- **View E (tutorial funnel) is out of scope** for the analytics UI.
- **"tutorial outcome" drops out** of View C's cross-tab dimensions.

## Phase 4 — Pickup roll-up

### The volume problem

Every log entry is one `writeDataPoint` (`AnalyticsEngineSink.ts`).
`pickup:grab` fires once per grab in `PickupManager.ts`, many times per run.
With analytics default-on it becomes the single largest consumer of the
Analytics Engine quota.

### Extract the emit site first

`run:end` is emitted from **four** near-identical copy-pasted sites —
`GameScene.ts` (3×) and `InfiniteGameScene.ts` (1×) — each re-deriving
`killCount` by hand. Adding fields to four hand-maintained copies is how you get
a silently partial dataset that looks fine.

Extract one helper taking the varying parts (`heapId`, `mode`, `cause`,
`runResult`, `height`, `elapsedMs`) and deriving the rest. Do this **before**
adding fields, as a behaviour-preserving commit with existing tests green.

### The tally

`PickupManager` keeps a per-run tally, reset at run start:

```ts
private grabs: Record<string, number> = {};
private grabBonus = 0;
```

Incremented where `pickup:grab` is emitted today; the per-grab
`getLogger().event(...)` call is removed. A getter exposes
`{ pickups, pickupBonus }` for the run-end helper, which adds them to the
payload. `pickup:grab` is deleted from the `GameEvent` union.

Two details that are easy to get wrong:

- **Sum the awarded bonus, not the base.** The current event sends
  `pickup.def.scoreBonus`, but the value actually awarded is
  `Math.round(def.scoreBonus * RARITY_SCORE_MULT[rarity])`. Carrying the bug
  forward makes pickup value systematically low.
- **Tally on grab, not from `carried`.** `getCarriedItems()` exists and
  ScoreScene uses it, but shield items are granted without ever entering
  `carried`. Reading the tally off `carried` erases shields from the data.

Payload size is not a concern: 20 salvage items is a few hundred bytes against a
2KB `maxEntryBytes` cap.

**Accepted loss:** per-pickup timing within a run, and per-rarity breakdown.
Keying by `itemId` alone is deliberate; if rarity turns out to matter the key
can become `itemId:rarity` without changing anything else.

## Phase 5 — Query layer

### Quota context

| | Workers Free | Workers Paid ($5/mo) |
|---|---|---|
| Data points | 100,000 / **day** | 10M / month (~333k/day) + $0.25/M |
| Read queries | 10,000 / day | 1M / month + $1.00/M |
| Retention | 3 months | 3 months — **same** |

With the pickup roll-up a session costs roughly 15–20 data points, putting the
free-plan ceiling in the low thousands of sessions/day. **Stay on free.**
Revisit at ~70k points/day. The paid plan buys headroom and monthly rather than
daily buckets — it does *not* buy retention. Cloudflare currently does not bill
for Analytics Engine at all.

### Sampling

AE downsamples at volume. Every aggregate uses `SUM(_sample_interval)`, never
`COUNT()` — a raw `COUNT()` over sampled data is wrong in a way that looks
plausible.

Sampling does **not** currently rule out per-player traces: it engages only at
high volume, and at Heap's scale `_sample_interval` is 1 and traces are
complete. It degrades silently as volume grows, so the trace view surfaces
`_sample_interval` and warns when it is ever >1, meaning that trace has gaps.

### AE SQL constraints the queries must respect

Verified against Cloudflare's SQL reference and against this repo's own
`.github/workflows/fetch-logs.yml`, which already documents two of them:

- **No `JOIN`, no `UNION`.** Queries operate on a single table. Subqueries in
  `FROM` *are* supported, which is what makes the per-player aggregations
  possible: an inner query groups by `index1` to derive each player's facts
  (first run via `argMin`, run count), and the outer query buckets those.
- **`double1` is SELECTable but cannot appear in `WHERE` or `ORDER BY`; the
  automatic `timestamp` column is the reverse — filterable but not
  SELECTable.** So every query filters on `timestamp` and outputs/orders on
  `double1` (the client event time). `fetch-logs.yml` learned this the hard
  way; the proxy's queries must not relearn it.
- Available aggregates include `argMin`/`argMax`, `count(DISTINCT …)`,
  `countIf`/`sumIf`/`avgIf`, and `quantileExactWeighted`.
- **Blob layout is positional and already fixed** by `AnalyticsEngineSink.ts`:
  `blob1`=level, `blob2`=eventType, `blob3`=platform, `blob4`=appVersion,
  `blob5`=sessionId, `blob6`=payload JSON, `blob7`=userAgent; `double1`=client
  timestamp; `index1`=player id. Changing that layout invalidates stored history,
  so treat it as frozen.

### The proxy

D1 cannot join across databases (`player_auth` is in `heap_scores`, logs live in
AE) and AE cannot join to D1 at all, so joins happen in the query layer.

`server/src/platform/routes/analytics.ts`, behind `adminGate`, exposing a
**fixed, enumerated set of parameterized queries** — never arbitrary SQL from
the caller:

| Query id | Returns |
|---|---|
| `funnel` | Stage counts for a cohort over a window |
| `crosstab` | Run-2 rate split by a named dimension |
| `player-trace` | All events for one player id, chronological |

Each takes a date range plus a small allowlisted parameter set (`dimension` for
`crosstab` is validated against a fixed list). Reads `CF_ACCOUNT_ID` and
`CF_ANALYTICS_TOKEN` (Account Analytics Read) via `wrangler secret put`, and
POSTs to
`https://api.cloudflare.com/client/v4/accounts/<id>/analytics_engine/sql`.

The fixed query set is the whole security argument: the token lives in the
Worker, but a caller who gets past `adminGate` still cannot read arbitrary
account analytics.

Cohort id lists are **chunked** when passed as a filter — a day of ids will not
fit in one `IN (…)` clause at scale, and the proxy pages rather than assuming it
fits.

## Phase 6 — Admin UI

`admin/index.html` is a single ~1850-line file, vanilla JS + Tailwind browser
CDN, organized as `renderX()` functions. The Analytics section follows that
pattern. Charts are hand-rolled inline SVG rather than another CDN dependency —
a line chart and a bar funnel are roughly 50 lines each and match the file's
existing style.

### View A — Acquisition

New players per day/week, line chart, from the Phase 1 endpoint. The baseline
number.

### View B — First-session funnel

Horizontal bars, each stage as a percentage of the cohort:

```
new player        ████████████████████ 100%  (412)
started run 1     ██████████████████    89%  (367)
finished run 1    ███████████████       76%  (313)
started run 2     ████████              41%  (169)
started run 3     █████                 26%  (107)
returned day 2    ███                   14%   (58)
```

The funnel says **where** the cliff is, which names the problem class:

| Cliff | Reading |
|---|---|
| started → finished run 1 | They quit mid-run — difficulty or controls |
| finished run 1 → started run 2 | The run ended and they did not want another — score screen, or the run felt unrewarding |
| after run 2–3 | Progression problem |

### View C — Churn cross-tab

The "why" engine. Split the cohort by a characteristic of their **first** run,
then show run-2 rate per bucket:

| first run duration | cohort | started run 2 |
|---|---|---|
| <15s | 88 | 9% |
| 15–45s | 140 | 24% |
| 45–120s | 121 | 38% |
| >120s | 63 | 52% |

`run:end` already carries `durationMs`, `cause`, `score`, `height`, `kills` and
`upgrades`; the envelope adds `platform` and `app_version`. Allowlisted
dimensions: run duration, `cause` (death vs quit), height reached, score,
platform, app version, placed-an-item, submitted-a-score. (Tutorial outcome
joins this list once Phase 3 is picked up.)

This is what produces actionable hypotheses rather than a shrug — *"players who
never placed an item return at 11% vs 40%"* points at placement as the hook and
the tutorial failing to land it. Splitting the same table by `app_version` is
also how a release regression surfaces: if the V0.2.31 cohort returns at half
the V0.2.30 rate, something broke.

### View D — Player trace

Paste a player id, get their events chronologically with timestamps and
payloads. A banner warns when `_sample_interval` > 1 for any row, meaning the
trace has gaps and should not be read as complete.

### View E — Tutorial funnel — DEFERRED

Blocked on Phase 3. Per-step bars (reached / completed / skipped for each of the
13 step ids, in order) directly answering which step loses people. Build it when
the tutorial is instrumented against its final entry flow.

## Non-goals

- **A D1 rollup cron for >90-day cohorts.** AE hard-deletes at 90 days and this
  is *not* retroactive — data aged out is gone. Accepted deliberately: the
  rollup can be added at any point going forward, and at Heap's scale the 90-day
  window answers every question we currently have. There are no `[triggers]` in
  `wrangler.toml` today; adding this means adding that too.
- **Arbitrary SQL from the admin UI.** The fixed query set is the security
  boundary.
- **Install attribution / funnel before first launch.** Play Console's job, and
  it already reports it.
- **Backfilling the envelope id change.** Pre-deploy rows keep the old key.

## Testing

- `MockMetricsDB` + route tests: bucketing, the `bucket` allowlist, date
  filtering, cohort paging, admin gate (`server/tests/`).
- A test asserting `getVerboseLogging()` defaults true **and** that a stored
  `false` still wins — the opt-out must survive the default flip.
- Envelope test asserting `getEffectivePlayerId()` is stamped, including the
  GPGS-signed-in case where it differs from the raw GUID.
- AE index test: a 64-character non-UUID id survives `userGuidIndex` intact
  (no truncation, no collision with another id sharing its first 32 chars),
  and a hyphenated UUID still maps to its 32-char hex form.
- Run-end helper: extraction lands with existing tests green, then a test per
  emit site asserting all four carry `pickups`/`pickupBonus`.
- `PickupManager` tally: reset between runs, shield items counted, awarded
  (rarity-multiplied) bonus summed rather than the base.
- Analytics proxy: unknown query id rejected; `dimension` allowlist enforced;
  admin gate; cohort chunking exercised past one chunk.
- `npm run build` before done — TS errors that tests miss.

## Risks

| Risk | Mitigation |
|---|---|
| Default-on analytics blows the free quota | Pickup roll-up lands in the same release; watch data points for a week before considering $5 |
| Envelope id change splits history | Record the deploy date in the runbook; the UI's earliest selectable date is that date |
| One of four `run:end` sites misses the new fields | Extract the helper first, as its own commit, before adding fields |
| Play Data Safety form drifts from reality | Ships in the same PR as the default flip |
| `COUNT()` used instead of `SUM(_sample_interval)` | Called out here and in the proxy's own comments |
| Traces silently degrade as volume grows | `_sample_interval` surfaced with a warning banner in View D |
| Analytics token reachable as a general read primitive | Fixed enumerated query set; no caller-supplied SQL |

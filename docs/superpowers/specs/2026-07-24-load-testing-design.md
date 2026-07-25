# Load Testing Heap — Design

**Date:** 2026-07-24
**Status:** Approved, ready for implementation planning
**Branch:** `feature/load-testing`

## Goal

Simulate many concurrent players against the Heap Worker to find where the system
breaks, using a realistic mix of endpoints and features. The test targets a
dedicated staging Worker on Cloudflare, driven by k6 from a developer machine,
with a hard per-run quota budget.

## Context: the account is on Cloudflare's free tier

Verified limits (2026-07-24, from Cloudflare docs):

| Resource | Free / day | Paid included |
|---|---|---|
| Workers requests | 100,000 | unlimited |
| Workers CPU per request | 10 ms | 30 s (max 5 min) |
| D1 rows read | 5,000,000 | 25B / mo |
| D1 rows written | 100,000 | 50M / mo |
| D1 databases per account | 10 | 50,000 |
| KV reads | 100,000 | 10M / mo |
| KV writes (`put`) | 1,000 | 1M / mo |
| KV deletes (`delete`) | 1,000 | 1M / mo |
| KV lists | 1,000 | 1M / mo |

Two consequences drive the whole design:

1. **These quotas are account-wide, not per-Worker.** A staging Worker with its
   own D1 and KV still draws from the same daily buckets as production. Every
   load-test run spends production's budget.
2. **KV deletes are the tightest resource**, not Workers requests. See below.

## Prerequisite server changes

Three changes, all TDD'd against `server/tests/`, landing before any load test
runs. The first two are redundant-KV-write fixes that are worth shipping on their
own merits — they are production efficiency wins, not test scaffolding.

### 1. Fold `top_y` into the CAS write

A successful `POST /heaps/:id/place` currently costs **4 KV deletes**:

- `server/src/routes/heap.ts:551` — `db.updateHeap(...)` returns `applied=true`
  → `server/src/cache/CachedHeapDB.ts:91` calls `invalidateHeap(id)`
  → deletes `cache:heap:{id}` and `cache:heap:list` (2 ops)
- `server/src/routes/heap.ts:554` — `await db.updateTopY(id, y)` on the very next line
  → `server/src/cache/CachedHeapDB.ts:102` calls `invalidateHeap(id)` again
  → deletes the same two keys a second time (2 ops)

The second pair deletes keys the first pair already removed microseconds earlier.
`updateTopY` also runs unconditionally, so placements that don't raise the summit
pay for it too.

`updateTopY`'s D1 statement (`server/src/db.ts:183`) is already an idempotent
`top_y = MIN(top_y, ?1)`, so the column folds directly into the CAS `UPDATE` at
`server/src/db.ts:163`:

```sql
UPDATE heap SET base_id=?1, version=?2, live_zone=?3, freeze_y=?4, top_y=MIN(top_y,?5)
WHERE id=?6 AND version=?7
```

`updateTopY` is then removed from the `HeapDB` interface and all three variants
(D1 / Mock / Cached), and the call site in the place route is deleted.

**Effect per placement:** 2 D1 writes → 1, and 4 KV deletes → 2. The free-tier
placement ceiling rises from ~250/day to ~500/day. The summit update also becomes
atomic with the CAS instead of a separate non-transactional follow-up write.

**Rejected:** dropping the `cache:heap:list` bust for a further 2x. `listHeaps`
(`server/src/db.ts:91`) selects `top_y` and `version`, so the list cache genuinely
goes stale on every placement. The bust is required for correctness.

### 2. Remove the redundant score-cache invalidation

`POST /scores` has the same double-invalidation shape as the place route.
`server/src/routes/scores.ts:309-310`:

```ts
const submitted = await scoreDb.upsertScore(heapId, playerId, finalScore, now);
if (submitted) await scoreDb.pruneScores(heapId);
```

- `server/src/cache/CachedScoreDB.ts:50` — `upsertScore` deletes
  `cache:scores:{heapId}:top` when the score changed
- `server/src/cache/CachedScoreDB.ts:56` — `pruneScores` deletes the identical
  key again

The second delete is provably unnecessary. `pruneScores` retains the **top 1,000**
by score (`server/src/scoreDb.ts:144`) while the cache holds
`CACHE_TOP_N = 50` (`server/src/cache/CachedScoreDB.ts:17`). Pruning only ever
removes rows ranked 1001 and below, which by definition cannot appear in the
cached top-50 window — so it can never invalidate anything that changed.

**Fix 2a:** drop the `kv.delete` from `CachedScoreDB.pruneScores`, leaving plain
delegation to the inner repo. Halves the KV delete cost of an improved score
submission from 2 to 1.

This does mean `pruneScores` no longer invalidates at all. That is correct for
the current retention gap (1,000 vs 50), and the reasoning is recorded as a
comment on the method so a future change to either constant is flagged.

**Fix 2b — invalidate only when the top-50 actually changes.** `upsertScore`
returns `changed=true` whenever the player beat their *own* previous best
(`server/src/scoreDb.ts:83`), which has nothing to do with whether the *leaderboard*
changed. A player improving from 500 to 600 on a heap whose 50th place is 10,000
busts a cache entry that would have returned identical bytes.

```ts
async upsertScore(heapId, playerId, score, now): Promise<boolean> {
  const changed = await this.inner.upsertScore(heapId, playerId, score, now);
  if (!changed) return false;

  const cached = await this.kv.get<ScoreRow[]>(this.topKey(heapId), 'json');
  if (!cached) return true;                  // nothing cached; nothing to bust
  if (cached.length < CACHE_TOP_N            // board not full: any score enters
      || score >= cached[cached.length - 1].score) {  // >= so ties invalidate
    await this.kv.delete(this.topKey(heapId));
  }
  return true;
}
```

Trades 1 KV read (100,000/day bucket) for 1 KV delete (1,000/day bucket) in the
common case. Reads are 100x more plentiful, so the trade is strongly positive.

**Why this stays correct.** `buildContext` sources the submitting player's own row
from `getScore` and their rank from `getRank`, both of which are *uncached*
straight-to-D1 delegations (`server/src/cache/CachedScoreDB.ts:61-68`). So a player
always sees their own fresh score and rank. The only value served from cache is
the `top` array — and if the new score didn't reach the 50th-place cutoff, that
array is genuinely unchanged. The skip is invisible.

Note also that the score cache is already eventually-consistent by design:
`SCORES_TTL` is 60s, and neither `PUT /players/:id/name` nor
`PUT /customization/:id` invalidates it, so cached names and loadouts already lag
by up to a minute. This change is consistent with that existing posture rather
than a new compromise.

**Not applied to the heap cache.** The analogous "skip the delete when nothing is
cached" trick was considered for `CachedHeapDB.invalidateHeap` and rejected:
`cache:heap:{id}` is hot exactly when traffic is high, so under load the key is
almost always present and the check would cost a read while still performing the
delete. There is no threshold equivalent either — every placement genuinely
changes the polygon, and a stale `version` would make clients miss other players'
placements for up to `HEAP_TTL` (60s).

**Fallback if more headroom is needed.** Because the player's own row and rank are
uncached, write-invalidation on scores could be dropped entirely, letting the 60s
TTL handle staleness and taking score-submit deletes to zero. Not proposed now —
fix 2b keeps correctness where it matters for a cheap read — but it is the next
lever if the delete budget still binds.

### 3. Staging-only synthetic rate-limit key

`server/src/middleware/rateLimit.ts` keys on `cf-connecting-ip`, which Cloudflare
sets at the edge and clients cannot spoof. k6 running from one machine is one IP,
so all virtual users share a single bucket and hit `RL_GLOBAL` (300/min) at about
5 req/s — making real concurrency testing impossible.

Real players arrive from distinct IPs. To mimic that, the limiter accepts a
synthetic key when, and only when, a staging-only secret is configured:

```ts
const secret = c.env?.LOADTEST_SECRET;
const key = (secret && c.req.header('X-LoadTest-Secret') === secret)
  ? c.req.header('X-LoadTest-Key') ?? ip
  : ip;
```

`LOADTEST_SECRET` is set only in `[env.staging]`. In production the var is absent,
so the condition short-circuits, the headers are inert, and the limiter keys on
`cf-connecting-ip` exactly as it does today. The limiter stays *active* under load
test rather than being switched off, so its behaviour is exercised rather than
bypassed.

## Staging environment

An `[env.staging]` block in `server/wrangler.toml` with:

- Its own KV namespace
- Its own 4 D1 databases (`heap_core_staging`, `heap_scores_staging`,
  `heap_rewards_staging`, `heap_telemetry_staging`)
- AE dataset `heap_logs_staging`, so load-test noise never reaches the
  `triaging-crash-logs` workflow
- The same `[[ratelimits]]` bindings as production
- `LOADTEST_SECRET` and `ADMIN_SECRET` vars

**Prerequisite:** the D1 free plan allows **10 databases per account**. The account
currently has 5 (the 4 sharded DBs plus the old `heap` DB kept as the PR #81
rollback path). Staging needs 4 more, reaching 9 — it fits, but leaves no
headroom. The sharded topology has been live and stable since #81, so the old
`heap` database is retired first. **Confirmed 2026-07-24: the user will delete it
manually.** This must happen before staging DBs are provisioned.

## Traffic model

Three k6 scenarios.

### A. Player journey

Mirrors the real client boot and run sequence, ~10 requests per session.

| Step | Endpoints | Per session |
|---|---|---|
| Boot | `GET /config`, `GET /heaps`, `GET /daily/status`, `GET /customization/:id` | 1 each |
| Heap load | `GET /heaps/:id`, `GET /heaps/:id/base` | 1 each; base is cached per-VU after first fetch, mirroring the client's localStorage cache in `HeapClient` |
| Leaderboard | `GET /scores/:heapId/context` | 1 |
| Run | `POST /heaps/:id/place` | p = 0.15 |
| End of run | `POST /scores`, `POST /log` | 1 each |
| Occasional | `PUT /customization/:id` (p=0.1), `PUT /players/:id/name` (p=0.05), `POST /daily/claim` (p=0.1) | — |

Placement probability is 0.15 because real players place rarely — roughly once per
run, and only on reaching the live zone at the summit. This is a tuning knob.

### Player identity model

VUs do **not** each generate a fresh `playerId`. A pool of ~200 identities
(`playerId` + `playerSecret`) is seeded once by `seed-staging.ts`, persisted to a
gitignored file, and reused across runs. Each VU draws from the pool; **5% of
sessions** use a brand-new UUID instead, to keep the TOFU claim-on-first-write
path in `enforcePlayerAuth` exercised.

This is both cheaper and more realistic. A fresh identity per VU means every score
submission is a personal best, so `upsertScore` returns `changed=true` and spends
a KV delete every single time — the single largest KV cost in the whole test. Real
traffic is mostly returning players with an existing best, who only invalidate the
leaderboard cache when they actually improve. With a reused pool and randomised
scores, the improvement rate falls off naturally as each identity's stored best
rises.

### B. Placement contention

10–20 VUs placing on a single shared heap, to drive the CAS retry loop at
`server/src/routes/heap.ts:445` and measure the rate of 409s from retry
exhaustion. Deliberately small: a scenario where 100+ players place
simultaneously is not realistic for this game.

### C. Limiter sanity check

About 20 requests sent *without* the loadtest headers, asserting that 429s appear
at the configured threshold. Confirms production's rate-limit protection is intact
and that the synthetic-key branch is genuinely opt-in.

### Heap fixtures

Two heaps are seeded: one fresh, one pre-grown with a large `live_zone`.

`POST /heaps/:id/place` runs `isPointInside` over the full base+liveZone polygon
up to 5 times per request, plus a `JSON.parse` of `live_zone`. Free tier caps CPU
at 10 ms per request. **Leading hypothesis: placement CPU scales with polygon size
and a mature heap breaches the cap.** The fixture pair is what measures it.

## Budget control

Scenarios use k6's `shared-iterations` executor with a fixed `iterations` count,
so **total request volume is known before the run starts** rather than being
discovered when a runtime guard trips. Spike shape comes from `stages` layered on
a capped iteration pool. A runtime counter aborts the run if a cap is breached
anyway.

### KV delete accounting

KV deletes, not Workers requests, are the binding constraint. Full accounting for
a run of **800 sessions**, after the two invalidation fixes:

| Source | Rate | Deletes each | Total |
|---|---|---|---|
| Placements (journey, p=0.15) | 120 | 2 | 240 |
| Placements (contention scenario) | 30 | 2 | 60 |
| Score submits that improved a personal best | ~116 | — | — |
| ...of which reach the top-50 cutoff (fix 2b) | ~29 | 1 | 29 |
| **Total** | | | **~329** |

The top-50 hit rate is estimated at roughly a quarter: with a 200-identity pool,
an improved score clears the 50th-place cutoff about 50/200 of the time. This is
an estimate to be replaced with the measured value after the first run.

That is ~33% of the daily 1,000-delete bucket, allowing **two full runs per day**
with comfortable headroom for production.

Without the three fixes the same run would cost roughly 1,320 deletes — over the
entire daily bucket, before production gets a single placement. Placements now
dominate the remaining cost, which is why the heap cache is the place to look if
further reduction is ever needed.

### Per-run caps

- **≤ 800 sessions / ≤ 10,000 requests** — 10% of the account's daily 100,000
- **≤ 150 placements total across scenarios** — the single hard cap enforced by
  the runtime counter
- **Daily reserve:** total load-test spend ≤ 30,000 requests and ≤ 500 KV
  deletes, leaving the majority of both for production

Non-binding at this budget: D1 writes (~5 rows/session vs 100,000/day), D1 reads
(vs 5M/day), KV reads (~4/session vs 100,000/day).

Runs should be scheduled in low-traffic windows, since the quotas are shared with
production.

## Thresholds and observability

k6 `thresholds` fail the run automatically:

- `http_req_failed` < 1% — 409 and 429 are tracked as separate counters, not
  counted as failures
- Read endpoints: p95 < 500 ms, p99 < 1500 ms
- `POST /heaps/:id/place`: p95 < 1000 ms
- `place_conflict_rate` (409 after 5 CAS attempts) < 2%
- Zero 5xx

Server-side observability during a run:

- `wrangler tail --env staging` for CPU time and uncaught exceptions
- Existing `captureServer` events (`place:rejected`, `rate_limit:hit`) landing in
  `heap_logs_staging`

## Layout

Everything lives in the game repo, not a separate one. The load test is not
separable from the server changes it depends on (`[env.staging]`, the
`LOADTEST_SECRET` branch, the `top_y` fold) — splitting repos would turn one
logical change into two ordered PRs across two repos, with staging config free to
drift from the Worker it targets.

```
loadtest/
  README.md                  # how to run, budget math, quota table
  k6/
    lib/
      config.js              # base URL + secrets from env
      player.js              # per-VU identity: playerId, playerSecret, loadtest key
      payloads.js            # request bodies (plain JS, shared with contract test)
      budget.js              # request/placement counters, abort on breach
    scenarios/
      journey.js
      placement.js
      limiter.js
    main.js                  # executors, stages, thresholds
  scripts/
    seed-staging.ts          # create both heap fixtures (admin-gated) + the
                             #   ~200 identity pool -> gitignored identities.json
    reset-staging.ts         # PUT /heaps/:id/reset between runs for repeatability
  __tests__/
    payload-contract.test.ts # type-checks payloads.js against shared/ types
```

### Payload drift guard

k6 runs its own JS runtime and cannot import the project's TypeScript, so request
shapes would normally be duplicated and free to drift — a load test that silently
measures nothing but 400s. Because the scenarios live in-repo, `payloads.js` holds
the bodies as plain JS and `payload-contract.test.ts` imports those same fixtures
and type-checks them against `PlaceRequest` and `SubmitScoreRequest` from
`shared/`. A breaking change to either type then fails `npm test`.

### Build isolation

`loadtest/` is excluded from `tsconfig.json` and the vite build, so it adds
nothing to build time. The contract test is the single exception and is fast. The
k6 scripts have no npm dependencies. Secrets stay in `.env`, uncommitted, as
`npm run seed` already does.

## Running

Manual, via `npm run loadtest`. Deliberately **not** wired into CI: every push
would spend account-wide quota shared with production.

## Out of scope

- Multi-region / cloud-hosted load generation (k6 Cloud). Revisit only if
  single-origin load proves insufficient.
- Upgrading to Workers Paid. Considered and declined for now; the two
  invalidation fixes buy enough headroom to test on the free tier. Note that
  production remains capped at roughly 500 placements/day, and that the 10 ms CPU
  cap still applies, until the plan changes.
- Load testing the game client itself (Phaser rendering, asset delivery). This
  design covers the Worker API only.

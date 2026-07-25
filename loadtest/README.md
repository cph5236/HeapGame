# Load testing Heap

k6 scenarios that drive a realistic mix of traffic against the Heap Worker API,
targeting a dedicated staging deployment.

## ⚠️ Read this first: the account is on Cloudflare's free tier

**Free-tier quotas are account-wide, not per-Worker.** Staging has its own D1
databases and KV namespace, but every request still draws from the same daily
buckets production uses. **A load-test run against staging spends production's
budget.** Run it in a low-traffic window, respect the per-run caps below, and
never point `BASE_URL` at production.

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

KV deletes are the tightest resource, not Workers requests — see
[Per-run budget](#per-run-budget) below.

## Prerequisites

1. **k6** installed and on `PATH`. Not an npm dependency — the scripts below
   assume a `k6` binary. See <https://k6.io/docs/get-started/installation/>.
   (If you can't install it system-wide, a static release binary works fine
   from anywhere on disk; just make sure it resolves as `k6` or adjust the
   commands below to its full path.)
2. **Staging deployed.** `[env.staging]` in `server/wrangler.toml`, its own 4
   D1 databases, KV namespace, and `LOADTEST_SECRET` + `ADMIN_SECRET` vars —
   see `docs/superpowers/runbooks/loadtest-staging.md` (Task 5 of
   `docs/superpowers/plans/2026-07-24-load-testing.md`). Until that exists,
   the local dry-run loop below is the only way to exercise this harness.
3. **Fixtures seeded once**, against whichever `BASE_URL` you're pointing at:
   ```bash
   BASE_URL=<staging-or-local-url> ADMIN_SECRET=<...> npm run loadtest:seed
   ```
   Writes `loadtest/fixtures.json` (gitignored — contains generated player
   secrets): `{ smallHeapId, largeHeapId, identities: [{playerId, playerSecret}, ...] }`.
   Re-run only when you need fresh fixtures; the scenarios and
   `npm run loadtest:reset` reuse the existing file otherwise.

## The local dry-run loop (default way to iterate)

Everything here runs against `wrangler dev`'s local D1/KV, so it **costs zero
account quota**. This is how you should develop and debug scenario changes —
never iterate directly against staging.

```bash
# terminal 1
cd server && npx wrangler dev

# terminal 2 — seed once
BASE_URL=http://localhost:8787 ADMIN_SECRET=dev npm run loadtest:seed

# terminal 2 — then iterate
BASE_URL=http://localhost:8787 npm run loadtest:local
```

`loadtest:local` runs `k6 run -e SESSIONS=20 -e MAX_PLACEMENTS=5
loadtest/k6/main.js` — the same scenarios and thresholds as a real run, just
at throwaway volume (20 journey iterations, the placement scenario's fixed 30
iterations, 20 limiter probes). `ADMIN_SECRET` can be anything locally:
`requireAdminSecret` no-ops when the server-side secret is unset, which it is
by default under plain `wrangler dev` (no `.dev.vars` in this repo). Expect
**zero 4xx other than 409 (CAS conflict) and 429 (rate limited), and zero
5xx**. Any other 4xx means a payload or coordinate is wrong — see
[If you hit a 400](#if-you-hit-a-400).

Two things are *expected* to look different locally than against staging, and
aren't bugs:

- **The two `http_req_duration` latency thresholds (`heap-get`, `heaps-list`,
  p95<500ms) can trip under `wrangler dev`.** Local dev's D1/KV emulation is
  much slower than the real edge, especially with 15-20 VUs all starting at
  once against a single local SQLite-backed D1. The thresholds are tuned for
  staging performance; a local dry run is about *correctness* (no unexpected
  4xx/5xx), not about validating those latency numbers.
- **`LOADTEST_SECRET` is normally unset locally**, so `journey`'s requests
  share one rate-limit bucket with `limiter`'s deliberately-unkeyed probes —
  expect a nonzero `rate_limited` metric on `journey` too in that case. Set
  `LOADTEST_SECRET` (and configure it identically server-side, e.g. via
  `server/.dev.vars`) if you want to dry-run the keyed-bucket behavior
  locally before a staging run.

## Running against staging

```bash
BASE_URL=https://heap-server-staging.<sub>.workers.dev \
LOADTEST_SECRET=<the staging secret> \
npm run loadtest
```

`npm run loadtest` runs the full-size `main.js` with no volume overrides
(`SESSIONS` defaults to 800). `LOADTEST_SECRET` must match what's configured
in `[env.staging]` — without it, every VU shares one rate-limit bucket keyed
on the k6 host's IP and the run trips `RL_GLOBAL` (300/min) almost
immediately instead of exercising real concurrency (see
[Watching the server](#watching-the-server) and the limiter scenario below).

## Per-run budget

Defaults (`SESSIONS=800`, `MAX_PLACEMENTS=150`), computed from what each
scenario actually sends per iteration — not the design spec's original
back-of-envelope numbers, which undercounted both scenarios:

| Scenario | Iterations | Requests/iteration | Requests | Placements |
|---|---|---|---|---|
| `journey` | 800 | 8 mandatory + ~0.35 probabilistic ≈ 8.35, plus one heap-base fetch per VU on its first iteration (50 VUs) | ≈ 6,730 | ≈ 120 (p=0.15) |
| `placement` | 30 | 3 (`GET /heaps`, `GET /heaps/:id`, `POST .../place`) | 90 | 30 |
| `limiter` | 20 | 1 | 20 | 0 |
| **Total** | | | **≈ 6,840** | **≈ 150** |

Against the per-run caps from the design spec:

- **≤ 800 sessions / ≤ 10,000 requests** — actual ≈ 6,840, comfortably under.
- **≤ 150 placements total across scenarios** — 120 (journey) + 30
  (placement) = 150 exactly; this is *why* the placement scenario's
  iteration count is 30 and not something derived from a request budget.
- **KV deletes ≈ 329/run** (accounting in the design spec, ~a third of the
  daily 1,000 bucket) — **≈ 2 runs/day** with headroom left for production.

`createBudget()` divides these global caps by each scenario's VU count to get
a per-VU runtime safety net (k6 VUs don't share module state). Those divisors
are deliberately generous, not a tight per-scenario slice — e.g. journey's
real steady-state usage is ~135 requests/VU against a 200/VU cap. The
authoritative bound is always each scenario's `iterations` in `main.js`,
fixed before the run starts; the per-VU counter only exists to abort a
scenario that's somehow sending far more requests per iteration than
expected (a bug), not to shape normal volume.

## Tunable env vars

All passed via k6's `-e` flag (`npm run loadtest` / `loadtest:local` already
wire the two most common ones):

| Var | Default | Effect |
|---|---|---|
| `BASE_URL` | `http://localhost:8787` | Target Worker. |
| `LOADTEST_SECRET` | *(unset)* | Staging-only synthetic rate-limit key. Inert (no-op) everywhere else, including production. |
| `SESSIONS` | 800 | `journey` scenario's total iteration count (shared across its 50 VUs). |
| `MAX_PLACEMENTS` | 150 | Global placement safety-net cap, divided across the `journey` and `placement` scenarios' VU counts (see above). |
| `PLACE_RATE` | 0.15 | Probability a `journey` session attempts a placement. |
| `NEW_IDENTITY_RATE` | 0.05 | Fraction of sessions that mint a brand-new identity instead of drawing from the seeded pool. Set explicitly (`-e NEW_IDENTITY_RATE=0`) to pin a run entirely to the seeded pool — an explicit `0` is honoured, it does not fall back to the default. |
| `PLACE_FIXTURE` | `small` | Which fixture heap the `placement` scenario hammers — `small` or `large`. See the [CPU-vs-polygon-size hypothesis](#leading-hypothesis-placement-cpu-vs-polygon-size) below. |

## Reset between runs

```bash
BASE_URL=<staging-or-local-url> ADMIN_SECRET=<...> npm run loadtest:reset
```

Puts both fixture heaps' live zones back to empty so runs are repeatable.
Identities in `fixtures.json` are deliberately **not** regenerated — reusing
the same pool across runs is what keeps score-submit KV cost low (see the
identity-model rationale in the design spec).

## Watching the server

```bash
cd server && npx wrangler tail --env staging
```

Streams live logs for CPU time and uncaught exceptions during a run.
`captureServer` events worth watching for: `place:rejected` (any reason other
than the expected CAS/geometry ones) and `rate_limit:hit`.

## Reading the results

k6 prints a summary at the end of the run. What to look at:

- **Thresholds** (`main.js`): `http_req_failed{expected_response:true}` <1%
  excludes 409/429 by design — a threshold breach here means genuine 4xx/5xx,
  not contention or rate limiting. Read endpoints are held to p95<500ms /
  p99<1500ms; `POST .../place` (both the `place` and `place-contention` tags)
  to p95<1000ms.
- **`place_accepted` / `place_conflicts`** (journey.js): placements from the
  realistic-traffic scenario that succeeded vs. exhausted their 5 CAS retries
  (409). A non-trivial `place_conflicts` count here (contention outside the
  dedicated contention scenario) suggests the fixture heap is getting more
  concurrent placement pressure than intended.
- **`cas_accepted` / `cas_conflicts`** (placement.js): the same pair for the
  dedicated contention scenario, which exists specifically to drive CAS
  retries — some `cas_conflicts` here is expected and healthy, not a failure.
  The design spec's threshold is a 409 rate under 2%.
- **`limiter_blocks`** (limiter.js): count of 429s from the ~20 un-keyed
  probes. Confirms the production rate limiter is still active and that the
  `LOADTEST_SECRET` bypass is genuinely opt-in — the un-keyed probes should
  start tripping `RL_GLOBAL` once combined un-keyed traffic in the current
  window crosses 300/min.
- **`rate_limited`** (journey.js, a k6 `Rate` metric): fraction of *keyed*
  journey requests that still got 429'd. Should be ~0 when `LOADTEST_SECRET`
  is set correctly; a nonzero rate means the synthetic-key bypass isn't
  working as configured.

### If you hit a 400

Every 400 in this harness means a payload shape or a coordinate is outside
the server's validation window — never a "real" application failure to
tolerate. Fix it in `k6/lib/payloads.js` or the offending scenario, then
extend `__tests__/payload-contract.test.ts` so the specific case can't
regress silently. Re-run the local dry-run loop until clean before touching
staging.

## Leading hypothesis: placement CPU vs. polygon size

`POST /heaps/:id/place` runs `isPointInside` over the full base+liveZone
polygon (up to 5 times per request, once per CAS attempt) plus a `JSON.parse`
of `live_zone`. The free tier caps Workers CPU at **10ms per request**.
**Hypothesis: placement CPU scales with polygon size, and a mature
(long-grown) heap is close to or over that cap**, where a freshly-seeded
heap isn't.

`loadtest:seed` creates exactly this pair — a fresh `smallHeapId` and a
pre-grown `largeHeapId` (default 400 seeded vertices) — to measure it:

```bash
# small (default)
BASE_URL=<...> npm run loadtest -- -e PLACE_FIXTURE=small
# large
BASE_URL=<...> npm run loadtest -- -e PLACE_FIXTURE=large
```

Compare `http_req_duration{name:place-contention}` and `wrangler tail`'s
reported CPU time between the two runs. If `large` shows materially higher
p95/p99 latency or CPU time approaching 10ms, the hypothesis holds and the
fix is on the geometry side (e.g. capping live-zone size more aggressively,
or a cheaper point-in-polygon check), not the request layer.

## Why this isn't wired into CI

Every CI run would spend account-wide quota shared with production — a push
that happens to land during a traffic spike could tip a KV or D1 bucket over
and take production down with it. Load testing here is a deliberate, manual,
human-scheduled action (`npm run loadtest`), run in a low-traffic window,
with a hard per-run cap enforced before the run starts (`shared-iterations`
executors + the `createBudget` safety net) — not an automatic gate on every
commit.

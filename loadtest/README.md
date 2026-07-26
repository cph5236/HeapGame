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

---

## Quickstart

### Command reference

Run these from the repo root. All of them load `.env` automatically.

```bash
npm run loadtest                            # full run: 800 sessions, ~6,800 requests
npm run loadtest -- -e SESSIONS=150         # smaller run, proportionally cheaper
npm run loadtest -- -e PLACE_FIXTURE=large  # contention on the big polygon
npm run loadtest:local                      # against local wrangler dev — FREE, no quota
npm run loadtest:seed                       # one-off: build fixtures
npm run loadtest:reset                      # small fixture back to empty between runs
```

Flags go after `--` so npm forwards them to k6. Combine freely:
`npm run loadtest -- -e SESSIONS=300 -e PLACE_FIXTURE=large -e MAX_PLACEMENTS=60`

### Zero to first result

**1. Install k6.** Not an npm dependency — it's a standalone binary.

```bash
curl -sL https://github.com/grafana/k6/releases/download/v0.54.0/k6-v0.54.0-linux-amd64.tar.gz \
  | tar xz -C /tmp
mkdir -p ~/.local/bin && mv /tmp/k6-v0.54.0-linux-amd64/k6 ~/.local/bin/
k6 version   # should print v0.54.0
```

`~/.local/bin` is on `PATH` by default on most distros and needs no sudo. If
`k6 version` fails, either add it to `PATH` or drop the binary somewhere that
already is.

**2. Put credentials in `.env`** (repo root, gitignored). Three lines, **no
spaces around `=`**:

```
BASE_URL=https://heap-server-staging.hanlinsoftwaresws.workers.dev
ADMIN_SECRET=<staging admin secret>
LOADTEST_SECRET=<staging load-test secret>
```

These are the secrets set on the staging Worker via `wrangler secret put`.
**Cloudflare cannot show them to you again after they're set** — if they're
lost, set new ones and update `.env` to match. See
`docs/superpowers/runbooks/loadtest-staging.md`.

`LOADTEST_SECRET` is what lets one machine simulate many players: it gives each
virtual user its own rate-limit bucket. Without it the limiter keys on your IP
and throttles the whole run to ~5 req/s, which measures the rate limiter rather
than the game.

**3. Rehearse locally first — this is free.** It catches payload and config
mistakes without spending any quota.

```bash
# terminal 1
cd server && npx wrangler dev

# terminal 2
BASE_URL=http://localhost:8787 ADMIN_SECRET=dev npm run loadtest:seed
npm run loadtest:local
```

`loadtest:local` hard-overrides `BASE_URL` to localhost, so it cannot
accidentally hit staging even with a staging `.env`. Expect zero unexpected
4xx/5xx. Latency thresholds *will* trip — `wrangler dev`'s local D1 emulation is
slow under concurrency. That's expected and not a finding.

**4. Seed the staging fixtures.** One-off, ~400 placements (~800 KV deletes).
Skip if `loadtest/fixtures.json` already exists.

```bash
npm run loadtest:seed
# reuse a heap you already made in the admin UI instead of creating one:
SMALL_HEAP_ID=<guid> npm run loadtest:seed
```

**5. Run it.**

```bash
npm run loadtest
```

Takes ~30s. Watch the server in another terminal:
`cd server && npx wrangler tail --env staging`

**6. Read the output** — see [Reading the results](#reading-the-results).
`http_req_failed` and the latency thresholds decide pass/fail; 409 and 429 are
declared expected and don't count as failures.

### Recommended first session

```bash
npm run loadtest:local                       # free rehearsal
npm run loadtest                             # baseline, small fixture
npm run loadtest -- -e PLACE_FIXTURE=large -e MAX_PLACEMENTS=60
```

The third is the actual experiment — see
[Leading hypothesis](#leading-hypothesis-placement-cpu-vs-polygon-size). Bump
`MAX_PLACEMENTS` because the default 30 iterations gives a p95 from too small a
sample to trust.

### If something goes wrong

| Symptom | Cause |
|---|---|
| `k6 not found on PATH` | Step 1 didn't take. `which k6`. |
| `ENOENT ... fixtures.json` | Step 4 not run. |
| Everything 401s | `ADMIN_SECRET` wrong or missing from `.env`. |
| `rate_limited` far above ~5% | `LOADTEST_SECRET` doesn't match the Worker's. |
| A 400 on every iteration | A payload drifted from `shared/`. See [If you hit a 400](#if-you-hit-a-400). |
| `Refusing to seed…` | `BASE_URL` isn't staging or localhost. Working as intended. |

---

## Prerequisites

1. **k6** installed and on `PATH`. Not an npm dependency — the scripts below
   assume a `k6` binary. See <https://k6.io/docs/get-started/installation/>.
   (If you can't install it system-wide, a static release binary works fine
   from anywhere on disk; just make sure it resolves as `k6` or adjust the
   commands below to its full path.)
2. **Staging deployed** — done, at
   `https://heap-server-staging.hanlinsoftwaresws.workers.dev`. Its
   `[env.staging]` block, 4 D1 databases, KV namespace and secrets are
   documented in `docs/superpowers/runbooks/loadtest-staging.md`.
3. **Credentials in `.env`** (repo root, gitignored). Every `npm run loadtest*`
   script loads it, so you don't have to prefix commands with env vars:

   ```
   BASE_URL=https://heap-server-staging.hanlinsoftwaresws.workers.dev
   ADMIN_SECRET=<staging admin secret>
   LOADTEST_SECRET=<staging load-test secret>
   ```

   No spaces around `=`. Cloudflare secrets cannot be read back after they're
   set, so if you lose these, re-run `wrangler secret put` with new values.

   `npm run loadtest:local` overrides `BASE_URL` to `http://localhost:8787` and
   blanks `LOADTEST_SECRET`, so a `.env` pointing at staging can never cause a
   "local" dry run to spend real quota.
4. **Fixtures seeded once**, against whichever `BASE_URL` you're pointing at:
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
at throwaway volume (20 journey iterations; the placement scenario scales
its own iteration/VU count down with `MAX_PLACEMENTS` — see
[Per-run budget](#per-run-budget) — so this becomes 5 iterations across 5
VUs; 20 limiter probes). `ADMIN_SECRET` can be anything locally:
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
  iteration count is 30 at the default `MAX_PLACEMENTS` and not something
  derived from a request budget.
- **KV deletes ≈ 329/run** (accounting in the design spec, ~a third of the
  daily 1,000 bucket) — **≈ 2 runs/day** with headroom left for production.

### How `placement`'s volume scales with `MAX_PLACEMENTS`

`main.js` derives the `placement` scenario's own iteration and VU counts from
`MAX_PLACEMENTS` instead of hardcoding them, specifically so a small
`MAX_PLACEMENTS` (as `loadtest:local` uses) can't produce a per-VU placement
budget below 1 — `placement()` returns immediately once its budget is
exhausted (see `k6/scenarios/placement.js`), so a cap that rounds down to 0
doesn't just under-count, it silently no-ops the rest of that VU's
iterations for the whole run (this shipped broken in the first version of
this file — a `loadtest:local` run's `cas_accepted + cas_conflicts` totals
came out to roughly half the configured iteration count instead of matching
it; see the fix note in `task-12-report.md` if you're tracing history):

```js
const PLACEMENT_ITERATIONS = Math.max(1, Math.min(30, MAX_PLACEMENTS));
const PLACEMENT_VUS = Math.max(1, Math.min(15, PLACEMENT_ITERATIONS));
// per-VU budget: Math.max(1, Math.ceil(MAX_PLACEMENTS / PLACEMENT_VUS))
```

| `MAX_PLACEMENTS` | Iterations | VUs | Per-VU budget | Real cap |
|---|---|---|---|---|
| 150 (default) | 30 | 15 | 10 | 30 (bounded by iterations, budget never binds) |
| 5 (`loadtest:local`) | 5 | 5 | 1 | 5 (budget binds at exactly 1/VU) |

Verified against both cases with a real local run (see `task-12-report.md`):
`MAX_PLACEMENTS=5` reaches its full `5/5 shared iters` rather than stalling
partway, and `MAX_PLACEMENTS=150` reaches `30/30`.

`createBudget()` divides these global caps by each scenario's VU count to get
a per-VU runtime safety net (k6 VUs don't share module state). Every divisor
(both `journey`'s and `placement`'s) is wrapped in `Math.max(1, Math.ceil(...))`
so it can never round down to a value that permanently blocks a VU's
`canPlace()` gate. Aside from that floor, the divisors are deliberately
generous, not a tight per-scenario slice — e.g. journey's real steady-state
usage is ~135 requests/VU against a 200/VU cap. The authoritative bound is
always each scenario's `iterations` in `main.js`, fixed before the run
starts; the per-VU counter only exists to abort a scenario that's somehow
sending far more requests per iteration than expected (a bug), not to shape
normal volume.

## Tunable env vars

All passed via k6's `-e` flag (`npm run loadtest` / `loadtest:local` already
wire the two most common ones):

| Var | Default | Effect |
|---|---|---|
| `BASE_URL` | `http://localhost:8787` | Target Worker. |
| `LOADTEST_SECRET` | *(unset)* | Staging-only synthetic rate-limit key. Inert (no-op) everywhere else, including production. |
| `SESSIONS` | 800 | `journey` scenario's total iteration count. Also caps its VU count (`min(50, SESSIONS)`) so a small override never sets iterations below vus, which k6 rejects outright. |
| `MAX_PLACEMENTS` | 150 | Global placement safety-net cap. Also sizes the `placement` scenario's own iteration/VU counts (see [Per-run budget](#per-run-budget)) and both scenarios' per-VU budget divisors. |
| `PLACE_RATE` | 0.15 | Probability a `journey` session attempts a placement. An explicit `-e PLACE_RATE=0` is honoured (disables placements from journey traffic entirely) rather than falling back to 0.15. |
| `NEW_IDENTITY_RATE` | 0.05 | Fraction of sessions that mint a brand-new identity instead of drawing from the seeded pool. Set explicitly (`-e NEW_IDENTITY_RATE=0`) to pin a run entirely to the seeded pool — an explicit `0` is honoured, it does not fall back to the default. |
| `PLACE_FIXTURE` | `small` | Which fixture heap the `placement` scenario hammers — `small` or `large`. See the [CPU-vs-polygon-size hypothesis](#leading-hypothesis-placement-cpu-vs-polygon-size) below. |
| `PLACEMENT_ITERATIONS` | `min(30, MAX_PLACEMENTS)` | How many placements the `placement` scenario performs. Overriding it also raises that scenario's placement budget, so an explicit value isn't silently throttled by `MAX_PLACEMENTS`. |
| `PLACEMENT_VUS` | `min(15, iterations)` | Concurrency of the `placement` scenario. Drop to 1 to remove CAS-retry amplification when measuring cost per placement. |
| `PLACE_SLEEP_MS` | `0` | Think time after each placement. `0` means VUs fire as fast as the network allows (~12.5 placements/sec at 15 VUs), which is the right shape for finding the contention ceiling. Raise it to pace a run. |

All numeric vars above (`SESSIONS`, `MAX_PLACEMENTS`, `PLACE_RATE`,
`NEW_IDENTITY_RATE`) share one parsing rule (`numEnv` in `k6/lib/config.js`):
only a genuinely absent or blank-string value falls back to the default —
`0` and every other numeric string is used as given. The naive
`Number(__ENV.X || default)` pattern this replaced silently discarded an
explicit `0` (`0 || default` evaluates the default), which is exactly the
value someone setting `PLACE_RATE=0` or `NEW_IDENTITY_RATE=0` needs honoured.

## Reset between runs

```bash
npm run loadtest:reset                    # small fixture only (default)
RESET_LARGE=true npm run loadtest:reset   # both — see the warning below
```

Puts the **small** fixture's live zone back to empty so runs are repeatable.

**The large fixture is left intact by default, and you almost never want to
reset it.** Its whole purpose is to *be* a large polygon — the control the
small fixture is compared against when testing whether placement CPU scales
with vertex count. Emptying it destroys the only property that makes it
useful, and rebuilding costs ~400 placements (~800 KV deletes from an
account-wide 1,000/day bucket shared with production), which cannot be
recovered until 00:00 UTC.

Identities in `fixtures.json` are likewise **not** regenerated — reusing the
same pool across runs is what keeps score-submit KV cost low (see the
identity-model rationale in the design spec).

### Fixture drift

Each run against the small fixture grows it, so the contrast between the two
narrows over time. Measure before relying on a comparison:

```bash
curl -s "$BASE_URL/heaps/<id>/base" | jq length      # base vertices
curl -s "$BASE_URL/heaps/<id>" | jq '.liveZone|length'  # live-zone vertices
```

Placement cost is driven by `base + liveZone` together — `POST /place` builds
`[...base, ...liveZone]` and runs `isPointInside` over the whole polygon, up to
5 times in the CAS retry loop. Reset the small fixture when the ratio gets too
close to call.

## Watching the server

```bash
cd server && npx wrangler tail --env staging
```

Streams live logs for CPU time and uncaught exceptions during a run.
`captureServer` events worth watching for: `place:rejected` (any reason other
than the expected CAS/geometry ones) and `rate_limit:hit`.

## Reading the results

k6 prints a summary at the end of the run. What to look at:

- **Thresholds** (`main.js`): `http_req_failed` <1% is the error-rate gate.
  `main.js` calls `http.setResponseCallback(http.expectedStatuses({ min: 200,
  max: 399 }, 409, 429))` at module scope (once per VU, during that VU's init
  phase — applies to every `http.*` call the VU makes afterwards, including
  from the imported scenario modules) so that 409/429 count as *expected*
  responses rather than failures before the threshold ever sees them. This
  matters: thresholding `http_req_failed` filtered by an
  `expected_response:true` tag (an earlier version of this file did that
  instead) is vacuous — k6 defines `http_req_failed` as the complement of the
  expected/actual match, so a population already filtered down to "responses
  that matched expectations" can never contain a failure, and the threshold
  reads a permanent 0% regardless of what the server actually returns. With
  the fix, a threshold breach means genuine unexpected 4xx/5xx. Read
  endpoints are additionally held to p95<500ms / p99<1500ms; `POST .../place`
  (both the `place` and `place-contention` tags) to p95<1000ms — expect these
  latency thresholds specifically (not the error-rate one) to be noisy under
  local `wrangler dev`, see the dry-run loop section above.
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

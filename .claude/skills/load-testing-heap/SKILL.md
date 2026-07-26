---
name: load-testing-heap
description: Use when a HeapGame change needs measuring under load — placement cost, throughput, CPU headroom against the free-tier cap, or comparing two commits or two heap sizes. Also when asked whether something "got slower" on the server.
---

# Load-Testing Heap

k6 harness in `loadtest/`, targeting `heap-server-staging`. Full reference:
`loadtest/README.md`. Runbook: `docs/superpowers/runbooks/loadtest-staging.md`.

## Measure CPU, not latency

A placement is 400–900 ms dominated by network and D1 round trips, and
run-to-run variance on an *identical* target is ~18%. A few ms of CPU is
invisible inside that. Latency-based comparisons here have produced confidently
wrong answers.

**The signal is Worker CPU time**, read per-minute from the Cloudflare dashboard
(Workers → heap-server-staging → Metrics). Free tier caps it at **10 ms/request**;
Cloudflare tolerates infrequent overruns and kills sustained ones with
`Error 1102`. Known baseline: P99 ~5.6 ms at 238 polygon vertices, ~10.3 ms at 684.

## Preflight

```bash
which k6 || echo "NOT INSTALLED"     # standalone binary, NOT an npm dep
grep -c BASE_URL .env                # needs BASE_URL, ADMIN_SECRET, LOADTEST_SECRET
ls loadtest/fixtures.json            # gitignored; if missing, see cost table
```

Install k6 without sudo: download the static binary to `~/.local/bin/`.

## Cost — quotas are ACCOUNT-WIDE and shared with production

The tight bucket is **KV deletes: 1,000/day**, resetting 00:00 UTC.

| Action | KV deletes | Note |
|---|---|---|
| `npm run loadtest` (800 sessions) | ~330 | |
| Isolation run (200 placements) | ~400 | |
| `npm run loadtest:reset` | ~2 | cheap — prefer this |
| `npm run loadtest:seed` | **~800** | one-off; nearly the whole day's budget |

**Never seed a new heap just to get a clean comparison.** Reset the existing
small fixture instead. Two seeds exceed the daily bucket and the second dies
partway through.

Exhausting the bucket is safe but degrading: the cache fails open, so reads fall
through to D1 and players see heaps up to 60 s stale rather than errors.

## Commands

All load `.env` — do **not** prefix them with `BASE_URL=` or `ADMIN_SECRET=`.

```bash
npm run loadtest:local    # against wrangler dev — FREE, rehearse here first
npm run loadtest          # full: 800 sessions, ~6,800 requests, ~30 s
npm run loadtest -- -e SESSIONS=150
npm run loadtest:reset    # small fixture only; RESET_LARGE=true also resets large
```

Rehearsing locally costs nothing and catches payload and config mistakes before
you spend quota. Latency thresholds will trip locally — `wrangler dev` uses slow
SQLite emulation. That is expected, not a finding.

## A/B comparison (two commits, or two heap sizes)

```bash
npm run loadtest -- -e PLACE_FIXTURE=large -e PLACEMENT_ITERATIONS=200 \
  -e PLACEMENT_VUS=1 -e PLACE_RATE=0 -e SESSIONS=50
sleep 90                                    # REQUIRED — see below
npm run loadtest -- -e PLACE_FIXTURE=small -e PLACEMENT_ITERATIONS=200 \
  -e PLACEMENT_VUS=1 -e PLACE_RATE=0 -e SESSIONS=50
```

**The gap between legs is not optional.** The CPU dashboard aggregates per
minute; back-to-back runs blur into shared buckets and the comparison becomes
unreadable. Record each run's start/end time and read only its own minutes.

`PLACEMENT_VUS=1` removes CAS-retry amplification so you measure base cost.
`PLACE_RATE=0` stops journey traffic adding placements to the small fixture and
contaminating leg two.

The small fixture *grows every run*, so leg two faces a bigger polygon than leg
one. Reset between legs and confirm sizes rather than assuming — placement cost
tracks `base + liveZone` together:

```bash
curl -s "$BASE_URL/heaps/<id>/base" | jq length
curl -s "$BASE_URL/heaps/<id>" | jq '.liveZone|length'
```

## Comparing two commits

Each leg needs its own staging deploy. Confirm what is actually running before
trusting a result, and restore staging afterwards — a stale staging Worker
silently invalidates every later run.

```bash
cd server && npx wrangler deployments list --env staging | head   # what's live now
npx wrangler deploy --env staging                                 # note the Version ID
# …run leg…  then restore:
git checkout main && cd server && npx wrangler deploy --env staging
```

Never deploy a test commit to production. `--env staging` is not optional.

## Reading results

Summaries land in `loadtest/results/<timestamp>-<fixture>.json`. Thresholds
decide pass/fail; 409 and 429 are declared expected and are not failures.

| Signal | Meaning |
|---|---|
| `cas_conflicts` | Placements that exhausted all 5 CAS retries. 28–36% at 15 concurrent placers is the known baseline. |
| `rate_limited` >5% | Harness outrunning real players, not a server fault — `RL_SCORES` is 10/min per player. |
| `heap-get` p95 failing by ~10 ms | Known mis-calibration detecting the cache-miss tail. Not a regression. |
| `placement resolved` failing | Placements returned 429. Something is sharing one rate-limit bucket. |

## Common mistakes

| Mistake | Reality |
|---|---|
| Seeding a fresh heap for a clean baseline | ~800 KV deletes vs ~2 for a reset. Reset instead. |
| Comparing `http_req_duration` between runs | Buried under 18% variance. Use CPU. |
| Running both legs back-to-back | Dashboard buckets blur. Wait ~90 s. |
| `RESET_LARGE=true` to "start clean" | Destroys the large fixture; ~800 deletes to rebuild, unrecoverable until 00:00 UTC. |
| Prefixing commands with `BASE_URL=…` | Scripts read `.env`. |
| Trusting `score-submit` numbers | ~40% get 429'd by `RL_SCORES`; needs think-time to be meaningful. |
| Leaving staging on a test commit | Every later run measures the wrong code. Redeploy `main` when done. |

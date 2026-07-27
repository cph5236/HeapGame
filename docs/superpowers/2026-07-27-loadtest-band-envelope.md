# Load test — band envelope branch vs main baseline

Run 2026-07-27 against `heap-server-staging`, Worker version `6c73ef8b`
(`feature/heap-delta-api`, PR #126). Baseline is the 2026-07-26 run set on the
pre-change Worker, same harness and same config.

## Windows for the CPU dashboard

**Worker CPU is the primary signal and is NOT in these JSON summaries** — read it
per-minute from Cloudflare → Workers → `heap-server-staging` → Metrics. Latency
below is secondary: run-to-run variance on an identical target is ~18%, which
swallows the few ms of CPU this work moves. Each leg was separated by 95s so the
dashboard's per-minute buckets stay readable.

| Leg | Fixture | Start (UTC) | End (UTC) |
|---|---|---|---|
| 1 | small, 200 placements, 1 VU | 20:47:06 | 20:49:16 |
| 2 | large, 200 placements, 1 VU | 20:51:28 | 20:54:27 |
| 3 | full — 800 sessions, 15 concurrent placers | 20:56:22 | 20:57:00 |

Known CPU baseline for reference: P99 ~5.6 ms at 238 polygon vertices, ~10.3 ms
at 684. Free-tier cap is 10 ms/request.

## Isolation legs — polygon size held constant, 1 placer

Fixture sizes measured immediately before leg 1: small `base=312 liveZone=0`
(freshly reset), large `base=564 liveZone=270`.

| | baseline small | **leg 1 small** | baseline large | **leg 2 large** |
|---|---|---|---|---|
| `place-contention` med | 436 ms | **214 ms** | 468 ms | **596 ms** |
| `place-contention` p95 | 559 ms | **667 ms** | 622 ms | **864 ms** |
| `place-contention` max | 2117 ms | **1130 ms** | 2784 ms | **3172 ms** |
| `heap-get` med | 115 ms | **133 ms** | 124 ms | **223 ms** |
| `heap-get` p95 | 513 ms | **267 ms** | 506 ms | **883 ms** |
| `placement resolved` | 200/200 | **200/200** | 200/200 | **200/200** |
| `http_req_failed` | 0.00% | **0.00%** | 0.00% | **0.00%** |
| `cas_accepted` | 150/200 | **91/200** | 146/200 | **119/200** |

Latency moved in both directions across these legs, which is what ~18% variance
looks like — no conclusion should be drawn from it either way. The two numbers
that do mean something are the last three rows: zero failures, every placement
resolved, and a real drop in acceptance rate.

## Full run — never executed before this branch

| | leg 3 |
|---|---|
| sessions / iterations | 800 / 850 |
| requests | 6,832 at 184.5/s |
| duration | 37 s |
| `http_req_failed` | **0.00%** (0 of 6,832) |
| `heap get ok` | 800/800 |
| `heaps list ok` | 800/800 |
| `score not 5xx` | 800/800 |
| `place not 5xx` | 108/108 |
| `placement resolved` | 30/30 |
| `rate_limited` | 4.83% (325/6,722) |

Thresholds crossed: `heap-get` p95 894 ms and `scores-context`. Both are
pre-existing calibration issues the skill documents — `heap-get` p95 failing by
around 10 ms is the known cache-miss-tail mis-calibration, and `score-submit` /
`scores-context` numbers are unreliable without think-time because `RL_SCORES`
(10/min per player) 429s a large share of them. `rate_limited` at 4.83% is under
the >5% line that would indicate the harness outrunning real players.

No 5xx anywhere across 6,832 requests at 184/s.

## KV delete cost — the reason the runs were affordable

Deletes are the tightest Cloudflare quota: 1,000/day, ACCOUNT-WIDE, shared with
production.

Measured by version bumps: small 1 → 131 and large 499 → 618, so **249 accepted
placements** across all three legs, at 1 delete each ≈ **253 deletes** including
resets. Under the pre-fix code the same work costs ~4× — about 1,000, the entire
daily bucket — which is why `perf(heap): cut placement-path KV deletes from 4 to 1`
had to land first.

Direct proof the GET-path write is gone, from staging D1 after all three runs:

| heap | `version` | `live_zone_version` |
|---|---|---|
| small `e5d850fc` | 1 → 131 (130 placements) | **300, unmoved** |
| large `ef03d913` | 499 → 618 (119 placements) | **0, never written** |

Every one of those 249 bumps would previously have left `live_zone_version`
equal to `version`, each costing a D1 write plus two KV deletes on the following
full GET. Neither column moved.

## Finding: acceptance rate dropped

`cas_accepted` fell from 150/200 to 91/200 on small, and 146/200 to 119/200 on
large. These are **not** failures — `placement resolved` stayed 200/200, so the
placements returned HTTP 200 with `accepted: false`, the legitimate
"does not widen its band" answer. Nothing errored and nothing was rate-limited.

It is the expected consequence of two changes on this branch, and it is more
pronounced than the numbers alone suggest because leg 1 ran on a *freshly reset*
small heap — which should accept MORE, since empty bands always accept:

1. **Local ghost anchoring.** Ghosts now land within `GHOST_JITTER_RADIUS_PX` of
   the placement instead of scattering across the live zone, so bands near where
   a player is working reach their full width quickly. Subsequent placements
   there must exceed those extents to count.
2. **New-band seeding.** A new band is stored with an interpolated opposite side
   rather than a single point, so it starts wider than the one x that created it.

Both were deliberate, and both trade acceptance rate for a smoother silhouette.
Whether ~45-60% is the right acceptance rate is a gameplay tuning question, not a
correctness one — the levers are `ghostPointCount`, `GHOST_JITTER_RADIUS_PX`, and
whether seeding stays on. Worth a play session before merge, since it is the
difference between a tap that visibly grows the heap and one that does nothing.

## Not covered

- **CPU numbers are absent** and must be read from the dashboard using the
  windows above. Every claim in the spec about CPU under load remains unverified
  until that is done.
- The harness sends no `baseId`, so all three legs exercised the **full**
  response path exclusively. The delta protocol — the thing this branch adds —
  was never measured. Testing it needs the harness to carry `version` + `baseId`
  across iterations.

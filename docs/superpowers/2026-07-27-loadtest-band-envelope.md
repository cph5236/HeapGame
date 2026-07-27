# Load test — band envelope branch vs main baseline

Run 2026-07-27 against `heap-server-staging`, Worker version `6c73ef8b`
(`feature/heap-delta-api`, PR #126). Baseline is the 2026-07-26 run set on the
pre-change Worker, same harness and same config.

## Worker CPU — the primary signal

Read from the Cloudflare dashboard (EDT, UTC−4) and mapped to each leg's window.
Latency further down is secondary: ~18% run-to-run variance on an identical
target swallows the few ms of CPU this work moves. Legs were separated by 95s so
the per-minute buckets stay readable.

| Window (EDT) | Leg (UTC) | P50 | P90 | P99 | P999 |
|---|---|---|---|---|---|
| 16:45–46 | *reset — not a leg* | ~7 | ~7 | ~7 | ~19.8 |
| 16:47–16:49 | small isolation (20:47:06–20:49:16) | ~2.2–3.5 | ~4–6.5 | **~6–10** | ~13.6–15.2 |
| 16:51–16:54 | large isolation (20:51:28–20:54:27) | ~3.3–5.2 | ~6.3–8.3 | **~12–17.2** | ~13.4–**29** |
| 16:56–16:57 | full, 184 req/s (20:56:22–20:57:00) | ~2 | ~4.3 | **~9** | ~18.4 |

Aggregate across the whole 30-minute window: P50 3.38, P90 6.62, P99 10.4,
P999 14.77 ms. Free-tier cap is **10 ms/request**; Cloudflare tolerates
infrequent overruns and kills sustained ones with Error 1102. Prior known
baseline: P99 ~5.6 ms at 238 polygon vertices, ~10.3 ms at 684.

Memory is a non-issue: P999 27.79 MB, peaks ~50 MB, against a 128 MB cap.

**The full run — the highest-throughput leg at 184 req/s — stayed under the cap
at P99 ~9 ms.** The large-fixture isolation leg breached it, peaking ~17 ms P99
with P999 ~29 ms. See the CPU finding below for why, which is the most actionable
result of this whole exercise.

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

## Finding: bounded growth works, bounded CPU does not — yet

This is the result worth acting on.

**The live zone is genuinely bounded.** Freeze fired **four times** on the large
fixture during leg 2 — four base epochs minted at 20:51:59, 20:52:01, 20:52:02
and 20:52:52 — and left the live set at **65 bands**, comfortably under
`LIVE_ZONE_MAX_BANDS` (77). That is the freeze fix from `9b25c27` doing exactly
its job: under the pre-fix code freeze fired once per heap ever, and the live zone
would have been all 348 bands and still climbing. The design's central claim
holds.

**Per-request CPU is still unbounded, for two reasons that are both frozen-side
dead weight rather than live-zone growth:**

| | large fixture, after leg 2 |
|---|---|
| total band rows | 348 |
| **live** (`band < 249669`) | **65** |
| **frozen** (`band >= 249669`) | **283** |

1. `getAllBands` returns all **348** rows on every read, of which **283 are
   frozen** and already folded into the base blob. That is 5.4× more band data
   than needed, carried through the KV snapshot, JSON-parsed and filtered on
   every single request — and it grows with heap age forever, because freeze
   deletes no rows.
2. The **base blob grows on every freeze**: 564 → 638 → 710 → 777 → 846 vertices
   across those four freezes inside one minute. Each freeze also mints a new
   `baseId`, forcing every client to refetch the whole larger blob, and
   `createBase` reads the previous base to concatenate — so freeze cost itself
   scales with heap age too.

Against the prior baseline (P99 5.6 ms at 238 vertices, 10.3 ms at 684), the large
fixture's ~846 base vertices plus 65 live bands extrapolates to ~13 ms, and we
measured 12–17 ms. In other words the band envelope has **not yet produced a CPU
win on a large heap** — the frozen dead weight on the read path offsets what
bounding the live zone gained.

Both causes are the two follow-ups already parked in the SDD ledger. The load test
has now put a number on why they matter, and turned them from housekeeping into
the thing standing between this branch and a heap that stays under the CPU cap as
it ages. Deleting frozen rows at freeze time is the higher-value half: it cuts the
per-request band read from 348 rows to 65 on this fixture, and a read audit
already showed it is safe (post-freeze, `getMaxBand` is only consulted on the
`freeze_y === 0` branch, `getBand`/`getBandRange` are only called for live bands,
and frozen geometry already lives in the base blob every matching-`baseId` client
has cached).

## Not covered

- **CPU numbers are absent** and must be read from the dashboard using the
  windows above. Every claim in the spec about CPU under load remains unverified
  until that is done.
- The harness sends no `baseId`, so all three legs exercised the **full**
  response path exclusively. The delta protocol — the thing this branch adds —
  was never measured. Testing it needs the harness to carry `version` + `baseId`
  across iterations.

---

# Leg 2 re-run: after frozen-row deletion (commit `44c32b4`)

Staging version `7fd00b97` (was `6c73ef8b`). Same command as the original leg 2,
same fixture, so the only deliberate difference is the deletion.

| Window (UTC) | Window (EDT) | Leg |
|---|---|---|
| 23:40:23–23:43:21 | 19:40–19:43 | large isolation, 200 placements, `PLACEMENT_VUS=1`, `PLACE_RATE=0`, `SESSIONS=50` |

## The read path shrank 85%

Measured on the real staging `heap_core_staging` row, before and after the run:

| | before | after |
|---|---|---|
| `heap_band` rows (what every read parses) | **348** | **53** |
| live | 65 | 53 |
| frozen (dead weight) | **283** | **0** |
| freeze band | 249669 | 249548 |
| base blob | 34,826 B | 42,810 B |
| heap version | 618 | 755 |

**The 283-row backlog cleaned itself up on the first freeze, with no migration.**
That falls out of the deletion boundary rather than being designed in: the rule is
`DELETE WHERE band >= bandOf(freezeY)`, and because the freeze line only ever
advances toward the summit (lower band index), each new line's deletion range is a
superset of every previous one. Any heap carrying frozen rows from before this
commit sheds all of them the next time it freezes. No backfill needed anywhere.

The `frozen = 0` cell is the load-bearing one: it is not "frozen rows grew more
slowly", it is "the category no longer exists at rest".

## What did NOT get fixed

The base blob still grew, 34,826 → 42,810 bytes (+23%) across this run's ~3
freezes. That is the second parked follow-up — re-envelope the base at freeze
instead of concatenating — and it remains the last unbounded term on the read
path. It is a much smaller term than the band rows were (bytes fetched once per
`baseId` and cached indefinitely client-side, versus rows parsed on every
request), but it is still monotonic in heap age.

## Latency, recorded but not concluded from

`place-contention` med 596→503 ms, p95 864→663 ms; `heap-get` med 223→187 ms.
Directionally consistent with the row reduction and **not evidence** — run-to-run
variance on an identical target is ~18%, which swamps this. `heap-base` med went
the other way (163→355 ms), consistent with the larger base blob but equally
inside the noise. The CPU dashboard remains the only signal that decides this.

`cas_accepted` was 137/200, up from 119/200 on the same fixture pre-change. Not a
goal of this commit and not read as one.

## Still open

CPU for the 23:40–23:43 UTC window has to be read off the dashboard. The D1
evidence above establishes that the *cause* identified in the previous section is
gone; it does not by itself establish that P99 is back under 10 ms.

## CPU: the fix lands, and the run contains its own before/after

Window aggregate (19:38–19:45 EDT): **P50 3.68 / P90 5.83 / P99 9.53 / P999 16.71 ms.**

The three freezes in this run are timestamped in `heap_base`, and the first one is
what swept the 283-row backlog:

| freeze | UTC | EDT |
|---|---|---|
| 1 (sweeps the backlog) | 23:41:23.544 | 19:41:23 |
| 2 | 23:42:00.792 | 19:42:00 |
| 3 | 23:42:57.434 | 19:42:57 |

So the per-minute series straddles the transition: 19:40 ran entirely at 348 rows,
and everything from 19:41:23 on ran at ~53–90.

| minute (EDT) | rows in play | P50 | P90 | P99 | P999 |
|---|---|---|---|---|---|
| 19:40 | 348 (pre-sweep) | ~3.7 | ~7.9 | **~12.6** | ~18.5 |
| 19:41 | mixed, sweep at :23 | 3.77 | 5.33 | 8.36 | 23.65 |
| 19:42 | post-sweep | ~3.5 | ~5.0 | ~9.8 | ~16 |
| 19:43 | post-sweep, no freeze | ~3.8 | ~5.1 | **~7.4** | ~9 |

Compared with the same leg before the change (16:51–16:54 EDT, P99 ~12–17.2 ms
per minute), the placement-only minutes moved from **12–17 ms to 7.4–9.8 ms** and
the window P99 is **9.53 ms, under the 10 ms cap**. The 19:40 row agrees with the
old numbers, which is the expected result for a minute that still had all 348 rows.

One confound, stated rather than smoothed over: 19:40 also contains the 50-VU
journey burst (`journey` completes in 6.2 s at run start), so that minute is not a
clean band-rows measurement. The load-bearing comparison is the placement-only
minutes, which are directly comparable between the two runs because the traffic
shape is identical.

### The remaining tail is the freeze operation, not the read path

P999 still peaks over the cap: 23.65 ms at 19:41, ~16 at 19:42, but ~9 at 19:43.
The two elevated minutes are exactly the minutes containing freezes, and the quiet
minute is the one without one. A freeze reads the previous base, concatenates, and
writes a larger blob — cost that grows with heap age and is unaffected by this
commit. This is the same term as the base-blob growth noted above, and it is now
the whole of what remains: the steady-state read path is inside budget, and the
outliers are the freeze requests themselves. That makes re-enveloping the base at
freeze the natural next piece of work, and it is a tail-latency fix rather than a
throughput one.

P999 over the cap on ~1 request in 1085 is not an `Error 1102` risk — Cloudflare
kills sustained overruns, not infrequent ones.

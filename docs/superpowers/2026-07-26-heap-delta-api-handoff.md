# Handoff — heap polygon delta API + bounded polygon growth

**Status:** ready for brainstorming → spec → plan. No code written.
**Origin:** load testing, 2026-07-26. Results:
`https://claude.ai/code/artifact/4579f8b6-423e-4a45-95d6-e522d3fd5518`
**Related:** `Todo/Todo.md` § PERF, PR #123 (merged), PR #125 (merged).

You are picking this up cold. Everything needed to design it is below, including
the measurements that justify it and the structural traps that will bite an
implementation that doesn't know about them.

---

## 1. The problem, with evidence

`POST /heaps/:id/place` ray-casts `isPointInside` over the **entire** polygon —
`[...baseVertices, ...liveZone]` — up to 5 times inside a CAS retry loop, plus a
`JSON.parse` of the whole live zone on every attempt.

Cloudflare's free tier caps Worker CPU at **10 ms per request**. Two isolation
runs against staging (200 placements each, 1 VU, CPU read per-minute off the
Cloudflare dashboard):

| CPU | small heap — 238 vertices | large heap — 684 vertices |
|-----|---------------------------|---------------------------|
| P50 | ~2.8 ms                   | ~3.6 ms                   |
| P90 | ~3.8 ms                   | ~6.0 ms                   |
| P99 | ~5.6 ms                   | **~10.3 ms**              |

On the large heap, P99 read 10.1 / 10.9 / 10.0 ms across three consecutive
minutes — at or over the cap every minute, not an occasional spike. Cloudflare
tolerates *infrequent* overruns but terminates sustained ones with `Error 1102`.

**Latency cannot detect this.** A placement is 400–900 ms dominated by network
and D1 round trips, so a 5 ms CPU delta is invisible. An earlier latency-based
comparison had 18% run-to-run variance on an *identical* target, which swamped
the signal entirely. Only per-window CPU resolved it. Any future measurement of
this work must use CPU, not latency.

Two secondary findings from the same runs:

- **Egress scales with heap size.** Peak-load transfer went 8.1 MB → 15 MB
  between runs purely because the heap grew. `GET /heaps/:id` returns the entire
  live zone, once per session, to *every* player — so this cost lands on the
  whole player base, not just the ~1% who place blocks.
- **CAS retries exhaust under contention.** 15 concurrent placers on one heap
  produced 28% (small) / 36% (large) of resolved placements returning 409 after
  all 5 retries.

## 2. Root cause: the polygon grows without bound

```ts
// server/src/polygon.ts:52
const newBaseVertices = [...existingBase, ...frozen];
```

The live zone is capped — `LIVE_ZONE_MAX = 500`, and `checkFreeze` moves the
bottom `FREEZE_BATCH = 250` into the base once exceeded. But **the base is
append-only and never shrinks.** Every placement that survives long enough ends
up in the base permanently.

This is the finding that matters: a cheaper scan over an unbounded input still
reaches the cap, just later. Constant-factor optimisation does not fix
unbounded growth. **Bounding the polygon is the primary goal; the delta API is
the secondary one** — though they share the same restructuring.

## 3. What we're aiming for

Four outcomes, in rough priority order:

1. **Bound polygon growth.** The rollup that moves live-zone vertices into the
   base should also *simplify* them — a heap is a silhouette, so only the
   topmost surface at each x matters and everything buried beneath is invisible
   cost. Bucketing x at some resolution across the placeable span
   (`PLACE_X_MIN = 120` to `PLACE_X_MAX = 840`, i.e. 720 px) would cap the base
   at a fixed vertex count regardless of how many blocks are ever placed.
2. **`GET /heaps/:id` returns a delta** relative to the client's cached version,
   not the whole polygon.
3. **A cheap, band-local containment check** in `/place`, replacing the
   whole-polygon ray cast.
4. **Eliminate CAS conflicts.** They exist only because the live zone is a
   single JSON blob that concurrent writers clobber.

These converge on one enabler: a **surface / scanline representation** rather
than a ray-cast ring. See §5 for why simplification is only *correct* under it.

## 4. Two compatible design sketches (already discussed, not yet decided)

Both landed in nearly the same place; treat them as input, not as a decision.

**Live-zone vertices become rows** in a new table keyed by heap id, carrying a
version number and a delta/sequence number. Placements INSERT rather than
splicing a blob. Rollup targets old versions for deletion once they've been
folded into the base. The existing `live_zone` blob is retained as a
*materialised view* so nothing that currently reads it breaks — this keeps the
migration incremental and independently shippable.

**Suggested layering** (each layer ships alone):
1. Vertex rows + dual-write, invisible to clients.
2. Delta response on `GET /heaps/:id`, with the server declaring which mode it
   used (`full` vs `delta`) so a client can never misapply one.
3. Client applies deltas by merge-and-sort.
4. Rollup simplification + band-local containment + CAS removal.

**Base deltas are in scope and are the *easy* case.** Because
`newBaseVertices = [...existingBase, ...frozen]` is a pure append, a base delta
is just "batches after baseId X" — no sequence numbers, no re-sorting. The live
zone is the hard one. (An earlier read of this had it backwards.)

## 5. Structural facts that will bite you

Verified against the code and, where noted, empirically.

**The live zone is NOT append-only.** Placements splice into the middle to keep
it Y-ascending (`server/src/routes/heap.ts:512`):

```ts
const insertIdx = liveZone.findIndex((v) => v.y > y);
liveZone.splice(insertIdx, 0, newVertex);
```

So "everything after index K" is not the delta.

**But the ordering is a pure function of the data.** That is a stable insert:
equal-y vertices keep insertion order, everything else sorts by y. Carry a
monotonic sequence number per vertex and sorting by `(y, seq)` reconstructs the
exact ring from an unordered set. This is what makes a delta possible at all.

**Ring order IS the shape.** Sampling 20,000 points inside the valid placement
band, live-zone-only containment disagreed with base+live containment on
**7.9%** — even though the base's own edges never straddle the band (base
y-range `[48648, 50000]` vs band `[47115, 48648]`). Ray casting depends on the
closed ring, and the junction edges between the two arrays cross it. **You cannot
add, remove or reorder vertices without changing the shape** under the current
representation. This is the single biggest constraint.

**`version` is not monotonic.** Reset sets it back to 1
(`updateHeap(id, base_id, 1, [], 0, top_y)`). A client cached at v50 hitting a
server freshly reset to v1 would request "everything since 50" and receive
nothing, silently keeping a heap that no longer exists. `clientVersion <
serverVersion` is **not** a sufficient validity test — the design needs an epoch
or generation identifier that changes on reset and never repeats.

**Freeze mints a new `baseId` and truncates the live zone.** A client holding the
old `baseId` has the frozen vertices in *both* its cached live zone and the new
base. Any `baseId` change must force a full resync of both.

**Ghost points.** Each placement adds one real vertex plus `ghost_point_count`
jittered ghosts (`heap.ts` ~520), each spliced individually. All of them must
appear in a delta, and their relative order matters per the ordering rule above.

**Rejected placements are silent, and stay that way.** `/place` returns
`{ accepted: false }` when the point is inside the polygon, but nothing in
`src/` reads `.accepted` — only tests do. **Decision made: keep it silent.** No
client-facing behaviour change is in scope.

**`getHeapFresh` deliberately bypasses the KV cache** so the CAS sees the
authoritative row. Anything replacing the CAS must preserve that guarantee.

**Cache TTLs.** Heap row and list: 60 s. Base: 24 h (immutable per baseId).
Config: 300 s.

## 6. Open questions for the spec

- **Surface representation: wholesale or hybrid?** `verticesToScanlines` already
  exists at `shared/heapPolygon/polygon.ts:161`, and the client already reasons
  in surface terms via `getSurfaceYAtX`. Does the server adopt the same model, or
  keep the ring and add a surface index alongside?
- **Simplification resolution.** What x-bucket size, and what does it do to the
  silhouette visually? This is a gameplay-visible decision, not just a
  performance one — players should not see their heap change shape after a
  rollup.
- **Epoch design** for the reset case (§5).
- **Migration** for existing heaps *and* existing installed clients holding
  caches in the current format.
- **D1 row-read quota.** A naive `SELECT *` over vertex rows is up to 500 rows
  per request against 5M/day. The materialised blob should cover the `full`
  path so only deltas touch rows.
- **CAS removal semantics.** Append-only rows don't conflict, but two concurrent
  placements could both pass a containment check and land overlapping. Is that
  acceptable? (Likely yes — cosmetic overlap beats a 409 — but it should be a
  stated decision.)
- **Does simplification interact with `top_y`?** `top_y` is maintained as
  `MIN(top_y, candidate)` and gates placement validity; dropping buried vertices
  must not move it.

## 7. Where the code lives

| Concern | Path |
|---|---|
| Place / get / reset handlers | `server/src/routes/heap.ts` (place ~403, get ~273, reset ~312) |
| `isPointInside`, `checkFreeze`, `LIVE_ZONE_MAX`, `FREEZE_BATCH` | `server/src/polygon.ts` |
| D1 repo + the CAS `UPDATE` | `server/src/db.ts` (`updateHeap` ~147) |
| KV cache decorator | `server/src/cache/CachedHeapDB.ts` |
| Existing scanline helper | `shared/heapPolygon/polygon.ts:161` |
| Client cache + polygon reconstruction | `src/systems/HeapClient.ts`, `src/systems/HeapPolygonLoader.ts` |
| Placement constants | `server/src/constants.ts` |
| Migrations | `server/migrations/heap_core/` — see the `adding-d1-migrations` skill |

## 8. How to re-measure

The load-test harness under `loadtest/` was built for exactly this. Run each
fixture and compare CPU, **not latency**:

```bash
npm run loadtest -- -e PLACE_FIXTURE=large -e PLACEMENT_ITERATIONS=200 \
  -e PLACEMENT_VUS=1 -e PLACE_RATE=0 -e SESSIONS=50
# wait ~60s so the dashboard buckets separate, then the same with =small
```

Read P50/P90/P99 CPU per minute from the Cloudflare dashboard for each run's
window. Baselines to beat are in §1. `loadtest/README.md` has the full
walkthrough; run summaries land in `loadtest/results/`.

**Quota warning:** Cloudflare free-tier limits are account-wide and shared with
production. Each run costs ~330 KV deletes against a 1,000/day bucket that
resets at 00:00 UTC.

---

## Dispatch prompt

```
Design the spec and implementation plan for the heap polygon delta API and
bounded polygon growth in the HeapGame repo (/home/connor/Documents/Repos/HeapGame).

Read docs/superpowers/2026-07-26-heap-delta-api-handoff.md first — it contains
the measurements motivating the work, two compatible design sketches, and a
section of structural traps (§5) that an implementation not knowing about them
will get wrong. Treat §5 as constraints, not suggestions; each item was verified
against the code or measured empirically.

Follow the project's normal flow: superpowers:brainstorming to pin the design
with the user, then superpowers:writing-plans. Do not write implementation code.

Note in particular:
- The primary goal is bounding polygon growth. The delta API is secondary,
  though they share the same restructuring.
- Ring order determines polygon shape (§5) — this constrains every option.
- `version` resets to 1, so it cannot be the sole delta-validity key.
- Rejected placements stay silent; no client-facing behaviour change is in scope.
- Any schema change goes through the `adding-d1-migrations` skill.
- Measure with CPU, not latency (§8), and mind the account-wide quota.

§6 lists the open questions the spec must resolve. Start there.
```

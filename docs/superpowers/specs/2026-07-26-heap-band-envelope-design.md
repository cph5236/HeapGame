# Heap Band Envelope — Bounded Polygon Growth + Delta API — Design

**Origin:** load testing 2026-07-26. Handoff:
`docs/superpowers/2026-07-26-heap-delta-api-handoff.md` (read it for the raw
measurements). Related: `Todo/Todo.md` § PERF, PR #123, PR #125.

## Goal

`POST /heaps/:id/place` breaches Cloudflare's free-tier 10 ms CPU cap on a large
heap — P99 read 10.1 / 10.9 / 10.0 ms across three consecutive minutes, at or
over the cap every minute rather than as an occasional spike. The cause is a
whole-polygon ray cast over `[...baseVertices, ...liveZone]`, run up to 5 times
inside a CAS retry loop, over a polygon that **grows without bound** because
`checkFreeze` appends to an append-only base (`server/src/polygon.ts:52`).

Four outcomes, priority order:

1. Bound polygon growth (primary).
2. `GET /heaps/:id` returns a delta, not the whole polygon.
3. Replace the whole-polygon containment test with a cheap local one.
4. Eliminate CAS conflicts (28–36% of resolved placements returned 409 under
   15 concurrent placers).

## Findings that shaped the design

Two facts verified during brainstorming that the handoff did not have. Both are
reproducible; the scripts are throwaway but the assertions become tests (§5).

**The client already discards ring order.** `reconstructPolygonFromPoints`
(`src/systems/HeapPolygonLoader.ts:99`) re-sorts incoming points by y, buckets
them into 20 px bands (`CHUNK_BAND_HEIGHT / 25`), keeps **only the min-x and
max-x of each band**, and stitches left/right edges. The server's array order
never reaches the renderer.

Consequences:

- **The server's containment test does not describe the shape players see.** The
  server ray-casts a y-sorted zigzag ring; the client renders a per-band x
  envelope. On a structurally faithful synthetic heap (616 vertices) they
  disagree on 15.6% of the placement band — the server calls 8.0% of the band
  solid, the client draws 22.1% of it solid. The number is synthetic and
  directional; the disagreement is structural, as the two algorithms cannot
  agree in general. (The handoff independently measured 7.9% on real data for a
  related comparison.)
- **Simplification can be provably pixel-identical** — but only on the client's
  axis. Bucketing y and keeping min/max x yields a byte-identical rendered ring
  (1636 → 136 base vertices, same 182-vertex output). The handoff's §3.1 sketch
  proposed the opposite axis (bucket x, keep topmost y), which would destroy the
  left/right envelope and visibly change overhangs.

A placement strictly inside the envelope therefore **cannot change the
silhouette** — it is a vertex that costs CPU and egress forever and renders
nothing. "Is this point inside?" and "should we simplify this away?" are the
same question.

**Correction to the handoff's growth framing.** Envelope vertex counts are
bounded by heap *height*, not by placements — but at *equal* height the envelope
is always far smaller, so simplification is a strict win at every point in time:

| heap height | placements | today | envelope @20px |
|---|---|---|---|
| 2,885 px *(≈ today's large heap)* | 3,000 | 6,290 | **292** |
| 10,000 px | 20,000 | 41,002 | 1,002 |
| 50,000 px *(full world)* | 150,000 | 305,002 | 5,002 |

## Decisions (from brainstorming)

- **Adopt the silhouette model** for the containment test, rather than
  preserving today's ray-cast semantics bug-for-bug. Today's accept/reject
  behaviour changes — silently, since nothing in `src/` reads `.accepted`.
- **Band envelope as the authoritative representation**, targeted across all
  four layers below. Rejected: vertex rows with sequence numbers (rows still
  grow per placement, deltas need re-sorting, simplification stays a separate
  bolted-on mechanism); and dropping containment entirely (loses the only brake
  on growth).
- **`BAND_SIZE_PX = 20`**, matching the client's existing render resolution.
  Finer bands on the server alone are provably worthless: client output is
  byte-identical at 10 px and 4 px server bands while storing 2× and 5× the
  vertices, because the client re-buckets at 20 px regardless. Changing
  fidelity on both sides is explicitly **not** a priority and is not planned
  work.
- **Reset mints a new `baseId`**, which becomes the cache epoch. No new column.
- **Rejected placements stay silent.** No client-facing behaviour change.

## 1. The shared rule

Sections 1–6 describe the **end state**. Section 8 sequences it into four PRs;
until PR 2 lands, the blobs remain authoritative and bands are dual-written
alongside them.

`BAND_SIZE_PX = 20` moves into `shared/`; the client's `bandSize` derives from it
instead of from `CHUNK_BAND_HEIGHT / 25`, so a change to `CHUNK_BAND_HEIGHT` can
no longer silently desync the two sides.

```
band = floor(y / BAND_SIZE_PX)
a vertex matters  ⟺  it is the min-x or max-x of its band
```

One predicate serves what are currently three separate mechanisms: the
containment test, the rollup simplification rule, and the render model.

## 2. Data model

`heap_band` becomes the source of truth, in `heap_core`:

```sql
CREATE TABLE heap_band (
  heap_id TEXT    NOT NULL,
  band    INTEGER NOT NULL,          -- floor(y / BAND_SIZE_PX)
  min_x   REAL    NOT NULL,
  max_x   REAL    NOT NULL,
  version INTEGER NOT NULL,          -- heap version at which this band last changed
  PRIMARY KEY (heap_id, band)
);
CREATE INDEX idx_heap_band_version ON heap_band(heap_id, version);
```

No `min_y` / `max_y`: the client emits every vertex at band-mid-y, so the exact
y within a band cannot affect output. No `frozen` column: frozen is
`band < freeze_y / BAND_SIZE_PX`.

`heap.live_zone` and `heap_base.vertices` are retained as **materialised views**,
maintained on write, so nothing that reads them today breaks.

**Freeze under the envelope.** `LIVE_ZONE_MAX = 500` / `FREEZE_BATCH = 250`
vertices become band counts: freeze triggers when the number of *live* bands
(those at or above `freeze_y / BAND_SIZE_PX`) exceeds `LIVE_ZONE_MAX_BANDS`, and
moves the bottom `FREEZE_BATCH_BANDS` below the freeze line. Because placement is
gated to `y <= liveZoneBottomY`, frozen bands are immutable — so they never
appear in a delta, and the base blob stays cacheable. Concrete values are a plan
decision; preserving today's live-zone span is the constraint, which puts
`LIVE_ZONE_MAX_BANDS` near 77 (the ≈1,533 px active span at 20 px) and bounds the
materialised live zone at roughly `2 × 77` = 154 vertices. That is what makes
re-materialising the blob on each write cheap by construction.

`top_y` stays its own column with `MIN()` semantics and is unaffected by
simplification — it is not derived from the vertex set, so dropping buried
vertices cannot move it.

## 3. `/place`

```
band  = floor(y / BAND_SIZE_PX)
read    the one band row + heap row            -- point reads, no scan
accept  iff band is empty  or  x < min_x  or  x > max_x
write   one D1 batch:
  UPDATE heap SET version = version + 1, top_y = MIN(top_y, ?) WHERE id = ? RETURNING version
  INSERT INTO heap_band (heap_id, band, min_x, max_x, version) VALUES (...)
    ON CONFLICT(heap_id, band) DO UPDATE SET
      min_x   = MIN(min_x, excluded.min_x),
      max_x   = MAX(max_x, excluded.max_x),
      version = excluded.version
```

Removed: the whole-polygon ray cast, the `JSON.parse` of the live zone per
attempt, the 5-attempt CAS loop, and the 409 path. All existing bounds checks
(x range, world bounds, `top_y` grace, `liveZoneBottomY`) are unchanged, as is
the write-auth ordering — auth still runs only after every bounds check passes,
so a doomed request never claims a `playerGuid` as a side effect.

Ghost points run the same band upsert. Ghosts that do not extend an envelope are
dropped, which is now the same judgement as rejecting a placement.

**Concurrency.** The `MIN`/`MAX` upsert is conflict-free: two placements in the
same band both apply, and the handoff's open question about concurrent
placements landing overlapping dissolves — both legitimately extend the
envelope, so there is nothing to reconcile.

**Why the version watermark is sound.** `version = version + 1` is an atomic
increment in the same transaction as the band write, so version order equals
commit order: a reader that sees version 12 is guaranteed to see the band
stamped 11. That is what makes "send me bands with version > N" correct without
sequence numbers or re-sorting. It assumes no read-replica lag, so authoritative
reads must keep `getHeapFresh`'s cache bypass.

## 4. Delta API

```ts
GET /heaps/:id?version=N&baseId=B

| { changed: false; version }
| { changed: true; mode: 'full';  version; baseId; freezeY; bands; liveZone; params; enemyParams }
| { changed: true; mode: 'delta'; version; baseId; freezeY; bands;            params; enemyParams }
```

`bands` is a flat numeric triple array — `[band, minX, maxX, band, minX, maxX, …]`
— not objects, since egress is one of the things this work exists to reduce and
key names would roughly triple the payload.

The server declares `mode` explicitly so a client can never misapply one.
Compatibility is gated on the *request*: a delta is only ever sent to a client
that opted in by sending `&baseId=`. Installed clients do not send it, so they
always receive `full`, which still carries the materialised `liveZone` in
today's exact format.

`full` responses read the materialised blob — one row read — so only deltas
touch band rows. This keeps a naive 500-row `SELECT` off the 5M/day row-read
quota.

**Epoch semantics.** Making `baseId` the epoch requires that it change *only* on
reset, but today freeze also mints one (`server/src/routes/heap.ts:543`), which
would conflate "discard your cache" with "the base grew". Therefore **freeze
stops minting a `baseId`**; the base blob's cache key becomes
`baseId + freezeY` — still immutable per value, still 24 h cacheable, changing
exactly when base content changes. `baseId` then means "heap generation", and a
change to it means discard everything. This resolves the handoff's §5 reset trap
(`clientVersion < serverVersion` is not a sufficient validity test) without a
new column.

**KV cache invariant.** The returned `version` must come from the *same* read as
the bands it accompanies. If `CachedHeapDB` served a fresh heap row (version 12)
alongside bands from a 60 s-old cached view (through version 11), the client
would record 12 while missing band 11 and never ask for it again. Deltas are
additive, so being briefly behind is harmless; an inflated watermark is
permanent data loss. The heap row and its bands therefore cache and invalidate
as one unit.

## 5. Client

`HeapCache` gains `bands` and its shape version bumps; an unrecognised shape is
treated as cold. The delta merge is the same `MIN`/`MAX` upsert as the server.

The client stops bucketing altogether: bands **are** the left and right edges,
so it sorts by band index, emits left ascending / right descending, and runs
`simplifyPolygon`. This removes — rather than optimises — the
O(bands × points) nested loop at `src/systems/HeapPolygonLoader.ts:117-129`,
which today is ~68 × 684 ≈ 46 K operations but would reach ~12.5 M against a
full-height base.

## 6. Testing

The load-bearing test is a **property test**: for random point sets,
`reconstruct(points)` must deep-equal `reconstruct(envelope(points))`. That
single assertion is what the entire "no visual change" claim rests on, and it is
cheap to run over thousands of cases.

Around it:

- Envelope math and band ⇄ vertex materialisation units.
- Route tests: accept/reject by envelope; two concurrent placements both
  applying; `full` vs `delta` mode selection; reset discarding; freeze cache key.
- Client tests: delta merge, cold cache, `baseId` change.

## 7. Verification

In order:

1. `npm test`
2. `npm run build` (catches TS errors tests miss)
3. Load test per the handoff §8, reading **CPU** per minute off the Cloudflare
   dashboard against baselines — small 2.8 / 3.8 / 5.6 ms, large
   3.6 / 6.0 / 10.3 ms (P50 / P90 / P99). Latency cannot detect this: a
   placement is 400–900 ms dominated by network and D1, and an earlier
   latency-based comparison had 18% run-to-run variance on an identical target.
   Free-tier quotas are account-wide and shared with production; each run costs
   ~330 KV deletes against a 1,000/day bucket.
4. Visual smoke test plus `scene-preview` before/after. Losslessness is so far
   proven only on synthetic data — the property test and the screenshots are
   what make it real.

## 8. Phasing

Four PRs, each shippable alone:

| # | Ships | Fixes |
|---|---|---|
| 1 | `heap_band` + backfill + envelope containment in `/place`; blobs still materialised | the 10 ms CPU breach |
| 2 | Bands authoritative, `MIN`/`MAX` writes replace CAS, freeze stops minting `baseId` | 28–36% 409s |
| 3 | `mode: 'full' \| 'delta'` responses, `baseId`-gated | egress (8.1 → 15 MB growth) |
| 4 | Client band cache + delta merge + edges direct from bands | client CPU |

**Migration.** One schema change in `heap_core` via the `adding-d1-migrations`
skill (two-file rule, remote apply). Backfill derives each heap's bands from its
existing `heap_base.vertices` + `heap.live_zone`, lossless by the envelope
property.

It must use the **same `MIN`/`MAX` upsert as `/place`, not
`ON CONFLICT DO NOTHING`.** Base and live-zone vertices can share a band at the
freeze boundary, so `DO NOTHING` would keep whichever array was inserted first
and silently discard the other's extent — a wrong envelope on exactly the bands
where the two arrays meet. `MIN`/`MAX` merges them correctly and is idempotent by
construction, so it is also safely re-runnable. Backfilled bands are stamped with
the heap's current `version` so watermarks stay meaningful.

Heaps are admin-created and few, so this is a one-shot in the migration rather
than a lazy per-request backfill, which would put a few hundred band derivations
inside a request with a 10 ms budget.

## Out of scope

- **Silhouette fidelity.** Rendering at 4 px (matching `SCAN_STEP`) instead of
  20 px would move the silhouette edge by ~56 px on average, so real detail is
  being discarded today — but this is explicitly not a priority and is not
  planned work. Recorded only so the measurement is not lost.
- Any client-facing change to rejected placements — they stay silent.
- The unrelated `Todo/Bugs.md` items (daily-rewards call frequency, streak-restore
  ad failure, enemy-params version bump).

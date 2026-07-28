# Freeze race: atomic guarded freeze on `/place`

Date: 2026-07-28
Status: approved, ready for planning
Severity of bug fixed: HIGH (silent, unrecoverable geometry loss)

## The bug

`POST /heaps/:id/place` decides a freeze and applies it across two unsynchronised
D1 round trips:

```ts
const freeze = checkFreezeBands(await db.getAllBands(id), freezeBand);   // read
if (freeze) {
  await db.createBase(newBaseId, id, baseVertices, ...);                 // write
  await db.setFreeze(id, newBaseId, freeze.newFreezeBand * BAND_SIZE_PX);// write
}
```

`setFreeze` issues a blind `UPDATE heap SET base_id = ?, freeze_y = ?` with no
compare-and-swap. Placement deliberately dropped CAS because MIN/MAX band
widening is conflict-free, but freeze is not conflict-free: it is a destructive
repoint-and-delete.

Two placements crossing the freeze threshold together both read the same
pre-freeze `row.base_id` and both build a new base from it. Identical frozen sets
are harmless — last writer wins with the same geometry. The loss case is
*different* frozen sets: the loser's bands are removed by its own `DELETE` but
survive only in its orphaned base, which the heap no longer points at. That
geometry is gone — not in `heap_band`, not in the winner's base.

It is rare (two placements inside one window, and freeze fires only every
`FREEZE_BATCH_BANDS = 38` new bands) but silent and unrecoverable.

Found by the PR #126 review. Not exercised by any test: `placeConcurrency.test.ts`
and `commitPlacementAtomicity.test.ts` both note their mocks cannot simulate true
interleaving, and nothing drives two concurrent placements through a freeze.

## Constraints that shape the fix

- D1 is SQLite over HTTP. There are no interactive transactions. The only atomic
  unit available is `d1.batch([...])`, whose statements run sequentially inside
  one transaction.
- A batch runs every statement it contains; it cannot branch on a result. So a
  guard cannot live in JS between statements — it has to be a SQL predicate
  inside each statement, evaluated against the transaction's own state.
- Workers have no shared memory and no per-heap actor, so no in-process lock is
  available.

## Design

### 1. One guarded batch replaces `createBase` + `setFreeze`

`setFreeze` is removed from the `HeapDB` interface and replaced with a single
method performing all three writes in one batch. Removing it rather than adding a
guarded variant alongside it is deliberate: an unguarded blind-write freeze left
in the interface invites the same bug back. `createBase` stays — the reset path
(`server/src/routes/heap.ts:388`) still uses it and has no freeze semantics.

```ts
/**
 * Atomic freeze: mint the new base, advance the freeze line, and bury the rows
 * the line covers — as ONE D1 batch (one transaction), guarded on the freeze_y
 * the caller read. Returns false when another request froze first, in which case
 * NOTHING was written: no base row, no line advance, no deletion.
 */
freezeAtomic(args: {
  heapId: string;
  expectedFreezeY: number;    // row.freeze_y as read before the check
  newBaseId: string;
  baseVertices: Vertex[];
  baseHash: string;
  newFreezeY: number;
  versionWatermark: number;
  now: string;
}): Promise<boolean>;
```

D1 implementation, as one `batch`:

```sql
-- 1. mint the base, only if the line we read is still the line
INSERT INTO heap_base (id, heap_id, vertices, vertex_hash, created_at)
SELECT ?1, ?2, ?3, ?4, ?5
 WHERE (SELECT freeze_y FROM heap WHERE id = ?2) = ?6;

-- 2. CAS the heap row onto it
UPDATE heap SET base_id = ?1, freeze_y = ?7 WHERE id = ?2 AND freeze_y = ?6;

-- 3. bury rows — only ones we captured, and only if step 2 landed
DELETE FROM heap_band
 WHERE heap_id = ?2 AND band >= ?8 AND version <= ?9
   AND (SELECT base_id FROM heap WHERE id = ?2) = ?1;
```

Each subquery resolves against the state *inside* the transaction, which is what
dissolves the wrinkle in the original report: the `DELETE` no longer keys off the
freeze line this request computed, but off whether this request's own base is the
one the heap currently points at.

The loser is a **total** no-op — step 1's `SELECT ... WHERE` yields no row so no
orphaned base is created, step 2 matches nothing, step 3's guard fails. Nothing
to clean up and nothing to retry.

`applied` is `results[1].meta.changes > 0`.

Step 3 keys on `base_id`, not `freeze_y`, because two racers can legitimately
compute the *same* new line; `base_id` is unique per attempt and so identifies
the winner unambiguously.

`expectedFreezeY` is the value read back out of the row, never a recomputed one,
so the REAL-column equality compares an exact round-tripped value.

The delete boundary `?8` is derived inside the method as `bandOf(newFreezeY)`
rather than passed in — carried over verbatim from the `setFreeze` doc it
replaces, and for the same reason: one input means the deletion can never
disagree with the freeze line it is supposed to match.

### 2. The version watermark makes it lossless

CAS alone still leaves a smaller loss: a band written by a concurrent placement
*after* this request's `getAllBands` but landing inside the frozen slice would be
deleted without ever reaching the base.

`heap_band.version` is stamped only when a row actually widens, and heap versions
are monotonic (`commitPlacement` bumps `heap.version` and the band rows read it
back inside the same transaction). Therefore any row written after our
`getAllBands` provably carries a version above every version that read returned.
Deleting `version <= watermark` deletes exactly what the base captured and never
a concurrent write.

Survivors sit below the freeze line as **stragglers**: filtered out of live
responses (`liveBandsOf` keeps `band < freezeBand`), so briefly invisible, but
present in `heap_band` and therefore not lost.

Stragglers are collected by the next freeze, which widens its base source by one
predicate — everything at or below the new line, not just the freshly frozen
slice.

`BandRow` is `{ band, minX, maxX }` and `getAllBands` does not select `version`,
so the watermark needs a second read. It is a **new read-through method**,
`getAllBandsVersioned`, called only when a freeze is actually due — once per 38
bands of climb — so the hot path keeps the cheap cached `getAllBands` it has
today and pays nothing:

```ts
const freeze = checkFreezeBands(await db.getAllBands(id), freezeBand);  // cached, unchanged
if (freeze) {
  const versioned = await db.getAllBandsVersioned(id);   // read-through, rare
  // frozen slice PLUS any straggler a previous freeze left behind
  const buried    = versioned.filter(b => b.band >= freeze.newFreezeBand);
  const watermark = Math.max(...buried.map(b => b.version));
  const baseVertices = [
    ...(await db.getBaseVerticesById(row.base_id)) ?? [],
    ...envelopeToVertices(mergeBands(new Map(), buried)),
  ];
  ...
}
```

The freeze *decision* running on the possibly-stale cached snapshot is safe: a
stale snapshot can only under-report bands, which delays a freeze to the next
placement. What must be fresh is the set actually buried, and that comes from
`getAllBandsVersioned`. The watermark is the max version among the rows that
read returned, so any row written after it provably sits above the watermark and
survives — which is the whole guarantee.

The `DELETE` already covers `band >= newFreezeBand`, so stragglers are folded
into the base and cleaned up in the same pass. Re-including a band that the
existing base already represents is safe: the base is a vertex union, and the
straggler's extent is the wider one.

`row.base_id` is read before the commit, so a losing racer builds its base from a
stale base — harmless, because the CAS makes its whole batch a no-op.

Maximum staleness for a straggler is one freeze cycle (`FREEZE_BATCH_BANDS = 38`
bands of climb). No schema change and no migration: `heap_band.version` already
exists and is already indexed.

### 3. Losing the CAS is not an error

The route does nothing on `applied === false` — no retry, no error response. The
placement itself already committed and succeeded; freeze is opportunistic and the
next placement re-evaluates it against fresh state.

`CachedHeapDB.freezeAtomic` invalidates unconditionally, win or lose. Freezes are
rare (once per 38 bands of climb) and a redundant invalidation costs less than
branching on the result.

### 4. Testing

The entire fix is SQL semantics — correlated subquery guards, batch-as-
transaction, `meta.changes`. A mock written to match my own assumptions about
that SQL proves nothing about it, and the suite currently has no way to execute
real SQL: every DB test runs against `MockHeapDB`.

**New test harness** — `server/tests/helpers/d1Sqlite.ts`: a test-only
`D1Database` implementation over **`node:sqlite`** (`DatabaseSync`), covering the
subset the server uses: `prepare`, `bind`, `all`, `first`, `run`, `batch`,
`meta.changes`, and batch-as-single-transaction (`BEGIN`/`COMMIT`). Built from
the real `server/schema/heap_core.sql` so it cannot drift from production DDL.
Reusable for every future D1 SQL change.

`node:sqlite` replaces the `better-sqlite3` devDependency named in the approved
design: it ships with Node, so there is no native build in CI, and it is
available on both the local toolchain (v22.23) and CI (v24). It emits an
experimental warning on v22, which is noise only.

The guarded batch above was prototyped against `node:sqlite` before this spec was
finalised: winner applies, loser writes nothing at all (no `heap_base` row), and
a band stamped above the watermark survives the delete.

**New tests** — `server/tests/freezeRace.test.ts`, against real SQLite:

1. Two freezes computed from the same pre-freeze snapshot, applied in sequence:
   winner's geometry intact, loser wrote nothing (no `heap_base` row, no line
   advance, no deletion), and every band is accounted for in either `heap_band`
   or the winner's base. This is the test that would have caught the bug.
2. A concurrent placement landing in the frozen slice mid-freeze survives as a
   straggler, and the next freeze folds it into the base and deletes it.
3. Identical frozen sets racing (the already-harmless case) stay harmless.

**Existing tests** — `MockHeapDB.freezeAtomic` mirrors the same guard semantics
so route-level tests keep working. `heapDelta.test.ts` and
`bandCacheConsistency.test.ts` call `setFreeze` today and move to `freezeAtomic`.

### 5. Drive-by

The doc comment on `server/src/polygon.ts:24` still claims "freeze never deletes
rows", which stopped being true in #126. It is directly adjacent to the code
being changed and misleads exactly the reasoning this fix depends on.

## Out of scope

- Gating the freeze check behind a `COUNT` so `getAllBands` stops scanning on
  every placement. A real CPU win, but a separate performance change with its own
  measurement — not mixed into a correctness fix.
- Moving freeze off the request path (cron/queue single-writer).
- Storing frozen geometry as rows instead of JSON vertices.

## Files touched

- `server/src/db.ts` — `HeapDB` interface: drop `setFreeze`, add `freezeAtomic`
  and `getAllBandsVersioned`; `D1HeapDB` implementations.
- `server/src/cache/CachedHeapDB.ts` — decorators for `freezeAtomic` (invalidate)
  and `getAllBandsVersioned` (read-through).
- `server/src/routes/heap.ts` — freeze block: `buried` filter, watermark,
  single `freezeAtomic` call; update the surrounding comment block.
- `server/src/polygon.ts` — stale doc comment.
- `server/tests/helpers/mockDb.ts` — `freezeAtomic` with matching semantics.
- `server/tests/helpers/d1Sqlite.ts` — new.
- `server/tests/freezeRace.test.ts` — new.
- `server/tests/heapDelta.test.ts`, `server/tests/bandCacheConsistency.test.ts` —
  call-site updates.

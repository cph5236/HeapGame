// server/tests/commitPlacementAtomicity.test.ts
//
// Regression guard for the delta watermark's soundness. The route used to bump
// the version and widen bands as two separate awaited calls
// (`db.bumpVersion()` then `db.upsertBands()`). CachedHeapDB invalidated its
// row+bands snapshot after EACH of those two writes, which meant a concurrent
// GET landing between them could rebuild its snapshot from a heap row that
// already carried the bumped version but a band table that did not yet carry
// the write that bumped it. Since `getBandsSince` filters strictly
// `version > watermark`, that band would never be sent to that client again —
// a permanent, silent loss.
//
// `commitPlacement` fixes this by making the version bump and the band writes
// one call, backed by one D1 transaction (`d1.batch([...])` in D1HeapDB).
//
// HONESTY NOTE: MockHeapDB.commitPlacement has no internal `await` between its
// version bump and its band writes, so it cannot simulate a real concurrent
// interleaving — no unit test run against it can prove D1 batch atomicity.
// What these tests DO prove is the invariant atomicity is supposed to
// guarantee (version and band stamp always agree) and the CachedHeapDB
// invalidation-timing behavior that closes the window on the caching side.
// True cross-request atomicity rests on D1's batch transaction semantics and
// is only exercised for real against staging D1 (see the load-testing-heap
// skill), never provable here.

import { describe, it, expect } from 'vitest';
import { MockHeapDB } from './helpers/mockDb';
import { MockKV } from './helpers/mockKv';
import { CachedHeapDB } from '../src/cache/CachedHeapDB';
import { DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';

const noWait = (_p: Promise<unknown>) => {};

async function seeded() {
  const db = new MockHeapDB();
  await db.createHeap('h1', 'b1', [{ x: 480, y: 50000 }], 'h', new Date().toISOString(), {
    ...DEFAULT_HEAP_PARAMS, worldHeight: 50000,
  });
  return db;
}

describe('commitPlacement — version/band stamp invariant', () => {
  it('stamps every band written by a placement with exactly the version that placement returned', async () => {
    const db = await seeded();
    const before = (await db.getHeap('h1'))!.version;

    const newVersion = await db.commitPlacement(
      'h1',
      [{ band: 10, minX: 400, maxX: 500 }, { band: 11, minX: 300, maxX: 600 }],
      100,
    );

    expect(newVersion).toBe(before + 1);
    const bands = await db.getAllBands('h1');
    expect(bands).toHaveLength(2);
    // This is the invariant the race broke: a reader that observes `newVersion`
    // must observe these exact bands stamped with it, never a lower stamp.
    for (const b of bands) {
      const since = await db.getBandsSince('h1', newVersion - 1);
      expect(since.map((r) => r.band)).toContain(b.band);
    }
  });

  it('still bumps the version when there are no candidate bands to write', async () => {
    const db = await seeded();
    const before = (await db.getHeap('h1'))!.version;

    const newVersion = await db.commitPlacement('h1', [], 100);

    expect(newVersion).toBe(before + 1);
    expect(await db.getAllBands('h1')).toEqual([]);
  });

  it('preserves widen-not-replace (MIN/MAX) semantics across repeated placements to the same band', async () => {
    const db = await seeded();
    await db.commitPlacement('h1', [{ band: 5, minX: 300, maxX: 500 }], 100);
    await db.commitPlacement('h1', [{ band: 5, minX: 400, maxX: 700 }], 100);
    await db.commitPlacement('h1', [{ band: 5, minX: 100, maxX: 450 }], 100);

    // The widest extent across all three calls survives — none of them replaced
    // the row outright.
    expect(await db.getBand('h1', 5)).toEqual({ band: 5, minX: 100, maxX: 700 });
  });

  it('lowers top_y toward the summit exactly like the old bumpVersion did', async () => {
    const db = await seeded();
    const initialTopY = (await db.getHeap('h1'))!.top_y;

    await db.commitPlacement('h1', [], initialTopY - 500);
    expect((await db.getHeap('h1'))!.top_y).toBe(initialTopY - 500);

    // A candidate BELOW the current summit must not lower it further — top_y is
    // the summit, the lowest y, so MIN() only ever raises the peak.
    await db.commitPlacement('h1', [], initialTopY + 9999);
    expect((await db.getHeap('h1'))!.top_y).toBe(initialTopY - 500);
  });
});

describe('CachedHeapDB.commitPlacement — invalidation timing', () => {
  it('invalidates the row+bands snapshot exactly once per placement, after the write completes', async () => {
    const inner = await seeded();
    const kv = new MockKV();
    const cached = new CachedHeapDB(inner, kv.asKV(), noWait);

    // Warm the snapshot at the pre-placement version.
    const before = await cached.getHeap('h1');
    expect(before).not.toBeNull();

    const newVersion = await cached.commitPlacement(
      'h1',
      [{ band: 20, minX: 100, maxX: 200 }],
      100,
    );

    // Exactly one delete for the heap-row key — not two, which is what a split
    // bumpVersion()+upsertBands() call pair (each invalidating on its own) would
    // have produced. The list key is deliberately untouched on placement; see
    // liveZoneKvCost.test.ts for why that is safe.
    expect(kv.deletes.filter((k) => k === 'cache:heap:h1')).toHaveLength(1);
    expect(kv.deletes.filter((k) => k === 'cache:heap:list')).toHaveLength(0);

    // The snapshot rebuilt after invalidation must show the version and the
    // band together — never the bumped version beside a still-stale band set.
    const row = await cached.getHeap('h1');
    const bands = await cached.getAllBands('h1');
    expect(row!.version).toBe(newVersion);
    expect(bands.map((b) => b.band)).toContain(20);
  });

  it('does not invalidate before the inner write resolves', async () => {
    const inner = await seeded();
    const kv = new MockKV();
    const cached = new CachedHeapDB(inner, kv.asKV(), noWait);
    await cached.getHeap('h1'); // warm the snapshot

    const originalCommit = inner.commitPlacement.bind(inner);
    let deletesSeenDuringWrite = -1;
    inner.commitPlacement = async (heapId, rows, topYCandidate) => {
      const result = await originalCommit(heapId, rows, topYCandidate);
      // Snapshot inside the window: the inner write has landed, but the
      // decorator has not yet had a chance to invalidate (it only does so
      // after this promise resolves back up to it).
      deletesSeenDuringWrite = kv.deletes.length;
      return result;
    };

    await cached.commitPlacement('h1', [{ band: 21, minX: 0, maxX: 10 }], 100);

    expect(deletesSeenDuringWrite).toBe(0);
    expect(kv.deletes.length).toBeGreaterThan(0);
  });
});

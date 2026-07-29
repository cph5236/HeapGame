// server/tests/bandCacheConsistency.test.ts
//
// The version handed to a client must never exceed the bands it was sent with.
// Serving a fresh heap row beside stale cached bands would make a client record a
// watermark covering bands it never received — and it would never ask again.
// Under-claiming is safe (the client re-receives and MIN/MAX merges idempotently);
// over-claiming loses data forever.

import { describe, it, expect } from 'vitest';
import { CachedHeapDB } from '../src/cache/CachedHeapDB';
import { MockHeapDB } from './helpers/mockDb';
import { MockKV } from './helpers/mockKv';
import { DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';

const noWait = (_p: Promise<unknown>) => {};
const NOW = '2026-07-28T00:00:00.000Z';

async function seeded() {
  const inner = new MockHeapDB();
  await inner.createHeap('h1', 'b1', [{ x: 480, y: 50000 }], 'h', new Date().toISOString(), {
    ...DEFAULT_HEAP_PARAMS, worldHeight: 50000,
  });
  await inner.upsertBands('h1', [{ band: 10, minX: 400, maxX: 500 }], 2);
  await inner.updateHeap('h1', 'b1', 2, [], 0, 100);
  return inner;
}

describe('band cache consistency', () => {
  it('serves the row and the full band set from one snapshot', async () => {
    const inner = await seeded();
    const kv = new MockKV();
    const cached = new CachedHeapDB(inner, kv.asKV(), noWait);

    const row = (await cached.getHeap('h1'))!;
    const bands = await cached.getAllBands('h1');
    expect(row.version).toBe(2);
    expect(bands).toEqual([{ band: 10, minX: 400, maxX: 500 }]);
  });

  it('never reports a row version newer than the bands served with it', async () => {
    const inner = await seeded();
    const kv = new MockKV();
    const cached = new CachedHeapDB(inner, kv.asKV(), noWait);

    await cached.getHeap('h1');   // warm the snapshot at v2

    // A placement lands directly on the inner DB, bypassing the decorator — this
    // is what a second isolate doing a placement looks like to this one.
    await inner.upsertBands('h1', [{ band: 11, minX: 300, maxX: 600 }], 3);
    await inner.updateHeap('h1', 'b1', 3, [], 0, 100);

    const row = (await cached.getHeap('h1'))!;
    const full = await cached.getAllBands('h1');
    // Both come from the same cached snapshot, so they agree with each other.
    expect(row.version).toBe(2);
    expect(full).toEqual([{ band: 10, minX: 400, maxX: 500 }]);

    // Deltas read through to D1, so they may over-send relative to the stale
    // watermark. That direction is safe.
    const since = await cached.getBandsSince('h1', 2);
    expect(since).toEqual([{ band: 11, minX: 300, maxX: 600 }]);
  });

  it('invalidates the snapshot when bands are written through the decorator', async () => {
    const inner = await seeded();
    const kv = new MockKV();
    const cached = new CachedHeapDB(inner, kv.asKV(), noWait);

    expect(await cached.getAllBands('h1')).toHaveLength(1);
    await cached.upsertBands('h1', [{ band: 11, minX: 300, maxX: 600 }], 3);
    expect(await cached.getAllBands('h1')).toHaveLength(2);
    expect(kv.deletes).toContain('cache:heap:h1');
  });

  it('invalidates the snapshot on commitPlacement, freezeAtomic and clearBands', async () => {
    const inner = await seeded();
    const kv = new MockKV();
    const cached = new CachedHeapDB(inner, kv.asKV(), noWait);

    await cached.getHeap('h1');
    await cached.commitPlacement('h1', [{ band: 12, minX: 100, maxX: 200 }], 90);
    expect(kv.deletes).toContain('cache:heap:h1');
    // Only ONE invalidation round for the whole placement — proves the
    // snapshot cannot be re-read between the version bump and the band write
    // (the split bumpVersion()+upsertBands() call pair used to invalidate
    // twice, opening exactly that window).
    expect(kv.deletes.filter((k) => k === 'cache:heap:h1')).toHaveLength(1);
    const row = (await cached.getHeap('h1'))!;
    expect(row.version).toBe(3);
    expect(await cached.getAllBands('h1')).toEqual([
      { band: 10, minX: 400, maxX: 500 },
      { band: 12, minX: 100, maxX: 200 },
    ]);

    kv.deletes.length = 0;
    // Freeze invalidates unconditionally, and busts BOTH keys rather than
    // taking commitPlacement's row-only shortcut: it changes base_id, so a
    // stale list summary would point at a base that no longer exists.
    const applied = await cached.freezeAtomic({
      heapId: 'h1', expectedFreezeY: 0, expectedBaseId: 'b1', newBaseId: 'b2',
      baseVertices: [{ x: 400, y: 210 }], baseHash: 'hash-b2',
      newFreezeY: 200, versionWatermark: 0, now: NOW,
    });
    expect(applied).toBe(true);
    expect(kv.deletes).toContain('cache:heap:h1');
    expect((await cached.getHeap('h1'))!.base_id).toBe('b2');

    kv.deletes.length = 0;
    await cached.clearBands('h1');
    expect(kv.deletes).toContain('cache:heap:h1');
    expect(await cached.getAllBands('h1')).toEqual([]);
  });

  it('recovers from a legacy bare-row cache entry left by the previous deploy', async () => {
    const inner = await seeded();
    const kv = new MockKV();
    const cached = new CachedHeapDB(inner, kv.asKV(), noWait);

    // Simulate a pre-migration cache entry: the old shape cached just the row,
    // with no `bands` field at all. Seed it directly into KV, bypassing the
    // decorator entirely — this is what a warm cache looks like immediately
    // after deploying this change.
    const legacyRow = await inner.getHeap('h1');
    kv.store.set('cache:heap:h1', JSON.stringify(legacyRow));

    // Without the guard, `hit.bands` would be undefined and `getAllBands` would
    // wrongly report zero bands for up to HEAP_TTL seconds.
    const bands = await cached.getAllBands('h1');
    expect(bands).toEqual([{ band: 10, minX: 400, maxX: 500 }]);

    // The fresh D1 read also rewrites the entry in the new snapshot shape.
    const rewritten = JSON.parse(kv.store.get('cache:heap:h1')!);
    expect(rewritten.bands).toEqual([{ band: 10, minX: 400, maxX: 500 }]);
    expect(rewritten.row.version).toBe(2);
  });
});

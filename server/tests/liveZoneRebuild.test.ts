// server/tests/liveZoneRebuild.test.ts
import { describe, it, expect } from 'vitest';
import { MockHeapDB } from './helpers/mockDb';
import { materialiseLiveZone } from '../src/routes/heap';
import { DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';

async function heap() {
  const db = new MockHeapDB();
  await db.createHeap('h1', 'b1', [{ x: 480, y: 50000 }], 'h', new Date().toISOString(), {
    ...DEFAULT_HEAP_PARAMS, worldHeight: 50000,
  });
  return db;
}

describe('lazy live_zone rebuild', () => {
  it('rebuilds from bands when the blob version lags the heap version', async () => {
    const db = await heap();
    await db.upsertBands('h1', [{ band: 5, minX: 300, maxX: 500 }], 4);
    await db.updateHeap('h1', 'b1', 4, [], 0, 100);
    const row = (await db.getHeap('h1'))!;
    expect(await materialiseLiveZone(db, row)).toEqual([
      { x: 300, y: 110 }, { x: 500, y: 110 },
    ]);
  });

  it('stores the rebuilt blob so the next read is free', async () => {
    const db = await heap();
    await db.upsertBands('h1', [{ band: 5, minX: 300, maxX: 500 }], 4);
    await db.updateHeap('h1', 'b1', 4, [], 0, 100);
    await materialiseLiveZone(db, (await db.getHeap('h1'))!);
    const row = (await db.getHeap('h1'))!;
    expect(row.live_zone_version).toBe(4);
    expect(JSON.parse(row.live_zone)).toEqual([{ x: 300, y: 110 }, { x: 500, y: 110 }]);
  });

  it('serves the cached blob without rebuilding when versions match', async () => {
    const db = await heap();
    await db.setLiveZoneBlob('h1', [{ x: 1, y: 2 }], 7);
    await db.updateHeap('h1', 'b1', 7, [{ x: 1, y: 2 }], 0, 100);
    const row = { ...(await db.getHeap('h1'))!, live_zone_version: 7, version: 7 };
    expect(await materialiseLiveZone(db, row)).toEqual([{ x: 1, y: 2 }]);
  });
});

// server/tests/liveZoneKvCost.test.ts
//
// KV deletes are the tightest Cloudflare quota — 1,000/day, ACCOUNT-WIDE, shared
// with production. This file pins the two reductions that got the placement path
// from 4 deletes per place-then-GET cycle down to 1.
//
// Replaces liveZoneRebuild.test.ts, which tested the mechanism these changes
// removed: `liveZone` used to be rebuilt from bands and written back to
// heap.live_zone behind a live_zone_version watermark. That write cost a D1 write
// plus a full cache invalidation (two deletes) on the first full GET after every
// placement, and it ran a second getAllBands inside the rebuild. `liveZone` is now
// derived per request from the same band array `bands` is built from.

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { CachedHeapDB } from '../src/cache/CachedHeapDB';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockKV } from './helpers/mockKv';
import { liveBandsOf } from '../src/routes/heap';
import { DEFAULT_HEAP_PARAMS, type GetHeapResponse, type PlaceResponse } from '../../shared/heapTypes';
import { bandOf, BAND_SIZE_PX } from '../../shared/heapPolygon/bandEnvelope';

const NOW = new Date().toISOString();
const noWait = (_p: Promise<unknown>) => {};

async function heapWithBands() {
  const inner = new MockHeapDB();
  await inner.createHeap('h1', 'b1', [{ x: 480, y: 50000 }], 'h', NOW, {
    ...DEFAULT_HEAP_PARAMS, worldHeight: 60000, ghostPointCount: 0,
  });
  await inner.upsertBands('h1', [{ band: 2500, minX: 300, maxX: 500 }], 2);
  await inner.updateHeap('h1', 'b1', 2, [], 0, 50000);
  return inner;
}

describe('liveBandsOf', () => {
  const bands = [
    { band: 2400, minX: 100, maxX: 200 },
    { band: 2450, minX: 110, maxX: 210 },
    { band: 2500, minX: 120, maxX: 220 },
  ];

  it('keeps every band when nothing is frozen (freeze_y === 0 sentinel)', () => {
    // bandOf(0) is band 0, a real index — treating the sentinel as a freeze line
    // would drop the entire heap.
    expect(liveBandsOf({ freeze_y: 0 } as never, bands)).toEqual(bands);
  });

  it('keeps only bands strictly above the freeze line', () => {
    const row = { freeze_y: 2450 * BAND_SIZE_PX } as never;
    expect(liveBandsOf(row, bands).map((b) => b.band)).toEqual([2400]);
  });
});

describe('GET /heaps/:id derives liveZone without persisting it', () => {
  it('serves liveZone built from bands, and bands/liveZone agree by construction', async () => {
    const db = await heapWithBands();
    const res = await createApp(db, new MockScoreDB()).request('/heaps/h1?version=0');
    const body = (await res.json()) as Extract<GetHeapResponse, { changed: true }>;
    expect(body.mode).toBe('full');
    // band 2500 spans 300..500, so two vertices at bandMidY(2500) = 50010.
    expect(body.liveZone).toEqual([{ x: 300, y: 50010 }, { x: 500, y: 50010 }]);
    const liveZoneBands = [...new Set(body.liveZone.map((v) => bandOf(v.y)))];
    expect(liveZoneBands).toEqual([2500]);
  });

  it('never writes heap.live_zone — the column stays frozen at its old value', async () => {
    // The regression guard for the D1 write that used to accompany every rebuild.
    const db = await heapWithBands();
    const before = (await db.getHeap('h1'))!;
    await createApp(db, new MockScoreDB()).request('/heaps/h1?version=0');
    const after = (await db.getHeap('h1'))!;
    expect(after.live_zone).toBe(before.live_zone);
    expect(after.live_zone_version).toBe(before.live_zone_version);
  });

  it('costs ZERO KV deletes, even though the row version is ahead of live_zone_version', async () => {
    // This is the exact state that used to trigger rebuild-and-invalidate: the
    // heap is at version 2 while live_zone_version is 0. Reading it must not
    // write anything now.
    const inner = await heapWithBands();
    expect((await inner.getHeap('h1'))!.live_zone_version).not.toBe(2);
    const kv = new MockKV();
    const cached = new CachedHeapDB(inner, kv.asKV(), noWait);

    await createApp(cached, new MockScoreDB()).request('/heaps/h1?version=0');
    expect(kv.deletes).toEqual([]);
  });
});

describe('POST /place KV cost', () => {
  it('busts only the heap row, leaving the list summary to its TTL', async () => {
    // Two deletes per placement halved to one. The list carries version and topY,
    // which a placement does change — but /place reads through getHeapFresh, and
    // the only client consumer is the height label on HeapSelectScene, so up to
    // HEAP_TTL of staleness there is what a 60s cache means.
    const inner = await heapWithBands();
    const kv = new MockKV();
    const cached = new CachedHeapDB(inner, kv.asKV(), noWait);

    const res = await createApp(cached, new MockScoreDB()).request('/heaps/h1/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 250, y: 50010 }),
    });
    expect(((await res.json()) as PlaceResponse).accepted).toBe(true);

    expect(kv.deletes).toEqual(['cache:heap:h1']);
    expect(kv.deletes).not.toContain('cache:heap:list');
  });

  it('a place-then-GET cycle costs exactly ONE KV delete', async () => {
    // The end-to-end number this whole change exists for. It was four: two from
    // the placement's full invalidation, two more from the following full GET
    // rebuilding and persisting the blob.
    const inner = await heapWithBands();
    const kv = new MockKV();
    const cached = new CachedHeapDB(inner, kv.asKV(), noWait);
    const app = createApp(cached, new MockScoreDB());

    await app.request('/heaps/h1/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 250, y: 50010 }),
    });
    await app.request('/heaps/h1?version=0');

    expect(kv.deletes).toHaveLength(1);
  });

  it('still busts the list on a structural write, where staleness is not equivalent', async () => {
    // Dropping the list invalidation is specific to placement. A reset changes
    // the heap's identity (new base, version back to 1), which the list reports.
    const inner = await heapWithBands();
    const kv = new MockKV();
    const cached = new CachedHeapDB(inner, kv.asKV(), noWait);
    await createApp(cached, new MockScoreDB()).request('/heaps/h1/reset', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': 'test' },
    });
    expect(kv.deletes).toContain('cache:heap:list');
  });
});

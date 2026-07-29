// server/tests/heapDelta.test.ts
//
// A delta is only ever sent to a client that opted in by sending &baseId=.
// Installed clients never send it, so they always get `full` with the
// materialised liveZone in today's format.

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { DEFAULT_HEAP_PARAMS, type GetHeapResponse } from '../../shared/heapTypes';
import { wireToBands } from '../../shared/heapPolygon/bandEnvelope';

async function heap() {
  const db = new MockHeapDB();
  await db.createHeap('h1', 'b1', [{ x: 480, y: 50000 }], 'h', new Date().toISOString(), {
    ...DEFAULT_HEAP_PARAMS, worldHeight: 50000,
  });
  await db.updateHeap('h1', 'b1', 5, [], 0, 47000);
  await db.upsertBands('h1', [{ band: 2350, minX: 400, maxX: 500 }], 3);
  await db.upsertBands('h1', [{ band: 2351, minX: 300, maxX: 600 }], 5);
  return db;
}

const get = (db: MockHeapDB, q: string) =>
  createApp(db, new MockScoreDB()).request(`/heaps/h1${q}`);

describe('GET /heaps/:id — delta protocol', () => {
  it('sends full, with liveZone, to a client that did not opt in', async () => {
    const body = (await (await get(await heap(), '?version=0')).json()) as GetHeapResponse;
    expect(body).toMatchObject({ changed: true, mode: 'full' });
    if (body.changed && body.mode === 'full') {
      expect(Array.isArray(body.liveZone)).toBe(true);
      expect(wireToBands(body.bands).map((b) => b.band)).toEqual([2350, 2351]);
    }
  });

  it('sends full when the client baseId differs', async () => {
    const body = (await (await get(await heap(), '?version=5&baseId=stale')).json()) as GetHeapResponse;
    expect(body).toMatchObject({ changed: true, mode: 'full' });
  });

  it('sends changed:false when version and baseId both match', async () => {
    const body = (await (await get(await heap(), '?version=5&baseId=b1')).json()) as GetHeapResponse;
    expect(body).toEqual({ changed: false, version: 5 });
  });

  it('sends only bands newer than the client version', async () => {
    const body = (await (await get(await heap(), '?version=3&baseId=b1')).json()) as GetHeapResponse;
    expect(body).toMatchObject({ changed: true, mode: 'delta' });
    if (body.changed && body.mode === 'delta') {
      expect(wireToBands(body.bands)).toEqual([{ band: 2351, minX: 300, maxX: 600 }]);
      expect('liveZone' in body).toBe(false);
    }
  });

  it('never offers a rejected placement to a delta client', async () => {
    // A placement that does not extend the envelope returns accepted:false from
    // the containment gate BEFORE commitPlacement, so it writes nothing at all —
    // not the band, and not the heap version either. Worth pinning: if that gate
    // ever moved below the write, every rejected placement would churn the
    // version and wake up every polling client for no geometry change.
    const db = new MockHeapDB();
    await db.createHeap('h1', 'b1', [{ x: 480, y: 50000 }], 'h', new Date().toISOString(), {
      ...DEFAULT_HEAP_PARAMS, worldHeight: 60000, ghostPointCount: 0,
    });
    await db.upsertBands('h1', [{ band: 2500, minX: 300, maxX: 700 }], 1);
    await db.updateHeap('h1', 'b1', 1, [], 0, 50000);

    const app = createApp(db, new MockScoreDB());
    const place = (x: number, y: number) => app.request('/heaps/h1/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x, y }),
    });

    const inside = await place(500, 50010); // within 300..700 — cannot widen
    expect(((await inside.json()) as { accepted: boolean }).accepted).toBe(false);
    expect((await db.getHeap('h1'))!.version).toBe(1);
    expect(await db.getBandsSince('h1', 1)).toEqual([]);

    // Two-sided: a placement that DOES widen must surface, or the assertion
    // above would pass on a delta path that never reports anything.
    const outside = await place(250, 50010);
    expect(((await outside.json()) as { accepted: boolean }).accepted).toBe(true);
    expect((await db.getBandsSince('h1', 1)).map((b) => b.band)).toEqual([2500]);
  });

  it('sends every intervening band to a client several versions behind', async () => {
    const db = await heap();
    await db.upsertBands('h1', [{ band: 2352, minX: 200, maxX: 700 }], 6);
    await db.upsertBands('h1', [{ band: 2353, minX: 100, maxX: 800 }], 7);
    await db.updateHeap('h1', 'b1', 7, [], 0, 47000);
    const body = (await (await get(db, '?version=3&baseId=b1')).json()) as GetHeapResponse;
    if (body.changed && body.mode === 'delta') {
      expect(wireToBands(body.bands).map((b) => b.band)).toEqual([2351, 2352, 2353]);
    } else {
      throw new Error('expected a delta');
    }
  });

  it('falls back to full after a reset, because reset mints a new baseId', async () => {
    const db = await heap();
    await createApp(db, new MockScoreDB()).request('/heaps/h1/reset', { method: 'PUT' });
    const body = (await (await get(db, '?version=5&baseId=b1')).json()) as GetHeapResponse;
    expect(body).toMatchObject({ changed: true, mode: 'full' });
  });

  it('falls back to full after a freeze, because freeze mints a new baseId', async () => {
    const db = await heap();
    // Simulate what the freeze path does: new base row, heap repointed at it.
    await db.freezeAtomic({
      heapId: 'h1', expectedFreezeY: 0, expectedBaseId: 'b1', newBaseId: 'b2',
      baseVertices: [{ x: 480, y: 50000 }], baseHash: 'h2',
      newFreezeY: 47000, versionWatermark: 0, now: new Date().toISOString(),
    });
    const body = (await (await get(db, '?version=5&baseId=b1')).json()) as GetHeapResponse;
    expect(body).toMatchObject({ changed: true, mode: 'full', baseId: 'b2' });
  });

  it('returns concurrent writes to different bands in a single delta', async () => {
    const db = await heap();
    await Promise.all([
      db.upsertBands('h1', [{ band: 2352, minX: 200, maxX: 700 }], 6),
      db.upsertBands('h1', [{ band: 2360, minX: 150, maxX: 750 }], 7),
    ]);
    await db.updateHeap('h1', 'b1', 7, [], 0, 47000);
    const body = (await (await get(db, '?version=5&baseId=b1')).json()) as GetHeapResponse;
    if (body.changed && body.mode === 'delta') {
      expect(wireToBands(body.bands).map((b) => b.band)).toEqual([2352, 2360]);
    } else {
      throw new Error('expected a delta');
    }
  });
});

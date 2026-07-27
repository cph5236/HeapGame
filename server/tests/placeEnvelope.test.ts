// server/tests/placeEnvelope.test.ts
//
// /place accepts a placement only when it widens its 20px band — the same
// predicate the client renders by. Replaces the whole-polygon ray cast, which
// tested a y-sorted zigzag ring that did not describe the rendered shape.

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { DEFAULT_HEAP_PARAMS, type PlaceResponse } from '../../shared/heapTypes';

const NOW = new Date().toISOString();

async function heapWith(bands: { band: number; minX: number; maxX: number }[], topY = 47000) {
  const db = new MockHeapDB();
  await db.createHeap('h1', 'b1', [{ x: 480, y: 50000 }], 'hash', NOW, {
    ...DEFAULT_HEAP_PARAMS,
    worldHeight: 50000,
    ghostPointCount: 0,   // isolate the placement from ghost noise
  });
  await db.updateHeap('h1', 'b1', 1, [], 0, topY);
  if (bands.length) await db.upsertBands('h1', bands, 1);
  return db;
}

function place(db: MockHeapDB, body: unknown) {
  return createApp(db, new MockScoreDB()).request('/heaps/h1/place', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /heaps/:id/place — envelope containment', () => {
  it('accepts a placement that widens its band to the left', async () => {
    const db = await heapWith([{ band: 2350, minX: 400, maxX: 500 }]);
    const res = await place(db, { x: 399, y: 47010 });
    expect(((await res.json()) as PlaceResponse).accepted).toBe(true);
  });

  it('accepts a placement that widens its band to the right', async () => {
    const db = await heapWith([{ band: 2350, minX: 400, maxX: 500 }]);
    const res = await place(db, { x: 501, y: 47010 });
    expect(((await res.json()) as PlaceResponse).accepted).toBe(true);
  });

  it('rejects a placement strictly inside its band extents', async () => {
    const db = await heapWith([{ band: 2350, minX: 400, maxX: 500 }]);
    const res = await place(db, { x: 450, y: 47010 });
    expect(((await res.json()) as PlaceResponse).accepted).toBe(false);
  });

  it('rejects a placement exactly on an extent', async () => {
    const db = await heapWith([{ band: 2350, minX: 400, maxX: 500 }]);
    const res = await place(db, { x: 400, y: 47010 });
    expect(((await res.json()) as PlaceResponse).accepted).toBe(false);
  });

  it('accepts into an empty band', async () => {
    // band 2351 is empty (only 2350 is seeded). liveZoneBottomY = (2350+1)*20 =
    // 47020, and the active-zone gate is inclusive at the boundary (y > bottomY
    // rejects), so 47020 is the one y in band 2351 that is both empty and still
    // within the active zone.
    const db = await heapWith([{ band: 2350, minX: 400, maxX: 500 }]);
    const res = await place(db, { x: 450, y: 47020 }); // band 2351
    expect(((await res.json()) as PlaceResponse).accepted).toBe(true);
  });

  it('persists the accepted placement into its band', async () => {
    const db = await heapWith([{ band: 2350, minX: 400, maxX: 500 }]);
    await place(db, { x: 380, y: 47010 });
    expect(await db.getBand('h1', 2350)).toEqual({ band: 2350, minX: 380, maxX: 500 });
  });

  it('does not widen the band for a rejected placement', async () => {
    const db = await heapWith([{ band: 2350, minX: 400, maxX: 500 }]);
    await place(db, { x: 450, y: 47010 });
    expect(await db.getBand('h1', 2350)).toEqual({ band: 2350, minX: 400, maxX: 500 });
  });

  it('gates on the active zone using band granularity', async () => {
    // Highest occupied band is 2350, so liveZoneBottomY = (2350 + 1) * 20 = 47020.
    const db = await heapWith([{ band: 2350, minX: 400, maxX: 500 }]);
    const inZone = await place(db, { x: 380, y: 47019 });
    expect(inZone.status).toBe(200);
    const belowZone = await place(db, { x: 380, y: 47021 });
    expect(belowZone.status).toBe(400);
  });
});

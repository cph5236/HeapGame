// server/tests/adminBandsRoute.test.ts
//
// Route-level behaviour for the admin band editor. The SQL is proven in
// adminBandsDb.test.ts and the fan-out rule in adminBandPlan.test.ts; this pins
// the wiring — the layer split on read, validation, and the 409 contract.

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { DEFAULT_HEAP_PARAMS, type AdminBandsResponse } from '../../shared/heapTypes';
import { BAND_SIZE_PX, bandMidY } from '../../shared/heapPolygon/bandEnvelope';

const NOW = new Date().toISOString();
const SECRET = 's3cret';

/**
 * Heap h1 whose base covers bands 200 and 201, with live rows at bands 100
 * and 101, frozen at band 150.
 */
async function seeded() {
  const db = new MockHeapDB();
  await db.createHeap(
    'h1', 'b1',
    [
      { x: -800, y: bandMidY(200) }, { x: 800, y: bandMidY(200) },
      { x: -900, y: bandMidY(201) }, { x: 900, y: bandMidY(201) },
    ],
    'hash-b1', NOW,
    { ...DEFAULT_HEAP_PARAMS, worldHeight: 50000 },
  );
  await db.upsertBands('h1', [
    { band: 100, minX: -100, maxX: 100 },
    { band: 101, minX: -200, maxX: 200 },
  ], 1);
  const row = await db.getHeapFresh('h1');
  await db.updateHeap('h1', row!.base_id, row!.version, [], 150 * BAND_SIZE_PX, row!.top_y);
  return db;
}

function app(db: MockHeapDB) {
  return createApp(db, new MockScoreDB(), { adminSecret: SECRET });
}

const AUTH = { 'X-Admin-Secret': SECRET, 'Content-Type': 'application/json' };

describe('GET /heaps/:id/bands', () => {
  it('requires the admin secret', async () => {
    const res = await app(await seeded()).request('/heaps/h1/bands');
    expect(res.status).toBe(401);
  });

  it('splits live rows from base bands', async () => {
    const res = await app(await seeded()).request('/heaps/h1/bands', { headers: AUTH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdminBandsResponse;
    expect(body.baseId).toBe('b1');
    expect(body.freezeY).toBe(150 * BAND_SIZE_PX);
    expect(body.worldHeight).toBe(50000);
    expect(body.liveBands).toEqual([
      { band: 100, minX: -100, maxX: 100 },
      { band: 101, minX: -200, maxX: 200 },
    ]);
    expect(body.baseBands).toEqual([
      { band: 200, minX: -800, maxX: 800 },
      { band: 201, minX: -900, maxX: 900 },
    ]);
  });

  it('excludes straggler band rows below the freeze line', async () => {
    const db = await seeded();
    // A row at band 160 is below the freeze band (150) — invisible to players,
    // so it must not appear in the editor either.
    await db.upsertBands('h1', [{ band: 160, minX: -5, maxX: 5 }], 2);
    const res = await app(db).request('/heaps/h1/bands', { headers: AUTH });
    const body = (await res.json()) as AdminBandsResponse;
    expect(body.liveBands.map((b) => b.band)).toEqual([100, 101]);
  });

  it('404s for an unknown heap', async () => {
    const res = await app(await seeded()).request('/heaps/nope/bands', { headers: AUTH });
    expect(res.status).toBe(404);
  });
});

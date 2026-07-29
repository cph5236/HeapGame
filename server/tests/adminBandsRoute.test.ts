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

async function put(db: MockHeapDB, body: unknown, headers = AUTH) {
  const res = await app(db).request('/heaps/h1/bands', {
    method: 'PUT', headers, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as any };
}

async function current(db: MockHeapDB) {
  const row = await db.getHeapFresh('h1');
  return { expectedVersion: row!.version, expectedBaseId: row!.base_id };
}

describe('PUT /heaps/:id/bands', () => {
  it('requires the admin secret', async () => {
    const db = await seeded();
    const res = await app(db).request('/heaps/h1/bands', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(await current(db)), bands: [{ band: 100, minX: 0, maxX: 1 }] }),
    });
    expect(res.status).toBe(401);
  });

  it('narrows a live band and bumps the version', async () => {
    const db = await seeded();
    const r = await put(db, { ...(await current(db)), bands: [{ band: 100, minX: -10, maxX: 10 }] });
    expect(r.status).toBe(200);
    expect(r.body.version).toBe(2);
    expect(await db.getBand('h1', 100)).toEqual({ band: 100, minX: -10, maxX: 10 });
  });

  it('mints a new base id even for a live-only edit', async () => {
    const db = await seeded();
    const before = await current(db);
    const r = await put(db, { ...before, bands: [{ band: 100, minX: -10, maxX: 10 }] });
    expect(r.body.baseId).not.toBe(before.expectedBaseId);
    expect((await db.getHeapFresh('h1'))!.base_id).toBe(r.body.baseId);
  });

  it('rewrites the base when a base band is edited', async () => {
    const db = await seeded();
    const r = await put(db, { ...(await current(db)), bands: [{ band: 200, minX: -1, maxX: 1 }] });
    expect(r.status).toBe(200);
    const verts = await db.getBaseVerticesById(r.body.baseId);
    // Band 200 narrowed to [-1, 1]; band 201 survives untouched.
    expect(verts).toEqual([
      { x: -1,   y: bandMidY(200) }, { x: 1,   y: bandMidY(200) },
      { x: -900, y: bandMidY(201) }, { x: 900, y: bandMidY(201) },
    ]);
  });

  it('409s on a stale version, writing nothing', async () => {
    const db = await seeded();
    const cur = await current(db);
    const r = await put(db, { ...cur, expectedVersion: 99, bands: [{ band: 100, minX: 0, maxX: 1 }] });
    expect(r.status).toBe(409);
    expect(r.body.version).toBe(cur.expectedVersion);
    expect(r.body.baseId).toBe(cur.expectedBaseId);
    expect(await db.getBand('h1', 100)).toEqual({ band: 100, minX: -100, maxX: 100 });
  });

  it('409s on a stale base id', async () => {
    const db = await seeded();
    const r = await put(db, {
      ...(await current(db)), expectedBaseId: 'someOtherBase',
      bands: [{ band: 100, minX: 0, maxX: 1 }],
    });
    expect(r.status).toBe(409);
  });

  it('rejects an empty band list', async () => {
    const db = await seeded();
    expect((await put(db, { ...(await current(db)), bands: [] })).status).toBe(400);
  });

  it('rejects more than 500 bands', async () => {
    const db = await seeded();
    const bands = Array.from({ length: 501 }, (_, i) => ({ band: i, minX: 0, maxX: 1 }));
    expect((await put(db, { ...(await current(db)), bands })).status).toBe(400);
  });

  it('rejects a non-integer band, a negative band, and a band past world height', async () => {
    const db = await seeded();
    const cur = await current(db);
    expect((await put(db, { ...cur, bands: [{ band: 1.5, minX: 0, maxX: 1 }] })).status).toBe(400);
    expect((await put(db, { ...cur, bands: [{ band: -1,  minX: 0, maxX: 1 }] })).status).toBe(400);
    expect((await put(db, { ...cur, bands: [{ band: 999999, minX: 0, maxX: 1 }] })).status).toBe(400);
  });

  it('rejects non-finite extents and minX > maxX', async () => {
    const db = await seeded();
    const cur = await current(db);
    expect((await put(db, { ...cur, bands: [{ band: 100, minX: 0, maxX: 'x' }] })).status).toBe(400);
    expect((await put(db, { ...cur, bands: [{ band: 100, minX: 50, maxX: 10 }] })).status).toBe(400);
  });

  it('rejects duplicate bands', async () => {
    const db = await seeded();
    const cur = await current(db);
    const bands = [{ band: 100, minX: 0, maxX: 1 }, { band: 100, minX: 2, maxX: 3 }];
    expect((await put(db, { ...cur, bands })).status).toBe(400);
  });

  it('404s for an unknown heap', async () => {
    const db = await seeded();
    const res = await app(db).request('/heaps/nope/bands', {
      method: 'PUT', headers: AUTH,
      body: JSON.stringify({ expectedVersion: 1, expectedBaseId: 'b1', bands: [{ band: 1, minX: 0, maxX: 1 }] }),
    });
    expect(res.status).toBe(404);
  });
});

describe('PUT /heaps/:id/bands — the layer-union case', () => {
  it('narrows a band held by BOTH layers in both, so the union narrows', async () => {
    // The regression this guards is the whole feature silently not working: the
    // live row narrows, the base does not, and the rendered union keeps the
    // spike because the client builds [...base, ...liveVertices].
    const db = new MockHeapDB();
    await db.createHeap('h1', 'b1',
      [{ x: -900, y: bandMidY(7) }, { x: 900, y: bandMidY(7) }],
      'hash-b1', NOW, { ...DEFAULT_HEAP_PARAMS, worldHeight: 50000 });
    // freeze_y stays 0 — the "nothing frozen" sentinel, so band 7 is also live.
    await db.upsertBands('h1', [{ band: 7, minX: -900, maxX: 900 }], 1);

    const row = await db.getHeapFresh('h1');
    const res = await app(db).request('/heaps/h1/bands', {
      method: 'PUT', headers: AUTH,
      body: JSON.stringify({
        expectedVersion: row!.version, expectedBaseId: row!.base_id,
        bands: [{ band: 7, minX: -50, maxX: 50 }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(await db.getBand('h1', 7)).toEqual({ band: 7, minX: -50, maxX: 50 });
    expect(await db.getBaseVerticesById(body.baseId)).toEqual([
      { x: -50, y: bandMidY(7) }, { x: 50, y: bandMidY(7) },
    ]);
  });
});

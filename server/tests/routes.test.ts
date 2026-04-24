// server/tests/routes.test.ts

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import type {
  CreateHeapResponse,
  ListHeapsResponse,
  GetHeapResponse,
  PlaceResponse,
  ResetHeapResponse,
  DeleteHeapResponse,
} from '../../shared/heapTypes';

const VERTICES = [
  { x: 100, y: 400 },
  { x: 300, y: 600 },
  { x: 500, y: 400 },
];

function makeApp() {
  return createApp(new MockHeapDB(), new MockScoreDB());
}

// ── POST /heaps ──────────────────────────────────────────────────────────────

describe('POST /heaps', () => {
  it('creates a heap and returns id, baseId, version 1, vertexCount', async () => {
    const res = await makeApp().request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as CreateHeapResponse;
    expect(typeof body.id).toBe('string');
    expect(typeof body.baseId).toBe('string');
    expect(body.id).not.toBe(body.baseId);
    expect(body.version).toBe(1);
    expect(body.vertexCount).toBe(3);
  });

  it('two creates with same vertices produce two heaps with different ids', async () => {
    const app = makeApp();
    const res1 = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    const res2 = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    const b1 = await res1.json() as CreateHeapResponse;
    const b2 = await res2.json() as CreateHeapResponse;
    expect(b1.id).not.toBe(b2.id);
  });

  it('rejects empty vertices with 400', async () => {
    const res = await makeApp().request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects missing vertices with 400', async () => {
    const res = await makeApp().request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('rejects malformed vertex objects with 400', async () => {
    const res = await makeApp().request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: [{ x: 1 }] }),  // missing y
    });
    expect(res.status).toBe(400);
  });
});

// ── GET /heaps ───────────────────────────────────────────────────────────────

describe('GET /heaps', () => {
  it('returns empty array when no heaps exist', async () => {
    const res = await makeApp().request('/heaps');
    expect(res.status).toBe(200);
    const body = await res.json() as ListHeapsResponse;
    expect(body.heaps).toEqual([]);
  });

  it('returns all heaps with id, version, createdAt', async () => {
    const db = new MockHeapDB();
    db.seedHeap('heap-1', 1, []);
    db.seedHeap('heap-2', 3, []);
    const res = await createApp(db, new MockScoreDB()).request('/heaps');
    expect(res.status).toBe(200);
    const body = await res.json() as ListHeapsResponse;
    expect(body.heaps).toHaveLength(2);
    const ids = body.heaps.map(h => h.id);
    expect(ids).toContain('heap-1');
    expect(ids).toContain('heap-2');
    const h2 = body.heaps.find(h => h.id === 'heap-2')!;
    expect(h2.version).toBe(3);
    expect(typeof h2.createdAt).toBe('string');
  });
});

// ── GET /heaps/:id ───────────────────────────────────────────────────────────

describe('GET /heaps/:id', () => {
  it('returns 404 for unknown id', async () => {
    const res = await makeApp().request('/heaps/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns changed:false when client version matches', async () => {
    const db = new MockHeapDB();
    db.seedHeap('h1', 5, [{ x: 10, y: 20 }]);
    const res = await createApp(db, new MockScoreDB()).request('/heaps/h1?version=5');
    expect(res.status).toBe(200);
    const body = await res.json() as GetHeapResponse;
    expect(body.changed).toBe(false);
    expect(body.version).toBe(5);
  });

  it('returns changed:true with liveZone and baseId when client version is behind', async () => {
    const db = new MockHeapDB();
    db.seedHeap('h1', 3, [{ x: 10, y: 20 }], 'base-guid-1');
    const res = await createApp(db, new MockScoreDB()).request('/heaps/h1?version=0');
    expect(res.status).toBe(200);
    const body = await res.json() as GetHeapResponse;
    expect(body.changed).toBe(true);
    if (body.changed) {
      expect(body.version).toBe(3);
      expect(body.baseId).toBe('base-guid-1');
      expect(body.liveZone).toEqual([{ x: 10, y: 20 }]);
    }
  });

  it('defaults version to 0 when not provided', async () => {
    const db = new MockHeapDB();
    db.seedHeap('h1', 1, []);
    const res = await createApp(db, new MockScoreDB()).request('/heaps/h1');
    expect(res.status).toBe(200);
    const body = await res.json() as GetHeapResponse;
    expect(body.changed).toBe(true);  // version 1 > 0
  });
});

// ── GET /heaps/:id/base ──────────────────────────────────────────────────────

describe('GET /heaps/:id/base', () => {
  it('returns 404 for unknown heap id', async () => {
    const res = await makeApp().request('/heaps/no-heap/base');
    expect(res.status).toBe(404);
  });

  it('returns base vertices for known heap', async () => {
    const db = new MockHeapDB();
    const baseVertices = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
    db.seedHeap('h1', 1, [], 'base-1');
    db.seedBase('base-1', 'h1', baseVertices);
    const res = await createApp(db, new MockScoreDB()).request('/heaps/h1/base');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(baseVertices);
  });
});

// ── PUT /heaps/:id/reset ─────────────────────────────────────────────────────

describe('PUT /heaps/:id/reset', () => {
  it('returns 404 for unknown id', async () => {
    const res = await makeApp().request('/heaps/no-heap/reset', { method: 'PUT' });
    expect(res.status).toBe(404);
  });

  it('resets live_zone to empty, version to 1, and returns previousVersion', async () => {
    const db = new MockHeapDB();
    db.seedHeap('h1', 42, [{ x: 10, y: 20 }], 'base-1');
    const res = await createApp(db, new MockScoreDB()).request('/heaps/h1/reset', { method: 'PUT' });
    expect(res.status).toBe(200);
    const body = await res.json() as ResetHeapResponse;
    expect(body.id).toBe('h1');
    expect(body.version).toBe(1);
    expect(body.previousVersion).toBe(42);

    // Confirm state was written to DB
    const row = await db.getHeap('h1');
    expect(row?.version).toBe(1);
    expect(JSON.parse(row!.live_zone)).toEqual([]);
    expect(row?.freeze_y).toBe(0);
  });

  it('preserves base_id on reset', async () => {
    const db = new MockHeapDB();
    db.seedHeap('h1', 10, [{ x: 5, y: 5 }], 'base-preserved');
    await createApp(db, new MockScoreDB()).request('/heaps/h1/reset', { method: 'PUT' });
    const row = await db.getHeap('h1');
    expect(row?.base_id).toBe('base-preserved');
  });
});

// ── POST /heaps/:id/place ────────────────────────────────────────────────────

describe('POST /heaps/:id/place', () => {
  it('returns 404 for unknown heap id', async () => {
    const res = await makeApp().request('/heaps/no-heap/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 10, y: 20 }),
    });
    expect(res.status).toBe(404);
  });

  it('accepts a point when live zone is empty and base is empty', async () => {
    const db = new MockHeapDB();
    db.seedHeap('h1', 1, [], 'base-1');
    db.seedBase('base-1', 'h1', []);
    const res = await createApp(db, new MockScoreDB()).request('/heaps/h1/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 100, y: 200 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as PlaceResponse;
    expect(body.accepted).toBe(true);
    expect(body.version).toBe(2);
  });

  it('rejects a point inside the polygon', async () => {
    const db = new MockHeapDB();
    const square = [
      { x: 0, y: 0 }, { x: 100, y: 0 },
      { x: 100, y: 100 }, { x: 0, y: 100 },
    ];
    db.seedHeap('h1', 1, square, 'base-1');
    db.seedBase('base-1', 'h1', []);
    const res = await createApp(db, new MockScoreDB()).request('/heaps/h1/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 50, y: 50 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as PlaceResponse;
    expect(body.accepted).toBe(false);
    expect(body.version).toBe(1);
  });

  it('accepts a point outside the polygon and bumps version', async () => {
    const db = new MockHeapDB();
    const square = [
      { x: 0, y: 0 }, { x: 100, y: 0 },
      { x: 100, y: 100 }, { x: 0, y: 100 },
    ];
    db.seedHeap('h1', 1, square, 'base-1');
    db.seedBase('base-1', 'h1', []);
    const res = await createApp(db, new MockScoreDB()).request('/heaps/h1/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 200, y: 200 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as PlaceResponse;
    expect(body.accepted).toBe(true);
    expect(body.version).toBe(2);
  });

  it('returns 400 when x or y is missing', async () => {
    const db = new MockHeapDB();
    db.seedHeap('h1', 1, [], 'base-1');
    const res = await createApp(db, new MockScoreDB()).request('/heaps/h1/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 10 }),  // missing y
    });
    expect(res.status).toBe(400);
  });
});

// ── DELETE /heaps/:id ────────────────────────────────────────────────────────

describe('DELETE /heaps/:id', () => {
  it('returns 404 for unknown id', async () => {
    const res = await makeApp().request('/heaps/no-heap', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('deletes heap and returns deleted:true', async () => {
    const db = new MockHeapDB();
    db.seedHeap('h1', 1, []);
    const res = await createApp(db, new MockScoreDB()).request('/heaps/h1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as DeleteHeapResponse;
    expect(body.deleted).toBe(true);

    // Confirm gone from DB
    const row = await db.getHeap('h1');
    expect(row).toBeNull();
  });

  it('heap no longer appears in list after delete', async () => {
    const db = new MockHeapDB();
    db.seedHeap('h1', 1, []);
    db.seedHeap('h2', 1, []);
    const app = createApp(db, new MockScoreDB());
    await app.request('/heaps/h1', { method: 'DELETE' });
    const listRes = await app.request('/heaps');
    const body = await listRes.json() as ListHeapsResponse;
    expect(body.heaps.map(h => h.id)).toEqual(['h2']);
  });
});

// ── Heap params ──────────────────────────────────────────────────────────────

describe('POST /heaps with params', () => {
  it('accepts full params and returns them in GET /heaps', async () => {
    const app = makeApp();
    const res = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vertices: VERTICES,
        params: {
          name: 'Frostbite Summit',
          difficulty: 3.5,
          spawnRateMult: 1.5,
          coinMult: 1.3,
          scoreMult: 2.0,
        },
      }),
    });
    expect(res.status).toBe(201);

    const listRes = await app.request('/heaps');
    const list = await listRes.json() as ListHeapsResponse;
    expect(list.heaps).toHaveLength(1);
    expect(list.heaps[0].params).toEqual({
      name: 'Frostbite Summit',
      difficulty: 3.5,
      spawnRateMult: 1.5,
      coinMult: 1.3,
      scoreMult: 2.0,
      worldHeight: 50_000,
    });
  });

  it('applies defaults when params omitted', async () => {
    const app = makeApp();
    await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    const list = await (await app.request('/heaps')).json() as ListHeapsResponse;
    expect(list.heaps[0].params).toEqual({
      name: 'Unnamed Heap',
      difficulty: 1.0,
      spawnRateMult: 1.0,
      coinMult: 1.0,
      scoreMult: 1.0,
      worldHeight: 50_000,
    });
  });

  it('rejects difficulty out of range', async () => {
    const res = await makeApp().request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES, params: { difficulty: 6 } }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects difficulty not on 0.5 step', async () => {
    const res = await makeApp().request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES, params: { difficulty: 2.3 } }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects non-positive coinMult', async () => {
    const res = await makeApp().request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES, params: { coinMult: 0 } }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects params that are not an object', async () => {
    const res = await makeApp().request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES, params: 'hello' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects params as an array', async () => {
    const res = await makeApp().request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES, params: [1, 2, 3] }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects non-number difficulty', async () => {
    const res = await makeApp().request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES, params: { difficulty: '3' } }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /heaps/:id', () => {
  it('includes params on the changed: true branch', async () => {
    const app = makeApp();
    const createRes = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vertices: VERTICES,
        params: { name: 'X', difficulty: 2, spawnRateMult: 1.1, coinMult: 1.2, scoreMult: 1.3 },
      }),
    });
    const created = await createRes.json() as CreateHeapResponse;

    const res = await app.request(`/heaps/${created.id}?version=0`);
    const body = await res.json() as GetHeapResponse;
    expect(body.changed).toBe(true);
    if (body.changed) {
      expect(body.params).toEqual({ name: 'X', difficulty: 2, spawnRateMult: 1.1, coinMult: 1.2, scoreMult: 1.3, worldHeight: 50_000 });
    }
  });
});

// ── worldHeight ───────────────────────────────────────────────────────────────

describe('worldHeight in heap params', () => {
  it('defaults worldHeight to 50000 when not specified', async () => {
    const app = makeApp();
    await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    const list = await (await app.request('/heaps')).json() as ListHeapsResponse;
    expect(list.heaps[0].params.worldHeight).toBe(50_000);
  });

  it('stores and returns a custom worldHeight via GET /heaps', async () => {
    const app = makeApp();
    await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES, params: { worldHeight: 5_000_000 } }),
    });
    const list = await (await app.request('/heaps')).json() as ListHeapsResponse;
    expect(list.heaps[0].params.worldHeight).toBe(5_000_000);
  });

  it('includes worldHeight in GET /:id changed:true response', async () => {
    const app = makeApp();
    const createRes = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES, params: { worldHeight: 5_000_000 } }),
    });
    const created = await createRes.json() as CreateHeapResponse;

    const res = await app.request(`/heaps/${created.id}?version=0`);
    const body = await res.json() as GetHeapResponse;
    expect(body.changed).toBe(true);
    if (body.changed) {
      expect(body.params.worldHeight).toBe(5_000_000);
    }
  });

  it('seedHeap with worldHeight is reflected in GET /heaps', async () => {
    const db = new MockHeapDB();
    db.seedHeap('h1', 1, [], 'base-1', 0, { name: 'Old Heap', difficulty: 1, spawnRateMult: 1, coinMult: 1, scoreMult: 1, worldHeight: 50_000 });
    const res = await createApp(db, new MockScoreDB()).request('/heaps');
    const body = await res.json() as ListHeapsResponse;
    expect(body.heaps[0].params.worldHeight).toBe(50_000);
  });
});

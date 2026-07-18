// server/tests/routes.test.ts

import { describe, it, expect } from 'vitest';
import { createApp, type AppOptions } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockSink } from './helpers/mockSink';
import type {
  CreateHeapResponse,
  ListHeapsResponse,
  GetHeapResponse,
  PlaceResponse,
  ResetHeapResponse,
  DeleteHeapResponse,
  HeapEnemyParams,
  HeapParams,
} from '../../shared/heapTypes';
import { DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';

const VERTICES = [
  { x: 100, y: 400 },
  { x: 300, y: 600 },
  { x: 500, y: 400 },
];

function makeApp(opts: AppOptions = {}) {
  return createApp(new MockHeapDB(), new MockScoreDB(), opts);
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

  it('rejects malformed vertex objects with 400', async () => {
    const res = await makeApp().request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: [{ x: 1 }] }),  // missing y
    });
    expect(res.status).toBe(400);
  });

  it('creates a heap with no body — server generates default polygon', async () => {
    const res = await makeApp().request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as CreateHeapResponse;
    expect(body.vertexCount).toBeGreaterThan(10);
  });

  it('honors explicit seed for deterministic creation', async () => {
    const app = makeApp();
    const a = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seed: 12345 }),
    }).then(r => r.json()) as CreateHeapResponse;
    const b = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seed: 12345 }),
    }).then(r => r.json()) as CreateHeapResponse;
    expect(a.vertexCount).toBe(b.vertexCount);
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

  it('list response includes topY for each heap', async () => {
    const db = new MockHeapDB();
    const app = createApp(db, new MockScoreDB());
    const created = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    }).then(r => r.json()) as CreateHeapResponse;

    // Simulate a placed point that lowered top_y
    db.setTopYForTest(created.id, 12345);

    const res = await app.request('/heaps');
    expect(res.status).toBe(200);
    const body = await res.json() as ListHeapsResponse;
    const found = body.heaps.find(h => h.id === created.id);
    expect(found).toBeDefined();
    expect(found!.topY).toBe(12345);
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

  it('includes enemyParams in changed: true response', async () => {
    const app = makeApp();
    const createRes = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    const { id } = await createRes.json() as CreateHeapResponse;

    const res = await app.request(`/heaps/${id}?version=0`);
    expect(res.status).toBe(200);
    const body = await res.json() as GetHeapResponse;
    expect(body.changed).toBe(true);
    if (body.changed) {
      expect(body.enemyParams).toBeDefined();
      expect(body.enemyParams.percher).toBeDefined();
      expect(body.enemyParams.ghost).toBeDefined();
    }
  });

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
      expect(body.params).toEqual({ name: 'X', difficulty: 2, spawnRateMult: 1.1, coinMult: 1.2, scoreMult: 1.3, worldHeight: 50_000, ghostPointCount: 1, baseItemSpawnRate: 0.33, positiveItemSpawnRate: 0.15, negativeItemSpawnRate: 0.85, lockedByHeapId: null });
    }
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
      body: JSON.stringify({ x: 200, y: 200 }),
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
      body: JSON.stringify({ x: 200, y: 200 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as PlaceResponse;
    expect(body.accepted).toBe(true);
    expect(body.version).toBe(2);
  });

  it('rejects a point inside the polygon', async () => {
    const db = new MockHeapDB();
    const square = [
      { x: 200, y: 0 }, { x: 400, y: 0 },
      { x: 400, y: 100 }, { x: 200, y: 100 },
    ];
    db.seedHeap('h1', 1, square, 'base-1');
    db.seedBase('base-1', 'h1', []);
    const res = await createApp(db, new MockScoreDB()).request('/heaps/h1/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 300, y: 50 }),
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
    // square's max y = 100 → liveZoneBottomY = 100; place outside the square but within active band
    const res = await createApp(db, new MockScoreDB()).request('/heaps/h1/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 200, y: 50 }),
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
      body: JSON.stringify({ x: 200 }),  // missing y
    });
    expect(res.status).toBe(400);
  });

  it('inserts ghostPointCount extra points into liveZone alongside the player point', async () => {
    const db = new MockHeapDB();
    const params: HeapParams = { ...DEFAULT_HEAP_PARAMS, ghostPointCount: 2 };
    db.seedHeap('h1', 1, [], 'base-1', 0, params);
    db.seedBase('base-1', 'h1', []);

    const app = createApp(db, new MockScoreDB());
    const res = await app.request('/heaps/h1/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 300, y: 150 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as PlaceResponse;
    expect(body.accepted).toBe(true);

    // Fetch the heap and verify liveZone has 1 player + 2 ghost = 3 points
    const heapRes = await app.request('/heaps/h1?version=0');
    const heap = await heapRes.json() as Extract<GetHeapResponse, { changed: true }>;
    expect(heap.liveZone).toHaveLength(3);
  });

  it('inserts zero ghost points when ghostPointCount is 0', async () => {
    const db = new MockHeapDB();
    const params: HeapParams = { ...DEFAULT_HEAP_PARAMS, ghostPointCount: 0 };
    db.seedHeap('h1', 1, [], 'base-1', 0, params);
    db.seedBase('base-1', 'h1', []);

    const app = createApp(db, new MockScoreDB());
    const res = await app.request('/heaps/h1/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 300, y: 150 }),
    });
    const heap = await (await app.request('/heaps/h1?version=0')).json() as Extract<GetHeapResponse, { changed: true }>;
    expect(heap.liveZone).toHaveLength(1); // only player point
  });

  it('returns bonusCoins when placement is more than 100px below top_y', async () => {
    const db = new MockHeapDB();
    db.seedHeap('h1', 1, [], 'base-1', 0, { ...DEFAULT_HEAP_PARAMS, ghostPointCount: 0 });
    db.seedBase('base-1', 'h1', []);

    const res = await createApp(db, new MockScoreDB()).request('/heaps/h1/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 300, y: 101 }), // 101 > 0 + 100
    });
    const body = await res.json() as PlaceResponse;
    expect(body.accepted).toBe(true);
    expect(body.bonusCoins).toBe(10);
  });

  it('does not return bonusCoins when placement is at or within 100px of top_y', async () => {
    const db = new MockHeapDB();
    db.seedHeap('h1', 1, [], 'base-1', 0, { ...DEFAULT_HEAP_PARAMS, ghostPointCount: 0 });
    db.seedBase('base-1', 'h1', []);

    const res = await createApp(db, new MockScoreDB()).request('/heaps/h1/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 300, y: 100 }), // 100 is NOT > 100
    });
    const body = await res.json() as PlaceResponse;
    expect(body.accepted).toBe(true);
    expect(body.bonusCoins).toBeUndefined();
  });

  it('ghost points land within GHOST_JITTER_RADIUS_PX of an existing live zone vertex', async () => {
    // Seed a heap with one existing vertex far from the placement point
    const db = new MockHeapDB();
    db.seedHeap('h1', 1, [{ x: 600, y: 300 }], 'base-1', 0, {
      ...DEFAULT_HEAP_PARAMS,
      ghostPointCount: 1,
    });
    db.seedBase('base-1', 'h1', []);

    const app = createApp(db, new MockScoreDB());
    await app.request('/heaps/h1/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 400, y: 150 }),
    });

    const heapRes = await app.request('/heaps/h1?version=0');
    const heap = await heapRes.json() as Extract<GetHeapResponse, { changed: true }>;
    // 1 existing + 1 player + 1 ghost = 3
    expect(heap.liveZone).toHaveLength(3);

    const RADIUS = 80; // must match GHOST_JITTER_RADIUS_PX in heap.ts
    // Possible anchors at the time ghost was inserted: existing (600,300) and player (400,150)
    const anchors = [{ x: 600, y: 300 }, { x: 400, y: 150 }];
    const ghostPoints = heap.liveZone.filter(
      v => !(v.x === 400 && v.y === 150) && !(v.x === 600 && v.y === 300),
    );
    expect(ghostPoints).toHaveLength(1);
    const ghost = ghostPoints[0];
    const nearAnyAnchor = anchors.some(
      a => Math.abs(ghost.x - a.x) <= RADIUS && Math.abs(ghost.y - a.y) <= RADIUS,
    );
    expect(nearAnyAnchor).toBe(true);
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
      ghostPointCount: 1,
      baseItemSpawnRate: 0.33,
      positiveItemSpawnRate: 0.15,
      negativeItemSpawnRate: 0.85,
      lockedByHeapId: null,
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
      ghostPointCount: 1,
      baseItemSpawnRate: 0.33,
      positiveItemSpawnRate: 0.15,
      negativeItemSpawnRate: 0.85,
      lockedByHeapId: null,
    });
  });

  it('round-trips custom salvage spawn rates through create + GET', async () => {
    const app = makeApp();
    await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vertices: VERTICES,
        params: { baseItemSpawnRate: 0.8, positiveItemSpawnRate: 3, negativeItemSpawnRate: 1 },
      }),
    });
    const list = await (await app.request('/heaps')).json() as ListHeapsResponse;
    expect(list.heaps[0].params.baseItemSpawnRate).toBe(0.8);
    expect(list.heaps[0].params.positiveItemSpawnRate).toBe(3);
    expect(list.heaps[0].params.negativeItemSpawnRate).toBe(1);
  });

  it('clamps baseItemSpawnRate to [0,1] and rejects negative weights to 0', async () => {
    const app = makeApp();
    await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vertices: VERTICES,
        params: { baseItemSpawnRate: 5, positiveItemSpawnRate: -2, negativeItemSpawnRate: 0.25 },
      }),
    });
    const list = await (await app.request('/heaps')).json() as ListHeapsResponse;
    expect(list.heaps[0].params.baseItemSpawnRate).toBe(1);      // clamped from 5
    expect(list.heaps[0].params.positiveItemSpawnRate).toBe(0);  // clamped from -2
    expect(list.heaps[0].params.negativeItemSpawnRate).toBe(0.25);
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
    db.seedHeap('h1', 1, [], 'base-1', 0, { ...DEFAULT_HEAP_PARAMS, name: 'Old Heap', worldHeight: 50_000 });
    const res = await createApp(db, new MockScoreDB()).request('/heaps');
    const body = await res.json() as ListHeapsResponse;
    expect(body.heaps[0].params.worldHeight).toBe(50_000);
  });
});

// ── GET /heaps/:id/enemy-params ──────────────────────────────────────────────

describe('GET /heaps/:id/enemy-params', () => {
  it('returns 404 for unknown heap', async () => {
    const res = await makeApp().request('/heaps/nonexistent/enemy-params');
    expect(res.status).toBe(404);
  });

  it('returns sentinel params when no heap-specific row exists', async () => {
    const app = makeApp();
    // Create a heap (MockHeapDB seeds sentinel automatically)
    const createRes = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    const { id } = await createRes.json() as { id: string };

    const res = await app.request(`/heaps/${id}/enemy-params`);
    expect(res.status).toBe(200);
    const body = await res.json() as HeapEnemyParams;
    expect(body.percher).toBeDefined();
    expect(body.ghost).toBeDefined();
    expect(body.percher.spawnChanceMin).toBeCloseTo(0.15);
  });

  it('returns heap-specific params when set', async () => {
    const db = new MockHeapDB();
    const app = createApp(db, new MockScoreDB());

    const createRes = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    const { id } = await createRes.json() as { id: string };

    const customParams: HeapEnemyParams = {
      percher: { spawnStartPxAboveFloor: 100, spawnEndPxAboveFloor: -1, spawnRampPxAboveFloor: 5000, spawnChanceMin: 0.5, spawnChanceMax: 0.9 },
    };
    db.seedEnemyParams(id, customParams);

    const res = await app.request(`/heaps/${id}/enemy-params`);
    expect(res.status).toBe(200);
    const body = await res.json() as HeapEnemyParams;
    expect(body.percher.spawnChanceMin).toBeCloseTo(0.5);
    expect(body.ghost).toBeUndefined(); // only percher was set
  });
});

// ── PUT /heaps/:id/enemy-params ──────────────────────────────────────────────

describe('PUT /heaps/:id/enemy-params', () => {
  it('returns 404 for unknown heap', async () => {
    const res = await makeApp().request('/heaps/nonexistent/enemy-params', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it('upserts and returns ok:true', async () => {
    const app = makeApp();
    const createRes = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    const { id } = await createRes.json() as { id: string };

    const params: HeapEnemyParams = {
      percher: { spawnStartPxAboveFloor: 0, spawnEndPxAboveFloor: -1, spawnRampPxAboveFloor: 8000, spawnChanceMin: 0.2, spawnChanceMax: 0.6 },
    };

    const res = await app.request(`/heaps/${id}/enemy-params`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('subsequent GET returns the PUT value', async () => {
    const app = makeApp();
    const createRes = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    const { id } = await createRes.json() as { id: string };

    const params: HeapEnemyParams = {
      ghost: { spawnStartPxAboveFloor: 1000, spawnEndPxAboveFloor: -1, spawnRampPxAboveFloor: 10000, spawnChanceMin: 0.05, spawnChanceMax: 0.3 },
    };
    await app.request(`/heaps/${id}/enemy-params`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const res = await app.request(`/heaps/${id}/enemy-params`);
    const body = await res.json() as HeapEnemyParams;
    expect(body.ghost.spawnStartPxAboveFloor).toBe(1000);
  });

  it('returns 400 for non-object body', async () => {
    const app = makeApp();
    const createRes = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    const { id } = await createRes.json() as { id: string };

    const res = await app.request(`/heaps/${id}/enemy-params`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([1, 2, 3]),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for null body', async () => {
    const app = makeApp();
    const createRes = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    const { id } = await createRes.json() as { id: string };

    const res = await app.request(`/heaps/${id}/enemy-params`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(null),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /heaps hardening', () => {
  it('rejects vertices containing non-finite coordinates', async () => {
    const res = await makeApp().request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vertices: [
          { x: 0, y: 0 },
          { x: Number.POSITIVE_INFINITY, y: 100 },
          { x: 100, y: 100 },
        ],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects vertex arrays exceeding 10_000 entries', async () => {
    const huge = Array.from({ length: 10_001 }, (_, i) => ({ x: i, y: i }));
    const res = await makeApp().request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: huge }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /heaps/:id/place hardening', () => {
  async function makeHeap(app: ReturnType<typeof makeApp>) {
    const res = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    return (await res.json() as CreateHeapResponse).id;
  }

  it('rejects non-finite coordinates', async () => {
    const app = makeApp();
    const id = await makeHeap(app);
    const res = await app.request(`/heaps/${id}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: Number.NaN, y: 100 }),
    });
    expect(res.status).toBe(400);
  });
});

describe('heap top_y maintenance', () => {
  it('initializes top_y to MIN(y) of base vertices on create', async () => {
    const db = new MockHeapDB();
    const app = createApp(db, new MockScoreDB());
    const res = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vertices: [{ x: 0, y: 500 }, { x: 50, y: 200 }, { x: 100, y: 400 }],
      }),
    });
    expect(res.status).toBe(201);
    const { id } = await res.json() as CreateHeapResponse;
    expect(db.getTopYForTest(id)).toBe(200);
  });

  it('lowers top_y when a placement is higher than current summit (lower Y)', async () => {
    const db = new MockHeapDB();
    const app = createApp(db, new MockScoreDB());
    const create = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    const { id } = await create.json() as CreateHeapResponse;
    expect(db.getTopYForTest(id)).toBe(400);

    // Place at y=200 (which is top_y - grace), extending summit upward
    const place = await app.request(`/heaps/${id}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 300, y: 200 }),
    });
    expect(place.status).toBe(200);
    expect(db.getTopYForTest(id)).toBe(200);
  });

  it('does not raise top_y when a placement is below current summit (higher Y)', async () => {
    const db = new MockHeapDB();
    const app = createApp(db, new MockScoreDB());
    const create = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    const { id } = await create.json() as CreateHeapResponse;
    expect(db.getTopYForTest(id)).toBe(400);

    // Fresh heap → liveZoneBottomY = top_y + 300 = 700; pick (150, 500) which
    // is below summit (y > top_y) but within the active band and outside the triangle.
    const place = await app.request(`/heaps/${id}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 150, y: 500 }),
    });
    expect(place.status).toBe(200);
    expect(db.getTopYForTest(id)).toBe(400);
  });
});

describe('POST /heaps/:id/place coordinate clamp', () => {
  async function makeHeap(app: ReturnType<typeof createApp>) {
    const res = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    return (await res.json() as CreateHeapResponse).id;
  }

  it('rejects x below center zone (PLACE_X_MIN)', async () => {
    const app = createApp(new MockHeapDB(), new MockScoreDB());
    const id = await makeHeap(app);
    const res = await app.request(`/heaps/${id}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 100, y: 200 }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects x above center zone (PLACE_X_MAX)', async () => {
    const app = createApp(new MockHeapDB(), new MockScoreDB());
    const id = await makeHeap(app);
    const res = await app.request(`/heaps/${id}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 900, y: 200 }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects y below 0', async () => {
    const app = createApp(new MockHeapDB(), new MockScoreDB());
    const id = await makeHeap(app);
    const res = await app.request(`/heaps/${id}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 200, y: -1 }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects y above heap.worldHeight', async () => {
    const app = createApp(new MockHeapDB(), new MockScoreDB());
    const id = await makeHeap(app);
    const res = await app.request(`/heaps/${id}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 200, y: 999_999 }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects y above current summit + grace (anti-cheat)', async () => {
    const app = createApp(new MockHeapDB(), new MockScoreDB());
    const id = await makeHeap(app);
    // VERTICES min y = 400 (this is the heap's initial top_y).
    // Grace = 200, so anything below y=200 is too high.
    const res = await app.request(`/heaps/${id}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 200, y: 100 }),
    });
    expect(res.status).toBe(400);
  });

  it('accepts y at boundary (top_y - grace)', async () => {
    const app = createApp(new MockHeapDB(), new MockScoreDB());
    const id = await makeHeap(app);
    // top_y = 400, grace = 200, boundary = 200
    // The check is `y < top_y - grace`, so y=200 passes (200 < 200 is false)
    const res = await app.request(`/heaps/${id}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 200, y: 200 }),
    });
    expect(res.status).toBe(200);
  });

  it('accepts x at center-zone boundaries', async () => {
    const app = createApp(new MockHeapDB(), new MockScoreDB());
    const id = await makeHeap(app);
    // x = 120 (PLACE_X_MIN) — boundary inclusive
    const res = await app.request(`/heaps/${id}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 120, y: 200 }),
    });
    expect(res.status).toBe(200);
  });

  it('returns generic error message (no rule leakage)', async () => {
    const app = createApp(new MockHeapDB(), new MockScoreDB());
    const id = await makeHeap(app);
    const res = await app.request(`/heaps/${id}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 100, y: 100 }),  // out of center zone
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid placement');
  });

  it('rejects y below the active zone on a fresh heap (anti-cheat)', async () => {
    const app = createApp(new MockHeapDB(), new MockScoreDB());
    const id = await makeHeap(app);
    // Fresh heap → liveZoneBottomY = top_y(400) + HEAP_TOP_ZONE_PX(300) = 700.
    // y=2000 is well below that.
    const res = await app.request(`/heaps/${id}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 200, y: 2000 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid placement');
  });

  it('accepts y exactly at the fresh-heap active-zone boundary (top_y + HEAP_TOP_ZONE_PX)', async () => {
    const app = createApp(new MockHeapDB(), new MockScoreDB());
    const id = await makeHeap(app);
    // boundary = top_y(400) + 300 = 700; check is `y > liveZoneBottomY`, so y=700 passes
    const res = await app.request(`/heaps/${id}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 200, y: 700 }),
    });
    expect(res.status).toBe(200);
  });

  it('rejects y below liveZoneBottomY on a heap with non-empty live zone', async () => {
    const db = new MockHeapDB();
    // Seed a heap whose live zone has max y = 100; bottom is fixed regardless of top_y.
    db.seedHeap('h1', 1, [{ x: 50, y: 50 }, { x: 50, y: 100 }], 'base-1');
    db.seedBase('base-1', 'h1', []);
    const res = await createApp(db, new MockScoreDB()).request('/heaps/h1/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 200, y: 200 }),  // 200 > liveZoneBottomY=100
    });
    expect(res.status).toBe(400);
  });
});

// ── PUT /heaps/:id/params ────────────────────────────────────────────────────

describe('PUT /heaps/:id/params', () => {
  async function seedOne(app: ReturnType<typeof makeApp>) {
    const res = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    return (await res.json() as CreateHeapResponse).id;
  }

  it('updates editable params and returns updated summary', async () => {
    const app = makeApp();
    const id = await seedOne(app);

    const res = await app.request(`/heaps/${id}/params`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed', difficulty: 2.5, coinMult: 1.5 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { summary: any };
    expect(body.summary.params.name).toBe('Renamed');
    expect(body.summary.params.difficulty).toBe(2.5);
    expect(body.summary.params.coinMult).toBe(1.5);
  });

  it('rejects worldHeight in body with 400', async () => {
    const app = makeApp();
    const id = await seedOne(app);
    const res = await app.request(`/heaps/${id}/params`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldHeight: 99_999 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/worldHeight/i);
  });

  it('returns 404 when heap does not exist', async () => {
    const app = makeApp();
    const res = await app.request('/heaps/does-not-exist/params', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(404);
  });

  it('rejects when admin secret is configured but missing', async () => {
    const app = makeApp({ adminSecret: 'topsecret' });
    const id = await (async () => {
      const res = await app.request('/heaps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': 'topsecret' },
        body: JSON.stringify({ vertices: VERTICES }),
      });
      return (await res.json() as CreateHeapResponse).id;
    })();

    const res = await app.request(`/heaps/${id}/params`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },  // no X-Admin-Secret
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('POST /heaps/:id/place — remote logging', () => {
  it('emits place:rejected warn when coordinates are invalid', async () => {
    const sink = new MockSink();
    const app = makeApp({ logSink: sink });
    const heapRes = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    const heapId = (await heapRes.json() as CreateHeapResponse).id;

    const placeRes = await app.request(`/heaps/${heapId}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: NaN, y: 500 }),
    });
    expect(placeRes.status).toBe(400);
    expect(sink.written).toHaveLength(1);
    expect(sink.written[0].message).toBe('place:rejected');
    expect(sink.written[0].level).toBe('warn');
    expect(sink.written[0].payload.reason).toBe('bad coords');
  });

  it('emits place:rejected warn when x is out of center zone', async () => {
    const sink = new MockSink();
    const app = makeApp({ logSink: sink });
    const heapRes = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    const heapId = (await heapRes.json() as CreateHeapResponse).id;

    const placeRes = await app.request(`/heaps/${heapId}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 10, y: 500 }),  // x too small
    });
    expect(placeRes.status).toBe(400);
    expect(sink.written).toHaveLength(1);
    expect(sink.written[0].message).toBe('place:rejected');
    expect(sink.written[0].payload.reason).toBe('x out of center zone');
  });

  it('does not emit place:rejected when placement is accepted', async () => {
    const sink = new MockSink();
    const app = makeApp({ logSink: sink });
    const heapRes = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    const heapId = (await heapRes.json() as CreateHeapResponse).id;

    const placeRes = await app.request(`/heaps/${heapId}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 480, y: 300 }),  // valid center zone placement
    });
    expect(placeRes.status).toBe(200);
    expect(sink.written).toHaveLength(0);
  });

  it('works when sink is undefined (gracefully ignores)', async () => {
    const app = makeApp();
    const heapRes = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    const heapId = (await heapRes.json() as CreateHeapResponse).id;

    const placeRes = await app.request(`/heaps/${heapId}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 10, y: 500 }),
    });
    expect(placeRes.status).toBe(400);
  });
});

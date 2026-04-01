import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import type { GetHeapResponse, GetHashesResponse, AppendHeapResponse, SeedHeapResponse } from '../../shared/heapTypes';

const HEAP_ID = 'aaaa';  // arbitrary stable test heap ID

function makeApp() {
  return createApp(new MockHeapDB());
}

// ── GET /heap/hashes ─────────────────────────────────────────────────────────

describe('GET /heap/hashes', () => {
  it('returns empty array when no heaps exist', async () => {
    const res = await makeApp().request('/heap/hashes');
    expect(res.status).toBe(200);
    const body = await res.json() as GetHashesResponse;
    expect(body.hashes).toEqual([]);
  });

  it('returns all heap IDs', async () => {
    const db = new MockHeapDB();
    db.seedPolygon('hash1', 1, []);
    db.seedPolygon('hash2', 1, []);
    const res = await createApp(db).request('/heap/hashes');
    expect(res.status).toBe(200);
    const body = await res.json() as GetHashesResponse;
    expect(body.hashes).toHaveLength(2);
    expect(body.hashes).toContain('hash1');
    expect(body.hashes).toContain('hash2');
  });
});

// ── GET /heap/:hash ──────────────────────────────────────────────────────────

describe('GET /heap/:hash', () => {
  it('returns 404 for an unknown heap ID', async () => {
    const res = await makeApp().request('/heap/unknownhash');
    expect(res.status).toBe(404);
  });

  it('returns changed:false when client version matches server', async () => {
    const db = new MockHeapDB();
    db.seedPolygon(HEAP_ID, 3, [{ x: 10, y: 5 }]);
    const res = await createApp(db).request(`/heap/${HEAP_ID}?version=3`);
    expect(res.status).toBe(200);
    const body = await res.json() as GetHeapResponse;
    expect(body.changed).toBe(false);
    expect(body.version).toBe(3);
  });

  it('returns changed:true with liveZone when client version is behind', async () => {
    const db = new MockHeapDB();
    db.seedPolygon(HEAP_ID, 3, [{ x: 10, y: 5 }]);
    const res = await createApp(db).request(`/heap/${HEAP_ID}?version=0`);
    expect(res.status).toBe(200);
    const body = await res.json() as GetHeapResponse;
    expect(body.changed).toBe(true);
    if (body.changed) {
      expect(body.version).toBe(3);
      expect(Array.isArray(body.liveZone)).toBe(true);
      expect(typeof body.baseHash).toBe('string');
    }
  });

  it('defaults to version=0 when no version param provided', async () => {
    const db = new MockHeapDB();
    db.seedPolygon(HEAP_ID, 1, []);
    const res = await createApp(db).request(`/heap/${HEAP_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json() as GetHeapResponse;
    expect(body.changed).toBe(true);  // version 1 > 0
  });
});

// ── GET /heap/base/:hash ─────────────────────────────────────────────────────

describe('GET /heap/base/:hash', () => {
  it('returns 404 for an unknown hash', async () => {
    const res = await makeApp().request('/heap/base/unknownhash');
    expect(res.status).toBe(404);
  });

  it('returns base vertices for a known hash', async () => {
    const db = new MockHeapDB();
    await db.upsertBase('myhash', [{ x: 1, y: 2 }]);
    const res = await createApp(db).request('/heap/base/myhash');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ x: 1, y: 2 }]);
  });
});

// ── POST /heap/place ─────────────────────────────────────────────────────────

describe('POST /heap/place', () => {
  it('returns 404 when the heap ID does not exist', async () => {
    const res = await makeApp().request('/heap/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: 'nope', x: 100, y: 200 }),
    });
    expect(res.status).toBe(404);
  });

  it('accepts a point when the polygon is empty', async () => {
    const db = new MockHeapDB();
    db.seedPolygon(HEAP_ID, 1, []);
    const res = await createApp(db).request('/heap/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: HEAP_ID, x: 100, y: 200 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as AppendHeapResponse;
    expect(body.accepted).toBe(true);
    expect(body.version).toBe(2);
  });

  it('rejects a point inside the polygon', async () => {
    const db = new MockHeapDB();
    // A square: (0,0),(100,0),(100,100),(0,100) — centroid (50,50) is inside
    db.seedPolygon(HEAP_ID, 1, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
    const res = await createApp(db).request('/heap/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: HEAP_ID, x: 50, y: 50 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as AppendHeapResponse;
    expect(body.accepted).toBe(false);
    expect(body.version).toBe(1);
  });

  it('accepts a point outside the polygon and bumps version', async () => {
    const db = new MockHeapDB();
    db.seedPolygon(HEAP_ID, 1, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
    const res = await createApp(db).request('/heap/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: HEAP_ID, x: 200, y: 200 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as AppendHeapResponse;
    expect(body.accepted).toBe(true);
    expect(body.version).toBe(2);
  });

  it('returns 400 when hash, x, or y is missing', async () => {
    const res = await makeApp().request('/heap/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 10, y: 20 }),  // missing hash
    });
    expect(res.status).toBe(400);
  });
});

// ── POST /heap/seed ──────────────────────────────────────────────────────────

describe('POST /heap/seed', () => {
  const vertices = [
    { x: 100, y: 400 },
    { x: 300, y: 600 },
    { x: 500, y: 400 },
  ];

  it('seeds a new heap and returns seeded:true with version 1', async () => {
    const res = await makeApp().request('/heap/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as SeedHeapResponse;
    expect(body.seeded).toBe(true);
    expect(body.version).toBe(1);
    expect(body.vertexCount).toBe(3);
    expect(typeof body.hash).toBe('string');
  });

  it('returns 409 when same vertices sent again without overwriteHeap', async () => {
    const app = makeApp();
    // Seed once
    await app.request('/heap/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices }),
    });
    // Try again — same vertices → same hash → conflict
    const res = await app.request('/heap/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices }),
    });
    expect(res.status).toBe(409);
  });

  it('resets live zone and version to 1 when overwriteHeap:true', async () => {
    const db = new MockHeapDB();
    const app = createApp(db);
    // First seed
    const first = await app.request('/heap/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices }),
    });
    const { hash } = await first.json() as SeedHeapResponse;

    // Manually advance version to simulate player activity
    db.seedPolygon(hash, 42, [{ x: 200, y: 500 }]);

    // Overwrite
    const res = await app.request('/heap/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices, overwriteHeap: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as SeedHeapResponse;
    expect(body.seeded).toBe(true);
    expect(body.version).toBe(1);

    // Confirm live zone was reset
    const row = await db.getPolygonRow(hash);
    expect(row?.version).toBe(1);
    expect(JSON.parse(row!.live_zone)).toEqual([]);
  });

  it('rejects empty vertices array with 400', async () => {
    const res = await makeApp().request('/heap/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('two different vertex arrays produce two independent heaps', async () => {
    const app = makeApp();
    const verticesB = [{ x: 10, y: 20 }, { x: 30, y: 40 }, { x: 50, y: 20 }];

    await app.request('/heap/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices }),
    });
    await app.request('/heap/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: verticesB }),
    });

    const hashRes = await app.request('/heap/hashes');
    const { hashes } = await hashRes.json() as GetHashesResponse;
    expect(hashes).toHaveLength(2);
  });
});

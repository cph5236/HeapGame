import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { GetHeapResponse, AppendHeapResponse } from '../../shared/heapTypes';

function makeApp() {
  return createApp(new MockHeapDB());
}

describe('GET /heap', () => {
  it('returns changed:false when client version matches server', async () => {
    const app = makeApp();
    const res = await app.request('/heap?version=0');
    expect(res.status).toBe(200);
    const body = await res.json() as GetHeapResponse;
    expect(body.changed).toBe(false);
    expect(body.version).toBe(0);
  });

  it('returns changed:true with liveZone when client version is behind', async () => {
    const db = new MockHeapDB();
    db.seedPolygon('default', 3, [{ x: 10, y: 5 }], '', 0);
    const app = createApp(db);
    const res = await app.request('/heap?version=0');
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
    const app = makeApp();
    const res = await app.request('/heap');
    expect(res.status).toBe(200);
    const body = await res.json() as GetHeapResponse;
    expect(body.changed).toBe(false);
  });
});

describe('GET /heap/base/:hash', () => {
  it('returns 404 for an unknown hash', async () => {
    const app = makeApp();
    const res = await app.request('/heap/base/unknownhash');
    expect(res.status).toBe(404);
  });

  it('returns base vertices for a known hash', async () => {
    const db = new MockHeapDB();
    await db.upsertBase('myhash', [{ x: 1, y: 2 }]);
    const app = createApp(db);
    const res = await app.request('/heap/base/myhash');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ x: 1, y: 2 }]);
  });
});

describe('POST /heap/place', () => {
  it('accepts a point when the polygon is empty', async () => {
    const app = makeApp();
    const res = await app.request('/heap/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 100, y: 200 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as AppendHeapResponse;
    expect(body.accepted).toBe(true);
    expect(body.version).toBe(1);
  });

  it('rejects a point inside the polygon', async () => {
    const db = new MockHeapDB();
    // A square: (0,0),(100,0),(100,100),(0,100) — centroid (50,50) is inside
    db.seedPolygon('default', 1, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
    const app = createApp(db);
    const res = await app.request('/heap/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 50, y: 50 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as AppendHeapResponse;
    expect(body.accepted).toBe(false);
    expect(body.version).toBe(1);
  });

  it('accepts a point outside the polygon and bumps version', async () => {
    const db = new MockHeapDB();
    db.seedPolygon('default', 1, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
    const app = createApp(db);
    const res = await app.request('/heap/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 200, y: 200 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as AppendHeapResponse;
    expect(body.accepted).toBe(true);
    expect(body.version).toBe(2);
  });

  it('returns 400 when x or y is missing', async () => {
    const app = makeApp();
    const res = await app.request('/heap/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 10 }),
    });
    expect(res.status).toBe(400);
  });
});

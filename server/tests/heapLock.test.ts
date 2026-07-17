// server/tests/heapLock.test.ts

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import type { CreateHeapResponse, ListHeapsResponse, GetHeapResponse } from '../../shared/heapTypes';
import { INFINITE_HEAP_ID } from '../../shared/heapTypes';

const VERTICES = [
  { x: 100, y: 400 },
  { x: 300, y: 600 },
  { x: 500, y: 400 },
];

function makeApp() {
  return createApp(new MockHeapDB(), new MockScoreDB(), {});
}
type App = ReturnType<typeof makeApp>;

async function createHeap(app: App, params: Record<string, unknown> = {}): Promise<string> {
  const res = await app.request('/heaps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vertices: VERTICES, params: { name: 'H', ...params } }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as CreateHeapResponse).id;
}

function setLock(app: App, heapId: string, lockedByHeapId: string | null) {
  return app.request(`/heaps/${heapId}/params`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lockedByHeapId }),
  });
}

async function lockOf(app: App, heapId: string): Promise<string | null | undefined> {
  const res = await app.request('/heaps');
  const body = (await res.json()) as ListHeapsResponse;
  return body.heaps.find(h => h.id === heapId)?.params.lockedByHeapId;
}

describe('heap locking — threading', () => {
  it('defaults to null and round-trips through list', async () => {
    const app = makeApp();
    const a = await createHeap(app);
    expect(await lockOf(app, a)).toBeNull();

    const b = await createHeap(app, { lockedByHeapId: a });
    expect(await lockOf(app, b)).toBe(a);
  });

  it('appears in GET /heaps/:id params', async () => {
    const app = makeApp();
    const a = await createHeap(app);
    const b = await createHeap(app, { lockedByHeapId: a });
    const res = await app.request(`/heaps/${b}`);
    const body = (await res.json()) as GetHeapResponse;
    expect(body.changed && body.params.lockedByHeapId).toBe(a);
  });

  it('PUT /params sets and explicit null clears; omitting the key preserves', async () => {
    const app = makeApp();
    const a = await createHeap(app);
    const b = await createHeap(app);

    expect((await setLock(app, b, a)).status).toBe(200);
    expect(await lockOf(app, b)).toBe(a);

    // Unrelated params edit without the key must NOT touch the lock.
    const res = await app.request(`/heaps/${b}/params`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coinMult: 2 }),
    });
    expect(res.status).toBe(200);
    expect(await lockOf(app, b)).toBe(a);

    expect((await setLock(app, b, null)).status).toBe(200);
    expect(await lockOf(app, b)).toBeNull();
  });

  it('reset preserves the lock (no body and params body)', async () => {
    const app = makeApp();
    const a = await createHeap(app);
    const b = await createHeap(app, { lockedByHeapId: a });

    expect((await app.request(`/heaps/${b}/reset`, { method: 'PUT' })).status).toBe(200);
    expect(await lockOf(app, b)).toBe(a);

    const res = await app.request(`/heaps/${b}/reset`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    });
    expect(res.status).toBe(200);
    expect(await lockOf(app, b)).toBe(a);
  });
});

describe('heap locking — validation', () => {
  it('rejects an unknown prerequisite id', async () => {
    const app = makeApp();
    const a = await createHeap(app);
    expect((await setLock(app, a, 'no-such-heap')).status).toBe(400);
  });

  it('rejects an unknown prerequisite on create', async () => {
    const app = makeApp();
    const res = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES, params: { name: 'H', lockedByHeapId: 'no-such-heap' } }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects self-lock', async () => {
    const app = makeApp();
    const a = await createHeap(app);
    expect((await setLock(app, a, a)).status).toBe(400);
  });

  it('rejects a direct A<->B cycle', async () => {
    const app = makeApp();
    const a = await createHeap(app);
    const b = await createHeap(app);
    expect((await setLock(app, b, a)).status).toBe(200);
    expect((await setLock(app, a, b)).status).toBe(400);
  });

  it('rejects the closing edit of an A->B->C->A cycle', async () => {
    const app = makeApp();
    const a = await createHeap(app);
    const b = await createHeap(app);
    const c = await createHeap(app);
    expect((await setLock(app, a, b)).status).toBe(200); // A locked by B
    expect((await setLock(app, b, c)).status).toBe(200); // B locked by C
    expect((await setLock(app, c, a)).status).toBe(400); // closes the cycle
  });

  it('accepts a valid linear chain', async () => {
    const app = makeApp();
    const a = await createHeap(app);
    const b = await createHeap(app);
    const c = await createHeap(app);
    expect((await setLock(app, b, a)).status).toBe(200);
    expect((await setLock(app, c, b)).status).toBe(200);
  });

  it('rejects a non-string non-null lockedByHeapId', async () => {
    const app = makeApp();
    const a = await createHeap(app);
    const res = await app.request(`/heaps/${a}/params`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lockedByHeapId: 42 }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects the infinite heap as a lock prerequisite (it can never be beaten)', async () => {
    const db = new MockHeapDB();
    db.seedHeap(INFINITE_HEAP_ID, 1, []);
    const app = createApp(db, new MockScoreDB(), {});
    const a = await createHeap(app);
    expect((await setLock(app, a, INFINITE_HEAP_ID)).status).toBe(400);
  });
});

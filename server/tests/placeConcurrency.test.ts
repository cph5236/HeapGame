// server/tests/placeConcurrency.test.ts
//
// MIN/MAX band writes are conflict-free, so concurrent placements no longer race:
// there is no CAS, no retry loop, and no 409. Two placers in the same band both
// widen it; the result is indistinguishable from them arriving in sequence.
//
// HONESTY NOTE: this test drives concurrent requests with Promise.all, but
// MockHeapDB.upsertBands (and commitPlacement) contain no `await` internally,
// so under JavaScript's run-to-completion semantics these calls do NOT actually
// interleave — each request's synchronous-looking mutation completes before the
// next one's microtask runs. This proves the MIN/MAX widen math is correct and
// that the route never emits a 409, but it does NOT demonstrate real concurrent
// writes racing against each other. Genuine concurrency evidence comes only
// from the k6 load test against staging (D1), not from these mock-backed tests.
// The same limitation applies to commitPlacement's atomicity specifically (see
// server/tests/commitPlacementAtomicity.test.ts) — true single-transaction
// atomicity rests on D1's batch semantics and is not provable by a mock.

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { DEFAULT_HEAP_PARAMS, type PlaceResponse } from '../../shared/heapTypes';

async function heap(ghosts = 0) {
  const db = new MockHeapDB();
  await db.createHeap('h1', 'b1', [{ x: 480, y: 50000 }], 'h', new Date().toISOString(), {
    ...DEFAULT_HEAP_PARAMS, worldHeight: 50000, ghostPointCount: ghosts,
  });
  await db.updateHeap('h1', 'b1', 1, [], 0, 47000);
  await db.upsertBands('h1', [{ band: 2350, minX: 400, maxX: 500 }], 1);
  return db;
}

function place(db: MockHeapDB, body: unknown) {
  return createApp(db, new MockScoreDB()).request('/heaps/h1/place', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('POST /heaps/:id/place — concurrency without CAS', () => {
  it('applies both concurrent placements widening the same band', async () => {
    const db = await heap();
    const [a, b] = await Promise.all([
      place(db, { x: 350, y: 47010 }),
      place(db, { x: 550, y: 47010 }),
    ]);
    expect(((await a.json()) as PlaceResponse).accepted).toBe(true);
    expect(((await b.json()) as PlaceResponse).accepted).toBe(true);
    expect(await db.getBand('h1', 2350)).toEqual({ band: 2350, minX: 350, maxX: 550 });
  });

  it('never returns a version conflict', async () => {
    const db = await heap();
    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) => place(db, { x: 350 - i, y: 47010 })),
    );
    for (const r of results) expect(r.status).not.toBe(409);
  });

  it('increments the version once per accepted placement', async () => {
    const db = await heap();
    const before = (await db.getHeap('h1'))!.version;
    await Promise.all([
      place(db, { x: 350, y: 47010 }),
      place(db, { x: 550, y: 47010 }),
    ]);
    expect((await db.getHeap('h1'))!.version).toBe(before + 2);
  });
});

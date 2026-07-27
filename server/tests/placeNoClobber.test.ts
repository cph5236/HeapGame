// server/tests/placeNoClobber.test.ts
//
// Was placeCas.test.ts, covering the compare-and-swap retry loop (issue #82).
// MIN/MAX band writes made that loop unnecessary: a rival placement cannot clobber
// ours because neither replaces the other's extent. This asserts the property the
// CAS used to protect, without the CAS.
import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';

describe('POST /heaps/:id/place — no lost updates', () => {
  it('keeps a rival placement when ours lands in the same band', async () => {
    const db = new MockHeapDB();
    await db.createHeap('h1', 'b1', [{ x: 480, y: 50000 }], 'h', new Date().toISOString(), {
      ...DEFAULT_HEAP_PARAMS, worldHeight: 50000, ghostPointCount: 0,
    });
    await db.updateHeap('h1', 'b1', 1, [], 0, 47000);
    await db.upsertBands('h1', [{ band: 2350, minX: 400, maxX: 500 }], 1);

    const app = createApp(db, new MockScoreDB());
    const req = (x: number) => app.request('/heaps/h1/place', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x, y: 47010 }),
    });

    await req(300);                       // rival widens left
    await req(600);                       // ours widens right
    expect(await db.getBand('h1', 2350)).toEqual({ band: 2350, minX: 300, maxX: 600 });
  });
});

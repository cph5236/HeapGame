// server/tests/bandBlobEquivalence.test.ts
//
// Was the Phase 1 dual-write guard (commit b5ee42d): it asserted the live_zone
// blob and the heap_band table stayed in lockstep because /place wrote both.
// Task 8 deletes that dual write — /place now writes ONLY bands, and the blob
// is a derived cache rebuilt lazily by materialiseLiveZone (Task 7) on read.
// The old assertion (blob envelope == band envelope immediately after a
// placement) is therefore no longer true by design: the blob is stale until
// something reads the heap. This file now asserts the Task 8 reality instead —
// bands are the single source of truth /place writes to, and the blob is left
// untouched by placement.
//
// The property this test used to protect — that the two representations never
// silently drift out of correctness — is covered instead by
// liveZoneRebuild.test.ts, which proves the lazily-rebuilt blob is always
// derivable from bands.

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';

describe('band writes after the CAS/dual-write removal (Task 8)', () => {
  it('/place writes only bands and leaves the live_zone blob untouched', async () => {
    const db = new MockHeapDB();
    await db.createHeap('h1', 'b1', [{ x: 480, y: 50000 }], 'hash', new Date().toISOString(), {
      ...DEFAULT_HEAP_PARAMS, worldHeight: 50000, ghostPointCount: 2,
    });
    await db.updateHeap('h1', 'b1', 1, [], 0, 47000);

    const rowBefore = (await db.getHeap('h1'))!;
    const blobBefore = rowBefore.live_zone;

    const app = createApp(db, new MockScoreDB());
    for (let i = 0; i < 60; i++) {
      await app.request('/heaps/h1/place', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: 200 + ((i * 37) % 600), y: 47000 + (i % 15) }),
      });
    }

    const rowAfter = (await db.getHeap('h1'))!;
    // Bands accumulated real data...
    const bands = await db.getAllBands('h1');
    expect(bands.length).toBeGreaterThan(0);
    // ...but the blob is exactly what it was before any placement — /place
    // never calls updateHeap or setLiveZoneBlob any more.
    expect(rowAfter.live_zone).toBe(blobBefore);
    // Version still advances once per accepted placement even though the blob
    // does not move — bumpVersion, not updateHeap, is now what drives it.
    expect(rowAfter.version).toBeGreaterThan(rowBefore.version);
  });
});

// server/tests/bandBlobEquivalence.test.ts
//
// Was the Phase 1 dual-write guard (commit b5ee42d): it asserted the live_zone
// blob and the heap_band table stayed in lockstep because /place wrote both.
// Task 8 deleted that dual write — /place now writes ONLY bands, and the blob
// is a derived cache rebuilt lazily by materialiseLiveZone (Task 7) on read.
// The old assertion (blob envelope == band envelope immediately after a
// placement, read via the repo) no longer applies.
//
// What replaces it: the property actually worth protecting post-Task-8 is not
// "two writers agree" but "the blob a CLIENT is served is exactly the live
// bands, after real traffic". This drives 60 real, unmocked (randomized
// Math.random, ghost-bearing) placements through the actual /place route, then
// reads the heap back the way a client does — GET /heaps/:id, which routes
// through materialiseLiveZone — and asserts the served live_zone's envelope is
// pixel-identical to the live band rows. If materialiseLiveZone or the
// placement path ever silently disagree, this fails.
//
// SCOPE NOTE (carried from the original guard): a real, migration-backfilled
// heap also has base-region bands (down at y < freeze_y) that the live-zone
// blob never represents — materialiseLiveZone deliberately filters those out
// (see its own comment). That's exactly why the "live bands" side here is
// filtered to `band >= bandOf(freeze_y)` rather than compared against the full
// heap_band table: this fixture's freeze_y stays 0 throughout (freeze is out
// of scope until the next task), so the filter is a no-op here, but the
// assertion is written to match materialiseLiveZone's own rule rather than to
// assume freeze never runs.

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { DEFAULT_HEAP_PARAMS, type GetHeapResponse } from '../../shared/heapTypes';
import { bandOf, envelopeToRows, verticesToEnvelope } from '../../shared/heapPolygon/bandEnvelope';

describe('served live_zone projects the live bands (post-Task-8)', () => {
  it('GET liveZone envelope matches getAllBands after real, ghost-bearing /place traffic', async () => {
    const db = new MockHeapDB();
    await db.createHeap('h1', 'b1', [{ x: 480, y: 50000 }], 'hash', new Date().toISOString(), {
      ...DEFAULT_HEAP_PARAMS, worldHeight: 50000, ghostPointCount: 2,
    });
    await db.updateHeap('h1', 'b1', 1, [], 0, 47000);

    const app = createApp(db, new MockScoreDB());
    // Real, unmocked Math.random — ghosts land wherever they land. The value of
    // this guard is exercising the actual fuzz, not a scripted sequence.
    for (let i = 0; i < 60; i++) {
      await app.request('/heaps/h1/place', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: 200 + ((i * 37) % 600), y: 47000 + (i % 15) }),
      });
    }

    // Read the way a client does: GET with a stale version forces the
    // changed:true path, which calls materialiseLiveZone.
    const getRes = await app.request('/heaps/h1?version=0');
    const served = (await getRes.json()) as Extract<GetHeapResponse, { changed: true }>;

    const servedRows = envelopeToRows(verticesToEnvelope(served.liveZone));

    const row = (await db.getHeap('h1'))!;
    const freezeBand = bandOf(row.freeze_y);
    const liveBandRows = (await db.getAllBands('h1')).filter((b) => b.band >= freezeBand);

    expect(servedRows).toEqual(liveBandRows);
    // Sanity: this traffic actually produced bands — an empty-vs-empty match
    // would pass vacuously and prove nothing.
    expect(liveBandRows.length).toBeGreaterThan(0);
  });
});

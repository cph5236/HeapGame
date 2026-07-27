// server/tests/bandBlobEquivalence.test.ts
//
// Phase 1 keeps the live_zone blob authoritative while dual-writing bands. If the
// two ever disagree, /place is judging placements against a shape that is not the
// one being served. This asserts they cannot.
//
// SCOPE NOTE: this test compares the band envelope derived from the live_zone blob
// against the FULL heap_band table (`db.getAllBands`). That equality only holds
// here because `MockHeapDB.createHeap` seeds a heap with no bands at all — every
// row in `heap_band` for this fixture was therefore written by a placement, i.e.
// derived from the same vertices that went into the blob. It proves the dual-write
// in /place keeps the two representations in lockstep for bands touched by placements.
//
// It does NOT prove whole-table equivalence on a real heap. Migration 0004
// backfilled `heap_band` from BOTH the live zone AND `heap_base.vertices`, so a
// production heap has bands (down in the frozen base region) that the live-zone
// blob knows nothing about. Comparing `getAllBands` to the blob's envelope on a
// backfilled heap would fail for a reason that has nothing to do with dual-write
// drift. The guard here is scoped to live-zone-derived bands, not to all bands —
// that scoping is safe only because this fixture's base contributes none.

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { DEFAULT_HEAP_PARAMS, type Vertex } from '../../shared/heapTypes';
import { verticesToEnvelope, envelopeToRows } from '../../shared/heapPolygon/bandEnvelope';

describe('band/blob equivalence under dual-write', () => {
  it('keeps the band envelope equal to the envelope of the blob', async () => {
    const db = new MockHeapDB();
    await db.createHeap('h1', 'b1', [{ x: 480, y: 50000 }], 'hash', new Date().toISOString(), {
      ...DEFAULT_HEAP_PARAMS, worldHeight: 50000, ghostPointCount: 2,
    });
    await db.updateHeap('h1', 'b1', 1, [], 0, 47000);

    const app = createApp(db, new MockScoreDB());
    for (let i = 0; i < 60; i++) {
      await app.request('/heaps/h1/place', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: 200 + ((i * 37) % 600), y: 47000 + (i % 15) }),
      });
    }

    const row = (await db.getHeap('h1'))!;
    const fromBlob = envelopeToRows(verticesToEnvelope(JSON.parse(row.live_zone) as Vertex[]));
    const fromBands = await db.getAllBands('h1');
    expect(fromBands).toEqual(fromBlob);
  });
});

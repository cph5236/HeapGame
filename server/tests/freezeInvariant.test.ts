// server/tests/freezeInvariant.test.ts
//
// The permanent regression guard for the live/frozen band partition. Task 9
// reinstated freeze in band terms, but three consumers (materialiseLiveZone,
// liveZoneBottomY, ghost anchor sampling) initially got the live/frozen
// comparison direction backwards. Every existing test missed it because
// freeze never fired before that task landed — freeze_y stayed 0, so
// `band >= 0` (or its mirror) matched everything and the inversion was a
// no-op. This test drives real /place requests through the actual app until
// a freeze genuinely fires, then asserts the invariant whose absence let the
// bug survive nine tasks: every band the heap has ever recorded is in
// exactly one of {live, base} — never both, never neither.

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { DEFAULT_HEAP_PARAMS, type PlaceResponse } from '../../shared/heapTypes';
import { bandOf, verticesToEnvelope, BAND_SIZE_PX } from '../../shared/heapPolygon/bandEnvelope';
import { LIVE_ZONE_MAX_BANDS } from '../src/polygon';

const NOW = new Date().toISOString();

function place(db: MockHeapDB, x: number, y: number) {
  return createApp(db, new MockScoreDB()).request('/heaps/h1/place', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x, y }),
  });
}

describe('freeze partition invariant', () => {
  it('every recorded band is live XOR frozen once a real freeze has fired', async () => {
    const START_Y = 50000; // an exact multiple of BAND_SIZE_PX, comfortably below worldHeight
    const db = new MockHeapDB();
    await db.createHeap('h1', 'b1', [{ x: 480, y: START_Y }], 'hash', NOW, {
      ...DEFAULT_HEAP_PARAMS,
      worldHeight: 60000,
      ghostPointCount: 0, // isolate: exactly one new band per placement, no ghost noise
    });

    // Climb the summit upward one band at a time (each placement 20px = one
    // BAND_SIZE_PX above the last), landing in a brand-new, previously-empty
    // band every time. LIVE_ZONE_MAX_BANDS + 1 distinct bands is the minimum
    // needed to push the live count over the limit and force exactly one
    // freeze, on the final placement.
    const PLACEMENT_COUNT = LIVE_ZONE_MAX_BANDS + 1; // 78
    for (let i = 0; i < PLACEMENT_COUNT; i++) {
      const y = START_Y - i * BAND_SIZE_PX;
      const res = await place(db, 480, y);
      const body = (await res.json()) as PlaceResponse;
      expect(body.accepted).toBe(true);
    }

    const row = await db.getHeapFresh('h1');
    expect(row).not.toBeNull();

    // The freeze must have genuinely fired — assert this BEFORE the
    // partition check, so a future regression that silently stops freezing
    // (making this test vacuous) fails loudly here instead of passing by
    // omission.
    expect(row!.freeze_y).toBeGreaterThan(0);
    expect(row!.base_id).not.toBe('b1');

    const freezeBand = bandOf(row!.freeze_y);
    const allBands = await db.getAllBands('h1');
    expect(allBands.length).toBe(PLACEMENT_COUNT); // freeze never deletes band rows

    const baseVertices = (await db.getBaseVerticesById(row!.base_id)) ?? [];
    const baseBands = verticesToEnvelope(baseVertices);

    // The partition invariant itself: every band is in the live set
    // (band < freezeBand) XOR present in the base envelope — never both,
    // never neither. This is exactly the check whose absence let the
    // three inverted/overbroad consumers survive undetected.
    for (const b of allBands) {
      const inLive = b.band < freezeBand;
      const inBase = baseBands.has(b.band);
      expect(inLive).toBe(!inBase);
    }

    // The live set must be non-empty and must contain the current summit
    // band — a future inversion that empties the live zone (freezing the
    // summit instead of the bottom) must fail loudly here.
    const liveBands = allBands.filter((b) => b.band < freezeBand);
    expect(liveBands.length).toBeGreaterThan(0);
    const summitBand = bandOf(row!.top_y);
    expect(liveBands.some((b) => b.band === summitBand)).toBe(true);

    // The placement gate must actually enforce the freeze line: a placement
    // landing in the newly-frozen region (at freeze_y itself) is rejected,
    // while one just above it (still live) is accepted. This is the
    // liveZoneBottomY consumer's own regression guard — a reverted -1 or a
    // reverted freeze_y>0 sentinel would admit writes into buried geometry.
    // x=481, not 480: the frozen band at freeze_y already holds a point at
    // x=480 from the climb loop, so a same-x replay would read accepted:false
    // from the WIDTH check alone, masking a gate that wrongly let it through.
    // Using a different x means the only way to see accepted:false here is a
    // genuine 400 from the active-zone gate.
    const intoFrozen = await place(db, 481, row!.freeze_y);
    expect(intoFrozen.status).toBe(400);

    // x=481, not 480: the band just below the freeze line was already
    // populated (at x=480) by the climb loop above, and a placement that
    // doesn't widen its band is accepted-but-false, not rejected — using a
    // different x proves this is a genuine width-check pass, not a gate 400.
    const stillLive = await place(db, 481, row!.freeze_y - BAND_SIZE_PX);
    const liveBody = (await stillLive.json()) as PlaceResponse;
    expect(liveBody.accepted).toBe(true);
  });
});

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
import { DEFAULT_HEAP_PARAMS, type PlaceResponse, type GetHeapResponse } from '../../shared/heapTypes';
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

function getHeap(db: MockHeapDB) {
  return createApp(db, new MockScoreDB()).request('/heaps/h1?version=0');
}

const START_Y = 50000; // an exact multiple of BAND_SIZE_PX, comfortably below worldHeight
const PLACEMENT_COUNT = LIVE_ZONE_MAX_BANDS + 1; // 78 — the minimum to force exactly one freeze

/**
 * Climb the summit upward one band at a time (each placement 20px = one
 * BAND_SIZE_PX above the last), landing in a brand-new, previously-empty band
 * every time, until the live band count exceeds LIVE_ZONE_MAX_BANDS and a
 * freeze genuinely fires on the final placement. ghostPointCount: 0 isolates
 * band creation to exactly one band per placement, no ghost noise.
 */
async function driveToFreeze(): Promise<MockHeapDB> {
  const db = new MockHeapDB();
  await db.createHeap('h1', 'b1', [{ x: 480, y: START_Y }], 'hash', NOW, {
    ...DEFAULT_HEAP_PARAMS,
    worldHeight: 60000,
    ghostPointCount: 0,
  });
  for (let i = 0; i < PLACEMENT_COUNT; i++) {
    const y = START_Y - i * BAND_SIZE_PX;
    const res = await place(db, 480, y);
    const body = (await res.json()) as PlaceResponse;
    expect(body.accepted).toBe(true);
  }
  return db;
}

describe('freeze partition invariant', () => {
  it('every recorded band is live XOR frozen once a real freeze has fired', async () => {
    const db = await driveToFreeze();

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

  it('GET /heaps/:id serves a live zone with no frozen bands, through the real materialiseLiveZone path', async () => {
    // This is the dedicated regression guard for materialiseLiveZone
    // specifically (server/src/routes/heap.ts:138-151): a prior claim that
    // liveZoneRebuild.test.ts / bandBlobEquivalence.test.ts / the other test
    // in this file covered it was WRONG — none of those ever drive freeze_y
    // above 0 before reading through GET, so under the freeze_y>0 sentinel
    // `freezeBand` never leaves Infinity there and every band passes the
    // filter regardless of its comparison direction. This test is the one
    // that actually exercises the corrected direction: freeze fires first,
    // THEN the heap is read through the real GET /heaps/:id route, which is
    // the only path that calls materialiseLiveZone with a non-trivial
    // freezeBand.
    const db = await driveToFreeze();
    const row = await db.getHeapFresh('h1');
    expect(row).not.toBeNull();
    expect(row!.freeze_y).toBeGreaterThan(0); // freeze genuinely fired, again, before trusting GET

    const freezeBand = bandOf(row!.freeze_y);
    const baseVertices = (await db.getBaseVerticesById(row!.base_id)) ?? [];
    const baseBands = verticesToEnvelope(baseVertices);
    // Sanity on the fixture itself: there must be at least one genuinely
    // frozen band to prove absent from the served liveZone below — otherwise
    // the "no frozen band leaks through" assertion would pass vacuously.
    expect(baseBands.size).toBeGreaterThan(0);
    const aFrozenBand = [...baseBands.keys()][0];

    const getRes = await getHeap(db);
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as Extract<GetHeapResponse, { changed: true }>;
    expect(body.changed).toBe(true);

    const servedBands = body.liveZone.map((v) => bandOf(v.y));

    // No frozen band may appear in what a client receives. This is the
    // direction of the inversion under test: the buggy `band >= freezeBand`
    // filter would serve exactly the frozen base here instead of the live
    // zone.
    for (const b of servedBands) {
      expect(b).toBeLessThan(freezeBand);
    }

    // Two-sided: the served set must be non-empty and include the summit
    // band (a test that passed by serving nothing would be worthless)...
    expect(servedBands.length).toBeGreaterThan(0);
    const summitBand = bandOf(row!.top_y);
    expect(servedBands).toContain(summitBand);

    // ...AND at least one band that IS frozen must be absent from what was
    // served. Without this half, a served set of "everything" (the base
    // filter direction bug) would still slip past the "no frozen band"
    // check above only by coincidence of which bands happen to be included;
    // this pins down that the frozen band is actively excluded, not just
    // that none of the ones we checked matched.
    expect(servedBands).not.toContain(aFrozenBand);
  });
});

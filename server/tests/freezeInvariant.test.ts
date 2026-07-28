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
import { bandOf, verticesToEnvelope, BAND_SIZE_PX, wireToBands } from '../../shared/heapPolygon/bandEnvelope';
import { LIVE_ZONE_MAX_BANDS, FREEZE_BATCH_BANDS } from '../src/polygon';

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
async function climb(db: MockHeapDB, fromIndex: number, count: number): Promise<void> {
  for (let i = fromIndex; i < fromIndex + count; i++) {
    const y = START_Y - i * BAND_SIZE_PX;
    const res = await place(db, 480, y);
    const body = (await res.json()) as PlaceResponse;
    expect(body.accepted).toBe(true);
  }
}

/** Every band `climb` has touched after `count` placements from index 0 — the
 *  ground truth the live rows and the base blob must partition between them. */
function bandsEverPlaced(count: number): Set<number> {
  return new Set(Array.from({ length: count }, (_, i) => bandOf(START_Y - i * BAND_SIZE_PX)));
}

async function driveToFreeze(): Promise<MockHeapDB> {
  const db = new MockHeapDB();
  await db.createHeap('h1', 'b1', [{ x: 480, y: START_Y }], 'hash', NOW, {
    ...DEFAULT_HEAP_PARAMS,
    worldHeight: 60000,
    ghostPointCount: 0,
  });
  await climb(db, 0, PLACEMENT_COUNT);
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
    // Freeze DELETES the rows it buries, in the same transaction that advances
    // the freeze line, so heap_band holds only the live set afterwards. One
    // freeze shed exactly FREEZE_BATCH_BANDS rows.
    expect(allBands.length).toBe(PLACEMENT_COUNT - FREEZE_BATCH_BANDS);

    const baseVertices = (await db.getBaseVerticesById(row!.base_id)) ?? [];
    const baseBands = verticesToEnvelope(baseVertices);

    // The partition invariant itself, now that the two halves live in two
    // different places: every band the heap has ever recorded is a surviving
    // row XOR present in the base envelope — never both, never neither.
    // Checking it against `bandsEverPlaced` rather than against the rows alone
    // is what makes deletion safe to assert: a delete that dropped geometry
    // WITHOUT the base absorbing it leaves a band in neither set, and only the
    // independent ground truth can see that.
    const rowBands = new Set(allBands.map((b) => b.band));
    for (const b of rowBands) expect(baseBands.has(b)).toBe(false);
    expect(new Set([...rowBands, ...baseBands.keys()])).toEqual(bandsEverPlaced(PLACEMENT_COUNT));

    // And the split falls exactly on the freeze line, in both directions.
    for (const b of rowBands) expect(b).toBeLessThan(freezeBand);
    for (const b of baseBands.keys()) expect(b).toBeGreaterThanOrEqual(freezeBand);

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
    // Asserting on the status, not on accepted:false — the band at freeze_y no
    // longer has a row (the freeze deleted it), so a gate that wrongly let this
    // through would now WIDEN a resurrected frozen band and report
    // accepted:true. Only the 400 proves the gate held.
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

  it('freezes repeatedly, keeping the live band count bounded forever', async () => {
    // The guard for the bug every other test in this file missed: they all
    // drive exactly ONE freeze, and the first freeze fires correctly under
    // either comparison direction (freeze_y is still 0, so the sentinel admits
    // every band whichever way the filter points). checkFreezeBands takes
    // *every* recorded band — freeze deletes no rows — so an inverted filter
    // selects the already-frozen batch instead of the live set, whose count
    // can never exceed the limit. Freeze then fires exactly once per heap for
    // its entire lifetime while the live zone grows without bound, which is
    // the one thing this whole feature exists to prevent.
    const db = await driveToFreeze();
    const first = await db.getHeapFresh('h1');
    expect(first!.freeze_y).toBeGreaterThan(0);

    // Keep climbing well past the point where a second, third and fourth
    // freeze are due, asserting the bound after EVERY placement — not just at
    // the end — so a freeze that stalls is caught at the placement it stalled
    // on rather than 100 placements later.
    const freezeLines: number[] = [first!.freeze_y];
    let placements = PLACEMENT_COUNT;
    for (let i = PLACEMENT_COUNT; i < PLACEMENT_COUNT + 4 * FREEZE_BATCH_BANDS; i++) {
      await climb(db, i, 1);
      placements++;
      const row = await db.getHeapFresh('h1');
      const freezeBand = row!.freeze_y > 0 ? bandOf(row!.freeze_y) : Infinity;
      const allBands = await db.getAllBands('h1');
      // The ROW COUNT is the bound that matters, and it is the one the CPU
      // dashboard cares about: every read pays for every surviving row, so a
      // live set that stays bounded while dead rows pile up behind it is not a
      // bounded read path. Asserting on the unfiltered table — not on the
      // filtered view — is what pins the deletion in place.
      expect(allBands.length).toBeLessThanOrEqual(LIVE_ZONE_MAX_BANDS);
      expect(allBands.filter((b) => b.band < freezeBand).length).toBe(allBands.length);
      // Nothing is lost while the table shrinks: rows plus base still account
      // for every band ever placed, after every single placement.
      const baseBands = verticesToEnvelope((await db.getBaseVerticesById(row!.base_id)) ?? []);
      expect(new Set([...allBands.map((b) => b.band), ...baseBands.keys()]))
        .toEqual(bandsEverPlaced(placements));
      if (row!.freeze_y !== freezeLines[freezeLines.length - 1]) freezeLines.push(row!.freeze_y);
    }

    // Freeze fired more than once, and each line advanced toward the summit
    // (lower y) — the frozen region only ever grows downward-inclusive.
    expect(freezeLines.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < freezeLines.length; i++) {
      expect(freezeLines[i]).toBeLessThan(freezeLines[i - 1]);
    }

    // Every freeze minted a fresh baseId (loadCachedBase caches base vertices
    // by baseId with no TTL, so a reused id strands clients on a stale base),
    // and the partition stays exact after all of them.
    const row = await db.getHeapFresh('h1');
    expect(row!.base_id).not.toBe(first!.base_id);

    const freezeBand = bandOf(row!.freeze_y);
    const allBands = await db.getAllBands('h1');
    const baseBands = verticesToEnvelope((await db.getBaseVerticesById(row!.base_id)) ?? []);
    for (const b of allBands) {
      expect(b.band < freezeBand).toBe(!baseBands.has(b.band));
    }

    // The base absorbed every band the successive freezes shed — nothing was
    // dropped on the floor between epochs. Each epoch's base concatenates the
    // previous one, so this counts across ALL four freezes, not just the last.
    expect(baseBands.size).toBe(placements - allBands.length);

    // And the summit is still live and still reachable.
    const summitBand = bandOf(row!.top_y);
    expect(summitBand).toBeLessThan(freezeBand);
  });

  it('bounds what a read costs, not just what a read serves', async () => {
    // The distinct property freeze-time deletion adds. Before it, freeze bounded
    // the live SET while heap_band grew forever: a staging fixture ended a load
    // test with 65 live rows and 283 frozen ones, and getAllBands returned all
    // 348 on every request — 5.4x the necessary band data, carried through the
    // KV snapshot and JSON-parsed per read, growing with heap age without limit.
    // P99 CPU breached the 10ms free-tier cap at that size.
    //
    // The bound asserted here is on the unfiltered table, which is what the read
    // path actually pays for. The other tests in this file would all still pass
    // with the deletion reverted.
    const db = await driveToFreeze();
    for (let i = PLACEMENT_COUNT; i < PLACEMENT_COUNT + 5 * FREEZE_BATCH_BANDS; i++) {
      await climb(db, i, 1);
    }
    const placements = PLACEMENT_COUNT + 5 * FREEZE_BATCH_BANDS;

    const rows = await db.getAllBands('h1');
    expect(rows.length).toBeLessThanOrEqual(LIVE_ZONE_MAX_BANDS);
    // Two-sided: the table must be far smaller than the climb, or the assertion
    // above could pass on a heap that simply never grew.
    expect(placements).toBeGreaterThan(2 * LIVE_ZONE_MAX_BANDS);

    // Every band the deletion removed is readable from the base blob instead —
    // the geometry moved, it did not vanish.
    const row = await db.getHeapFresh('h1');
    const baseBands = verticesToEnvelope((await db.getBaseVerticesById(row!.base_id)) ?? []);
    expect(new Set([...rows.map((b) => b.band), ...baseBands.keys()]))
      .toEqual(bandsEverPlaced(placements));

    // And the base the heap points at is the one holding them — a deletion that
    // committed against a base the heap was never repointed to would satisfy
    // every set assertion above while stranding the geometry.
    expect(baseBands.size).toBeGreaterThan(0);
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

  it('a full response never resends frozen bands, and bands/liveZone describe the same band set', async () => {
    // Regression guard: the full response used to build its `bands` field from
    // db.getAllBands() unfiltered — every band ever recorded, including bands
    // already folded into the base blob at freeze time. Since the client caches
    // that base blob indefinitely by baseId, frozen geometry was traveling
    // twice: once in the base, once in every subsequent full response's
    // `bands`. This asserts `bands` is filtered to the live set exactly like
    // `liveZone` already is.
    const db = await driveToFreeze();
    const row = await db.getHeapFresh('h1');
    expect(row).not.toBeNull();
    // Freeze must have genuinely fired before trusting anything below, or this
    // test would pass vacuously (freezeBand === Infinity admits everything).
    expect(row!.freeze_y).toBeGreaterThan(0);

    const freezeBand = bandOf(row!.freeze_y);
    // Frozen bands come from the BASE now, not from a filter over heap_band —
    // their rows are deleted at freeze time, so the old
    // `getAllBands().filter(band >= freezeBand)` would be empty here and every
    // assertion below it would pass vacuously.
    const frozenBands = [...verticesToEnvelope((await db.getBaseVerticesById(row!.base_id)) ?? []).keys()];
    // Sanity on the fixture: at least one band must actually be frozen, or the
    // "no frozen band leaks through" assertion below would pass by omission.
    expect(frozenBands.length).toBeGreaterThan(0);

    const getRes = await getHeap(db);
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as Extract<GetHeapResponse, { changed: true }>;
    expect(body.changed).toBe(true);
    expect(body.mode).toBe('full');
    if (!(body.changed && body.mode === 'full')) throw new Error('expected a full response');

    const servedBandNumbers = wireToBands(body.bands).map((b) => b.band);
    // No frozen band may appear in `bands`.
    for (const b of servedBandNumbers) {
      expect(b).toBeLessThan(freezeBand);
    }
    // ...AND at least one genuinely-frozen band is actively excluded, not just
    // coincidentally absent from a served set that happened to include none of
    // the ones checked.
    for (const fb of frozenBands) {
      expect(servedBandNumbers).not.toContain(fb);
    }

    // bands and liveZone must describe the SAME band set — the coherent
    // contract this fix establishes. liveZone is band-mid-y vertices; recover
    // each vertex's band and compare the two sets (order-independent).
    const liveZoneBandNumbers = [...new Set(body.liveZone.map((v) => bandOf(v.y)))].sort((a, b) => a - b);
    const servedBandSet = [...new Set(servedBandNumbers)].sort((a, b) => a - b);
    expect(servedBandSet).toEqual(liveZoneBandNumbers);
  });

  it('folds a straggler into the base on the next freeze', async () => {
    // A straggler is a band the previous freeze deliberately spared: written
    // concurrently, so stamped above that freeze's watermark, so excluded from
    // the DELETE because the base it was building never captured it. It sits
    // below the freeze line — invisible to every live filter — and would be
    // stranded there forever if the next freeze only ever folded in its own
    // fresh slice. The base source is `band >= newFreezeBand`, deliberately
    // wider than the frozen slice, precisely to collect it.
    const db = await driveToFreeze();
    const afterFirst = (await db.getHeapFresh('h1'))!;
    expect(afterFirst.freeze_y).toBeGreaterThan(0); // freeze genuinely fired

    // Inject exactly what a concurrent mid-freeze placement leaves behind: a row
    // below the freeze line, stamped at the current heap version (which is above
    // the watermark that freeze captured).
    const firstFreezeBand = bandOf(afterFirst.freeze_y);
    const stragglerBand = firstFreezeBand + 5;
    await db.upsertBands('h1', [{ band: stragglerBand, minX: 100, maxX: 900 }], afterFirst.version);

    // It is genuinely invisible: below the line, so no live consumer sees it.
    expect((await db.getAllBands('h1')).some((b) => b.band === stragglerBand)).toBe(true);
    expect(stragglerBand).toBeGreaterThanOrEqual(firstFreezeBand);

    // Climb until a SECOND freeze fires.
    await climb(db, PLACEMENT_COUNT, FREEZE_BATCH_BANDS + 1);
    const afterSecond = (await db.getHeapFresh('h1'))!;
    expect(afterSecond.freeze_y).toBeLessThan(afterFirst.freeze_y); // line advanced
    expect(afterSecond.base_id).not.toBe(afterFirst.base_id);

    // The straggler's geometry is now in the base, at its real extents...
    const baseBands = verticesToEnvelope((await db.getBaseVerticesById(afterSecond.base_id)) ?? []);
    expect(baseBands.get(stragglerBand)).toMatchObject({ minX: 100, maxX: 900 });

    // ...and its row is gone, because this freeze's watermark DID capture it.
    expect((await db.getAllBands('h1')).some((b) => b.band === stragglerBand)).toBe(false);
  });
});

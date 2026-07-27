// server/tests/placeEnvelope.test.ts
//
// /place accepts a placement only when it widens its 20px band — the same
// predicate the client renders by. Replaces the whole-polygon ray cast, which
// tested a y-sorted zigzag ring that did not describe the rendered shape.

import { describe, it, expect, vi } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { DEFAULT_HEAP_PARAMS, type PlaceResponse } from '../../shared/heapTypes';

const NOW = new Date().toISOString();

async function heapWith(bands: { band: number; minX: number; maxX: number }[], topY = 47000) {
  const db = new MockHeapDB();
  await db.createHeap('h1', 'b1', [{ x: 480, y: 50000 }], 'hash', NOW, {
    ...DEFAULT_HEAP_PARAMS,
    worldHeight: 50000,
    ghostPointCount: 0,   // isolate the placement from ghost noise
  });
  await db.updateHeap('h1', 'b1', 1, [], 0, topY);
  if (bands.length) await db.upsertBands('h1', bands, 1);
  return db;
}

function place(db: MockHeapDB, body: unknown) {
  return createApp(db, new MockScoreDB()).request('/heaps/h1/place', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /heaps/:id/place — envelope containment', () => {
  it('accepts a placement that widens its band to the left', async () => {
    const db = await heapWith([{ band: 2350, minX: 400, maxX: 500 }]);
    const res = await place(db, { x: 399, y: 47010 });
    expect(((await res.json()) as PlaceResponse).accepted).toBe(true);
  });

  it('accepts a placement that widens its band to the right', async () => {
    const db = await heapWith([{ band: 2350, minX: 400, maxX: 500 }]);
    const res = await place(db, { x: 501, y: 47010 });
    expect(((await res.json()) as PlaceResponse).accepted).toBe(true);
  });

  it('rejects a placement strictly inside its band extents', async () => {
    const db = await heapWith([{ band: 2350, minX: 400, maxX: 500 }]);
    const res = await place(db, { x: 450, y: 47010 });
    expect(((await res.json()) as PlaceResponse).accepted).toBe(false);
  });

  it('rejects a placement exactly on an extent', async () => {
    const db = await heapWith([{ band: 2350, minX: 400, maxX: 500 }]);
    const res = await place(db, { x: 400, y: 47010 });
    expect(((await res.json()) as PlaceResponse).accepted).toBe(false);
  });

  it('accepts into an empty band', async () => {
    // band 2351 is empty (only 2350 is seeded). liveZoneBottomY = (2350+1)*20 =
    // 47020, and the active-zone gate is inclusive at the boundary (y > bottomY
    // rejects), so 47020 is the one y in band 2351 that is both empty and still
    // within the active zone.
    const db = await heapWith([{ band: 2350, minX: 400, maxX: 500 }]);
    const res = await place(db, { x: 450, y: 47020 }); // band 2351
    expect(((await res.json()) as PlaceResponse).accepted).toBe(true);
  });

  it('persists the accepted placement into its band', async () => {
    const db = await heapWith([{ band: 2350, minX: 400, maxX: 500 }]);
    await place(db, { x: 380, y: 47010 });
    expect(await db.getBand('h1', 2350)).toEqual({ band: 2350, minX: 380, maxX: 500 });
  });

  it('does not widen the band for a rejected placement', async () => {
    const db = await heapWith([{ band: 2350, minX: 400, maxX: 500 }]);
    await place(db, { x: 450, y: 47010 });
    expect(await db.getBand('h1', 2350)).toEqual({ band: 2350, minX: 400, maxX: 500 });
  });

  it('gates on the active zone using band granularity', async () => {
    // Highest occupied band is 2350, so liveZoneBottomY = (2350 + 1) * 20 = 47020.
    const db = await heapWith([{ band: 2350, minX: 400, maxX: 500 }]);
    const inZone = await place(db, { x: 380, y: 47019 });
    expect(inZone.status).toBe(200);
    const belowZone = await place(db, { x: 380, y: 47021 });
    expect(belowZone.status).toBe(400);
  });

  it('scatters a ghost into a band far from the placement (anti-clustering regression)', async () => {
    // Ghosts must anchor on a random OCCUPIED band's edge, not on this
    // request's own placement/earlier ghosts — otherwise growth clusters
    // within GHOST_JITTER_RADIUS_PX of wherever the player clicked instead of
    // scattering across the live zone the way it does on main. This proves a
    // ghost can land many bands away from the placement's own band.
    const db = new MockHeapDB();
    await db.createHeap('h1', 'b1', [{ x: 480, y: 50000 }], 'hash', NOW, {
      ...DEFAULT_HEAP_PARAMS,
      worldHeight: 50000,
      ghostPointCount: 8,
    });
    // freeze_y = 0 -> freezeBand = 0, the bottom of the sampling range.
    await db.updateHeap('h1', 'b1', 1, [], 0, 47000);

    // One occupied band at the TOP of the live range (maxBand), far from
    // where we're about to place.
    const FAR_BAND = 2400; // y in [48000, 48020)
    await db.upsertBands('h1', [{ band: FAR_BAND, minX: 400, maxX: 500 }], 1);

    const PLACEMENT_BAND = 2350; // y in [47000, 47020) -- 50 bands below FAR_BAND
    const placementY = PLACEMENT_BAND * 20 + 10;

    // Deterministic Math.random() sequence. Each ghost draws 4 values in
    // order: (1) sampledBand pick, (2) minX-vs-maxX edge pick, (3) dx jitter,
    // (4) dy jitter. Force every ghost onto FAR_BAND's maxX edge with zero
    // jitter on y (stays mid-band) and +40px jitter on x (provably widens the
    // band rather than just re-touching its existing extent).
    //
    // Ghosts sample from [summitBand, liveBottomBand], not [freezeBand,
    // maxBand] — the live range trails the summit, not the whole occupied
    // history. summitBand = bandOf(top_y=47000) = 2350. freeze_y=0 so
    // liveZoneBottomY falls back to the maxBand branch: maxBand=FAR_BAND=2400,
    // so liveZoneBottomY=(2400+1)*20=48020 -> liveBottomBand=2401. Range size
    // = 2401-2350+1 = 52.
    //   floor(R * 52) = 50 (2400-2350)  <=>  R in [50/52, 51/52)   -> R = 0.97
    //   R < 0.5 ? minX : maxX = maxX                                -> R = 0.9
    //   dx = (R*2-1)*80 = 40                                        -> R = 0.75
    //   dy = (R*2-1)*80 = 0                                          -> R = 0.5
    const sequence = [0.97, 0.9, 0.75, 0.5];
    let call = 0;
    const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => sequence[call++ % sequence.length]);
    let res: Awaited<ReturnType<typeof place>>;
    try {
      res = await place(db, { x: 450, y: placementY });
    } finally {
      randomSpy.mockRestore(); // always restore, even if the request throws
    }

    expect(((await res.json()) as PlaceResponse).accepted).toBe(true);

    // FAR_BAND's maxX must have widened from the seeded 500 to 540 — proof a
    // ghost actually landed there, not just that the pre-seeded row exists.
    expect(await db.getBand('h1', FAR_BAND)).toEqual({ band: FAR_BAND, minX: 400, maxX: 540 });

    // And FAR_BAND is unambiguously far from the placement's own band, well
    // outside the "own band ± 2" neighborhood the old vertex-anchored
    // implementation was confined to.
    expect(Math.abs(FAR_BAND - PLACEMENT_BAND)).toBeGreaterThan(2);
  });
});

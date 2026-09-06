// server/tests/placeEnvelope.test.ts
//
// /place accepts a placement only when it widens its 20px band — the same
// predicate the client renders by. Replaces the whole-polygon ray cast, which
// tested a y-sorted zigzag ring that did not describe the rendered shape.

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { DEFAULT_HEAP_PARAMS, type PlaceResponse } from '../../shared/heapTypes';
import { GHOST_SPREAD_BANDS } from '../src/game/routes/heap';

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

  it('keeps every ghost within GHOST_SPREAD_BANDS of the placement, never touching a distant band', async () => {
    // Ghosts anchor on THIS placement, so growth thickens the heap where the
    // player built. This replaces an earlier test that asserted the opposite —
    // ghosts anchored on a randomly sampled band across the whole live zone.
    // That scatter had two measured failures: it carried the sampled band's x
    // into a band up to GHOST_SPREAD_BANDS away, producing a sawtooth
    // silhouette, and since a ghost anchors on a band's own extreme and jitters
    // outward under a MIN/MAX write, every band it hit stepped monotonically
    // wider forever, converging on a featureless full-width column.
    //
    // Math.random is deliberately NOT mocked: the locality bound must hold for
    // every draw, not one hand-picked sequence, so a high ghost count over real
    // randomness is the stronger assertion.
    const db = new MockHeapDB();
    await db.createHeap('h1', 'b1', [{ x: 480, y: 50000 }], 'hash', NOW, {
      ...DEFAULT_HEAP_PARAMS,
      worldHeight: 50000,
      ghostPointCount: 40,
    });
    await db.updateHeap('h1', 'b1', 1, [], 0, 47000);

    // An occupied band far from where we place. No ghost may reach it.
    const FAR_BAND = 2400;
    await db.upsertBands('h1', [{ band: FAR_BAND, minX: 400, maxX: 500 }], 1);

    const PLACEMENT_BAND = 2350;
    const before = await db.getAllBands('h1');
    const res = await place(db, { x: 450, y: PLACEMENT_BAND * 20 + 10 });
    expect(((await res.json()) as PlaceResponse).accepted).toBe(true);

    // The distant band is untouched — the scatter is genuinely gone.
    expect(await db.getBand('h1', FAR_BAND)).toEqual({ band: FAR_BAND, minX: 400, maxX: 500 });
    expect(Math.abs(FAR_BAND - PLACEMENT_BAND)).toBeGreaterThan(GHOST_SPREAD_BANDS);

    // And every band this placement created or changed is inside the spread.
    const beforeByBand = new Map(before.map((b) => [b.band, b]));
    const changed = (await db.getAllBands('h1')).filter((b) => {
      const prev = beforeByBand.get(b.band);
      return !prev || prev.minX !== b.minX || prev.maxX !== b.maxX;
    });
    expect(changed.length).toBeGreaterThan(0); // not vacuous
    for (const b of changed) {
      expect(Math.abs(b.band - PLACEMENT_BAND)).toBeLessThanOrEqual(GHOST_SPREAD_BANDS);
    }
  });
});

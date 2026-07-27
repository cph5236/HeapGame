// server/tests/bandSeedingRoute.test.ts
//
// End-to-end guard for write-time band seeding through the real /place route:
// a placement into an empty band between two known bands must be STORED with an
// interpolated opposite side, not as a single point. The pure logic is covered in
// shared/__tests__/bandSeeding.test.ts; this pins the wiring — that /place reads
// the current envelope and passes it to seedNewBands before committing.

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { DEFAULT_HEAP_PARAMS, type PlaceResponse } from '../../shared/heapTypes';
import { BAND_SIZE_PX } from '../../shared/heapPolygon/bandEnvelope';

const NOW = new Date().toISOString();
const B = 2000;                 // working band index
const Y = (band: number) => band * BAND_SIZE_PX;

async function place(db: MockHeapDB, x: number, y: number) {
  const res = await createApp(db, new MockScoreDB()).request('/heaps/h1/place', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x, y }),
  });
  return { status: res.status, body: (await res.json()) as PlaceResponse };
}

/**
 * ghostPointCount 0 so every stored band comes from an explicit placement.
 *
 * Built bottom-up: the active-zone gate rejects any y below (maxBand + 1) *
 * BAND_SIZE_PX, so the lower band (B+2) must be populated before the higher one
 * (B) — the same direction real play grows in.
 */
async function heapWithTwoExtentNeighbours(): Promise<MockHeapDB> {
  const db = new MockHeapDB();
  await db.createHeap('h1', 'b1', [{ x: 480, y: Y(B + 2) }], 'hash', NOW, {
    ...DEFAULT_HEAP_PARAMS,
    worldHeight: 60000,
    ghostPointCount: 0,
  });
  // Two distinct x in each of bands B+2 then B — the seed sources. Band B+1 is
  // deliberately skipped: it is the empty in-between band under test.
  for (const [x, band] of [[200, B + 2], [600, B + 2], [300, B], [500, B]] as const) {
    expect((await place(db, x, Y(band))).body.accepted).toBe(true);
  }
  return db;
}

describe('write-time band seeding via POST /heaps/:id/place', () => {
  it('stores an interpolated opposite side for a new in-between band', async () => {
    const db = await heapWithTwoExtentNeighbours();
    expect(await db.getBand('h1', B)).toMatchObject({ minX: 300, maxX: 500 });
    expect(await db.getBand('h1', B + 2)).toMatchObject({ minX: 200, maxX: 600 });

    // A single point into the empty band between them. Halfway, so the seed is
    // the midpoint of each side: 250..550.
    expect((await place(db, 350, Y(B + 1))).body.accepted).toBe(true);

    const seeded = await db.getBand('h1', B + 1);
    expect(seeded).toMatchObject({ minX: 250, maxX: 550 });
    // The whole point: two distinct extents, so the renderer no longer has to
    // guess a side and forward-fill the other.
    expect(seeded!.minX).not.toBe(seeded!.maxX);
  });

  it('keeps the placed x when it falls outside the interpolated span', async () => {
    const db = await heapWithTwoExtentNeighbours();
    // x=120 is left of the interpolated minX (250), so it must win on that side
    // while the seed still supplies the unknown right side.
    expect((await place(db, 120, Y(B + 1))).body.accepted).toBe(true);
    expect(await db.getBand('h1', B + 1)).toMatchObject({ minX: 120, maxX: 550 });
  });

  it('does not seed a new summit band — the heap keeps tapering to a point', async () => {
    const db = await heapWithTwoExtentNeighbours();
    // Band B-1 is above everything: no two-extent neighbour above it, so no
    // interpolation. Seeding from the band below alone would make each new
    // summit band as wide as the one under it, growing a flat-topped column.
    expect((await place(db, 350, Y(B - 1))).body.accepted).toBe(true);
    const summit = await db.getBand('h1', B - 1);
    expect(summit).toMatchObject({ minX: 350, maxX: 350 });
  });

  it('does not touch a band that already has real geometry', async () => {
    const db = await heapWithTwoExtentNeighbours();
    // Band B already spans 300..500. A placement widening it must widen by
    // exactly the placed x — no interpolated value may bleed in.
    expect((await place(db, 700, Y(B))).body.accepted).toBe(true);
    expect(await db.getBand('h1', B)).toMatchObject({ minX: 300, maxX: 700 });
  });
});

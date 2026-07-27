import { describe, it, expect } from 'vitest';
import {
  interpolateBandSeed, seedNewBands, type BandEnvelope, type BandRow,
} from '../heapPolygon/bandEnvelope';

function env(rows: BandRow[]): BandEnvelope {
  return new Map(rows.map((r) => [r.band, { minX: r.minX, maxX: r.maxX }]));
}

describe('interpolateBandSeed', () => {
  it('interpolates both extents between the nearest two-extent neighbours', () => {
    // The worked example from the proposal: band 2 is new, between 1 and 3.
    const seed = interpolateBandSeed(env([
      { band: 1, minX: 30, maxX: 150 },
      { band: 3, minX: 20, maxX: 175 },
    ]), 2);
    expect(seed).toEqual({ minX: 25, maxX: 162.5 });
  });

  it('weights by band distance, not evenly', () => {
    // Band 8 is 3/4 of the way from 5 to 9.
    const seed = interpolateBandSeed(env([
      { band: 5, minX: 100, maxX: 200 },
      { band: 9, minX: 200, maxX: 600 },
    ]), 8)!;
    expect(seed.minX).toBeCloseTo(175);
    expect(seed.maxX).toBeCloseTo(500);
  });

  it('returns null with no neighbour above — a new summit band stays a point', () => {
    // Seeding from the band below alone would make every new summit band as wide
    // as the one beneath it, growing a flat-topped column instead of a taper.
    expect(interpolateBandSeed(env([
      { band: 10, minX: 100, maxX: 300 },
      { band: 11, minX: 90, maxX: 310 },
    ]), 9)).toBeNull();
  });

  it('returns null with no neighbour below', () => {
    expect(interpolateBandSeed(env([
      { band: 9, minX: 100, maxX: 300 },
      { band: 10, minX: 90, maxX: 310 },
    ]), 11)).toBeNull();
  });

  it('skips single-extent neighbours rather than propagating their guess', () => {
    // Band 6 is single-extent: its own opposite side is unknown. Interpolating
    // from it would spread that unknown instead of resolving it, so the search
    // passes over it to band 5.
    const seed = interpolateBandSeed(env([
      { band: 5, minX: 100, maxX: 200 },
      { band: 6, minX: 640, maxX: 640 },
      { band: 8, minX: 100, maxX: 200 },
    ]), 7)!;
    expect(seed).toEqual({ minX: 100, maxX: 200 });
  });

  it('returns null when every neighbour is single-extent', () => {
    expect(interpolateBandSeed(env([
      { band: 5, minX: 640, maxX: 640 },
      { band: 7, minX: 120, maxX: 120 },
    ]), 6)).toBeNull();
  });

  it('ignores an existing row at the target band itself', () => {
    // Guards against the band seeding itself into a no-op.
    const seed = interpolateBandSeed(env([
      { band: 1, minX: 30, maxX: 150 },
      { band: 2, minX: 500, maxX: 900 },
      { band: 3, minX: 20, maxX: 175 },
    ]), 2);
    expect(seed).toEqual({ minX: 25, maxX: 162.5 });
  });
});

describe('seedNewBands', () => {
  const existing = env([
    { band: 1, minX: 30, maxX: 150 },
    { band: 3, minX: 20, maxX: 175 },
  ]);

  it('fills the unknown side of a new band, keeping the placed x on its own side', () => {
    // Placed at x=25, left of the interpolated 25..162.5 — minX stays the placed
    // value, maxX comes from the seed. This is the proposal's worked example.
    expect(seedNewBands([{ band: 2, minX: 25, maxX: 25 }], existing))
      .toEqual([{ band: 2, minX: 25, maxX: 162.5 }]);
  });

  it('lets the placed x win when it falls outside the seed on either side', () => {
    expect(seedNewBands([{ band: 2, minX: 5, maxX: 5 }], existing))
      .toEqual([{ band: 2, minX: 5, maxX: 162.5 }]);
    expect(seedNewBands([{ band: 2, minX: 400, maxX: 400 }], existing))
      .toEqual([{ band: 2, minX: 25, maxX: 400 }]);
  });

  it('never narrows a row — a placement inside the seed keeps the full span', () => {
    const [out] = seedNewBands([{ band: 2, minX: 100, maxX: 100 }], existing);
    expect(out.minX).toBeLessThanOrEqual(25);
    expect(out.maxX).toBeGreaterThanOrEqual(162.5);
  });

  it('leaves a new band alone when its own candidates already gave it two extents', () => {
    // Several candidates landed in this new band, so both sides are observed.
    // Widening it to the interpolated span would fabricate geometry past what
    // was actually placed — there is no unknown side left to fill.
    const rows: BandRow[] = [{ band: 2, minX: 100, maxX: 140 }];
    expect(seedNewBands(rows, existing)).toEqual(rows);
  });

  it('leaves rows for already-occupied bands untouched', () => {
    // Band 1 has real extents; seeding it would fabricate geometry over
    // observed geometry.
    const rows: BandRow[] = [{ band: 1, minX: 40, maxX: 40 }];
    expect(seedNewBands(rows, existing)).toEqual(rows);
  });

  it('passes a new band through unchanged when it cannot be interpolated', () => {
    const rows: BandRow[] = [{ band: 0, minX: 44, maxX: 44 }];
    expect(seedNewBands(rows, existing)).toEqual(rows);
  });

  it('seeds each new band independently from the pre-existing envelope', () => {
    // Two new bands in one placement: neither may be seeded from the other's
    // freshly-invented extents, only from the bands that were already stored.
    const out = seedNewBands(
      [{ band: 2, minX: 25, maxX: 25 }, { band: 4, minX: 300, maxX: 300 }],
      existing,
    );
    expect(out[0]).toEqual({ band: 2, minX: 25, maxX: 162.5 });
    // Band 4 is above band 3 with nothing beyond it — no pair, so unchanged.
    expect(out[1]).toEqual({ band: 4, minX: 300, maxX: 300 });
  });
});

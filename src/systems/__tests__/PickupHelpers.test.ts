import { describe, it, expect } from 'vitest';
import { shouldSpawnPickup, findNearestInRange, surfaceSpawnCandidates } from '../PickupHelpers';

describe('shouldSpawnPickup', () => {
  const MIN_GAP = 600;

  it('spawns when there is no prior pickup and chance allows', () => {
    expect(shouldSpawnPickup(0.1, null, 5000, MIN_GAP, 0.5)).toBe(true);
  });

  it('never spawns when chance is 0', () => {
    expect(shouldSpawnPickup(0.0, null, 5000, MIN_GAP, 0)).toBe(false);
  });

  it('always spawns when chance is 1 and gap is satisfied', () => {
    expect(shouldSpawnPickup(0.999, 6000, 5000, MIN_GAP, 1)).toBe(true);
  });

  it('refuses to spawn when too close to the last pickup', () => {
    // gap = |5300 - 5000| = 300 < 600 minimum
    expect(shouldSpawnPickup(0.0, 5300, 5000, MIN_GAP, 1)).toBe(false);
  });

  it('honours the chance roll when the gap is satisfied', () => {
    expect(shouldSpawnPickup(0.6, 6000, 5000, MIN_GAP, 0.5)).toBe(false); // 0.6 >= 0.5
    expect(shouldSpawnPickup(0.4, 6000, 5000, MIN_GAP, 0.5)).toBe(true);  // 0.4 < 0.5
  });
});

describe('findNearestInRange', () => {
  const range = 100;

  it('returns -1 when no pickups are in range', () => {
    const pickups = [{ x: 500, y: 500, collected: false }];
    expect(findNearestInRange(0, 0, pickups, range)).toBe(-1);
  });

  it('returns the index of the nearest in-range pickup', () => {
    const pickups = [
      { x: 80, y: 0, collected: false },  // dist 80
      { x: 30, y: 0, collected: false },  // dist 30 (nearest)
      { x: 600, y: 0, collected: false }, // out of range
    ];
    expect(findNearestInRange(0, 0, pickups, range)).toBe(1);
  });

  it('skips collected pickups even if nearer', () => {
    const pickups = [
      { x: 10, y: 0, collected: true },   // nearest but collected
      { x: 50, y: 0, collected: false },
    ];
    expect(findNearestInRange(0, 0, pickups, range)).toBe(1);
  });
});

describe('surfaceSpawnCandidates', () => {
  // A simple closed band: top edge sits on the band-top cut line (y=0).
  const verts = [
    { x: 0,   y: 0   }, // A
    { x: 100, y: 0   }, // B  → edge A-B is the artificial top cut (skip)
    { x: 100, y: 200 }, // C
    { x: 0,   y: 200 }, // D
  ];

  it('returns [] for fewer than 2 vertices', () => {
    expect(surfaceSpawnCandidates([{ x: 0, y: 0 }], 0, 500)).toEqual([]);
  });

  it('excludes the artificial top-cut edge', () => {
    const cands = surfaceSpawnCandidates(verts, 0, 500);
    expect(cands).not.toContainEqual({ x: 50, y: 0 }); // midpoint of the top-cut edge
  });

  it('includes real surface edges as midpoints', () => {
    const cands = surfaceSpawnCandidates(verts, 0, 500);
    expect(cands).toContainEqual({ x: 50, y: 200 });  // bottom surface edge midpoint
    expect(cands.length).toBe(3);                     // B-C, C-D, D-A (A-B excluded)
  });

  it('excludes the artificial bottom-cut edge', () => {
    // Band 0..500; a flat edge sitting on the bottom cut line (y=500) is excluded.
    const v = [
      { x: 0,   y: 100 },
      { x: 100, y: 100 }, // real surface edge
      { x: 100, y: 500 },
      { x: 0,   y: 500 }, // edge (100,500)-(0,500) is the bottom cut (skip)
    ];
    const cands = surfaceSpawnCandidates(v, 0, 500);
    expect(cands).not.toContainEqual({ x: 50, y: 500 });
    expect(cands).toContainEqual({ x: 50, y: 100 });
  });
});

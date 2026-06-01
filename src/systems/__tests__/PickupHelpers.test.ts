import { describe, it, expect } from 'vitest';
import { shouldSpawnPickup, findNearestInRange } from '../PickupHelpers';

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

import { pickPolarity } from '../PickupHelpers';

describe('pickPolarity', () => {
  it('splits 50/50 on equal rates', () => {
    expect(pickPolarity(0.4, 0.5, 0.5)).toBe('positive'); // pPos = 0.5
    expect(pickPolarity(0.6, 0.5, 0.5)).toBe('negative');
  });

  it('always positive when negative rate is 0', () => {
    expect(pickPolarity(0.99, 1, 0)).toBe('positive');
    expect(pickPolarity(0.0, 1, 0)).toBe('positive');
  });

  it('always negative when positive rate is 0', () => {
    expect(pickPolarity(0.0, 0, 1)).toBe('negative');
    expect(pickPolarity(0.99, 0, 1)).toBe('negative');
  });

  it('honours weighting (3:1 → 75% positive)', () => {
    expect(pickPolarity(0.7, 3, 1)).toBe('positive');  // < 0.75
    expect(pickPolarity(0.8, 3, 1)).toBe('negative');  // >= 0.75
  });

  it('defaults to positive when both rates are 0 (no division by zero)', () => {
    expect(pickPolarity(0.5, 0, 0)).toBe('positive');
  });
});

import { walkableSurfaceCandidates } from '../PickupHelpers';

describe('walkableSurfaceCandidates', () => {
  // Rectangular heap body: interior is y 100..300, x 0..100. Sky is above (y<100).
  //   A-B  top surface (open air above) -> walkable
  //   B-C  right wall (vertical)        -> excluded (steep)
  //   C-D  bottom face (heap above)     -> excluded (interior/underside)
  //   D-A  left wall (vertical)         -> excluded (steep)
  const hill = [
    { x: 0,   y: 100 },
    { x: 100, y: 100 },
    { x: 100, y: 300 },
    { x: 0,   y: 300 },
  ];

  it('keeps only the exterior walkable top surface', () => {
    expect(walkableSurfaceCandidates(hill, 0, 500, hill, 30)).toEqual([{ x: 50, y: 100 }]);
  });

  it('excludes steep wall edges', () => {
    const cands = walkableSurfaceCandidates(hill, 0, 500, hill, 30);
    expect(cands).not.toContainEqual({ x: 100, y: 200 }); // B-C wall
    expect(cands).not.toContainEqual({ x: 0, y: 200 });   // D-A wall
  });

  it('excludes undersides / interior edges (heap above the surface)', () => {
    const cands = walkableSurfaceCandidates(hill, 0, 500, hill, 30);
    expect(cands).not.toContainEqual({ x: 50, y: 300 }); // C-D underside
  });

  it('excludes the artificial band cut edges', () => {
    const v = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 }, { x: 0, y: 200 }];
    expect(walkableSurfaceCandidates(v, 0, 500, v, 30)).not.toContainEqual({ x: 50, y: 0 });
  });

  it('falls back to angle-only filtering when no full polygon is supplied', () => {
    // Without the polygon the underside can't be detected, but walls still are.
    const cands = walkableSurfaceCandidates(hill, 0, 500, [], 30);
    expect(cands).toContainEqual({ x: 50, y: 100 }); // top
    expect(cands).toContainEqual({ x: 50, y: 300 }); // underside now allowed (no polygon)
    expect(cands).not.toContainEqual({ x: 100, y: 200 }); // wall still excluded
  });
});

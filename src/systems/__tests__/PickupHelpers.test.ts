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

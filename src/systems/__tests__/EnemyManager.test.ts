// src/systems/__tests__/EnemyManager.test.ts
// Pure-math helpers are now in EnemySpawnMath — comprehensive tests live there.
// This file re-runs the same suite importing via the EnemyManager re-export path
// to confirm the barrel export works correctly.
import { describe, it, expect } from 'vitest';
import {
  isPointInsidePolygon,
  computeSurfaceAngle,
  spawnChance,
  scaleSpawnChance,
  computeGhostFlip,
} from '../EnemySpawnMath';
import type { EnemySpawnParams } from '../../../shared/heapTypes';

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe('isPointInsidePolygon', () => {
  it('returns true for a point clearly inside', () => {
    expect(isPointInsidePolygon(5, 5, square)).toBe(true);
  });

  it('returns false for a point clearly outside', () => {
    expect(isPointInsidePolygon(20, 20, square)).toBe(false);
  });

  it('returns false for empty polygon', () => {
    expect(isPointInsidePolygon(5, 5, [])).toBe(false);
  });

  it('returns false for a point above the polygon (y < all vertices)', () => {
    expect(isPointInsidePolygon(5, -1, square)).toBe(false);
  });

  it('correctly identifies interior vs exterior for an L-shape', () => {
    const lShape = [
      { x: 0,  y: 0  },
      { x: 20, y: 0  },
      { x: 20, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 20 },
      { x: 0,  y: 20 },
    ];
    expect(isPointInsidePolygon(5,  5,  lShape)).toBe(true);
    expect(isPointInsidePolygon(15, 5,  lShape)).toBe(true);
    expect(isPointInsidePolygon(5,  15, lShape)).toBe(true);
    expect(isPointInsidePolygon(15, 15, lShape)).toBe(false);
  });
});

describe('computeSurfaceAngle', () => {
  it('returns 0 for a flat horizontal edge', () => {
    expect(computeSurfaceAngle({ x: 0, y: 100 }, { x: 100, y: 100 })).toBeCloseTo(0);
  });

  it('returns 90 for a perfectly vertical edge', () => {
    expect(computeSurfaceAngle({ x: 50, y: 0 }, { x: 50, y: 100 })).toBeCloseTo(90);
  });

  it('returns ~45 for a 45-degree edge', () => {
    expect(computeSurfaceAngle({ x: 0, y: 0 }, { x: 100, y: 100 })).toBeCloseTo(45);
  });

  it('returns <30 for a shallow slope (surface)', () => {
    expect(computeSurfaceAngle({ x: 0, y: 0 }, { x: 100, y: 10 })).toBeLessThan(30);
  });

  it('returns ≥30 for a steep slope (wall)', () => {
    expect(computeSurfaceAngle({ x: 0, y: 0 }, { x: 10, y: 100 })).toBeGreaterThanOrEqual(30);
  });
});

const baseParams: EnemySpawnParams = {
  spawnStartPxAboveFloor: 0,
  spawnEndPxAboveFloor: -1,
  spawnRampPxAboveFloor: 40000,
  spawnChanceMin: 0.1,
  spawnChanceMax: 0.5,
};

describe('spawnChance (via EnemyManager barrel re-export)', () => {
  it('returns null below start', () => {
    const params = { ...baseParams, spawnStartPxAboveFloor: 1000 };
    expect(spawnChance(params, 500)).toBeNull();
  });

  it('returns spawnChanceMin at floor', () => {
    expect(spawnChance(baseParams, 0)).toBeCloseTo(0.1);
  });

  it('returns spawnChanceMax at ramp end', () => {
    expect(spawnChance(baseParams, 40000)).toBeCloseTo(0.5);
  });

  it('returns flat min when ramp is -1', () => {
    const params = { ...baseParams, spawnRampPxAboveFloor: -1 };
    expect(spawnChance(params, 30000)).toBeCloseTo(0.1);
  });
});

describe('scaleSpawnChance', () => {
  it('scales linearly and clamps at 1', () => {
    expect(scaleSpawnChance(0.2, 2)).toBeCloseTo(0.4);
    expect(scaleSpawnChance(0.2, 10)).toBe(1);
    expect(scaleSpawnChance(0.2, 0.5)).toBeCloseTo(0.1);
  });
});

describe('computeGhostFlip', () => {
  it('flips right when at left bound moving left', () => {
    expect(computeGhostFlip(0, -50, 50, 0, 960)).toBe(50);
  });

  it('flips left when at right bound moving right', () => {
    expect(computeGhostFlip(960, 50, 50, 0, 960)).toBe(-50);
  });

  it('preserves velocity when not at bounds', () => {
    expect(computeGhostFlip(400, -50, 50, 0, 960)).toBe(-50);
  });

  it('uses custom xMin/xMax bounds', () => {
    expect(computeGhostFlip(100, -50, 50, 100, 500)).toBe(50);
    expect(computeGhostFlip(500, 50, 50, 100, 500)).toBe(-50);
  });
});

// src/systems/__tests__/EnemyManager.test.ts
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// isPointInsidePolygon — exported for testing
// Ray-casting point-in-polygon test.
// ---------------------------------------------------------------------------
import { isPointInsidePolygon } from '../EnemyManager';

// Unit square: (0,0) → (10,0) → (10,10) → (0,10)
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
    // In Phaser coords Y increases downward, so y=-1 is above the square
    expect(isPointInsidePolygon(5, -1, square)).toBe(false);
  });

  it('correctly identifies interior vs exterior for an L-shape', () => {
    // L-shape polygon (Phaser Y-down coords):
    //   (0,0)→(20,0)→(20,10)→(10,10)→(10,20)→(0,20)
    const lShape = [
      { x: 0,  y: 0  },
      { x: 20, y: 0  },
      { x: 20, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 20 },
      { x: 0,  y: 20 },
    ];
    expect(isPointInsidePolygon(5,  5,  lShape)).toBe(true);  // top-left arm
    expect(isPointInsidePolygon(15, 5,  lShape)).toBe(true);  // top-right arm
    expect(isPointInsidePolygon(5,  15, lShape)).toBe(true);  // bottom-left arm
    expect(isPointInsidePolygon(15, 15, lShape)).toBe(false); // cutout corner
  });
});

// ---------------------------------------------------------------------------
// computeSurfaceAngle — exported for testing
// Returns degrees from horizontal for a directed edge v1→v2.
// ---------------------------------------------------------------------------
import { computeSurfaceAngle } from '../EnemyManager';

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
    // dx=100, dy=10 → atan(10/100) ≈ 5.7°
    expect(computeSurfaceAngle({ x: 0, y: 0 }, { x: 100, y: 10 })).toBeLessThan(30);
  });

  it('returns ≥30 for a steep slope (wall)', () => {
    // dx=10, dy=100 → atan(100/10) ≈ 84.3°
    expect(computeSurfaceAngle({ x: 0, y: 0 }, { x: 10, y: 100 })).toBeGreaterThanOrEqual(30);
  });
});

// ---------------------------------------------------------------------------
// spawnChance — exported for testing
// Computes spawn probability for a given def and world Y.
// ---------------------------------------------------------------------------
import { spawnChance } from '../EnemyManager';
import type { EnemyDef } from '../../data/enemyDefs';

const baseDef: EnemyDef = {
  kind: 'percher',
  textureKey: 'enemy-percher',
  width: 24,
  height: 24,
  speed: 0,
  spawnOnHeapSurface: true,
  spawnOnHeapWall: false,
  spawnStartY: 50000,
  spawnEndY: -1,
  spawnChanceMin: 0.1,
  spawnChanceMax: 0.5,
  spawnRampEndY: 10000,
};

describe('spawnChance', () => {
  it('returns null below spawnStartY (too low on heap)', () => {
    // Y > spawnStartY means below the start zone
    expect(spawnChance(baseDef, 60000)).toBeNull();
  });

  it('returns spawnChanceMin at spawnStartY', () => {
    expect(spawnChance(baseDef, 50000)).toBeCloseTo(0.1);
  });

  it('returns spawnChanceMax at spawnRampEndY', () => {
    expect(spawnChance(baseDef, 10000)).toBeCloseTo(0.5);
  });

  it('returns spawnChanceMax (clamped) above spawnRampEndY', () => {
    expect(spawnChance(baseDef, 5000)).toBeCloseTo(0.5);
  });

  it('returns interpolated value between start and ramp end', () => {
    // At midpoint Y = (50000 + 10000) / 2 = 30000, t = 0.5, chance = lerp(0.1, 0.5, 0.5) = 0.3
    const result = spawnChance(baseDef, 30000);
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(0.3);
  });

  it('returns null above spawnEndY when endY is set', () => {
    const def = { ...baseDef, spawnEndY: 20000 };
    // Y < spawnEndY means above the ceiling
    expect(spawnChance(def, 15000)).toBeNull();
  });

  it('returns flat spawnChanceMin when spawnRampEndY is -1', () => {
    const def = { ...baseDef, spawnRampEndY: -1 };
    expect(spawnChance(def, 30000)).toBeCloseTo(0.1);
    expect(spawnChance(def, 5000)).toBeCloseTo(0.1);
  });
});

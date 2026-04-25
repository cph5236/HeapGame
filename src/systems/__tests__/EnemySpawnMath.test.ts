import { describe, it, expect } from 'vitest';
import {
  isPointInsidePolygon,
  computeSurfaceAngle,
  spawnChance,
  scaleSpawnChance,
  computeGhostFlip,
} from '../EnemySpawnMath';
import type { EnemyDef } from '../../data/enemyDefs';

// ---------------------------------------------------------------------------
// isPointInsidePolygon
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// computeSurfaceAngle
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// spawnChance — fraction-based with worldHeight
// Defs use spawnStartFrac/spawnEndFrac/spawnRampEndFrac (0=summit, 1=floor).
// ---------------------------------------------------------------------------

const baseDef: EnemyDef = {
  kind: 'percher',
  textureKey: 'enemy-percher',
  width: 24,
  height: 24,
  speed: 0,
  spawnOnHeapSurface: true,
  spawnOnHeapWall: false,
  spawnStartFrac: 1.0,    // world floor
  spawnEndFrac: -1,
  spawnChanceMin: 0.1,
  spawnChanceMax: 0.5,
  spawnRampEndFrac: 0.2,  // 20% from summit
  displayName: 'TEST',
  scoreValue: 50,
};

describe('spawnChance', () => {
  it('returns null when player Y is below floor (worldHeight=50000)', () => {
    expect(spawnChance(baseDef, 60_000, 50_000)).toBeNull();
  });

  it('returns spawnChanceMin at the world floor (worldHeight=50000)', () => {
    expect(spawnChance(baseDef, 50_000, 50_000)).toBeCloseTo(0.1);
  });

  it('returns spawnChanceMax at ramp-end fraction (worldHeight=50000)', () => {
    // spawnRampEndFrac=0.2 → rampEndY = 0.2 * 50000 = 10000
    expect(spawnChance(baseDef, 10_000, 50_000)).toBeCloseTo(0.5);
  });

  it('clamps to spawnChanceMax above the ramp end (worldHeight=50000)', () => {
    expect(spawnChance(baseDef, 5_000, 50_000)).toBeCloseTo(0.5);
  });

  it('returns interpolated value between start and ramp end', () => {
    // midpoint Y = (50000 + 10000) / 2 = 30000, t=0.5, chance = lerp(0.1, 0.5, 0.5) = 0.3
    const result = spawnChance(baseDef, 30_000, 50_000);
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(0.3);
  });

  it('scales correctly to worldHeight=5000000', () => {
    // spawnStartFrac=1.0 → startY=5_000_000; spawnRampEndFrac=0.2 → rampEndY=1_000_000
    expect(spawnChance(baseDef, 6_000_000, 5_000_000)).toBeNull();
    expect(spawnChance(baseDef, 5_000_000, 5_000_000)).toBeCloseTo(0.1);
    expect(spawnChance(baseDef, 1_000_000, 5_000_000)).toBeCloseTo(0.5);
  });

  it('respects spawnEndFrac ceiling (worldHeight=50000)', () => {
    const def = { ...baseDef, spawnEndFrac: 0.4 }; // ceiling at Y=20000
    expect(spawnChance(def, 15_000, 50_000)).toBeNull();  // above ceiling
    expect(spawnChance(def, 25_000, 50_000)).not.toBeNull();
  });

  it('returns flat spawnChanceMin when spawnRampEndFrac is -1', () => {
    const def = { ...baseDef, spawnRampEndFrac: -1 };
    expect(spawnChance(def, 30_000, 50_000)).toBeCloseTo(0.1);
    expect(spawnChance(def, 5_000, 50_000)).toBeCloseTo(0.1);
  });
});

// ---------------------------------------------------------------------------
// scaleSpawnChance
// ---------------------------------------------------------------------------

describe('scaleSpawnChance', () => {
  it('scales linearly and clamps at 1', () => {
    expect(scaleSpawnChance(0.2, 2)).toBeCloseTo(0.4);
    expect(scaleSpawnChance(0.2, 10)).toBe(1);
    expect(scaleSpawnChance(0.2, 0.5)).toBeCloseTo(0.1);
  });
});

// ---------------------------------------------------------------------------
// computeGhostFlip
// ---------------------------------------------------------------------------

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

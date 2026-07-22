import { describe, it, expect } from 'vitest';
import {
  isPointInsidePolygon,
  computeSurfaceAngle,
  spawnChance,
  scaleSpawnChance,
  computeGhostFlip,
  insetPatrolBounds,
  shouldPatrol,
  computeWallFace,
  jumperNextState,
} from '../EnemySpawnMath';
import type { EnemySpawnParams } from '../../../shared/heapTypes';

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
// spawnChance — absolute px-above-floor values
// pxAboveFloor = worldHeight - y  (computed at call site)
// ---------------------------------------------------------------------------

const baseParams: EnemySpawnParams = {
  spawnStartPxAboveFloor: 0,      // can spawn from floor upward
  spawnEndPxAboveFloor: -1,       // no ceiling
  spawnRampPxAboveFloor: 40000,   // reaches max at 40000 px above floor
  spawnChanceMin: 0.1,
  spawnChanceMax: 0.5,
};

describe('spawnChance', () => {
  it('returns null below spawnStartPxAboveFloor', () => {
    const params = { ...baseParams, spawnStartPxAboveFloor: 1000 };
    expect(spawnChance(params, 500)).toBeNull();   // 500 px < 1000 px start
  });

  it('returns spawnChanceMin at spawnStartPxAboveFloor', () => {
    expect(spawnChance(baseParams, 0)).toBeCloseTo(0.1);
  });

  it('returns spawnChanceMax at spawnRampPxAboveFloor', () => {
    expect(spawnChance(baseParams, 40000)).toBeCloseTo(0.5);
  });

  it('clamps to spawnChanceMax above the ramp', () => {
    expect(spawnChance(baseParams, 50000)).toBeCloseTo(0.5);
  });

  it('interpolates at midpoint of ramp', () => {
    // t = 20000/40000 = 0.5 → lerp(0.1, 0.5, 0.5) = 0.3
    expect(spawnChance(baseParams, 20000)).toBeCloseTo(0.3);
  });

  it('returns null above spawnEndPxAboveFloor ceiling', () => {
    const params = { ...baseParams, spawnEndPxAboveFloor: 30000 };
    expect(spawnChance(params, 35000)).toBeNull();   // 35000 > ceiling 30000
    expect(spawnChance(params, 20000)).not.toBeNull(); // 20000 < ceiling — ok
  });

  it('returns flat spawnChanceMin when spawnRampPxAboveFloor is -1', () => {
    const params = { ...baseParams, spawnRampPxAboveFloor: -1 };
    expect(spawnChance(params, 0)).toBeCloseTo(0.1);
    expect(spawnChance(params, 50000)).toBeCloseTo(0.1);
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

// ---------------------------------------------------------------------------
// insetPatrolBounds
// ---------------------------------------------------------------------------

describe('insetPatrolBounds', () => {
  it('insets both ends of a long flat edge by the margin', () => {
    const b = insetPatrolBounds({ x: 0, y: 100 }, { x: 500, y: 100 }, 24);
    expect(b.minX).toBe(24);
    expect(b.maxX).toBe(476);
    expect(b.minY).toBe(100);
    expect(b.maxY).toBe(100);
  });

  it('interpolates Y at the inset X on a sloped edge', () => {
    // Edge (0,100) → (200,300): slope 1 (Δy 200 over Δx 200).
    const b = insetPatrolBounds({ x: 0, y: 100 }, { x: 200, y: 300 }, 20);
    expect(b.minX).toBe(20);
    expect(b.maxX).toBe(180);
    expect(b.minY).toBe(120); // 100 + 20*1
    expect(b.maxY).toBe(280); // 100 + 180*1
  });

  it('collapses to the midpoint when the edge is too short to inset both ends', () => {
    // width 40 <= 2*24 → collapse
    const b = insetPatrolBounds({ x: 100, y: 50 }, { x: 140, y: 50 }, 24);
    expect(b.minX).toBe(120);
    expect(b.maxX).toBe(120);
    expect(b.minX).toBe(b.maxX);
    expect(b.minY).toBe(50);
    expect(b.maxY).toBe(50);
  });

  it('collapses a degenerate zero-width edge without dividing by zero', () => {
    const b = insetPatrolBounds({ x: 80, y: 200 }, { x: 80, y: 260 }, 24);
    expect(b.minX).toBe(80);
    expect(b.maxX).toBe(80);
    expect(b.minY).toBe(230); // midpoint Y, not NaN
    expect(b.maxY).toBe(230);
  });
});

// ---------------------------------------------------------------------------
// shouldPatrol
// ---------------------------------------------------------------------------

describe('shouldPatrol', () => {
  it('patrols when the span is at or above the minimum width', () => {
    expect(shouldPatrol(100, 148, 48)).toBe(true); // span exactly 48
    expect(shouldPatrol(100, 200, 48)).toBe(true); // span 100
  });

  it('stands still when the span is below the minimum width', () => {
    expect(shouldPatrol(100, 140, 48)).toBe(false); // span 40
    expect(shouldPatrol(100, 100, 48)).toBe(false); // collapsed to a point
  });
});

// ---------------------------------------------------------------------------
// computeWallFace
// ---------------------------------------------------------------------------

describe('computeWallFace', () => {
  // A square heap block from (0,0) to (100,100). Its right edge x=100 is a
  // wall whose open air is to the +x side.
  const square = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
  ];

  it('returns +x outward for the right wall', () => {
    const face = computeWallFace({ x: 100, y: 0 }, { x: 100, y: 100 }, square, 6);
    expect(face).not.toBeNull();
    expect(face!.outwardX).toBe(1);
  });

  it('returns -x outward for the left wall', () => {
    const face = computeWallFace({ x: 0, y: 100 }, { x: 0, y: 0 }, square, 6);
    expect(face).not.toBeNull();
    expect(face!.outwardX).toBe(-1);
  });

  it('returns null for an edge with heap on both sides (interior)', () => {
    // A thin polygon where a probe of 6 from the edge midpoint lands inside on
    // both perpendicular sides: use a wide box and probe a vertical seam.
    const seam = [
      { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 },
    ];
    // The vertical segment x=100 from y=40..160 is fully interior — both
    // perpendicular probes (+x and -x) stay inside the box.
    const face = computeWallFace({ x: 100, y: 40 }, { x: 100, y: 160 }, seam, 6);
    expect(face).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// jumperNextState
// ---------------------------------------------------------------------------

describe('jumperNextState', () => {
  const cfg = { attackRangePx: 140, attackActiveMs: 500, cooldownMs: 3000 };

  it('idle → attacking when player in range', () => {
    expect(jumperNextState('idle', 0, 100, cfg)).toBe('attacking');
  });
  it('idle stays idle when player out of range', () => {
    expect(jumperNextState('idle', 0, 200, cfg)).toBe('idle');
  });
  it('attacking → cooldown after active window', () => {
    expect(jumperNextState('attacking', 500, 50, cfg)).toBe('cooldown');
    expect(jumperNextState('attacking', 300, 50, cfg)).toBe('attacking');
  });
  it('cooldown → idle after cooldown, ignores proximity meanwhile', () => {
    expect(jumperNextState('cooldown', 100, 10, cfg)).toBe('cooldown');
    expect(jumperNextState('cooldown', 3000, 10, cfg)).toBe('idle');
  });
});

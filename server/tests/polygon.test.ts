import { describe, it, expect } from 'vitest';
import { isPointInside, checkFreeze, hashVertices, LIVE_ZONE_MAX, FREEZE_BATCH } from '../src/polygon';
import { Vertex } from '../../shared/heapTypes';

// A simple 10×10 square with corners at (0,0), (10,0), (10,10), (0,10)
const SQUARE: Vertex[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe('isPointInside', () => {
  it('returns true for a point inside the polygon', () => {
    expect(isPointInside({ x: 5, y: 5 }, SQUARE)).toBe(true);
  });

  it('returns false for a point outside the polygon', () => {
    expect(isPointInside({ x: 15, y: 5 }, SQUARE)).toBe(false);
  });

  it('returns false for an empty polygon', () => {
    expect(isPointInside({ x: 5, y: 5 }, [])).toBe(false);
  });

  it('returns false for a polygon with fewer than 3 vertices', () => {
    expect(isPointInside({ x: 5, y: 5 }, [{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe(false);
  });
});

describe('hashVertices', () => {
  it('returns a 64-char hex string', () => {
    expect(hashVertices(SQUARE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns the same hash for identical vertex arrays', () => {
    expect(hashVertices(SQUARE)).toBe(hashVertices([...SQUARE]));
  });

  it('returns different hashes for different vertex arrays', () => {
    const other: Vertex[] = [{ x: 1, y: 1 }];
    expect(hashVertices(SQUARE)).not.toBe(hashVertices(other));
  });
});

describe('checkFreeze', () => {
  it('returns null when live zone is at or under LIVE_ZONE_MAX', () => {
    const liveZone: Vertex[] = Array.from({ length: LIVE_ZONE_MAX }, (_, i) => ({ x: i, y: i }));
    expect(checkFreeze(liveZone, [])).toBeNull();
  });

  it('freezes the bottom FREEZE_BATCH vertices when over LIVE_ZONE_MAX', () => {
    // liveZone sorted Y ascending (summit first = lowest Y = index 0)
    const liveZone: Vertex[] = Array.from({ length: LIVE_ZONE_MAX + 1 }, (_, i) => ({ x: 0, y: i }));
    const existingBase: Vertex[] = [{ x: 99, y: 99 }];

    const result = checkFreeze(liveZone, existingBase);

    expect(result).not.toBeNull();
    expect(result!.newLiveZone).toHaveLength(LIVE_ZONE_MAX + 1 - FREEZE_BATCH);
    expect(result!.newBaseVertices).toHaveLength(1 + FREEZE_BATCH);
    expect(result!.newBaseVertices[0]).toEqual({ x: 99, y: 99 });
    expect(result!.newBaseVertexHash).toMatch(/^[0-9a-f]{64}$/);
    const frozenBatch = liveZone.slice(-FREEZE_BATCH);
    expect(result!.newFreezeY).toBe(frozenBatch[0].y);
  });
});

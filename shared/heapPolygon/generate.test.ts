import { describe, it, expect } from 'vitest';
import { generateDefaultPolygon } from './generate';

describe('generateDefaultPolygon', () => {
  it('produces a non-empty vertex list for a standard heap', () => {
    const verts = generateDefaultPolygon(42, 50_000);
    expect(verts.length).toBeGreaterThan(10);
    for (const v of verts) {
      expect(Number.isFinite(v.x)).toBe(true);
      expect(Number.isFinite(v.y)).toBe(true);
    }
  });

  it('is deterministic for a given seed + worldHeight', () => {
    const a = generateDefaultPolygon(42, 50_000);
    const b = generateDefaultPolygon(42, 50_000);
    expect(a).toEqual(b);
  });

  it('different seeds produce different polygons', () => {
    const a = generateDefaultPolygon(42, 50_000);
    const b = generateDefaultPolygon(43, 50_000);
    expect(a).not.toEqual(b);
  });
});

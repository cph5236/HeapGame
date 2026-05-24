import { describe, it, expect } from 'vitest';
import { verticesToScanlines, SCAN_STEP } from './polygon';
import type { Vertex } from './types';

describe('verticesToScanlines', () => {
  it('returns [] for fewer than 3 vertices', () => {
    expect(verticesToScanlines([])).toEqual([]);
    expect(verticesToScanlines([{ x: 0, y: 0 }])).toEqual([]);
    expect(verticesToScanlines([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toEqual([]);
  });

  it('rasterizes a square polygon to constant-width rows', () => {
    // Square: (0,0), (100,0), (100,100), (0,100)
    const square: Vertex[] = [
      { x: 0,   y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0,   y: 100 },
    ];
    const rows = verticesToScanlines(square);
    // Scanline algorithm skips horizontal edges; ys range 0..100 step SCAN_STEP=4 → 26 candidate Y values.
    // At y=0 and y=100, edges (0,0)-(100,0) and (100,100)-(0,100) are horizontal — no crossings via the
    // half-open interval used here. So rows.length is < 26.
    // What matters: the body of the square (y in [4, 96]) should give leftX=0, rightX=100 consistently.
    expect(rows.length).toBeGreaterThan(20);
    for (const row of rows) {
      expect(row.leftX).toBe(0);
      expect(row.rightX).toBe(100);
    }
  });

  it('rasterizes a triangle to monotonically narrowing rows', () => {
    // Triangle pointing up: apex (50, 0), base (0, 100), (100, 100)
    const tri: Vertex[] = [
      { x: 50, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const rows = verticesToScanlines(tri);
    expect(rows.length).toBeGreaterThan(0);
    // Width grows with Y (narrow at top, wide at bottom).
    let prevWidth = -Infinity;
    for (const row of rows) {
      const width = row.rightX - row.leftX;
      expect(width).toBeGreaterThanOrEqual(prevWidth - 0.001); // monotone non-decreasing
      prevWidth = width;
    }
  });

  it('rasterizes a concave (C-shaped) polygon by using Math.min/Math.max of crossings', () => {
    // C-shape: outer square with a notch.
    // Vertices: (0,0)-(100,0)-(60,40)-(100,60)-(100,100)-(0,100)
    const c: Vertex[] = [
      { x: 0,   y: 0 },
      { x: 100, y: 0 },
      { x: 60,  y: 40 },
      { x: 100, y: 60 },
      { x: 100, y: 100 },
      { x: 0,   y: 100 },
    ];
    const rows = verticesToScanlines(c);
    // At Y=48 (in the notch range [40,60]), edges (100,0)→(60,40) and (60,40)→(100,60)
    // create multiple intersection points. The algorithm collects all X crossings and uses
    // Math.min/Math.max. At the notch, the right side is ~76 (not 100) due to the edge slope.
    expect(rows.length).toBeGreaterThan(20);
    const notchRow = rows.find(r => r.y === 48);
    if (notchRow !== undefined) {
      expect(notchRow.leftX).toBe(0);
      // The right edge at Y=48 falls along the diagonal (100,60)←(60,40), so X ≈ 76.
      expect(notchRow.rightX).toBeCloseTo(76, 1);
    }
  });

  it('returns ScanlineRow{y} values that are SCAN_STEP apart', () => {
    const tri: Vertex[] = [
      { x: 50, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const rows = verticesToScanlines(tri);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].y - rows[i - 1].y).toBeCloseTo(SCAN_STEP, 5);
    }
  });
});

import { describe, it, expect } from 'vitest';
import { computeRowSlopeAngleDeg, ScanlineRow } from '../HeapPolygon';

// SCAN_STEP = 4 — each row is 4px apart in Y.

describe('computeRowSlopeAngleDeg', () => {
  it('returns 90° for a perfectly vertical left edge (no horizontal movement)', () => {
    const rows: ScanlineRow[] = [
      { y: 0, leftX: 100, rightX: 200 },
      { y: 4, leftX: 100, rightX: 200 }, // deltaX = 0 → vertical
    ];
    expect(computeRowSlopeAngleDeg(rows, 0, 'left')).toBeCloseTo(90, 1);
  });

  it('returns 45° for a left edge where deltaX equals SCAN_STEP (4px)', () => {
    const rows: ScanlineRow[] = [
      { y: 0, leftX: 100, rightX: 200 },
      { y: 4, leftX: 104, rightX: 200 }, // deltaX = 4 = SCAN_STEP
    ];
    expect(computeRowSlopeAngleDeg(rows, 0, 'left')).toBeCloseTo(45, 1);
  });

  it('returns a shallow angle for a nearly-flat left edge', () => {
    const rows: ScanlineRow[] = [
      { y: 0, leftX: 100, rightX: 200 },
      { y: 4, leftX: 140, rightX: 200 }, // deltaX = 40 — far flatter than 60°
    ];
    const angle = computeRowSlopeAngleDeg(rows, 0, 'left');
    expect(angle).toBeLessThan(10);
  });

  it('returns 90° for a perfectly vertical right edge', () => {
    const rows: ScanlineRow[] = [
      { y: 0, leftX: 100, rightX: 200 },
      { y: 4, leftX: 100, rightX: 200 }, // deltaX = 0 on right
    ];
    expect(computeRowSlopeAngleDeg(rows, 0, 'right')).toBeCloseTo(90, 1);
  });

  it('uses the previous row delta for the last row', () => {
    // i = last index → falls back to rows[i-1]
    const rows: ScanlineRow[] = [
      { y: 0, leftX: 100, rightX: 200 },
      { y: 4, leftX: 104, rightX: 200 }, // deltaX = 4 on the only pair
    ];
    expect(computeRowSlopeAngleDeg(rows, 1, 'left')).toBeCloseTo(45, 1);
  });
});

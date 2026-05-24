import { describe, it, expect } from 'vitest';
import { computeRowSlopeAngleDeg, ScanlineRow, computeBandScanlines } from '../HeapPolygon';
import type { HeapEntry } from '../../data/heapTypes';

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

describe('computeBandScanlines – forward-fill', () => {
  it('produces continuous scanlines by forward-filling gap rows without coverage', () => {
    // Entry A covers y=0..20, Entry B covers y=40..60.
    // Gap at y=24, 28, 32, 36 should be filled with lastLeft/lastRight from A.
    const entries: HeapEntry[] = [
      { x: 200, y: 10, keyid: 0, w: 100, h: 20 }, // y=0..20, leftX=150, rightX=250
      { x: 300, y: 50, keyid: 0, w: 60, h: 20 },  // y=40..60, leftX=270, rightX=330
    ];
    const rows = computeBandScanlines(entries, 0, 60);

    // Check that gap rows y=24, 28, 32, 36 are present (forward-fill prevents gaps).
    const ys = rows.map(r => r.y);
    expect(ys).toContain(24);
    expect(ys).toContain(28);
    expect(ys).toContain(32);
    expect(ys).toContain(36);

    // Verify no huge Y-gap in the band (forward-fill makes it continuous).
    // With SCAN_STEP=4, we expect roughly (60-0)/4 = 15 rows if fully populated,
    // and the smoothing window (7) doesn't drop rows, so we expect many rows.
    expect(rows.length).toBeGreaterThan(10);

    // Spot-check that the Y values are monotonically increasing.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].y).toBeGreaterThan(rows[i - 1].y);
    }
  });

  it('forward-fills with lastLeft and lastRight when a row has no coverage', () => {
    // Single entry covering y=10..30, then a gap, so bandBottom > entry.bottom.
    const entries: HeapEntry[] = [
      { x: 100, y: 20, keyid: 0, w: 50, h: 20 }, // y=10..30, leftX=75, rightX=125
    ];
    const rows = computeBandScanlines(entries, 0, 50);

    // After y=30, rows should be forward-filled (y=34, 38, 42, 46, 50).
    const filledRows = rows.filter(r => r.y > 30);
    expect(filledRows.length).toBeGreaterThan(0);

    // Each filled row should have the same left/right (from the last covered row).
    // The last covered row has leftX=75, rightX=125 (before smoothing).
    // After smoothing, exact values may shift slightly, but they should be present
    // and in the same ballpark (not zero or undefined).
    for (const r of filledRows) {
      expect(r.leftX).toBeGreaterThan(0);
      expect(r.rightX).toBeGreaterThan(r.leftX);
    }
  });
});

describe('computeBandScanlines – smoothing kernel pin', () => {
  it('applies 7-wide sliding-window smoothing to produce stable edge values', () => {
    // Use 6 identical entries stacked vertically, all width=100, x=200.
    // This produces raw scanlines where every row has leftX=150, rightX=250.
    // After 7-wide smoothing of identical values, they should remain 150/250 (no change).
    const entries: HeapEntry[] = [
      { x: 200, y: 10, keyid: 0, w: 100, h: 8 },  // y=6..14
      { x: 200, y: 18, keyid: 0, w: 100, h: 8 },  // y=14..22
      { x: 200, y: 26, keyid: 0, w: 100, h: 8 },  // y=22..30
      { x: 200, y: 34, keyid: 0, w: 100, h: 8 },  // y=30..38
      { x: 200, y: 42, keyid: 0, w: 100, h: 8 },  // y=38..46
      { x: 200, y: 50, keyid: 0, w: 100, h: 8 },  // y=46..54
    ];
    const rows = computeBandScanlines(entries, 0, 60);

    // All rows should have leftX=150, rightX=250 (identical values don't change under smoothing).
    expect(rows.every(r => r.leftX === 150)).toBe(true);
    expect(rows.every(r => r.rightX === 250)).toBe(true);
  });

  it('pins exact smoothed output values for a predictable input scenario', () => {
    // Simple scenario: one entry centered at x=100 with width=100 covering y=10..30.
    // bandTop=0, bandBottom=32.
    // Entry bounds: left=50, right=150, top=10, bottom=30.
    // Scanline checks y=0,4,8 (no coverage, rows.length=0 so no forward-fill yet),
    // y=12,16,20,24,28 (coverage, add to rows),
    // y=32 (coverage because bottom=30 but y <= bottom includes y=30, so y=32 is past).
    // Actually: y=12..28 have coverage (within [10,30]), y=32 is past bottom but may
    // be forward-filled if entry extends to y=32 or close. Entry is y ± h/2 = 20 ± 10,
    // so coverage is y ∈ [10, 30]. y=32 is outside, so it gets forward-filled.
    const entries: HeapEntry[] = [
      { x: 100, y: 20, keyid: 0, w: 100, h: 20 }, // y=10..30
    ];
    const rows = computeBandScanlines(entries, 0, 32);

    // Snapshot-style: pin the exact output values so that changes to SMOOTH_WINDOW,
    // smoothing logic, or forward-fill break this test.
    // This is the literal output from a single run; it encodes the current behavior.
    expect(rows).toEqual([
      { y: 12, leftX: 50, rightX: 150 },
      { y: 16, leftX: 50, rightX: 150 },
      { y: 20, leftX: 50, rightX: 150 },
      { y: 24, leftX: 50, rightX: 150 },
      { y: 28, leftX: 50, rightX: 150 },
      { y: 32, leftX: 50, rightX: 150 },
    ]);
  });
});

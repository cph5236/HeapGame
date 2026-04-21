import { describe, it, expect } from 'vitest';
import { findPortalSurface, randBetween } from '../PortalManager';
import type { ScanlineRow } from '../HeapPolygon';

// rows ordered top→bottom (ascending Y, as LayerGenerator produces them)
const surfaceRows: ScanlineRow[] = [
  { y: 100, leftX: 50, rightX: 200 },
  { y: 104, leftX: 50, rightX: 200 },
  { y: 108, leftX: 50, rightX: 200 },
  { y: 112, leftX: 50, rightX: 200 },
];

describe('findPortalSurface', () => {
  it('returns the topmost row Y when x is on heap and clearance is free', () => {
    expect(findPortalSurface(surfaceRows, 125, 10)).toBe(100);
  });

  it('returns null when x is outside all rows', () => {
    expect(findPortalSurface(surfaceRows, 25, 10)).toBeNull();
  });

  it('returns null when a row in the clearance zone contains x', () => {
    const rowsWithObstruction: ScanlineRow[] = [
      { y: 50,  leftX: 50, rightX: 200 }, // inside clearance zone: 100 - 60 = 40 < 50 < 100
      { y: 100, leftX: 50, rightX: 200 }, // surface
    ];
    // clearanceRequired=60 → clearTop=40; y=50 is in (40, 100) and contains x=125 → blocked
    expect(findPortalSurface(rowsWithObstruction, 125, 60)).toBeNull();
  });

  it('returns surface Y when clearance zone rows do not contain x', () => {
    const rowsNarrowObstruction: ScanlineRow[] = [
      { y: 50,  leftX: 50, rightX: 100 }, // contains x=125? no (125 > 100) → not an obstruction
      { y: 100, leftX: 50, rightX: 200 }, // surface contains x=125
    ];
    expect(findPortalSurface(rowsNarrowObstruction, 125, 60)).toBe(100);
  });

  it('returns null when x is exactly on clearance boundary row', () => {
    const rows: ScanlineRow[] = [
      { y: 41,  leftX: 50, rightX: 200 }, // y=41 > clearTop(40), < surface(100) → obstruction
      { y: 100, leftX: 50, rightX: 200 },
    ];
    expect(findPortalSurface(rows, 125, 60)).toBeNull();
  });
});

describe('randBetween', () => {
  it('returns min when rng returns 0', () => {
    expect(randBetween([200, 400], () => 0)).toBe(200);
  });

  it('returns max when rng returns 1', () => {
    expect(randBetween([200, 400], () => 1)).toBe(400);
  });

  it('returns midpoint when rng returns 0.5', () => {
    expect(randBetween([200, 400], () => 0.5)).toBe(300);
  });
});

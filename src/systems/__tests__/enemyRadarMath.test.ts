import { describe, it, expect } from 'vitest';
import {
  wrapNearestX,
  computeBlip,
  selectBlips,
  type RadarView,
  type RadarOpts,
} from '../enemyRadarMath';

const VIEW: RadarView = { x: 0, y: 0, width: 480, height: 900 };
const OPTS: RadarOpts = { rangePx: 600, marginPx: 24, wrapPeriod: 1200 };
const PX = 240, PY = 450; // player at view centre

describe('wrapNearestX', () => {
  it('returns the raw x when no wrapped image is closer', () => {
    expect(wrapNearestX(540, 240, 1200)).toBe(540);
  });
  it('picks the left wrapped image for a far-right enemy', () => {
    // 950 vs player 30: raw dist 920, but (950-1200)=-250 is dist 280 → closer
    expect(wrapNearestX(950, 30, 1200)).toBe(-250);
  });
  it('picks the right wrapped image for a far-left enemy', () => {
    // -250 vs player 930: raw dist 1180, but (-250+1200)=950 is dist 20 → closer
    expect(wrapNearestX(-250, 930, 1200)).toBe(950);
  });
});

describe('computeBlip', () => {
  it('returns null for an on-screen enemy', () => {
    expect(computeBlip(240, 450, PX, PY, VIEW, OPTS)).toBeNull();
  });
  it('returns null for an enemy beyond range', () => {
    // 700px straight up — off-screen but out of the 600px range
    expect(computeBlip(240, -250, PX, PY, VIEW, OPTS)).toBeNull();
  });
  it('clamps to the right edge with angle ~0', () => {
    const b = computeBlip(540, 450, PX, PY, VIEW, OPTS)!;
    expect(b).not.toBeNull();
    expect(b.x).toBe(456); // width - margin
    expect(b.y).toBe(450);
    expect(b.angle).toBeCloseTo(0, 5);
  });
  it('clamps to the left edge with angle ~pi', () => {
    const b = computeBlip(-60, 450, PX, PY, VIEW, OPTS)!;
    expect(b.x).toBe(24); // margin
    expect(Math.abs(b.angle)).toBeCloseTo(Math.PI, 5);
  });
  it('clamps to the top edge with angle ~-pi/2', () => {
    const b = computeBlip(240, -50, PX, PY, VIEW, OPTS)!;
    expect(b.y).toBe(24);
    expect(b.angle).toBeCloseTo(-Math.PI / 2, 5);
  });
  it('clamps to the bottom edge with angle ~pi/2', () => {
    const b = computeBlip(240, 950, PX, PY, VIEW, OPTS)!;
    expect(b.y).toBe(876); // height - margin
    expect(b.angle).toBeCloseTo(Math.PI / 2, 5);
  });
  it('clamps to a corner for an off-bottom-right enemy', () => {
    const b = computeBlip(540, 950, PX, PY, VIEW, OPTS)!;
    expect(b.x).toBe(456);
    expect(b.y).toBe(876);
  });
  it('puts the arrow on the NEAR edge for a wrap-side enemy', () => {
    // Player near the left edge; camera view starts at -210. Enemy at the far
    // RIGHT world edge (950) is 920px away linearly (out of range) but only 280px
    // via wrap, so it should yield a LEFT-edge arrow.
    const view: RadarView = { x: -210, y: 0, width: 480, height: 900 };
    const b = computeBlip(950, 450, 30, 450, view, OPTS)!;
    expect(b).not.toBeNull();
    expect(b.x).toBe(24); // left edge (margin)
    expect(Math.abs(b.angle)).toBeCloseTo(Math.PI, 5);
    expect(b.dist).toBeCloseTo(280, 5);
  });
});

describe('selectBlips', () => {
  it('returns the nearest N off-screen enemies, capped at max', () => {
    const enemies = [
      { x: 240, y: 450 },  // on-screen → filtered
      { x: 540, y: 450 },  // 300px off right
      { x: 240, y: 950 },  // 500px off bottom
    ];
    const blips = selectBlips(enemies, PX, PY, VIEW, OPTS, 1);
    expect(blips).toHaveLength(1);
    expect(blips[0].dist).toBeCloseTo(300, 5); // the nearer one
  });
});

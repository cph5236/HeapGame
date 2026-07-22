import { describe, it, expect } from 'vitest';
import {
  wrapNearestX,
  computeBlip,
  selectBlips,
  visibleWorldRect,
  type RadarView,
  type RadarOpts,
} from '../enemyRadarMath';

const VIEW: RadarView = { x: 0, y: 0, width: 480, height: 900 };
const OPTS: RadarOpts = { rangePx: 600, marginPx: 24, wrapPeriod: 1200 };
const PX = 240, PY = 450; // player at view centre

describe('visibleWorldRect', () => {
  // Cross-checked against a live Phaser Camera.worldView (debug session): the same
  // inputs gave worldView ≈ (1205, 2273, 273, 364) — this reconstruction lands
  // within ~1px (Phaser rounds internally), which is what the on-screen test needs.
  it('matches Phaser worldView under DPR zoom (the mobile case)', () => {
    const r = visibleWorldRect({ scrollX: 1000, scrollY: 2000, width: 682, height: 909, zoom: 2.5 });
    expect(r.x).toBeCloseTo(1204.6, 1);
    expect(r.y).toBeCloseTo(2272.7, 1);
    expect(r.width).toBeCloseTo(272.8, 1);
    expect(r.height).toBeCloseTo(363.6, 1);
  });
  it('reduces to plain scroll at zoom 1 (the desktop case)', () => {
    const r = visibleWorldRect({ scrollX: 1000, scrollY: 2000, width: 480, height: 900, zoom: 1 });
    expect(r).toEqual({ x: 1000, y: 2000, width: 480, height: 900 });
  });
  it('centres the inset — the rect stays centred on scroll+size/2', () => {
    const r = visibleWorldRect({ scrollX: 0, scrollY: 0, width: 1000, height: 1000, zoom: 2 });
    // centre of the visible rect equals the camera-midpoint (scroll + physical size / 2)
    expect(r.x + r.width / 2).toBeCloseTo(500, 5);
    expect(r.y + r.height / 2).toBeCloseTo(500, 5);
  });
});

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
  it('suppresses the arrow for an edge-straddling enemy when onScreenPadPx is set', () => {
    // Enemy centre 20px past the right edge (x=500, view width 480) — its sprite is
    // still clearly visible. With a 32px pad the on-screen rect grows to x<=512, so
    // no arrow. Without the pad (base OPTS) it would still show.
    const padded: RadarOpts = { ...OPTS, onScreenPadPx: 32 };
    expect(computeBlip(500, 450, PX, PY, VIEW, padded)).toBeNull();
    expect(computeBlip(500, 450, PX, PY, VIEW, OPTS)).not.toBeNull();
    // A genuinely off-screen enemy (60px past the edge, body fully off) still shows.
    expect(computeBlip(540, 450, PX, PY, VIEW, padded)).not.toBeNull();
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
  it('pins an off-bottom-right enemy to the edge its direction ray exits first', () => {
    // dx=300, dy=500 from centre (240,450): the ray reaches the right margin (x=456,
    // t=0.72) before the bottom margin (y=876, t=0.852), so it exits the right edge.
    const b = computeBlip(540, 950, PX, PY, VIEW, OPTS)!;
    expect(b.x).toBe(456);
    expect(b.y).toBeCloseTo(810, 5);
    expect(b.angle).toBeCloseTo(Math.atan2(500, 300), 5);
  });
  it('treats a wrap-side enemy as off-screen even when its ghost lands inside the view', () => {
    // After a wrap the camera follow-offset shifts the view a half-screen; here it
    // spans [-480, 0]. The enemy's real sprite is at the far right (950, off-screen),
    // but its wrap ghost (-250) maps INSIDE this offset view. The on-screen test must
    // use the RAW position, so the arrow still shows — pinned to the LEFT edge,
    // pointing the wrap direction, not floating mid-screen.
    const view: RadarView = { x: -480, y: 0, width: 480, height: 900 };
    const b = computeBlip(950, 450, 30, 450, view, OPTS)!;
    expect(b).not.toBeNull();
    expect(b.x).toBe(24); // left edge (margin)
    expect(Math.abs(b.angle)).toBeCloseTo(Math.PI, 5);
    expect(b.dist).toBeCloseTo(280, 5);
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

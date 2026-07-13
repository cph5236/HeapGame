import { describe, it, expect } from 'vitest';
import { stepPupil, DEFAULT_EYE_PHYSICS, type PupilState, type PupilParams } from '../eyePhysics';

const params: PupilParams = { restX: 0, restY: 1.4, radius: 2.2, ...DEFAULT_EYE_PHYSICS };
const at = (x: number, y: number): PupilState => ({ x, y, vx: 0, vy: 0 });

function run(s: PupilState, p: PupilParams, ax: number, ay: number, ms: number): PupilState {
  for (let t = 0; t < ms; t += 16) s = stepPupil(s, p, ax, ay, 16);
  return s;
}

describe('stepPupil', () => {
  it('settles to the rest pose with no input', () => {
    const s = run(at(2.2, 0), params, 0, 0, 3000);
    expect(Math.hypot(s.x - params.restX, s.y - params.restY)).toBeLessThan(0.05);
    expect(Math.hypot(s.vx, s.vy)).toBeLessThan(0.05);
  });

  it('never leaves the track radius, even under huge acceleration', () => {
    let s = at(0, 0);
    for (let i = 0; i < 200; i++) {
      s = stepPupil(s, params, 50000 * (i % 2 ? 1 : -1), -30000, 16);
      expect(Math.hypot(s.x, s.y)).toBeLessThanOrEqual(params.radius + 1e-9);
    }
  });

  it('moves opposite to player acceleration (inertia)', () => {
    const s = run(at(params.restX, params.restY), params, 2000, 0, 200);
    expect(s.x).toBeLessThan(params.restX);   // player accelerates right → pupil lags left
  });

  it('damps out — kinetic energy decays after an impulse', () => {
    let s: PupilState = { x: 0, y: 0, vx: 40, vy: -30 };
    const early = run(s, params, 0, 0, 100);
    const late  = run(s, params, 0, 0, 2500);
    expect(Math.hypot(late.vx, late.vy)).toBeLessThan(Math.hypot(early.vx, early.vy));
  });

  it('keeps tangential velocity when pinned to the rim (orbit/spin)', () => {
    // On the rim at (radius, 0), moving straight up (pure tangential), pushed outward.
    const s0: PupilState = { x: params.radius, y: 0, vx: 0, vy: -50 };
    const s1 = stepPupil(s0, params, -20000, 0, 16);  // accel pushes pupil outward (+x)
    expect(Math.hypot(s1.x, s1.y)).toBeLessThanOrEqual(params.radius + 1e-9);
    expect(s1.vy).toBeLessThan(0);                    // tangential motion survives
  });

  it('is stable across a huge dt spike (tab switch)', () => {
    const s = stepPupil(at(1, 1), params, 3000, 3000, 5000);
    expect(Number.isFinite(s.x) && Number.isFinite(s.y)).toBe(true);
    expect(Math.hypot(s.x, s.y)).toBeLessThanOrEqual(params.radius + 1e-9);
  });

  it('does not mutate the input state', () => {
    const s0 = at(1, 0);
    stepPupil(s0, params, 500, 0, 16);
    expect(s0).toEqual({ x: 1, y: 0, vx: 0, vy: 0 });
  });
});

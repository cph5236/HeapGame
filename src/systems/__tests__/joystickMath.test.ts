import { describe, it, expect } from 'vitest';
import { axisFromForce, initDoubleTap, stepDoubleTap, zoneFromAxis } from '../joystickMath';

describe('axisFromForce', () => {
  it('returns 0 inside the dead zone', () => {
    expect(axisFromForce(10, 64, 0.2, 0.3)).toBe(0); // 10/64 = 0.156 < 0.2
  });
  it('clamps to +1 at/beyond full radius', () => {
    expect(axisFromForce(64, 64, 0.2, 0.3)).toBeCloseTo(1, 5);
    expect(axisFromForce(200, 64, 0.2, 0.3)).toBeCloseTo(1, 5);
  });
  it('clamps to -1 at negative full radius', () => {
    expect(axisFromForce(-64, 64, 0.2, 0.3)).toBeCloseTo(-1, 5);
  });
  it('preserves sign and is monotonic between dead zone and max', () => {
    const a = axisFromForce(30, 64, 0.2, 0.3);
    const b = axisFromForce(50, 64, 0.2, 0.3);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(axisFromForce(-30, 64, 0.2, 0.3)).toBeCloseTo(-a, 5);
  });
});

describe('zoneFromAxis', () => {
  it('is 0 below threshold, ±1 at/above', () => {
    expect(zoneFromAxis(0.5, 0.85)).toBe(0);
    expect(zoneFromAxis(0.9, 0.85)).toBe(1);
    expect(zoneFromAxis(-0.9, 0.85)).toBe(-1);
  });
});

describe('stepDoubleTap', () => {
  it('does not fire on a single tap', () => {
    const s = initDoubleTap();
    expect(stepDoubleTap(s, 0, 0, 300).fired).toBe(false);
    expect(stepDoubleTap(s, 1, 10, 300).fired).toBe(false); // first engage from center
  });
  it('fires on a second same-direction engage within the window', () => {
    const s = initDoubleTap();
    stepDoubleTap(s, 0, 0, 300);    // center
    stepDoubleTap(s, 1, 10, 300);   // first tap (engage)
    stepDoubleTap(s, 0, 20, 300);   // recenter
    const r = stepDoubleTap(s, 1, 30, 300); // second tap within window
    expect(r.fired).toBe(true);
    expect(r.dir).toBe(1);
  });
  it('does not fire if the second tap is the opposite direction', () => {
    const s = initDoubleTap();
    stepDoubleTap(s, 0, 0, 300);
    stepDoubleTap(s, 1, 10, 300);
    stepDoubleTap(s, 0, 20, 300);
    expect(stepDoubleTap(s, -1, 30, 300).fired).toBe(false);
  });
  it('does not fire if the second tap is too late', () => {
    const s = initDoubleTap();
    stepDoubleTap(s, 0, 0, 300);
    stepDoubleTap(s, 1, 10, 300);
    stepDoubleTap(s, 0, 20, 300);
    expect(stepDoubleTap(s, 1, 500, 300).fired).toBe(false); // 490ms > window
  });
  it('only engages on a rise from center (held direction does not re-fire)', () => {
    const s = initDoubleTap();
    stepDoubleTap(s, 0, 0, 300);
    stepDoubleTap(s, 1, 10, 300);   // first engage
    const held = stepDoubleTap(s, 1, 20, 300); // still held, no recenter
    expect(held.fired).toBe(false);
  });
});

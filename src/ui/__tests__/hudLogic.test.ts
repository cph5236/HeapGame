import { describe, it, expect } from 'vitest';
import {
  showDashIndicator, airJumpPipStates, dashBarFillFraction, controlClusterLayout,
} from '../hudLogic';

describe('showDashIndicator', () => {
  it('shows on desktop regardless of mode', () => {
    expect(showDashIndicator(false, 'tilt')).toBe(true);
    expect(showDashIndicator(false, 'joystick')).toBe(true);
  });
  it('shows on mobile tilt, hides on mobile joystick (button carries it)', () => {
    expect(showDashIndicator(true, 'tilt')).toBe(true);
    expect(showDashIndicator(true, 'joystick')).toBe(false);
  });
});

describe('airJumpPipStates', () => {
  it('marks the first `left` pips available, rest used', () => {
    expect(airJumpPipStates(2, 3)).toEqual([true, true, false]);
    expect(airJumpPipStates(0, 3)).toEqual([false, false, false]);
    expect(airJumpPipStates(3, 3)).toEqual([true, true, true]);
  });
  it('clamps left into [0, max]', () => {
    expect(airJumpPipStates(5, 2)).toEqual([true, true]);
    expect(airJumpPipStates(-1, 2)).toEqual([false, false]);
  });
});

describe('dashBarFillFraction', () => {
  it('is full when cooldown is 0, empty when cooldown is 1', () => {
    expect(dashBarFillFraction(0)).toBe(1);
    expect(dashBarFillFraction(1)).toBe(0);
    expect(dashBarFillFraction(0.25)).toBe(0.75);
  });
  it('clamps out-of-range input', () => {
    expect(dashBarFillFraction(-0.5)).toBe(1);
    expect(dashBarFillFraction(2)).toBe(0);
  });
});

describe('controlClusterLayout', () => {
  const dims = { joyRadius: 64, joyMargin: 28, dashRadius: 34, placeW: 80, placeH: 60, placeGap: 14 };
  it('left side: stick bottom-left, dash + place bottom-right', () => {
    const l = controlClusterLayout('left', 480, 800, dims);
    expect(l.stick).toEqual({ x: 28 + 64, y: 800 - 28 - 64 });
    expect(l.dash).toEqual({ x: 480 - 28 - 34, y: 800 - 28 - 34 });
    expect(l.place.x).toBe(480 - 28 - 34);
    expect(l.place.y).toBe((800 - 28 - 34) - 34 - 14 - 30);
  });
  it('right side mirrors horizontally', () => {
    const r = controlClusterLayout('right', 480, 800, dims);
    expect(r.stick).toEqual({ x: 480 - 28 - 64, y: 800 - 28 - 64 });
    expect(r.dash).toEqual({ x: 28 + 34, y: 800 - 28 - 34 });
    expect(r.place.x).toBe(28 + 34);
  });
});

import { describe, it, expect } from 'vitest';
import {
  computeDifficultyFactor,
  INFINITE_MAX_RAMP_HEIGHT,
  INFINITE_MAX_RAMP_TIME,
} from '../../data/infiniteDefs';

describe('computeDifficultyFactor', () => {
  it('returns 0 at start (no height, no time)', () => {
    expect(computeDifficultyFactor(0, 0)).toBe(0);
  });

  it('returns 0.7 at full height, no time', () => {
    expect(computeDifficultyFactor(INFINITE_MAX_RAMP_HEIGHT, 0)).toBeCloseTo(0.7);
  });

  it('returns 0.3 at full time, no height', () => {
    expect(computeDifficultyFactor(0, INFINITE_MAX_RAMP_TIME)).toBeCloseTo(0.3);
  });

  it('returns 1.0 at both full height and full time', () => {
    expect(computeDifficultyFactor(INFINITE_MAX_RAMP_HEIGHT, INFINITE_MAX_RAMP_TIME)).toBeCloseTo(1.0);
  });

  it('clamps at 1.0 beyond max values', () => {
    expect(computeDifficultyFactor(INFINITE_MAX_RAMP_HEIGHT * 2, INFINITE_MAX_RAMP_TIME * 2)).toBe(1.0);
  });
});

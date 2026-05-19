import { describe, it, expect } from 'vitest';
import { effectiveVolume, proximityVolume, proximityRate } from '../AudioManager';

describe('effectiveVolume', () => {
  it('multiplies base × category × master', () => {
    expect(effectiveVolume(0.9, 0.8, 1.0)).toBeCloseTo(0.72);
  });

  it('returns 0 when master is 0', () => {
    expect(effectiveVolume(1.0, 1.0, 0)).toBe(0);
  });

  it('clamps output to [0, 1]', () => {
    expect(effectiveVolume(2.0, 2.0, 2.0)).toBe(1);
  });
});

describe('proximityVolume', () => {
  it('returns 0 when t is 0', () => {
    expect(proximityVolume(0, 1.0, 1.0, 1.0)).toBe(0);
  });

  it('returns base × cat × master when t is 1', () => {
    expect(proximityVolume(1, 0.8, 0.9, 1.0)).toBeCloseTo(0.8 * 0.9 * 1.0);
  });

  it('uses t^0.7 curve (less than linear)', () => {
    const half = proximityVolume(0.5, 1.0, 1.0, 1.0);
    expect(half).toBeCloseTo(Math.pow(0.5, 0.7));
    expect(half).toBeGreaterThan(0.5); // t^0.7 > t for t in (0,1)
  });
});

describe('proximityRate', () => {
  it('returns 0.8 at t=0', () => {
    expect(proximityRate(0)).toBeCloseTo(0.8);
  });

  it('returns 1.3 at t=1', () => {
    expect(proximityRate(1)).toBeCloseTo(1.3);
  });

  it('returns 1.05 at t=0.5', () => {
    expect(proximityRate(0.5)).toBeCloseTo(1.05);
  });
});

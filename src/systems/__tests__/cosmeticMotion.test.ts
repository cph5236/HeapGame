import { describe, it, expect } from 'vitest';
import { motionOffsets, IDENTITY_OFFSETS } from '../cosmeticMotion';

describe('motionOffsets', () => {
  it('spin: 60 rpm turns 90° in 250 ms, wraps within [0, 360)', () => {
    expect(motionOffsets({ type: 'spin', rpm: 60 }, 250).dAngle).toBeCloseTo(90);
    const wrapped = motionOffsets({ type: 'spin', rpm: 60 }, 61000).dAngle;
    expect(wrapped).toBeGreaterThanOrEqual(0);
    expect(wrapped).toBeLessThan(360);
  });

  it('bob: peaks at quarter period, zero at half period', () => {
    const anim = { type: 'bob', periodMs: 1000, amplitudePx: 3 } as const;
    expect(motionOffsets(anim, 250).dy).toBeCloseTo(3);
    expect(motionOffsets(anim, 500).dy).toBeCloseTo(0);
  });

  it('pulse: scale swings by scaleAmp, alpha dips by alphaAmp', () => {
    const anim = { type: 'pulse', periodMs: 1000, scaleAmp: 0.1, alphaAmp: 0.4 } as const;
    expect(motionOffsets(anim, 250).scaleMul).toBeCloseTo(1.1);
    expect(motionOffsets(anim, 750).scaleMul).toBeCloseTo(0.9);
    expect(motionOffsets(anim, 250).alphaMul).toBeCloseTo(0.6);
    const noAlpha = { type: 'pulse', periodMs: 1000, scaleAmp: 0.1 } as const;
    expect(motionOffsets(noAlpha, 250).alphaMul).toBeCloseTo(1);
  });

  it('sheet: identity (frames animate via Phaser, not transforms)', () => {
    expect(motionOffsets({ type: 'sheet', frameW: 32, frameH: 32, frameRate: 8 }, 500))
      .toEqual(IDENTITY_OFFSETS);
  });
});

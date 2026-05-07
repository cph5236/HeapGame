import { describe, it, expect } from 'vitest';
import { heightFt } from './format';

describe('heightFt', () => {
  it('returns formatted feet when topY is finite', () => {
    expect(heightFt(50_000, 49_000)).toBe('100 FT');
    expect(heightFt(50_000, 0)).toBe('5000 FT');
  });

  it('floors fractional feet', () => {
    expect(heightFt(50_000, 49_995)).toBe('0 FT');
    expect(heightFt(50_000, 49_990)).toBe('1 FT');
  });

  it('returns ??? when topY is null/undefined/non-finite', () => {
    expect(heightFt(50_000, null)).toBe('???');
    expect(heightFt(50_000, undefined)).toBe('???');
    expect(heightFt(50_000, NaN)).toBe('???');
    expect(heightFt(50_000, Infinity)).toBe('???');
  });

  it('abbreviates with K once feet >= 10_000', () => {
    // worldHeight - topY = px; ft = floor(px / SCORE_DISPLAY_DIVISOR=10) — see format.ts
    expect(heightFt(100_000,    0)).toBe('10K FT');           // 10_000 ft → boundary
    expect(heightFt(4_673_260,  0)).toBe('467K FT');          // rounds, not floors, for K
    expect(heightFt(99_999, 0)).toBe('9999 FT');              // 9_999 ft stays full
  });

  it('abbreviates with M once feet >= 1_000_000', () => {
    expect(heightFt(10_000_000, 0)).toBe('1.0M FT');
    expect(heightFt(15_000_000, 0)).toBe('1.5M FT');
  });

  it('renders infinite heaps as ∞ FT regardless of topY', () => {
    expect(heightFt(50_000, NaN, true)).toBe('∞ FT');
    expect(heightFt(50_000, null, true)).toBe('∞ FT');
    expect(heightFt(50_000, 0,    true)).toBe('∞ FT');
  });
});

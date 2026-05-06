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
});

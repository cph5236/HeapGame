import { describe, it, expect } from 'vitest';
import { formatMult } from '../formatMult';

describe('formatMult', () => {
  it('keeps two decimals when needed (1.25 → "1.25")', () => {
    expect(formatMult(1.25)).toBe('1.25');
  });

  it('strips a trailing zero (1.5 → "1.5")', () => {
    expect(formatMult(1.5)).toBe('1.5');
  });

  it('strips a trailing decimal entirely (2 → "2")', () => {
    expect(formatMult(2)).toBe('2');
  });

  it('keeps a leading-zero decimal (1.05 → "1.05")', () => {
    expect(formatMult(1.05)).toBe('1.05');
  });

  it('rounds to two decimals for float drift (1 + 0.05*5 → "1.25")', () => {
    expect(formatMult(1 + 0.05 * 5)).toBe('1.25');
  });

  it('handles sub-1 multipliers (0.5 → "0.5")', () => {
    expect(formatMult(0.5)).toBe('0.5');
  });
});

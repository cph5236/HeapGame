import { describe, it, expect } from 'vitest';
import { passesSurfaceCheck } from '../PlaceableManager';

describe('passesSurfaceCheck', () => {
  it('returns true when surface is within threshold', () => {
    expect(passesSurfaceCheck(1000, 1050, 100)).toBe(true);
  });

  it('returns false when surface is outside threshold', () => {
    expect(passesSurfaceCheck(1000, 1200, 100)).toBe(false);
  });

  it('returns true at exact threshold boundary', () => {
    expect(passesSurfaceCheck(1000, 1100, 100)).toBe(true);
  });

  it('works with savedY above surfaceY', () => {
    expect(passesSurfaceCheck(1100, 1050, 100)).toBe(true);
    expect(passesSurfaceCheck(1300, 1050, 100)).toBe(false);
  });
});

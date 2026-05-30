import { describe, it, expect } from 'vitest';
import { makeGrimeRng } from '../heapGrime';

describe('makeGrimeRng', () => {
  it('is deterministic for a given seed', () => {
    const a = makeGrimeRng(42);
    const b = makeGrimeRng(42);
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = makeGrimeRng(1);
    const b = makeGrimeRng(2);
    expect(a()).not.toBe(b());
  });

  it('returns values in [0, 1)', () => {
    const r = makeGrimeRng(7);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

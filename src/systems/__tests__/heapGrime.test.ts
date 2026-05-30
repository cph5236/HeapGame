import { describe, it, expect } from 'vitest';
import { makeGrimeRng, gradePixel } from '../heapGrime';

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

describe('gradePixel', () => {
  it('warm-shifts a neutral grey (r > g > b) without large movement', () => {
    const [r, g, b] = gradePixel(128, 128, 128);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(Math.abs(r - 128)).toBeLessThan(20);
  });

  it('desaturates a saturated colour toward its luma', () => {
    const [r, g, b] = gradePixel(255, 0, 0);
    expect(r).toBeLessThan(255);
    expect(g).toBeGreaterThan(0);
    expect(b).toBeGreaterThanOrEqual(0);
  });

  it('clamps to the 0..255 range', () => {
    const [r, g, b] = gradePixel(255, 255, 255);
    expect(r).toBe(255);
    expect(g).toBeLessThanOrEqual(255);
    expect(b).toBeLessThanOrEqual(255);
    const [r2, g2, b2] = gradePixel(0, 0, 0);
    expect(r2).toBeGreaterThanOrEqual(0);
    expect(g2).toBeGreaterThanOrEqual(0);
    expect(b2).toBeGreaterThanOrEqual(0);
  });
});

import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain JS module shared with the k6 runtime, no types
import { numEnv } from '../k6/lib/config.js';

/**
 * numEnv guards a bug class this branch hit twice: `Number(raw || fallback)`
 * silently swallows an explicit `0`, so `-e PLACE_RATE=0` (documented as the
 * way to disable placements) and `-e NEW_IDENTITY_RATE=0` (pin the run to the
 * seeded pool) both had no effect. Only `undefined` and `''` may fall back.
 */
describe('numEnv', () => {
  it('honours an explicit zero rather than falling back', () => {
    expect(numEnv('0', 0.15)).toBe(0);
  });

  it('falls back when the var is absent', () => {
    expect(numEnv(undefined, 0.15)).toBe(0.15);
  });

  it('falls back when the var is present but empty', () => {
    // e.g. `export PLACE_RATE=` in a shell, or a blank line in .env
    expect(numEnv('', 0.15)).toBe(0.15);
  });

  it('parses ordinary integer and fractional values', () => {
    expect(numEnv('800', 1)).toBe(800);
    expect(numEnv('0.25', 1)).toBe(0.25);
  });

  it('does not treat other falsy-looking strings as absent', () => {
    expect(numEnv('0.0', 9)).toBe(0);
    expect(numEnv('-1', 9)).toBe(-1);
  });

  it('yields NaN on non-numeric input rather than silently using the fallback', () => {
    // Surfacing NaN is deliberate: a typo'd -e SESSIONS=abc should fail loudly
    // in k6's executor config, not quietly run the default volume.
    expect(Number.isNaN(numEnv('abc', 5))).toBe(true);
  });
});

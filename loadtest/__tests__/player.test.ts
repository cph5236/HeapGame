import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain JS module shared with the k6 runtime, no types
import { pickIdentity } from '../k6/lib/player.js';

const POOL = [
  { playerId: 'a', playerSecret: 'sa' },
  { playerId: 'b', playerSecret: 'sb' },
  { playerId: 'c', playerSecret: 'sc' },
];

/** Deterministic pseudo-random sequence. A constant rand is degenerate — two
 *  UUIDs drawn from it are necessarily identical, which no real RNG does. */
function seededRand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('pickIdentity', () => {
  it('draws from the pool when the roll is above the new-identity rate', () => {
    const id = pickIdentity(POOL, 0, 0, () => 0.99);
    expect(POOL.some((p) => p.playerId === id.playerId)).toBe(true);
    expect(id.isNew).toBe(false);
  });

  it('mints a fresh identity when the roll is below the new-identity rate', () => {
    const varying = seededRand(1);
    let first = true;
    const rand = () => {
      if (first) { first = false; return 0.0; } // force the mint branch
      return varying();
    };

    const id = pickIdentity(POOL, 0, 0, rand);

    expect(POOL.some((p) => p.playerId === id.playerId)).toBe(false);
    expect(id.isNew).toBe(true);
    expect(id.playerSecret).toBeTruthy();
    expect(id.playerId).not.toBe(id.playerSecret);
    expect(id.playerId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('spreads different VUs across different pool members', () => {
    const a = pickIdentity(POOL, 0, 0, () => 0.99);
    const b = pickIdentity(POOL, 1, 0, () => 0.99);
    expect(a.playerId).not.toBe(b.playerId);
  });

  it('is deterministic for the same vuId and iteration', () => {
    const a = pickIdentity(POOL, 2, 5, () => 0.99);
    const b = pickIdentity(POOL, 2, 5, () => 0.99);
    expect(a.playerId).toBe(b.playerId);
  });

  it('never indexes past the end of the pool', () => {
    for (let vu = 0; vu < 50; vu++) {
      const id = pickIdentity(POOL, vu, vu * 7, () => 0.99);
      expect(id.playerId).toBeTruthy();
    }
  });
});

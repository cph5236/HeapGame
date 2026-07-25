import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain JS module shared with the k6 runtime, no types
import { pickIdentity } from '../k6/lib/player.js';

const POOL = [
  { playerId: 'a', playerSecret: 'sa' },
  { playerId: 'b', playerSecret: 'sb' },
  { playerId: 'c', playerSecret: 'sc' },
];

describe('pickIdentity', () => {
  it('draws from the pool when the roll is above the new-identity rate', () => {
    const id = pickIdentity(POOL, 0, 0, () => 0.99);
    expect(POOL.some((p) => p.playerId === id.playerId)).toBe(true);
    expect(id.isNew).toBe(false);
  });

  it('mints a fresh identity when the roll is below the new-identity rate', () => {
    const id = pickIdentity(POOL, 0, 0, () => 0.0);
    expect(POOL.some((p) => p.playerId === id.playerId)).toBe(false);
    expect(id.isNew).toBe(true);
    expect(id.playerSecret).toBeTruthy();
    expect(id.playerId).not.toBe(id.playerSecret);
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

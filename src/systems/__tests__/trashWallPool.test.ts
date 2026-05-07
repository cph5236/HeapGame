import { describe, it, expect } from 'vitest';
import { pickTrashWallPool } from '../trashWallPool';

type Def = { textureKey: string; rarity: number };

function seededRng(seed: number): () => number {
  // Mulberry32 — deterministic, good enough for tests
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const defs: Def[] = Array.from({ length: 100 }, (_, i) => ({
  textureKey: `k${i}`,
  rarity: i < 50 ? 1.0 : 0.1,  // first 50 are 10× more likely than last 50
}));

describe('pickTrashWallPool', () => {
  it('returns exactly count items when count <= defs.length', () => {
    const rng = seededRng(42);
    const out = pickTrashWallPool(defs, 50, rng);
    expect(out).toHaveLength(50);
  });

  it('returns all items when count >= defs.length', () => {
    const rng = seededRng(42);
    const out = pickTrashWallPool(defs, 500, rng);
    expect(out).toHaveLength(defs.length);
  });

  it('never duplicates', () => {
    const rng = seededRng(7);
    const out = pickTrashWallPool(defs, 50, rng);
    const keys = new Set(out.map(d => d.textureKey));
    expect(keys.size).toBe(out.length);
  });

  it('is deterministic given the same rng seed', () => {
    const a = pickTrashWallPool(defs, 30, seededRng(99));
    const b = pickTrashWallPool(defs, 30, seededRng(99));
    expect(a.map(d => d.textureKey)).toEqual(b.map(d => d.textureKey));
  });

  it('weights selection — high-rarity items appear more often than low-rarity over many trials', () => {
    let highCount = 0;
    let lowCount  = 0;
    for (let trial = 0; trial < 200; trial++) {
      const out = pickTrashWallPool(defs, 10, seededRng(trial + 1));
      for (const d of out) {
        if (d.rarity === 1.0) highCount++;
        else lowCount++;
      }
    }
    // High-rarity (10× weight) should dominate; allow generous margin
    expect(highCount).toBeGreaterThan(lowCount * 3);
  });

  it('handles empty input', () => {
    expect(pickTrashWallPool([], 10, seededRng(1))).toEqual([]);
  });

  it('handles zero count', () => {
    expect(pickTrashWallPool(defs, 0, seededRng(1))).toEqual([]);
  });
});

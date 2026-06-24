import { describe, it, expect } from 'vitest';
import { buildInfiniteEntry } from '../infiniteCatalog';
import { INFINITE_HEAP_ID } from '../infiniteDefs';
import type { HeapSummary } from '../../../shared/heapTypes';

function realRow(): HeapSummary {
  return {
    id: INFINITE_HEAP_ID,
    version: 1,
    createdAt: '2026-06-22T00:00:00.000Z',
    topY: 1,
    params: {
      name: 'Infinite', difficulty: 5, spawnRateMult: 2, coinMult: 3, scoreMult: 1.5,
      worldHeight: 50000000, ghostPointCount: 1,
      baseItemSpawnRate: 0.33, positiveItemSpawnRate: 0.15, negativeItemSpawnRate: 0.85,
    },
  };
}

describe('buildInfiniteEntry', () => {
  it('uses the real FFF row and forces isInfinite=true, preserving its mults', () => {
    const entry = buildInfiniteEntry([realRow(), { id: 'other' } as HeapSummary]);
    expect(entry.id).toBe(INFINITE_HEAP_ID);
    expect(entry.params.isInfinite).toBe(true);
    expect(entry.params.spawnRateMult).toBe(2);
    expect(entry.params.coinMult).toBe(3);
    expect(entry.params.scoreMult).toBe(1.5);
    expect(entry.params.worldHeight).toBe(50000000);
  });

  it('falls back to a synthetic entry when no FFF row is present', () => {
    const entry = buildInfiniteEntry([{ id: 'other' } as HeapSummary]);
    expect(entry.id).toBe(INFINITE_HEAP_ID);
    expect(entry.params.isInfinite).toBe(true);
    expect(entry.params.spawnRateMult).toBe(1.0);
    expect(entry.params.coinMult).toBe(1.0);
    expect(entry.params.scoreMult).toBe(1.0);
  });
});

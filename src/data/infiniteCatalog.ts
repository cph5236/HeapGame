import type { HeapSummary } from '../../shared/heapTypes';
import { INFINITE_HEAP_ID } from './infiniteDefs';
import { MOCK_HEAP_HEIGHT_PX } from '../constants';

/** Offline / not-seeded fallback — keeps infinite playable without a server row. */
const SYNTHETIC_INFINITE_ENTRY: HeapSummary = {
  id: INFINITE_HEAP_ID,
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  topY: NaN,
  params: {
    name: 'Infinite Heap',
    difficulty: 5.0,
    spawnRateMult: 1.0,
    coinMult: 1.0,
    scoreMult: 1.0,
    worldHeight: MOCK_HEAP_HEIGHT_PX,
    isInfinite: true,
    ghostPointCount: 1,
    baseItemSpawnRate: 0.33,
    positiveItemSpawnRate: 0.15,
    negativeItemSpawnRate: 0.85,
  },
};

/**
 * Build the infinite-heap catalog entry. Prefers the real server FFF row (so DB
 * params drive the run), merging in the client-only `isInfinite` flag the DB has
 * no column for. Falls back to a synthetic entry when the server returned no
 * infinite row (offline / not seeded).
 */
export function buildInfiniteEntry(summaries: HeapSummary[]): HeapSummary {
  const real = summaries.find(s => s.id === INFINITE_HEAP_ID);
  if (!real) return SYNTHETIC_INFINITE_ENTRY;
  return { ...real, params: { ...real.params, isInfinite: true } };
}

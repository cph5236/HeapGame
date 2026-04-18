import { HeapEntry } from '../data/heapTypes';
import { OBJECT_DEFS } from '../data/heapObjectDefs';
import { HeapState } from './HeapState';
import { findSurfaceY } from './HeapSurface';
import { MOCK_HEAP_HEIGHT_PX } from '../constants';

const OBJECT_COUNT = Object.keys(OBJECT_DEFS).length;

/**
 * Procedurally generates HeapEntry[] for one column of the infinite heap.
 * Entries are stacked using findSurfaceY so blocks sit on each other naturally.
 *
 * @param seed      - Deterministic PRNG seed (different per run per column)
 * @param xMin      - Left edge of column in world coords
 * @param xMax      - Right edge of column in world coords
 * @param numBlocks - Number of blocks to generate
 */
export function buildColumnEntries(
  seed: number,
  xMin: number,
  xMax: number,
  numBlocks: number,
): HeapEntry[] {
  const state = new HeapState(MOCK_HEAP_HEIGHT_PX, seed);
  const entries: HeapEntry[] = [];

  for (let i = 0; i < numBlocks; i++) {
    const keyid = Math.floor(state.seededRandom(i * 3) * OBJECT_COUNT);
    const def   = OBJECT_DEFS[keyid] ?? OBJECT_DEFS[0];

    const usableMin = xMin + def.width / 2;
    const usableMax = xMax - def.width / 2;
    if (usableMax <= usableMin) continue;

    const cx       = usableMin + state.seededRandom(i * 3 + 1) * (usableMax - usableMin);
    const surfaceY = findSurfaceY(cx, def.width, entries);
    const y        = surfaceY - def.height / 2;

    entries.push({ x: cx, y, keyid });
  }

  return entries;
}

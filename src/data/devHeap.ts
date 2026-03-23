import { HeapEntry } from './heapTypes';
import { OBJECT_DEFS } from './heapObjectDefs';
import { HeapState } from '../systems/HeapState';
import { findSurfaceY } from '../systems/HeapSurface';
import { WORLD_WIDTH, MOCK_HEAP_HEIGHT_PX, MOCK_SEED } from '../constants';

/**
 * Dev/test heap: 2000 seeded-random blocks scattered across the middle 75%
 * of world width, each resting on the surface below it.
 *
 * Format mirrors what the backend will eventually serve:
 *   GET /heap/chunk?fromY=X&toY=Y  →  HeapEntry[]
 *
 * Each entry's (x, y) is the CENTER of the object in world coordinates.
 * Entries are sorted by Y descending (bottom of heap first) so HeapGenerator
 * can stream upward using a simple pointer.
 */

const NUM_BLOCKS = 200;
const STACK_GAP  = 0; // px of air between stacked items

function buildHeap(): HeapEntry[] {
  const state   = new HeapState(MOCK_HEAP_HEIGHT_PX, MOCK_SEED);
  const entries: HeapEntry[] = [];

  for (let i = 0; i < NUM_BLOCKS; i++) {
    // 3 seeded draws per block: keyid, cx-fraction, (gap unused — fixed)
    const keyid = Math.floor(state.seededRandom(i * 3 + 0) * 3);
    const def   = OBJECT_DEFS[keyid];

    // cx constrained to middle 75% of world, with half-width inset so block
    // never hangs off the zone boundary
    const xMin = WORLD_WIDTH * 0.125 + def.width / 2;
    const xMax = WORLD_WIDTH * 0.875 - def.width / 2;
    const cx   = xMin + state.seededRandom(i * 3 + 1) * (xMax - xMin);

    // Block rests on whatever is already in entries at this X span
    const surfaceY = findSurfaceY(cx, def.width, entries);
    const y        = surfaceY - def.height / 2 - STACK_GAP;

    entries.push({ x: cx, y, keyid });
  }

  // Sort descending by Y so HeapGenerator's nextLoadIndex pointer can advance
  // upward (toward smaller Y) as the player climbs
  return entries.sort((a, b) => b.y - a.y);
}

export const DEV_HEAP: HeapEntry[] = buildHeap();

import { HeapEntry } from '../data/heapTypes';
import { OBJECT_DEFS } from '../data/heapObjectDefs';
import { MOCK_HEAP_HEIGHT_PX } from '../constants';

/**
 * Returns the Y of the topmost surface overlapping the horizontal span
 * [cx - width/2, cx + width/2] among the given entries.
 *
 * Falls back to MOCK_HEAP_HEIGHT_PX (world floor) if nothing overlaps —
 * so placing on an empty column naturally rests on the ground.
 *
 * Used by:
 *  - devHeap.ts at build time (each generated block rests on what's below)
 *  - GameScene at runtime (player spawn Y, new block placement Y)
 */
export function findSurfaceY(
  cx: number,
  width: number,
  entries: readonly HeapEntry[],
): number {
  const left  = cx - width / 2;
  const right = cx + width / 2;
  let surfaceY = MOCK_HEAP_HEIGHT_PX;

  for (const entry of entries) {
    const def    = OBJECT_DEFS[entry.keyid] ?? OBJECT_DEFS[0];
    const eW     = entry.w ?? def.width;
    const eH     = entry.h ?? def.height;
    const eLeft  = entry.x - eW / 2;
    const eRight = entry.x + eW / 2;

    if (eRight > left && eLeft < right) {
      const topEdge = entry.y - eH / 2;
      if (topEdge < surfaceY) surfaceY = topEdge;
    }
  }

  return surfaceY;
}

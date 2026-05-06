// shared/heapPolygon/surface.ts
//
// findSurfaceY — top-of-stack lookup for placing a new entry.
// Parameterized over floorY and item defs.

import type { HeapEntry, ItemDefs } from './types';

export function findSurfaceY(
  cx: number,
  width: number,
  entries: readonly HeapEntry[],
  floorY: number,
  defs: ItemDefs,
): number {
  const left  = cx - width / 2;
  const right = cx + width / 2;
  let surfaceY = floorY;

  for (const entry of entries) {
    const def    = defs[entry.keyid] ?? defs[0];
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

// src/systems/HeapSurface.ts
//
// Thin wrapper — pre-binds MOCK_HEAP_HEIGHT_PX and OBJECT_DEFS for existing
// call sites. Logic lives in shared/heapPolygon/surface.ts.

import type { HeapEntry } from '../data/heapTypes';
import { OBJECT_DEFS } from '../data/heapObjectDefs';
import { MOCK_HEAP_HEIGHT_PX } from '../constants';
import { findSurfaceY as _findSurfaceY } from '../../shared/heapPolygon/surface';
import type { ItemDefs } from '../../shared/heapPolygon/types';

export function findSurfaceY(
  cx: number,
  width: number,
  entries: readonly HeapEntry[],
): number {
  return _findSurfaceY(cx, width, entries, MOCK_HEAP_HEIGHT_PX, OBJECT_DEFS as unknown as ItemDefs);
}

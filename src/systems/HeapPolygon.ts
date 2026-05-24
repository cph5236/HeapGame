// src/systems/HeapPolygon.ts
//
// Thin wrapper over shared/heapPolygon/* — pre-binds OBJECT_DEFS so existing
// call sites (heapWorker, InfiniteGameScene, etc.) keep their old signatures.

import { OBJECT_DEFS } from '../data/heapObjectDefs';
import type { HeapEntry } from '../data/heapTypes';
import {
  computeBandScanlines as _computeBandScanlines,
  computeBandPolygon,
  simplifyPolygon,
  computeRowSlopeAngleDeg,
  verticesToScanlines,
  SCAN_STEP,
} from '../../shared/heapPolygon/polygon';
import type { ItemDefs, Vertex, ScanlineRow } from '../../shared/heapPolygon/types';

export type { Vertex, ScanlineRow };
export { computeRowSlopeAngleDeg, verticesToScanlines, SCAN_STEP };

export function computeBandScanlines(
  entries: HeapEntry[],
  bandTop: number,
  bandBottom: number,
): ScanlineRow[] {
  return _computeBandScanlines(entries, bandTop, bandBottom, OBJECT_DEFS as unknown as ItemDefs);
}

export { computeBandPolygon, simplifyPolygon };

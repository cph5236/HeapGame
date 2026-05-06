// shared/heapPolygon/objectDefs.ts
//
// Minimal item-def snapshot used by the server's default-polygon generator.
// Mirrors keyids 0–2 of src/data/heapItemDefs.ts (allow-wheel, bw-motor-pedal-bike,
// car-tire). Width/height only — the server never renders, only computes geometry.
//
// If src/data/heapItemDefs.ts dimensions for keyids 0–2 ever change, update this
// snapshot to keep server-generated defaults visually consistent with the seed
// script's polygon shape. (Existing seeded heaps are unaffected.)

import type { ItemDefs } from './types';

export const DEFAULT_HEAP_DEFS: ItemDefs = {
  0: { width: 69, height: 96 },  // allow-wheel
  1: { width: 96, height: 79 },  // bw-motor-pedal-bike
  2: { width: 61, height: 96 },  // car-tire
};

// shared/heapPolygon/generate.ts
//
// Server-callable default polygon generator. Mirrors the pipeline that
// scripts/seed-heap.ts uses, with the same defaults (1200 blocks, simplify
// epsilon 2). Pure-math, no DOM/Phaser/runtime deps.

import { HeapState } from './state';
import { findSurfaceY } from './surface';
import { computeBandScanlines, computeBandPolygon, simplifyPolygon } from './polygon';
import { DEFAULT_HEAP_DEFS } from './objectDefs';
import type { HeapEntry, Vertex } from './types';

// Mirror of src/constants.ts WORLD_WIDTH. Kept inline so shared/ stays
// dependency-free of src/.
const WORLD_WIDTH = 960;

export interface GenerateOptions {
  numBlocks?: number;
  simplifyEpsilon?: number;
}

export function generateDefaultPolygon(
  seed: number,
  worldHeight: number,
  opts: GenerateOptions = {},
): Vertex[] {
  const numBlocks       = opts.numBlocks       ?? 50;
  const simplifyEpsilon = opts.simplifyEpsilon ?? 2;

  const state = new HeapState(seed);
  const entries: HeapEntry[] = [];
  const numKeys = Object.keys(DEFAULT_HEAP_DEFS).length;

  for (let i = 0; i < numBlocks; i++) {
    const keyid = Math.floor(state.seededRandom(i * 3) * numKeys);
    const def   = DEFAULT_HEAP_DEFS[keyid];

    const xMin = WORLD_WIDTH * 0.125 + def.width / 2;
    const xMax = WORLD_WIDTH * 0.875 - def.width / 2;
    const cx   = xMin + state.seededRandom(i * 3 + 1) * (xMax - xMin);

    const surfaceY = findSurfaceY(cx, def.width, entries, worldHeight, DEFAULT_HEAP_DEFS);
    const y = surfaceY - def.height / 2;

    entries.push({ x: cx, y, keyid });
  }

  const rows = computeBandScanlines(entries, 0, worldHeight, DEFAULT_HEAP_DEFS);
  const full = computeBandPolygon(rows);
  return simplifyPolygon(full, simplifyEpsilon);
}

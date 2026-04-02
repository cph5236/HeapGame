/**
 * Seed script — generates an initial heap polygon and uploads it to the server.
 *
 * Usage:
 *   npm run seed                                           # targets http://localhost:8787
 *   HEAP_SERVER_URL=https://heap-server.workers.dev npm run seed
 *   OVERWRITE=true npm run seed                           # pass overwriteHeap:true
 */

import { HeapState } from '../src/systems/HeapState';
import { OBJECT_DEFS } from '../src/data/heapObjectDefs';
import { findSurfaceY } from '../src/systems/HeapSurface';
import {
  computeBandScanlines,
  computeBandPolygon,
  simplifyPolygon,
} from '../src/systems/HeapPolygon';
import { WORLD_WIDTH, MOCK_HEAP_HEIGHT_PX, MOCK_SEED } from '../src/constants';
import type { HeapEntry } from '../src/data/heapTypes';
import type { SeedHeapResponse } from '../shared/heapTypes';

// ── Config ────────────────────────────────────────────────────────────────────

const SERVER_URL = process.env.HEAP_SERVER_URL ?? 'http://localhost:8787';
const NUM_BLOCKS = 500;
const SIMPLIFY_EPSILON = 2;
const OVERWRITE = process.env.OVERWRITE === 'true';

// ── Generate HeapEntry[] via seeded PRNG ──────────────────────────────────────

function buildHeap(): HeapEntry[] {
  const state = new HeapState(MOCK_HEAP_HEIGHT_PX, MOCK_SEED);
  const entries: HeapEntry[] = [];

  for (let i = 0; i < NUM_BLOCKS; i++) {
    const keyid = Math.floor(state.seededRandom(i * 3 + 0) * 3);
    const def = OBJECT_DEFS[keyid];

    const xMin = WORLD_WIDTH * 0.125 + def.width / 2;
    const xMax = WORLD_WIDTH * 0.875 - def.width / 2;
    const cx = xMin + state.seededRandom(i * 3 + 1) * (xMax - xMin);

    const surfaceY = findSurfaceY(cx, def.width, entries);
    const y = surfaceY - def.height / 2;

    entries.push({ x: cx, y, keyid });
  }

  return entries;
}

// ── Convert entries to a simplified polygon ───────────────────────────────────

interface Vertex { x: number; y: number }

function buildPolygon(entries: HeapEntry[]): Vertex[] {
  const rows = computeBandScanlines(entries, 0, MOCK_HEAP_HEIGHT_PX);
  const full = computeBandPolygon(rows);
  return simplifyPolygon(full, SIMPLIFY_EPSILON);
}

// ── POST to /heap/seed ────────────────────────────────────────────────────────

async function seed(): Promise<void> {
  console.log(`Building heap with ${NUM_BLOCKS} blocks…`);
  const entries = buildHeap();
  console.log(`  Generated ${entries.length} entries`);

  console.log('Computing polygon…');
  const vertices = buildPolygon(entries);
  console.log(`  Polygon: ${vertices.length} vertices after simplification`);

  const url = `${SERVER_URL}/heap/seed`;
  console.log(`POSTing to ${url}${OVERWRITE ? ' (overwriteHeap:true)' : ''}…`);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vertices, overwriteHeap: OVERWRITE }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`  ✗ ${res.status}: ${body}`);
    process.exit(1);
  }

  const data = await res.json() as SeedHeapResponse;
  console.log(`  ✓ Seeded! version=${data.version}, vertexCount=${data.vertexCount}, hash=${data.hash}`);
}

seed().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

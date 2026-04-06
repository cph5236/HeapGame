/**
 * Seed script — generates an initial heap polygon and uploads it to the server.
 *
 * Usage:
 *   npm run seed                                                    # create new heap
 *   VITE_HEAP_SERVER_URL=https://heap-server.workers.dev npm run seed   # target prod
 *   OVERWRITE=true TARGET_HEAP_ID=<guid> npm run seed              # reset existing heap
 *   VERBOSE=true npm run seed                                       # show polygon details
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
import type { CreateHeapResponse, ResetHeapResponse } from '../shared/heapTypes';

// ── Config ────────────────────────────────────────────────────────────────────

const SERVER_URL = process.env.VITE_HEAP_SERVER_URL ?? 'http://localhost:8787';
const NUM_BLOCKS = 200;
const SIMPLIFY_EPSILON = 2;
const OVERWRITE = process.env.OVERWRITE === 'true';
const TARGET_HEAP_ID = process.env.TARGET_HEAP_ID ?? '';
const VERBOSE = process.env.VERBOSE === 'true';

// ── Generate HeapEntry[] via seeded PRNG ──────────────────────────────────────

function buildHeap(): HeapEntry[] {
  const state = new HeapState(MOCK_HEAP_HEIGHT_PX, MOCK_SEED);
  const entries: HeapEntry[] = [];

  for (let i = 0; i < NUM_BLOCKS; i++) {
    const keyid = Math.floor(state.seededRandom(i * 3) * 3);
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
  if (VERBOSE) console.log(`  Scanlines: ${rows.length} rows`);

  const full = computeBandPolygon(rows);
  if (VERBOSE) console.log(`  Before simplify: ${full.length} vertices`);

  const simplified = simplifyPolygon(full, SIMPLIFY_EPSILON);
  if (VERBOSE) {
    console.log(`  After simplify (epsilon=${SIMPLIFY_EPSILON}): ${simplified.length} vertices`);
    const yValues = simplified.map(v => v.y).sort((a, b) => a - b);
    console.log(`  Y range: ${yValues[0]} to ${yValues[yValues.length - 1]}`);
  }

  return simplified;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function seed(): Promise<void> {
  if (OVERWRITE) {
    if (!TARGET_HEAP_ID) {
      console.error('OVERWRITE=true requires TARGET_HEAP_ID=<guid>');
      console.error('  Example: TARGET_HEAP_ID=abc123 OVERWRITE=true npm run seed');
      process.exit(1);
    }

    const url = `${SERVER_URL}/heaps/${TARGET_HEAP_ID}/reset`;
    console.log(`Resetting heap ${TARGET_HEAP_ID} at ${url}…`);

    const res = await fetch(url, { method: 'PUT' });
    if (!res.ok) {
      const body = await res.text();
      console.error(`  ✗ ${res.status}: ${body}`);
      process.exit(1);
    }

    const data = await res.json() as ResetHeapResponse;
    console.log(`  ✓ Reset! id=${data.id}, version=${data.version}, previousVersion=${data.previousVersion}`);
    return;
  }

  console.log(`Building heap with ${NUM_BLOCKS} blocks…`);
  const entries = buildHeap();
  if (VERBOSE) {
    const xVals = entries.map(e => e.x).sort((a, b) => a - b);
    const yVals = entries.map(e => e.y).sort((a, b) => a - b);
    console.log(`  Entry X range: ${xVals[0]?.toFixed(1)} to ${xVals[xVals.length - 1]?.toFixed(1)}`);
    console.log(`  Entry Y range: ${yVals[0]?.toFixed(1)} to ${yVals[yVals.length - 1]?.toFixed(1)}`);
  }

  console.log('Computing polygon…');
  const vertices = buildPolygon(entries);
  console.log(`  Polygon: ${vertices.length} vertices after simplification`);

  if (VERBOSE) {
    console.log('Vertex list (first 10):');
    vertices.slice(0, 10).forEach((v, i) => {
      console.log(`    [${i}] x=${v.x.toFixed(1)}, y=${v.y.toFixed(1)}`);
    });
  }

  const url = `${SERVER_URL}/heaps`;
  console.log(`POSTing to ${url}…`);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vertices }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`  ✗ ${res.status}: ${body}`);
    process.exit(1);
  }

  const data = await res.json() as CreateHeapResponse;
  console.log(`  ✓ Created! id=${data.id}, baseId=${data.baseId}, version=${data.version}, vertexCount=${data.vertexCount}`);
  console.log(`  Save this id — you will need it for OVERWRITE: TARGET_HEAP_ID=${data.id}`);
}

seed().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

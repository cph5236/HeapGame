/**
 * Seed script — generates an initial heap polygon and uploads it to the server.
 *
 * Usage:
 *   npm run seed                                                                    # create new heap (random seed)
 *   NAME="Downtown Dump" DIFFICULTY=3 SPAWN_MULT=1.5 COIN_MULT=1.25 SCORE_MULT=1.25 npm run seed
 *   SEED=42 NAME="Horder's Heap" DIFFICULTY=2 npm run seed                         # fixed map seed
 *   WORLD_HEIGHT=50000 npm run seed                                                 # 50 k-px world (default 5 000 000)
 *   VITE_HEAP_SERVER_URL=https://heap-server.workers.dev npm run seed              # target prod
 *   OVERWRITE=true TARGET_HEAP_ID=<guid> npm run seed                              # reset existing heap
 *   VERBOSE=true npm run seed                                                       # show polygon details
 
      SEED SCRIPT WITH OVERWRITE:
        1. Run with OVERWRITE=true and a TARGET_HEAP_ID to reset an existing heap to empty.
        2. The response will include the heap id and new version number.
        3. Use that heap id for TARGET_HEAP_ID in future runs to overwrite the same heap.
        
        --Script example:
        NAME="Downtown Dump" WORLD_HEIGHT=5000000 DIFFICULTY=3.0 SPAWN_MULT=1.5 COIN_MULT=1.25 SCORE_MULT=1.25 OVERWRITE=true TARGET_HEAP_ID=<guid> npm run seed

*/

/// <reference types="node" />

import { generateDefaultPolygon } from '../shared/heapPolygon';
import { MOCK_HEAP_HEIGHT_PX } from '../src/constants';
import type { CreateHeapResponse, ResetHeapResponse } from '../shared/heapTypes';

// ── Config ────────────────────────────────────────────────────────────────────

const SERVER_URL = process.env.VITE_HEAP_SERVER_URL ?? 'http://localhost:8787';
const OVERWRITE = process.env.OVERWRITE === 'true';
const TARGET_HEAP_ID = process.env.TARGET_HEAP_ID ?? '';
const VERBOSE = process.env.VERBOSE === 'true';

// Heap params from env
const PARAM_NAME         = process.env.NAME         ?? '';
const PARAM_DIFF         = process.env.DIFFICULTY   ? Number(process.env.DIFFICULTY)   : 1.0;
const PARAM_SPAWN        = process.env.SPAWN_MULT   ? Number(process.env.SPAWN_MULT)   : 1.0;
const PARAM_COIN         = process.env.COIN_MULT    ? Number(process.env.COIN_MULT)    : 1.0;
const PARAM_SCORE        = process.env.SCORE_MULT   ? Number(process.env.SCORE_MULT)   : 1.0;
const PARAM_WORLD_HEIGHT = process.env.WORLD_HEIGHT ? Number(process.env.WORLD_HEIGHT) : MOCK_HEAP_HEIGHT_PX;
const PARAM_SEED         = process.env.SEED         ? Number(process.env.SEED)         : Math.floor(Math.random() * 1_000_000);

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

    const params = {
      name:          PARAM_NAME || undefined,
      difficulty:    PARAM_DIFF,
      spawnRateMult: PARAM_SPAWN,
      coinMult:      PARAM_COIN,
      scoreMult:     PARAM_SCORE,
      worldHeight:   PARAM_WORLD_HEIGHT,
    };
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': process.env.ADMIN_SECRET ?? '',
      },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`  ✗ ${res.status}: ${body}`);
      process.exit(1);
    }

    const data = await res.json() as ResetHeapResponse;
    console.log(`  ✓ Reset! id=${data.id}, version=${data.version}, previousVersion=${data.previousVersion}`);
    return;
  }

  console.log(`Generating polygon with seed ${PARAM_SEED}…`);
  const vertices = generateDefaultPolygon(PARAM_SEED, PARAM_WORLD_HEIGHT);
  if (VERBOSE) console.log(`  Polygon vertices: ${vertices.length}`);


  const url = `${SERVER_URL}/heaps`;
  console.log(`POSTing to ${url}…`);

  const params = {
    name:          PARAM_NAME || `Heap #${Date.now().toString(36).slice(-4)}`,
    difficulty:    PARAM_DIFF,
    spawnRateMult: PARAM_SPAWN,
    coinMult:      PARAM_COIN,
    scoreMult:     PARAM_SCORE,
    worldHeight:   PARAM_WORLD_HEIGHT,
  };
  console.log('Heap params:', params);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Secret': process.env.ADMIN_SECRET ?? '',
    },
    body: JSON.stringify({ vertices, params }),
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

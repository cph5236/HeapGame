/**
 * Seeds the load-test staging environment:
 *   - a small heap fixture (fresh, empty live zone)
 *   - a large heap fixture (pre-grown live zone, to test how placement CPU
 *     scales with polygon size against the 10ms free-tier CPU cap)
 *   - a pool of player identities, reused across runs so that most score
 *     submissions are not personal bests (see the design doc's KV budget)
 *
 * Usage:
 *   BASE_URL=https://heap-server-staging.<sub>.workers.dev \
 *   ADMIN_SECRET=... npm run loadtest:seed
 */

/// <reference types="node" />

import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { generateDefaultPolygon } from '../../shared/heapPolygon';
import { MOCK_HEAP_HEIGHT_PX, WORLD_WIDTH, HEAP_TOP_ZONE_PX } from '../../src/constants';
import type { CreateHeapResponse, Vertex } from '../../shared/heapTypes';

const BASE_URL     = process.env.BASE_URL     ?? '';
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? '';
const POOL_SIZE    = Number(process.env.POOL_SIZE ?? 200);
/** Vertices pre-placed on the large fixture. */
const LARGE_SEED_VERTICES = Number(process.env.LARGE_SEED_VERTICES ?? 400);
/**
 * Delay between growth placements. POST /heaps/:id/place is rate-limited to
 * RL_PLACE = 30 requests/min per client IP (server/wrangler.toml) and this
 * script is not exempt from it (that limiter has no admin-secret bypass) —
 * without pacing, the growth loop below would start getting 429s around
 * placement #30 and abort. 2200ms keeps us under the 2000ms/request cap with
 * a small safety margin. Override for a faster/slower loop if the staging
 * limiter config ever changes.
 */
const PLACE_DELAY_MS = Number(process.env.PLACE_DELAY_MS ?? 2200);

if (!BASE_URL)     throw new Error('BASE_URL is required');
if (!ADMIN_SECRET) throw new Error('ADMIN_SECRET is required');

/**
 * Production safety gate. Deliberately an allow-list (only URLs that clearly
 * look like staging or a local dev server pass) rather than a deny-list on
 * the production hostname — a deny-list silently stops protecting the day
 * the production URL changes shape. Staging Workers are expected to contain
 * "staging" in their hostname (e.g. heap-server-staging.<sub>.workers.dev);
 * local dev servers are exempted so this script stays useful against
 * `wrangler dev`.
 */
function looksLikeStaging(url: string): boolean {
  return /\bstaging\b/i.test(url) || /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(url);
}

if (!looksLikeStaging(BASE_URL)) {
  throw new Error(
    `Refusing to seed a URL that doesn't look like the staging Worker or a local dev server: "${BASE_URL}". ` +
    'Expected the hostname to contain "staging" (e.g. https://heap-server-staging.<sub>.workers.dev) or a localhost address.',
  );
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Mirrors the placement-validation window in server/src/routes/heap.ts (POST
// /:id/place, ~line 403 on). These are module-local consts there, not
// exported from server/src/constants.ts (which only holds MAX_ID_LEN), so
// they're re-derived here rather than imported. Keep in sync if either
// changes.
const PLACE_X_MIN = WORLD_WIDTH * 0.125;
const PLACE_X_MAX = WORLD_WIDTH * 0.875;
const PLACE_HEIGHT_GRACE_PX = 200;

/**
 * Mirrors D1HeapDB.createHeap's initialTopY computation (server/src/db.ts):
 * the summit is the smallest y among the vertices actually sent to the
 * server. Since this script generates those vertices itself, it can predict
 * the resulting top_y exactly rather than needing an extra round-trip to
 * read it back.
 */
function computeInitialTopY(vertices: Vertex[]): number {
  return vertices.length > 0 ? Math.min(...vertices.map((v) => v.y)) : 0;
}

async function createHeap(name: string): Promise<{ id: string; topY: number }> {
  const seed = Math.floor(Math.random() * 1_000_000);
  const vertices = generateDefaultPolygon(seed, MOCK_HEAP_HEIGHT_PX);
  const res = await fetch(`${BASE_URL}/heaps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
    body: JSON.stringify({
      vertices,
      params: {
        name,
        difficulty: 1.0,
        spawnRateMult: 1.0,
        coinMult: 1.0,
        scoreMult: 1.0,
        worldHeight: MOCK_HEAP_HEIGHT_PX,
      },
    }),
  });
  if (!res.ok) throw new Error(`createHeap(${name}) failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as CreateHeapResponse;
  return { id: body.id, topY: computeInitialTopY(vertices) };
}

async function main(): Promise<void> {
  const small = await createHeap('LoadTest Small');
  const large = await createHeap('LoadTest Large');
  console.log(`small heap: ${small.id}`);
  console.log(`large heap: ${large.id} (topY=${large.topY})`);

  // Grow the large fixture. Placements go through the real endpoint so the
  // polygon is shaped exactly as production data would be.
  const secret = randomUUID();
  const seeder = randomUUID();

  // Valid placement window on a freshly created heap, mirroring the route's
  // checks against the live (empty) zone:
  //   x in [PLACE_X_MIN, PLACE_X_MAX]
  //   y in [topY - PLACE_HEIGHT_GRACE_PX, topY + HEAP_TOP_ZONE_PX]
  // (y >= 0 and y <= world_height are also required but are non-binding here
  // — MOCK_HEAP_HEIGHT_PX is enormous relative to this window.)
  //
  // The upper y bound is also the live zone's active-zone floor
  // (liveZoneBottomY) while the zone is still empty, and that floor is
  // thereafter the running max of every y placed into it — it can only grow,
  // never shrink. So the very first placement is pinned to exactly
  // topY + HEAP_TOP_ZONE_PX to lock the floor at its widest possible value;
  // every later placement is then free to land anywhere in the full window.
  const yLow  = Math.max(0, large.topY - PLACE_HEIGHT_GRACE_PX);
  const yHigh = large.topY + HEAP_TOP_ZONE_PX;

  let accepted = 0;
  for (let i = 0; i < LARGE_SEED_VERTICES; i++) {
    const x = PLACE_X_MIN + Math.random() * (PLACE_X_MAX - PLACE_X_MIN);
    const y = i === 0 ? yHigh : yLow + Math.random() * (yHigh - yLow);

    const res = await fetch(`${BASE_URL}/heaps/${large.id}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Player-Token': secret },
      body: JSON.stringify({ x, y, playerGuid: seeder }),
    });
    if (!res.ok) throw new Error(`seed placement ${i} failed: ${res.status} ${await res.text()}`);
    const placed = (await res.json()) as { accepted: boolean };
    if (placed.accepted) accepted++;

    if (i < LARGE_SEED_VERTICES - 1) await sleep(PLACE_DELAY_MS);
  }
  console.log(`grew large heap: ${accepted}/${LARGE_SEED_VERTICES} placements accepted`);

  const identities = Array.from({ length: POOL_SIZE }, () => ({
    playerId:     randomUUID(),
    playerSecret: randomUUID(),
  }));

  writeFileSync(
    new URL('../fixtures.json', import.meta.url),
    JSON.stringify({ smallHeapId: small.id, largeHeapId: large.id, identities }, null, 2),
  );
  console.log(`wrote loadtest/fixtures.json with ${identities.length} identities`);
}

main().catch((err) => { console.error(err); process.exit(1); });

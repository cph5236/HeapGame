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

/**
 * Reuse an existing heap instead of creating one. Set either to a heap GUID —
 * e.g. one made through the admin UI (`admin/index.html`) or `npm run seed` —
 * and this script skips creating that fixture and adopts it. Unset, it creates
 * the fixture itself.
 *
 * Reusing is the cheaper path: creating a heap is a write plus a base-vertex
 * snapshot, and duplicates accumulate on the staging heap list.
 */
const SMALL_HEAP_ID = process.env.SMALL_HEAP_ID ?? '';
const LARGE_HEAP_ID = process.env.LARGE_HEAP_ID ?? '';
/** Vertices pre-placed on the large fixture. Placements, not players. */
const LARGE_SEED_VERTICES = Number(process.env.LARGE_SEED_VERTICES ?? 400);

/**
 * Staging's synthetic rate-limit key (server/src/middleware/rateLimit.ts).
 * When set, each request presents its own bucket key, so the growth loop is not
 * throttled and needs no pacing. Absent — e.g. against local `wrangler dev`,
 * or a staging deploy with the secret removed — the loop falls back to sleeping
 * between placements. Never set in production, where the header is inert.
 */
const LOADTEST_SECRET = process.env.LOADTEST_SECRET ?? '';
const RATE_LIMIT_BYPASS = LOADTEST_SECRET.length > 0;

/**
 * Delay between growth placements. Without the bypass above, `POST
 * /heaps/:id/place` is capped at RL_PLACE = 30 requests/min per client IP and
 * the whole `/heaps` tree at RL_GLOBAL = 300/min (server/wrangler.toml), with
 * no admin-secret exemption — so an unpaced loop starts 429ing around placement
 * #30 and aborts. 2200ms clears the 2000ms/request floor with margin, at the
 * cost of ~15 minutes for the default 400 placements.
 *
 * With the bypass, every request lands in its own bucket, so the default drops
 * to 0. Override explicitly to pace it anyway.
 */
const PLACE_DELAY_MS = Number(
  process.env.PLACE_DELAY_MS ?? (RATE_LIMIT_BYPASS ? 0 : 2200),
);

if (!BASE_URL)     throw new Error('BASE_URL is required');
if (!ADMIN_SECRET) throw new Error('ADMIN_SECRET is required');

/**
 * Headers that give this request its own rate-limit bucket. `key` must be
 * unique per request for the loop to run unthrottled — reusing one key would
 * just move every request into a single shared bucket.
 */
function loadTestHeaders(key: string): Record<string, string> {
  if (!RATE_LIMIT_BYPASS) return {};
  return { 'X-LoadTest-Secret': LOADTEST_SECRET, 'X-LoadTest-Key': key };
}

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
  // Match the HOSTNAME only. Testing the whole URL string would let
  // https://heap-server-prod.example.com/?note=staging through the gate.
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false; // unparseable URL is not something we should write to
  }
  return /\bstaging\b/i.test(host) || host === 'localhost' || host === '127.0.0.1';
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

/**
 * Adopt an existing heap by GUID. `topY` comes from the server's own summary
 * rather than being recomputed locally, so an already-grown heap reports its
 * real current summit instead of the value its base vertices started at.
 */
async function adoptHeap(id: string, label: string): Promise<{ id: string; topY: number }> {
  const res = await fetch(`${BASE_URL}/heaps`, { headers: loadTestHeaders('seed-adopt') });
  if (!res.ok) throw new Error(`adoptHeap(${id}) list failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { heaps?: Array<{ id: string; topY: number; params?: { name?: string } }> };
  const found = (body.heaps ?? []).find((h) => h.id === id);
  if (!found) {
    throw new Error(
      `${label} heap ${id} not found on ${BASE_URL}. Check the GUID, and that you are pointing at the right Worker.`,
    );
  }
  return { id: found.id, topY: found.topY };
}

async function main(): Promise<void> {
  const small = SMALL_HEAP_ID
    ? await adoptHeap(SMALL_HEAP_ID, 'small')
    : await createHeap('LoadTest Small');
  const large = LARGE_HEAP_ID
    ? await adoptHeap(LARGE_HEAP_ID, 'large')
    : await createHeap('LoadTest Large');
  console.log(`small heap: ${small.id} ${SMALL_HEAP_ID ? '(adopted)' : '(created)'}`);
  console.log(`large heap: ${large.id} (topY=${large.topY}) ${LARGE_HEAP_ID ? '(adopted)' : '(created)'}`);

  // Grow the large fixture. Placements go through the real endpoint so the
  // polygon is shaped exactly as production data would be.
  const secret = randomUUID();
  const seeder = randomUUID();

  // Valid placement window, mirroring the route's checks:
  //   x in [PLACE_X_MIN, PLACE_X_MAX]
  //   y in [topY - PLACE_HEIGHT_GRACE_PX, liveZoneBottomY]
  // (y >= 0 and y <= world_height are also required but are non-binding here
  // — MOCK_HEAP_HEIGHT_PX is enormous relative to this window.)
  //
  // An earlier version of this loop computed yLow/yHigh ONCE up front and
  // pinned the very first placement to exactly topY + HEAP_TOP_ZONE_PX,
  // reasoning that liveZoneBottomY (the floor) only grows from there, so a
  // static window would stay valid for every later draw. That reasoning has
  // a gap: /place returns HTTP 200 with `{accepted: false}` — not an error —
  // when the chosen point already lies inside the existing base polygon, and
  // a point at (x, topY + HEAP_TOP_ZONE_PX) is well within the range the
  // base's own silhouette already covers, so the pinning placement itself
  // was frequently the one silently rejected. When that happened the floor
  // never got pinned to its widest value, later random draws kept sampling
  // against the stale wide yHigh, and the loop started 400ing (observed
  // locally against `wrangler dev`: placement index 2 failed with "y below
  // active zone" because the server's real liveZoneBottomY had come out
  // lower than the script's assumed window).
  //
  // Fixed by reading the live window fresh before every placement — the same
  // approach loadtest/k6/scenarios/journey.js and placement.js already use
  // against the long-lived fixture heap, now applied here too so this loop
  // is self-correcting regardless of which individual placements land.
  // top_y can only fall (server folds it via MIN on every accepted
  // placement — see server/src/db.ts), so it's tracked locally rather than
  // re-fetched, updating whenever an accepted placement's y undercuts it.
  let currentTopY = large.topY;
  let accepted = 0;
  for (let i = 0; i < LARGE_SEED_VERTICES; i++) {
    const stateRes = await fetch(`${BASE_URL}/heaps/${large.id}`, {
      headers: loadTestHeaders(`seed-state-${i}`),
    });
    if (!stateRes.ok) throw new Error(`seed state read ${i} failed: ${stateRes.status} ${await stateRes.text()}`);
    const state = (await stateRes.json()) as { liveZone?: Vertex[] };
    const liveZone = state.liveZone ?? [];

    const yLow  = Math.max(0, currentTopY - PLACE_HEIGHT_GRACE_PX);
    const yHigh = liveZone.length > 0
      ? liveZone.reduce((max, v) => (v.y > max ? v.y : max), -Infinity)
      : currentTopY + HEAP_TOP_ZONE_PX;

    const x = PLACE_X_MIN + Math.random() * (PLACE_X_MAX - PLACE_X_MIN);
    const y = yLow + Math.random() * Math.max(0, yHigh - yLow);

    const res = await fetch(`${BASE_URL}/heaps/${large.id}/place`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Player-Token': secret,
        ...loadTestHeaders(`seed-place-${i}`),
      },
      body: JSON.stringify({ x, y, playerGuid: seeder }),
    });
    if (!res.ok) throw new Error(`seed placement ${i} failed: ${res.status} ${await res.text()}`);
    const placed = (await res.json()) as { accepted: boolean };
    if (placed.accepted) {
      accepted++;
      if (y < currentTopY) currentTopY = y;
    }

    if (PLACE_DELAY_MS > 0 && i < LARGE_SEED_VERTICES - 1) await sleep(PLACE_DELAY_MS);
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

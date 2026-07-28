// server/src/routes/heap.ts

import { Hono } from 'hono';
import type { HeapDB, HeapRow } from '../db';
import type { Sink } from '../logging/Sink';
import { captureServer } from '../logging/captureServerEvent';
import { hashVertices, checkFreezeBands } from '../polygon';
import {
  BAND_SIZE_PX, bandOf, bandMidY, extendsEnvelope, verticesToEnvelope, envelopeToRows,
  envelopeToVertices, mergeBands, bandsToWire, seedNewBands,
  type BandEnvelope, type BandRow,
} from '../../../shared/heapPolygon/bandEnvelope';
import { MAX_ID_LEN } from '../constants';
import type { PlayerAuthDB } from '../playerAuthDb';
import { enforcePlayerAuth, PLAYER_TOKEN_HEADER } from '../playerAuth';
import type { ContributionDB } from '../contributionDb';
import type {
  CreateHeapRequest,
  CreateHeapResponse,
  ListHeapsResponse,
  GetHeapResponse,
  PlaceRequest,
  PlaceResponse,
  ResetHeapResponse,
  UpdateHeapParamsRequest,
  UpdateHeapParamsResponse,
  DeleteHeapResponse,
  Vertex,
  HeapParams,
  HeapEnemyParams,
} from '../../../shared/heapTypes';
import { DEFAULT_HEAP_PARAMS, INFINITE_HEAP_ID } from '../../../shared/heapTypes';
import { generateDefaultPolygon } from '../../../shared/heapPolygon';

// Mirror of src/constants.ts WORLD_WIDTH. Update both if either changes.
const WORLD_WIDTH = 960;

// Mirror of GameScene's center-zone bounds (WORLD_WIDTH * 0.125 to 0.875).
// TODO: promote to a heap parameter so each heap can define its playable column.
const PLACE_X_MIN = WORLD_WIDTH * 0.125;  // 120
const PLACE_X_MAX = WORLD_WIDTH * 0.875;  // 840

// Grace pixels above current summit a placement may extend the heap upward.
// Roughly one player-height of clearance plus margin.
const PLACE_HEIGHT_GRACE_PX = 200;

// Mirror of src/constants.ts HEAP_TOP_ZONE_PX. Defines the active-zone band
// above the summit on a fresh heap (no live-zone vertices yet).
const HEAP_TOP_ZONE_PX = 300;

const OFF_PEAK_THRESHOLD_PX = 100; // px below top_y that earns off-peak bonus
const OFF_PEAK_BONUS_COINS  = 10;  // flat coins awarded for off-peak placement
const GHOST_JITTER_RADIUS_PX = 80;  // max px offset from anchor when placing ghost points

// Furthest band a ghost can reach from the placement it anchors on.
export const GHOST_SPREAD_BANDS = Math.ceil(GHOST_JITTER_RADIUS_PX / BAND_SIZE_PX);
// How far past the candidate spread the placement window reaches, giving
// interpolateBandSeed room to find a two-extent band on each side of a new band.
// Beyond this the nearest neighbour is too far away for its extents to say
// anything useful about this y, and no seed is better than a fabricated one.
const SEED_SEARCH_BANDS = 16;
const PLACE_WINDOW_BANDS = GHOST_SPREAD_BANDS + SEED_SEARCH_BANDS;

function validateDifficulty(d: number): string | null {
  if (!Number.isFinite(d)) return 'difficulty must be a finite number';
  if (d < 1 || d > 5) return 'difficulty must be between 1 and 5';
  const stepped = Math.round(d * 2) / 2;
  if (Math.abs(stepped - d) > 1e-6) return 'difficulty must be a multiple of 0.5';
  return null;
}

function validateMult(value: number, name: string): string | null {
  if (!Number.isFinite(value)) return `${name} must be a finite number`;
  if (value <= 0) return `${name} must be > 0`;
  return null;
}

function resolveParams(input: Partial<HeapParams> | undefined): HeapParams | { error: string } {
  if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
    return { error: 'params must be an object' };
  }

  const merged: HeapParams = { ...DEFAULT_HEAP_PARAMS, ...(input ?? {}) };
  if (typeof merged.name !== 'string' || merged.name.trim() === '') {
    return { error: 'name must be a non-empty string' };
  }
  merged.name = merged.name.slice(0, 40);

  if (typeof merged.difficulty !== 'number') return { error: 'difficulty must be a number' };
  const dErr = validateDifficulty(merged.difficulty);
  if (dErr) return { error: dErr };

  for (const [k, v] of [
    ['spawnRateMult', merged.spawnRateMult],
    ['coinMult',      merged.coinMult],
    ['scoreMult',     merged.scoreMult],
  ] as const) {
    if (typeof v !== 'number') return { error: `${k} must be a number` };
    const err = validateMult(v, k);
    if (err) return { error: err };
  }

  merged.ghostPointCount = Math.max(0, Math.floor(merged.ghostPointCount ?? 1));

  // Salvage spawn rates: base is a probability [0,1]; pos/neg are non-negative weights.
  merged.baseItemSpawnRate     = Math.min(1, Math.max(0, merged.baseItemSpawnRate     ?? DEFAULT_HEAP_PARAMS.baseItemSpawnRate));
  merged.positiveItemSpawnRate = Math.max(0, merged.positiveItemSpawnRate ?? DEFAULT_HEAP_PARAMS.positiveItemSpawnRate);
  merged.negativeItemSpawnRate = Math.max(0, merged.negativeItemSpawnRate ?? DEFAULT_HEAP_PARAMS.negativeItemSpawnRate);

  // Heap lock pointer: string id or null (null/absent = unlocked). Existence
  // and cycle checks need DB access and run in validateLockTarget instead.
  if (merged.lockedByHeapId !== undefined && merged.lockedByHeapId !== null) {
    if (typeof merged.lockedByHeapId !== 'string' || merged.lockedByHeapId.length === 0 || merged.lockedByHeapId.length > MAX_ID_LEN) {
      return { error: 'lockedByHeapId must be a heap id string or null' };
    }
  }

  return merged;
}

/**
 * DB-backed validation for a non-null lockedByHeapId. Walks the existing
 * lock chain from the proposed prerequisite: if it reaches the heap being
 * edited, this edit would close a lock cycle — every heap in a cycle is
 * permanently locked for every player (fail-open never triggers because no
 * prerequisite is missing), so cycles must be rejected here.
 */
async function validateLockTarget(db: HeapDB, heapId: string, lockedByHeapId: string): Promise<string | null> {
  const rows = await db.listHeaps();
  const lockedBy = new Map(rows.map((r) => [r.id, r.locked_by_heap_id ?? null]));
  if (!lockedBy.has(lockedByHeapId)) return 'lockedByHeapId must reference an existing heap';
  if (lockedByHeapId === INFINITE_HEAP_ID) return 'the infinite heap cannot be a lock prerequisite (it can never be beaten)';
  if (lockedByHeapId === heapId) return 'a heap cannot be locked by itself';
  let cursor: string | null = lockedByHeapId;
  for (let hops = 0; cursor !== null && hops <= lockedBy.size; hops++) {
    if (cursor === heapId) return 'lockedByHeapId would create a lock cycle';
    cursor = lockedBy.get(cursor) ?? null;
  }
  return null;
}

/**
 * The live set of bands: everything above the freeze line. freeze_y = 0 means no
 * freeze has happened yet, so every band is still live. After a freeze, freeze_y
 * is the TOP of the frozen region (frozen = band >= freezeBand), so the live set
 * is strictly above it — getting this comparison backwards serves the buried base
 * as the live zone.
 */
export function liveBandsOf(row: HeapRow, allBands: BandRow[]): BandRow[] {
  const freezeBand = row.freeze_y > 0 ? bandOf(row.freeze_y) : Infinity;
  return allBands.filter((b) => b.band < freezeBand);
}

export function heapRoutes(
  db: HeapDB,
  getSink: () => Sink | undefined,
  authDb?: PlayerAuthDB,
  contributionDb?: ContributionDB,
): Hono {
  const app = new Hono();

  // POST /heaps — create a new heap
  app.post('/', async (c) => {
    let body: CreateHeapRequest;
    try {
      body = await c.req.json<CreateHeapRequest>();
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    const resolved = resolveParams(body.params);
    if ('error' in resolved) return c.json({ error: resolved.error }, 400);

    if (resolved.lockedByHeapId != null) {
      const lockErr = await validateLockTarget(db, '', resolved.lockedByHeapId);
      if (lockErr) return c.json({ error: lockErr }, 400);
    }

    let vertices: Vertex[];
    if (Array.isArray(body.vertices)) {
      vertices = body.vertices;
    } else {
      const seed = Number.isFinite(body.seed) ? Math.floor(body.seed!) : Math.floor(Math.random() * 1_000_000);
      const genOpts = Number.isFinite(body.numBlocks) && (body.numBlocks! > 0) ? { numBlocks: body.numBlocks! } : {};
      vertices = generateDefaultPolygon(seed, resolved.worldHeight, genOpts);
    }

    const MAX_VERTICES = 10_000;
    if (
      !Array.isArray(vertices) ||
      vertices.length < 3 ||
      vertices.length > MAX_VERTICES ||
      !vertices.every((v) =>
        v != null &&
        typeof (v as Vertex).x === 'number' && Number.isFinite((v as Vertex).x) &&
        typeof (v as Vertex).y === 'number' && Number.isFinite((v as Vertex).y),
      )
    ) {
      return c.json({ error: `vertices must be an array of 3-${MAX_VERTICES} {x, y} objects with finite numbers` }, 400);
    }

    const heapId = crypto.randomUUID();
    const baseId = crypto.randomUUID();
    const vertexHash = hashVertices(vertices);
    const now = new Date().toISOString();

    await db.createHeap(heapId, baseId, vertices, vertexHash, now, resolved);

    return c.json({
      id: heapId,
      baseId,
      version: 1,
      vertexCount: vertices.length,
    } satisfies CreateHeapResponse, 201);
  });

  // GET /heaps — list all heaps
  app.get('/', async (c) => {
    const rows = await db.listHeaps();
    return c.json({
      heaps: rows.map((r) => ({
        id: r.id,
        version: r.version,
        createdAt: r.created_at,
        topY: r.top_y,
        params: {
          name:            r.name,
          difficulty:      r.difficulty,
          spawnRateMult:   r.spawn_rate_mult,
          coinMult:        r.coin_mult,
          scoreMult:       r.score_mult,
          worldHeight:     r.world_height,
          ghostPointCount: r.ghost_point_count,
          baseItemSpawnRate:     r.base_item_spawn_rate,
          positiveItemSpawnRate: r.positive_item_spawn_rate,
          negativeItemSpawnRate: r.negative_item_spawn_rate,
          lockedByHeapId:  r.locked_by_heap_id ?? null,
        },
      })),
    } satisfies ListHeapsResponse);
  });

  // GET /heaps/:id/base — get current base vertices for a heap
  // NOTE: must be registered before /:id to prevent Hono matching "base" as an id
  app.get('/:id/base', async (c) => {
    const id = c.req.param('id');
    const row = await db.getHeap(id);
    if (!row) return c.json({ error: 'Heap not found' }, 404);

    const vertices = await db.getBaseVerticesById(row.base_id);
    if (!vertices) return c.json({ error: 'Base not found' }, 404);

    return c.json(vertices);
  });

  // GET /heaps/:id/enemy-params — returns heap's enemy spawn config (or sentinel default)
  app.get('/:id/enemy-params', async (c) => {
    const id = c.req.param('id');
    const row = await db.getHeap(id);
    if (!row) return c.json({ error: 'Heap not found' }, 404);
    const params = await db.getEnemyParams(id);
    return c.json(params);
  });

  // PUT /heaps/:id/enemy-params — upsert heap's enemy spawn config (full replacement)
  app.put('/:id/enemy-params', async (c) => {
    const id = c.req.param('id');
    const row = await db.getHeap(id);
    if (!row) return c.json({ error: 'Heap not found' }, 404);

    let body: HeapEnemyParams;
    try {
      body = await c.req.json<HeapEnemyParams>();
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return c.json({ error: 'body must be an object' }, 400);
    }

    await db.upsertEnemyParams(id, body);
    // Bump the heap version so version-gated clients (base-heap load()) re-fetch
    // the fresh enemy params on their next load instead of keeping stale cache.
    // Reuse updateHeap with every other field unchanged; it also invalidates the
    // KV heap-row cache. CAS on the current version — if a concurrent place wins
    // the race it already bumped the version, so the client still refreshes.
    await db.updateHeap(
      id,
      row.base_id,
      row.version + 1,
      JSON.parse(row.live_zone) as Vertex[],
      row.freeze_y,
      row.top_y,
      row.version,
    );
    return c.json({ ok: true });
  });

  // GET /heaps/:id?version=N&baseId=B — read heap state (delta-aware)
  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const clientVersion = parseInt(c.req.query('version') ?? '0') || 0;
    const clientBaseId = c.req.query('baseId');

    const row = await db.getHeap(id);
    if (!row) return c.json({ error: 'Heap not found' }, 404);

    // A client opts into deltas by echoing the baseId it holds. A mismatch means
    // its cache spans a different generation (reset) or an older base (freeze),
    // so it must take a full response.
    const optedIn = typeof clientBaseId === 'string' && clientBaseId.length > 0;
    const sameGeneration = optedIn && clientBaseId === row.base_id;

    if (sameGeneration && clientVersion === row.version) {
      return c.json({ changed: false, version: row.version } satisfies GetHeapResponse);
    }
    // Old clients send no baseId and rely on version alone.
    if (!optedIn && clientVersion === row.version) {
      return c.json({ changed: false, version: row.version } satisfies GetHeapResponse);
    }

    const params = {
      name: row.name, difficulty: row.difficulty,
      spawnRateMult: row.spawn_rate_mult, coinMult: row.coin_mult, scoreMult: row.score_mult,
      worldHeight: row.world_height, ghostPointCount: row.ghost_point_count,
      baseItemSpawnRate: row.base_item_spawn_rate,
      positiveItemSpawnRate: row.positive_item_spawn_rate,
      negativeItemSpawnRate: row.negative_item_spawn_rate,
      lockedByHeapId: row.locked_by_heap_id ?? null,
    };

    if (sameGeneration) {
      const [changedBands, enemyParams] = await Promise.all([
        db.getBandsSince(id, clientVersion),
        db.getEnemyParams(id),
      ]);
      return c.json({
        changed: true, mode: 'delta',
        version: row.version, baseId: row.base_id, freezeY: row.freeze_y,
        bands: bandsToWire(changedBands),
        params, enemyParams,
      } satisfies GetHeapResponse);
    }

    const [allBands, enemyParams] = await Promise.all([
      db.getAllBands(id),
      db.getEnemyParams(id),
    ]);
    // Frozen bands are already folded into the base blob (fetched separately
    // and cached indefinitely by baseId) — resending them here would ship the
    // same geometry twice on every full response, growing with heap height.
    const liveBands = liveBandsOf(row, allBands);
    // `liveZone` is the legacy field for clients that predate the band protocol.
    // Derived here from the same array `bands` is built from, so the two describe
    // the same band set by construction rather than by test.
    //
    // It is deliberately NOT persisted. It used to be written back to
    // heap.live_zone behind a live_zone_version watermark, which cost a D1 write
    // plus a KV cache invalidation (two deletes) on the first full GET after
    // every placement — and KV deletes are the tightest Cloudflare quota at
    // 1,000/day, account-wide. Recomputing is a map over ~77 live bands, far
    // cheaper than the round trip it replaces, and it also removes a second
    // getAllBands call that ran inside the old rebuild.
    const liveZone = envelopeToVertices(mergeBands(new Map(), liveBands));
    return c.json({
      changed: true, mode: 'full',
      version: row.version, baseId: row.base_id, freezeY: row.freeze_y,
      bands: bandsToWire(liveBands),
      liveZone,
      params, enemyParams,
    } satisfies GetHeapResponse);
  });

  // PUT /heaps/:id/reset — clear live zone, reset version to 1, optionally update params
  app.put('/:id/reset', async (c) => {
    const id = c.req.param('id');
    const row = await db.getHeap(id);
    if (!row) return c.json({ error: 'Heap not found' }, 404);

    const previousVersion = row.version;
    // Reset mints a fresh baseId. loadCachedBase keys localStorage on baseId
    // with no TTL, so a stable id over changed base content strands every
    // client on stale geometry — the id change is what tells a client to
    // discard its bands and take a full response. Copy the current base
    // vertices onto the new row so the mountain below the freeze line survives.
    const newBaseId = crypto.randomUUID();
    const baseVertices = (await db.getBaseVerticesById(row.base_id)) ?? [];
    await db.createBase(newBaseId, id, baseVertices, hashVertices(baseVertices), new Date().toISOString());
    await db.clearBands(id);
    await db.updateHeap(id, newBaseId, 1, [], 0, row.top_y);

    let bodyParams: Partial<HeapParams> = {};
    try { bodyParams = await c.req.json<Partial<HeapParams>>(); } catch { /* no body */ }

    if (Object.keys(bodyParams).length > 0) {
      const merged: HeapParams = {
        name:            bodyParams.name            ?? row.name,
        difficulty:      bodyParams.difficulty      ?? row.difficulty,
        spawnRateMult:   bodyParams.spawnRateMult   ?? row.spawn_rate_mult,
        coinMult:        bodyParams.coinMult        ?? row.coin_mult,
        scoreMult:       bodyParams.scoreMult       ?? row.score_mult,
        worldHeight:     bodyParams.worldHeight     ?? row.world_height,
        ghostPointCount: bodyParams.ghostPointCount ?? row.ghost_point_count,
        baseItemSpawnRate:     bodyParams.baseItemSpawnRate     ?? row.base_item_spawn_rate,
        positiveItemSpawnRate: bodyParams.positiveItemSpawnRate ?? row.positive_item_spawn_rate,
        negativeItemSpawnRate: bodyParams.negativeItemSpawnRate ?? row.negative_item_spawn_rate,
        lockedByHeapId: 'lockedByHeapId' in bodyParams ? bodyParams.lockedByHeapId : row.locked_by_heap_id,
      };
      if ('lockedByHeapId' in bodyParams && merged.lockedByHeapId != null) {
        const lockErr = await validateLockTarget(db, id, merged.lockedByHeapId);
        if (lockErr) return c.json({ error: lockErr }, 400);
      }
      await db.updateHeapParams(id, merged);
    }

    return c.json({
      id,
      version: 1,
      previousVersion,
    } satisfies ResetHeapResponse);
  });

  // PUT /heaps/:id/params — update editable params (worldHeight locked)
  app.put('/:id/params', async (c) => {
    const id = c.req.param('id');
    const existing = await db.getHeap(id);
    if (!existing) return c.json({ error: 'Heap not found' }, 404);

    let body: UpdateHeapParamsRequest;
    try {
      body = await c.req.json<UpdateHeapParamsRequest>();
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    if (body && 'worldHeight' in body) {
      return c.json({ error: 'worldHeight is locked after creation' }, 400);
    }

    // Reuse resolveParams against the merged shape (existing values + edits).
    const merged = resolveParams({
      name:            body.name            ?? existing.name,
      difficulty:      body.difficulty      ?? existing.difficulty,
      spawnRateMult:   body.spawnRateMult   ?? existing.spawn_rate_mult,
      coinMult:        body.coinMult        ?? existing.coin_mult,
      scoreMult:       body.scoreMult       ?? existing.score_mult,
      worldHeight:     existing.world_height,
      ghostPointCount: body.ghostPointCount ?? existing.ghost_point_count,
      baseItemSpawnRate:     body.baseItemSpawnRate     ?? existing.base_item_spawn_rate,
      positiveItemSpawnRate: body.positiveItemSpawnRate ?? existing.positive_item_spawn_rate,
      negativeItemSpawnRate: body.negativeItemSpawnRate ?? existing.negative_item_spawn_rate,
      lockedByHeapId: 'lockedByHeapId' in body ? body.lockedByHeapId : existing.locked_by_heap_id,
    });
    if ('error' in merged) return c.json({ error: merged.error }, 400);

    if ('lockedByHeapId' in body && merged.lockedByHeapId != null) {
      const lockErr = await validateLockTarget(db, id, merged.lockedByHeapId);
      if (lockErr) return c.json({ error: lockErr }, 400);
    }

    await db.updateHeapParams(id, merged);

    return c.json({
      summary: {
        id,
        version: existing.version,
        createdAt: existing.created_at,
        topY: existing.top_y,
        params: merged,
      },
    } satisfies UpdateHeapParamsResponse);
  });

  // POST /heaps/:id/place — add a block vertex to the live zone
  app.post('/:id/place', async (c) => {
    const id = c.req.param('id');
    let body: PlaceRequest;
    try {
      body = await c.req.json<PlaceRequest>();
    } catch {
      console.warn(`[place] reject: invalid JSON heapId=${id}`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'place:rejected', { reason: 'invalid JSON', heapId: id });
      }
      return c.json({ error: 'invalid placement' }, 400);
    }

    const { x, y } = body;
    if (typeof x !== 'number' || !Number.isFinite(x) ||
        typeof y !== 'number' || !Number.isFinite(y)) {
      console.warn(`[place] reject: bad coords (x=${x}, y=${y}) heapId=${id}`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'place:rejected', { reason: 'bad coords', heapId: id, x, y });
      }
      return c.json({ error: 'invalid placement' }, 400);
    }

    const { playerGuid } = body;
    if (playerGuid !== undefined) {
      if (typeof playerGuid !== 'string' || playerGuid.length === 0 || playerGuid.length > MAX_ID_LEN) {
        console.warn(`[place] reject: bad playerGuid heapId=${id}`);
        const sink = getSink();
        if (sink) {
          await captureServer(sink, 'warn', 'place:rejected', { reason: 'bad playerGuid', heapId: id });
        }
        return c.json({ error: 'invalid placement' }, 400);
      }
    }

    // MIN/MAX band writes are conflict-free: two placements landing in the same
    // band both widen it regardless of arrival order, so there is nothing left
    // to compare-and-swap. This is a straight-line handler now — one read, one
    // write, then a freeze check.
    const row = await db.getHeapFresh(id);
    if (!row) return c.json({ error: 'Heap not found' }, 404);

    if (x < PLACE_X_MIN || x > PLACE_X_MAX) {
      console.warn(`[place] reject: x out of center zone (${x}) heapId=${id}`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'place:rejected', { reason: 'x out of center zone', heapId: id, x, min: PLACE_X_MIN, max: PLACE_X_MAX });
      }
      return c.json({ error: 'invalid placement' }, 400);
    }
    if (y < 0 || y > row.world_height) {
      console.warn(`[place] reject: y out of world bounds (${y}, world_height=${row.world_height}) heapId=${id}`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'place:rejected', { reason: 'y out of world bounds', heapId: id, y, worldHeight: row.world_height });
      }
      return c.json({ error: 'invalid placement' }, 400);
    }
    if (y < row.top_y - PLACE_HEIGHT_GRACE_PX) {
      console.warn(`[place] reject: y above summit + grace (${y}, top_y=${row.top_y}, grace=${PLACE_HEIGHT_GRACE_PX}) heapId=${id}`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'place:rejected', { reason: 'y above summit + grace', heapId: id, y, topY: row.top_y, grace: PLACE_HEIGHT_GRACE_PX });
      }
      return c.json({ error: 'invalid placement' }, 400);
    }

    // Active-zone floor from band granularity: the bottom edge of the highest
    // occupied band. Replaces a scan over every live-zone vertex. Costs an
    // O(log n) probe off the (heap_id, band) primary key.
    const maxBand = await db.getMaxBand(id);
    // After a freeze, the live region's floor is the freeze line itself: bandOf(row.freeze_y)
    // is the first FROZEN band, and the gate below is `y > liveZoneBottomY`, so subtracting 1
    // keeps a placement landing exactly on freeze_y from being admitted into frozen territory.
    // Pre-freeze (freeze_y === 0 sentinel), keep the original maxBand-derived floor unchanged.
    // The freeze branch is why deleting frozen rows cannot break this gate: post-freeze
    // maxBand covers only live bands, and post-freeze this expression never consults it.
    const liveZoneBottomY = row.freeze_y > 0
      ? row.freeze_y - 1
      : maxBand !== null
        ? (maxBand + 1) * BAND_SIZE_PX
        : row.top_y + HEAP_TOP_ZONE_PX;
    if (y > liveZoneBottomY) {
      console.warn(`[place] reject: y below active zone (${y} > liveZoneBottomY=${liveZoneBottomY}) heapId=${id}`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'place:rejected', { reason: 'y below active zone', heapId: id, y, liveZoneBottomY });
      }
      return c.json({ error: 'invalid placement' }, 400);
    }

    // Write-auth: verify-or-claim only after the heap exists and the placement
    // passed every bounds check, mirroring the /scores ordering — a request
    // that is going to be rejected must never claim a playerGuid as a side
    // effect. No retry loop any more, so this simply runs once.
    if (playerGuid !== undefined) {
      const authRes = await enforcePlayerAuth(c, authDb, playerGuid, getSink, 'heaps:place');
      if (authRes) return authRes;
    }

    // One bounded window read serves this whole handler: the containment check,
    // and the seed sources for any new band. It replaces a point read plus a
    // per-ghost read plus a full-envelope read — on a 4-ghost heap that is six
    // queries collapsed into one, and unlike getAllBands its cost does not grow
    // with heap height. Every candidate lands within GHOST_SPREAD_BANDS of this
    // placement, so the window covers all of them with room to search outward
    // for interpolation neighbours.
    const band = bandOf(y);
    const window = mergeBands(
      new Map(),
      await db.getBandRange(id, band - PLACE_WINDOW_BANDS, band + PLACE_WINDOW_BANDS),
    );

    // Containment: a placement counts only if it widens its band. A point at or
    // inside the extents cannot change the silhouette the client renders, so
    // storing it would cost CPU and egress forever and draw nothing.
    if (!extendsEnvelope(window, x, y)) {
      return c.json({ accepted: false, version: row.version } satisfies PlaceResponse);
    }

    // Candidate vertices: the placement plus its ghost points. Ghosts that do
    // not widen a band are dropped by the same MIN/MAX upsert — the same
    // judgement as rejecting a placement.
    //
    // Every ghost anchors on THIS placement, so the heap thickens where the
    // player actually built. Anchoring on a randomly sampled band across the
    // whole live zone (what this did before, mirroring main) has two measured
    // failures: it deposits the sampled band's x into a band up to
    // GHOST_SPREAD_BANDS away, scrambling the silhouette into a sawtooth; and
    // because a ghost anchors on a band's own extreme and jitters outward while
    // the write is MIN/MAX, every band it touches steps monotonically wider and
    // never narrows. With hits accumulating on every band for the heap's whole
    // lifetime, that converges on a featureless full-width column. Anchoring
    // locally bounds the hits any one band receives to the window the player
    // spends near it, which is what keeps the shape stable.
    const candidates: Vertex[] = [{ x, y }];
    const ghostCount = Math.max(0, Math.floor(row.ghost_point_count ?? 1));
    for (let i = 0; i < ghostCount; i++) {
      const dx = (Math.random() * 2 - 1) * GHOST_JITTER_RADIUS_PX;
      const dy = (Math.random() * 2 - 1) * GHOST_JITTER_RADIUS_PX;
      candidates.push({
        x: Math.max(PLACE_X_MIN, Math.min(PLACE_X_MAX, x + dx)),
        y: Math.max(row.top_y, Math.min(liveZoneBottomY, y + dy)),
      });
    }

    // A candidate landing in an empty band knows only one x, so the band would
    // be stored with minX === maxX and the renderer would forward-fill the other
    // side from the previous band — the sawtooth. Seed the unknown side by
    // interpolating between the nearest two-extent bands above and below, so the
    // opposite edge gets a value belonging to this y. Only bands with a known
    // neighbour on both sides are seeded (see interpolateBandSeed), so a new
    // summit band still grows as a point rather than inheriting the width below
    // it. Seeds come from the window read above — no additional query.
    const bandRows: BandRow[] = seedNewBands(
      envelopeToRows(verticesToEnvelope(candidates)),
      window,
    );

    // Version is assigned inside the write — no expected-version compare, so no
    // way to lose a concurrent write. The blob is no longer touched here; it is
    // a derived cache rebuilt lazily by materialiseLiveZone (Task 7).
    //
    // commitPlacement bumps the version and widens bandRows in ONE D1 batch
    // (one transaction), not two separate calls — a version bump and a band
    // write issued as independent round-trips leaves a window where a
    // concurrent GET can observe the new version before the band it belongs
    // to has landed, permanently losing that band to a delta client's
    // strictly-greater-than watermark filter.
    const newVersion = await db.commitPlacement(id, bandRows, y);

    // Freeze: fold the bottom bands into the base, then drop them from
    // heap_band (setFreeze does the deletion in the same transaction as the
    // freeze-line advance — see its doc). Order matters: the base row must
    // exist BEFORE setFreeze repoints the heap at it and deletes the rows,
    // because those rows are the only other copy of that geometry.
    //
    // Minting a new baseId is mandatory — loadCachedBase keys localStorage on
    // baseId with no TTL, so a stable id over changed base content strands
    // every client on a stale base.
    //
    // Same freeze_y>0 sentinel as liveBandsOf and the full-response filter:
    // `bandOf(0)` would be band 0, which is a real (if absurdly high) band
    // index, not "nothing is frozen".
    const freezeBand = row.freeze_y > 0 ? bandOf(row.freeze_y) : Infinity;
    const freeze = checkFreezeBands(await db.getAllBands(id), freezeBand);
    if (freeze) {
      const existingBase = (await db.getBaseVerticesById(row.base_id)) ?? [];
      const baseVertices = [
        ...existingBase,
        ...envelopeToVertices(mergeBands(new Map(), freeze.frozen)),
      ];
      const newBaseId = crypto.randomUUID();
      await db.createBase(newBaseId, id, baseVertices, hashVertices(baseVertices), new Date().toISOString());
      await db.setFreeze(id, newBaseId, freeze.newFreezeBand * BAND_SIZE_PX);
    }

    const bonusCoins = y > row.top_y + OFF_PEAK_THRESHOLD_PX ? OFF_PEAK_BONUS_COINS : undefined;

    // Contribution tick: only for authenticated placements — guid + token
    // both present AND the auth gate actually ran (authDb wired) so the
    // token is proven verified/claimed, not merely present. Never fails
    // the placement.
    if (contributionDb && authDb && playerGuid && c.req.header(PLAYER_TOKEN_HEADER)) {
      try {
        await contributionDb.increment(id, playerGuid, new Date().toISOString());
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.warn(`[place] contribution increment failed heapId=${id}: ${detail}`);
        const sink = getSink();
        if (sink) {
          await captureServer(sink, 'warn', 'place:contribution-failed', { heapId: id, playerId: playerGuid, error: detail });
        }
      }
    }

    return c.json({ accepted: true, version: newVersion, bonusCoins } satisfies PlaceResponse);
  });

  // DELETE /heaps/:id — remove heap and all its base snapshots
  app.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const row = await db.getHeap(id);
    if (!row) return c.json({ error: 'Heap not found' }, 404);

    await db.deleteHeap(id);
    return c.json({ deleted: true } satisfies DeleteHeapResponse);
  });

  return app;
}

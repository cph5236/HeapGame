// server/src/routes/heap.ts

import { Hono } from 'hono';
import type { HeapDB } from '../db';
import type { Sink } from '../logging/Sink';
import { captureServer } from '../logging/captureServerEvent';
import { isPointInside, checkFreeze, hashVertices } from '../polygon';
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
import { DEFAULT_HEAP_PARAMS } from '../../../shared/heapTypes';
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

  return merged;
}

export function heapRoutes(
  db: HeapDB,
  getSink: () => Sink | undefined,
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
    return c.json({ ok: true });
  });

  // GET /heaps/:id?version=N — read heap state (delta-aware)
  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const clientVersion = parseInt(c.req.query('version') ?? '0') || 0;

    const row = await db.getHeap(id);
    if (!row) return c.json({ error: 'Heap not found' }, 404);

    if (clientVersion === row.version) {
      return c.json({ changed: false, version: row.version } satisfies GetHeapResponse);
    }

    const [liveZone, enemyParams] = await Promise.all([
      Promise.resolve(JSON.parse(row.live_zone) as Vertex[]),
      db.getEnemyParams(id),
    ]);

    return c.json({
      changed: true,
      version: row.version,
      baseId: row.base_id,
      liveZone,
      params: {
        name:            row.name,
        difficulty:      row.difficulty,
        spawnRateMult:   row.spawn_rate_mult,
        coinMult:        row.coin_mult,
        scoreMult:       row.score_mult,
        worldHeight:     row.world_height,
        ghostPointCount: row.ghost_point_count,
        baseItemSpawnRate:     row.base_item_spawn_rate,
        positiveItemSpawnRate: row.positive_item_spawn_rate,
        negativeItemSpawnRate: row.negative_item_spawn_rate,
      },
      enemyParams,
    } satisfies GetHeapResponse);
  });

  // PUT /heaps/:id/reset — clear live zone, reset version to 1, optionally update params
  app.put('/:id/reset', async (c) => {
    const id = c.req.param('id');
    const row = await db.getHeap(id);
    if (!row) return c.json({ error: 'Heap not found' }, 404);

    const previousVersion = row.version;
    await db.updateHeap(id, row.base_id, 1, [], 0);

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
      };
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
    });
    if ('error' in merged) return c.json({ error: merged.error }, 400);

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

    const row = await db.getHeap(id);
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

    const liveZone: Vertex[] = JSON.parse(row.live_zone);

    // Bottom of the live zone — placements below this aren't in the active band.
    // Mirrors HeapClient.getLiveZoneBottomY: max y of live zone, or top_y + 300 (HEAP_TOP_ZONE_PX) for fresh heaps.
    const liveZoneBottomY = liveZone.length > 0
      ? liveZone.reduce((max, v) => v.y > max ? v.y : max, -Infinity)
      : row.top_y + HEAP_TOP_ZONE_PX;
    if (y > liveZoneBottomY) {
      console.warn(`[place] reject: y below active zone (${y} > liveZoneBottomY=${liveZoneBottomY}) heapId=${id}`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'place:rejected', { reason: 'y below active zone', heapId: id, y, liveZoneBottomY });
      }
      return c.json({ error: 'invalid placement' }, 400);
    }

    const baseVertices: Vertex[] = (await db.getBaseVerticesById(row.base_id)) ?? [];
    const fullPolygon = [...baseVertices, ...liveZone];

    if (isPointInside({ x, y }, fullPolygon)) {
      return c.json({ accepted: false, version: row.version } satisfies PlaceResponse);
    }

    // Insert sorted Y ascending (summit = lowest Y = front)
    const newVertex: Vertex = { x, y };
    const insertIdx = liveZone.findIndex((v) => v.y > y);
    if (insertIdx === -1) {
      liveZone.push(newVertex);
    } else {
      liveZone.splice(insertIdx, 0, newVertex);
    }

    // Ghost points: jitter near a random existing live zone vertex to keep heap shape organic
    const ghostCount = Math.max(0, Math.floor(row.ghost_point_count ?? 1));
    for (let i = 0; i < ghostCount; i++) {
      const anchorIdx = Math.floor(Math.random() * liveZone.length);
      const anchor = liveZone[anchorIdx];
      const dx = (Math.random() * 2 - 1) * GHOST_JITTER_RADIUS_PX;
      const dy = (Math.random() * 2 - 1) * GHOST_JITTER_RADIUS_PX;
      const gx = Math.max(PLACE_X_MIN, Math.min(PLACE_X_MAX, anchor.x + dx));
      const gy = Math.max(row.top_y, Math.min(liveZoneBottomY, anchor.y + dy));
      const gv: Vertex = { x: gx, y: gy };
      const gIdx = liveZone.findIndex((v) => v.y > gy);
      if (gIdx === -1) liveZone.push(gv); else liveZone.splice(gIdx, 0, gv);
    }

    const bonusCoins = y > row.top_y + OFF_PEAK_THRESHOLD_PX ? OFF_PEAK_BONUS_COINS : undefined;

    let currentBaseId = row.base_id;
    let newFreezeY = row.freeze_y;
    let finalLiveZone = liveZone;

    const freeze = checkFreeze(liveZone, baseVertices);
    if (freeze) {
      const newBaseId = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.createBase(newBaseId, id, freeze.newBaseVertices, freeze.newBaseVertexHash, now);
      currentBaseId = newBaseId;
      newFreezeY = freeze.newFreezeY;
      finalLiveZone = freeze.newLiveZone;
    }

    const newVersion = row.version + 1;
    await db.updateHeap(id, currentBaseId, newVersion, finalLiveZone, newFreezeY);
    await db.updateTopY(id, y);

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

// server/src/routes/heap.ts

import { Hono } from 'hono';
import type { HeapDB } from '../db';
import { isPointInside, checkFreeze, hashVertices } from '../polygon';
import type {
  CreateHeapRequest,
  CreateHeapResponse,
  ListHeapsResponse,
  GetHeapResponse,
  PlaceRequest,
  PlaceResponse,
  ResetHeapResponse,
  DeleteHeapResponse,
  Vertex,
  HeapParams,
} from '../../../shared/heapTypes';
import { DEFAULT_HEAP_PARAMS } from '../../../shared/heapTypes';

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
  return merged;
}

export function heapRoutes(db: HeapDB): Hono {
  const app = new Hono();

  // POST /heaps — create a new heap
  app.post('/', async (c) => {
    let body: CreateHeapRequest;
    try {
      body = await c.req.json<CreateHeapRequest>();
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    const { vertices, params } = body;
    if (
      !Array.isArray(vertices) ||
      vertices.length < 3 ||
      !vertices.every((v) => typeof (v as Vertex)?.x === 'number' && typeof (v as Vertex)?.y === 'number')
    ) {
      return c.json({ error: 'vertices must be an array of at least 3 {x, y} objects' }, 400);
    }

    const resolved = resolveParams(params);
    if ('error' in resolved) return c.json({ error: resolved.error }, 400);

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
        params: {
          name:          r.name,
          difficulty:    r.difficulty,
          spawnRateMult: r.spawn_rate_mult,
          coinMult:      r.coin_mult,
          scoreMult:     r.score_mult,
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

  // GET /heaps/:id?version=N — read heap state (delta-aware)
  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const clientVersion = parseInt(c.req.query('version') ?? '0') || 0;

    const row = await db.getHeap(id);
    if (!row) return c.json({ error: 'Heap not found' }, 404);

    if (clientVersion === row.version) {
      return c.json({ changed: false, version: row.version } satisfies GetHeapResponse);
    }

    const liveZone: Vertex[] = JSON.parse(row.live_zone);
    return c.json({
      changed: true,
      version: row.version,
      baseId: row.base_id,
      liveZone,
      params: {
        name:          row.name,
        difficulty:    row.difficulty,
        spawnRateMult: row.spawn_rate_mult,
        coinMult:      row.coin_mult,
        scoreMult:     row.score_mult,
      },
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
        name:          bodyParams.name          ?? row.name,
        difficulty:    bodyParams.difficulty     ?? row.difficulty,
        spawnRateMult: bodyParams.spawnRateMult  ?? row.spawn_rate_mult,
        coinMult:      bodyParams.coinMult       ?? row.coin_mult,
        scoreMult:     bodyParams.scoreMult      ?? row.score_mult,
      };
      await db.updateHeapParams(id, merged);
    }

    return c.json({
      id,
      version: 1,
      previousVersion,
    } satisfies ResetHeapResponse);
  });

  // POST /heaps/:id/place — add a block vertex to the live zone
  app.post('/:id/place', async (c) => {
    let body: PlaceRequest;
    try {
      body = await c.req.json<PlaceRequest>();
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    const id = c.req.param('id');
    const { x, y } = body;
    if (typeof x !== 'number' || typeof y !== 'number') {
      return c.json({ error: 'x and y are required numbers' }, 400);
    }

    const row = await db.getHeap(id);
    if (!row) return c.json({ error: 'Heap not found' }, 404);

    const liveZone: Vertex[] = JSON.parse(row.live_zone);
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

    return c.json({ accepted: true, version: newVersion } satisfies PlaceResponse);
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

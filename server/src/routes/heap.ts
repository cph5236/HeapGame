import { Hono } from 'hono';
import type { HeapDB } from '../db';
import { isPointInside, checkFreeze, hashVertices } from '../polygon';
import type {
  GetHeapResponse,
  GetHashesResponse,
  AppendHeapRequest,
  AppendHeapResponse,
  SeedHeapRequest,
  SeedHeapResponse,
  Vertex,
} from '../../../shared/heapTypes';

export function heapRoutes(db: HeapDB): Hono {
  const app = new Hono();

  // GET /heap/hashes — list all heap IDs
  app.get('/hashes', async (c) => {
    const hashes = await db.getAllHeapIds();
    return c.json({ hashes } satisfies GetHashesResponse);
  });

  // GET /heap/base/:hash — fetch frozen base vertices
  app.get('/base/:hash', async (c) => {
    const vertices = await db.getBaseVertices(c.req.param('hash'));
    if (!vertices) return c.json({ error: 'Base not found' }, 404);
    return c.json(vertices);
  });

  // NOTE: /base/:hash must be registered before /:hash to prevent Hono matching "base" as a heap ID
  // GET /heap/:hash?version=N — fetch a specific heap's delta
  app.get('/:hash', async (c) => {
    const heapId = c.req.param('hash');
    const clientVersion = parseInt(c.req.query('version') ?? '0') || 0;

    const row = await db.getPolygonRow(heapId);
    if (!row) return c.json({ error: 'Heap not found' }, 404);

    if (clientVersion === row.version) {
      return c.json({ changed: false, version: row.version } satisfies GetHeapResponse);
    }

    const liveZone: Vertex[] = JSON.parse(row.live_zone);
    return c.json({
      changed: true,
      version: row.version,
      baseHash: row.base_hash,
      liveZone,
    } satisfies GetHeapResponse);
  });

  // POST /heap/place — add a block to a specific heap's live zone
  app.post('/place', async (c) => {
    let body: AppendHeapRequest;
    try {
      body = await c.req.json<AppendHeapRequest>();
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    const { hash, x, y } = body;
    if (typeof hash !== 'string' || typeof x !== 'number' || typeof y !== 'number') {
      return c.json({ error: 'hash, x and y are required' }, 400);
    }

    const row = await db.getPolygonRow(hash);
    if (!row) return c.json({ error: 'Heap not found' }, 404);

    const liveZone: Vertex[] = JSON.parse(row.live_zone);
    const baseVertices: Vertex[] = (await db.getBaseVertices(row.base_hash)) ?? [];
    const fullPolygon = [...baseVertices, ...liveZone];

    if (isPointInside({ x, y }, fullPolygon)) {
      return c.json({ accepted: false, version: row.version } satisfies AppendHeapResponse);
    }

    // Insert sorted Y ascending (summit = lowest Y = front)
    const newVertex: Vertex = { x, y };
    const insertIdx = liveZone.findIndex((v) => v.y > y);
    if (insertIdx === -1) {
      liveZone.push(newVertex);
    } else {
      liveZone.splice(insertIdx, 0, newVertex);
    }

    const newVersion = row.version + 1;
    let currentBaseHash = row.base_hash;
    let newFreezeY = row.freeze_y;
    let finalLiveZone = liveZone;

    const freeze = checkFreeze(liveZone, baseVertices);
    if (freeze) {
      await db.upsertBase(freeze.newBaseVertexHash, freeze.newBaseVertices);
      currentBaseHash = freeze.newBaseVertexHash;
      newFreezeY = freeze.newFreezeY;
      finalLiveZone = freeze.newLiveZone;
    }

    // heap_id (row.heap_id) is stable — only base_hash may change on freeze
    await db.upsertPolygonRow(row.heap_id, currentBaseHash, newVersion, finalLiveZone, newFreezeY);

    return c.json({ accepted: true, version: newVersion } satisfies AppendHeapResponse);
  });

  // POST /heap/seed — create a new heap or overwrite an existing one
  app.post('/seed', async (c) => {
    let body: SeedHeapRequest;
    try {
      body = await c.req.json<SeedHeapRequest>();
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    const { vertices, overwriteHeap = false } = body;
    if (
      !Array.isArray(vertices) ||
      vertices.length === 0 ||
      !vertices.every((v) => typeof (v as Vertex)?.x === 'number' && typeof (v as Vertex)?.y === 'number')
    ) {
      return c.json({ error: 'vertices must be a non-empty array of {x, y} objects' }, 400);
    }

    const hash = hashVertices(vertices);
    const existing = await db.getPolygonRow(hash);

    if (existing && !overwriteHeap) {
      return c.json({ error: 'Heap already seeded. Pass overwriteHeap:true to reset.' }, 409);
    }

    await db.upsertBase(hash, vertices);
    await db.upsertPolygonRow(hash, hash, 1, [], 0);

    return c.json({ seeded: true, version: 1, hash, vertexCount: vertices.length } satisfies SeedHeapResponse);
  });

  return app;
}

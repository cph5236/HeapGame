import { Hono } from 'hono';
import type { HeapDB } from '../db';
import { isPointInside, checkFreeze } from '../polygon';
import type {
  GetHeapResponse,
  AppendHeapRequest,
  AppendHeapResponse,
  Vertex,
} from '../../../shared/heapTypes';

export function heapRoutes(db: HeapDB): Hono {
  const app = new Hono();

  // GET /heap?version=N
  app.get('/', async (c) => {
    const clientVersion = parseInt(c.req.query('version') ?? '0') || 0;
    const row = await db.getPolygonRow();

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

  // GET /heap/base/:hash
  app.get('/base/:hash', async (c) => {
    const vertices = await db.getBaseVertices(c.req.param('hash'));
    if (!vertices) return c.json({ error: 'Base not found' }, 404);
    return c.json(vertices);
  });

  // POST /heap/place
  app.post('/place', async (c) => {
    let body: AppendHeapRequest;
    try {
      body = await c.req.json<AppendHeapRequest>();
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    const { x, y } = body;
    if (typeof x !== 'number' || typeof y !== 'number') {
      return c.json({ error: 'x and y must be numbers' }, 400);
    }

    const row = await db.getPolygonRow();
    const liveZone: Vertex[] = JSON.parse(row.live_zone);

    let baseVertices: Vertex[] = [];
    if (row.base_hash) {
      baseVertices = (await db.getBaseVertices(row.base_hash)) ?? [];
    }

    const fullPolygon = [...baseVertices, ...liveZone];

    if (isPointInside({ x, y }, fullPolygon)) {
      return c.json({ accepted: false, version: row.version } satisfies AppendHeapResponse);
    }

    // Insert into live zone sorted Y ascending (summit = lowest Y = front)
    const newVertex: Vertex = { x, y };
    const insertIdx = liveZone.findIndex((v) => v.y > y);
    if (insertIdx === -1) {
      liveZone.push(newVertex);
    } else {
      liveZone.splice(insertIdx, 0, newVertex);
    }

    const newVersion = row.version + 1;
    let newBaseHash = row.base_hash;
    let newFreezeY = row.freeze_y;
    let finalLiveZone = liveZone;

    const freeze = checkFreeze(liveZone, baseVertices);
    if (freeze) {
      await db.upsertBase(freeze.newBaseHash, freeze.newBaseVertices);
      newBaseHash = freeze.newBaseHash;
      newFreezeY = freeze.newFreezeY;
      finalLiveZone = freeze.newLiveZone;
    }

    await db.updatePolygon(newVersion, newBaseHash, finalLiveZone, newFreezeY);

    return c.json({ accepted: true, version: newVersion } satisfies AppendHeapResponse);
  });

  return app;
}

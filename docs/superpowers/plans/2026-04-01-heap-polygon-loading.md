# Heap Polygon Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static `DEV_HEAP` mock with a multi-heap server model — multiple heap polygons can be seeded independently, each with its own live zone; the game loads available heaps at boot and traverses the first one.

**Architecture:** `heap_polygon` becomes a multi-row table keyed by a stable `heap_id` (SHA-256 of the original seed vertices). Each row tracks its current `base_hash` (changes on freeze), `version`, `live_zone`, and `freeze_y`. `POST /heap/seed` creates a new heap entry; re-seeding the same vertices is blocked unless `overwriteHeap: true` is passed, which resets that heap's live zone to `[]` and version to `1`. `GET /heap/hashes` lists all heap IDs. `GET /heap/:hash?version=N` and `POST /heap/place` (with `hash` in body) operate per-heap. `HeapClient` caches per heap ID. `BootScene` fetches all hashes and loads the first; `GameScene` removes `DEV_HEAP` and uses the server polygon.

**Tech Stack:** Hono, Cloudflare Workers/D1, Wrangler, Vitest, tsx (seed script), Phaser 3, TypeScript 5

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `server/schema.sql` | Modify | Multi-row `heap_polygon` keyed by `heap_id` |
| `server/src/db.ts` | Modify | `HeapDB` interface + `D1HeapDB` for multi-heap |
| `server/tests/helpers/mockDb.ts` | Modify | Multi-row `MockHeapDB` matching new interface |
| `shared/heapTypes.ts` | Modify | Add `GetHashesResponse`, `SeedHeapRequest/Response`; update `AppendHeapRequest` |
| `server/src/routes/heap.ts` | Modify | Multi-heap routes: `/hashes`, `/:hash`, `/place`, `/seed` |
| `server/tests/routes.test.ts` | Modify | Update existing tests + new tests for all route changes |
| `src/systems/HeapClient.ts` | Modify | Hash-keyed cache, `getHashes()`, `load(hash)`, `append(hash, x, y)` |
| `src/systems/HeapPolygonLoader.ts` | Create | `applyPolygonToGenerator`, `polygonTopY`, `findSurfaceYFromPolygon` |
| `src/systems/HeapGenerator.ts` | Modify | Add `setPolygonTopY()` + update `topY` getter |
| `src/scenes/BootScene.ts` | Modify | `getHashes()` → `load(hashes[0])` → Phaser registry → `MenuScene` |
| `src/scenes/GameScene.ts` | Modify | Remove `DEV_HEAP`, use server polygon, pass `heapHash` to `append` |
| `src/data/devHeap.ts` | Delete | Replaced by seed script |
| `package.json` | Modify | Add `tsx` devDep + `"seed"` npm script |
| `scripts/seed-heap.ts` | Create | Generate polygon, POST to `/heap/seed` |

---

## Background: How the polygon flows end-to-end

**Coordinate system:** Y=0 is the world top (summit). Y=`MOCK_HEAP_HEIGHT_PX` (50 000) is the world floor. The heap occupies the lower portion (high Y values). The player spawns at the floor and climbs up (toward smaller Y).

**Constants used throughout:**
- `MOCK_HEAP_HEIGHT_PX = 50_000` — world height in pixels
- `WORLD_WIDTH = 960`
- `CHUNK_BAND_HEIGHT = 500` — height of each visual/collision band
- `SCAN_STEP = 4` — scanline density
- `MOCK_SEED = 42`

**Heap identity vs. base hash:** Each heap has a stable `heap_id` = SHA-256 of its original seed vertices. This never changes. The `base_hash` column tracks the current base polygon (which advances when the live zone freezes). All API consumers use `heap_id` to identify a heap.

**Seed polygon shape:** `computeBandScanlines(entries, 0, MOCK_HEAP_HEIGHT_PX)` → `computeBandPolygon(rows)` builds a closed outline: left edge Y-ascending then right edge Y-descending. `simplifyPolygon(vertices, 2)` reduces vertex count.

**Band reconstruction on client:** The flat `Vertex[]` is split by `CHUNK_BAND_HEIGHT`. Filtering by Y while preserving array order yields a closed per-band polygon suitable for `applyBandPolygon`.

---

## Task 1: Schema — multi-row `heap_polygon`

**Files:**
- Modify: `server/schema.sql`

- [ ] **Step 1: Replace the schema**

Replace the entire contents of `server/schema.sql` with:

```sql
CREATE TABLE IF NOT EXISTS heap_polygon (
  heap_id   TEXT PRIMARY KEY,
  base_hash TEXT NOT NULL,
  version   INTEGER NOT NULL DEFAULT 1,
  live_zone TEXT    NOT NULL DEFAULT '[]',
  freeze_y  REAL    NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS heap_base (
  hash     TEXT PRIMARY KEY,
  vertices TEXT NOT NULL
);
```

The old schema had a single row locked to `id = 1` with a default empty insert. The new schema has no initial rows — heaps are created exclusively via `POST /heap/seed`. `heap_id` is the stable identity (initial seed hash). `base_hash` tracks the current base and may change as the live zone freezes.

- [ ] **Step 2: Apply to local D1**

```bash
cd server && npx wrangler d1 execute heap --local --file=schema.sql
```

Expected: `Executed SQL file successfully` (no errors). This wipes and recreates the local DB.

- [ ] **Step 3: Commit**

```bash
git add server/schema.sql
git commit -m "feat: multi-row heap_polygon schema keyed by heap_id"
```

---

## Task 2: DB interface + implementations

**Files:**
- Modify: `server/src/db.ts`
- Modify: `server/tests/helpers/mockDb.ts`

- [ ] **Step 1: Rewrite `server/src/db.ts`**

Replace the entire file:

```ts
import { Vertex } from '../../shared/heapTypes';

export interface HeapRow {
  heap_id: string;
  base_hash: string;
  version: number;
  live_zone: string;   // JSON Vertex[]
  freeze_y: number;
}

/** Abstraction over D1 — allows MockHeapDB in tests. */
export interface HeapDB {
  getAllHeapIds(): Promise<string[]>;
  getPolygonRow(heapId: string): Promise<HeapRow | null>;
  upsertPolygonRow(heapId: string, baseHash: string, version: number, liveZone: Vertex[], freezeY: number): Promise<void>;
  getBaseVertices(hash: string): Promise<Vertex[] | null>;
  upsertBase(hash: string, vertices: Vertex[]): Promise<void>;
}

/** Production implementation backed by Cloudflare D1. */
export class D1HeapDB implements HeapDB {
  constructor(private d1: D1Database) {}

  async getAllHeapIds(): Promise<string[]> {
    const result = await this.d1
      .prepare('SELECT heap_id FROM heap_polygon')
      .all<{ heap_id: string }>();
    return result.results.map((r) => r.heap_id);
  }

  async getPolygonRow(heapId: string): Promise<HeapRow | null> {
    const row = await this.d1
      .prepare('SELECT heap_id, base_hash, version, live_zone, freeze_y FROM heap_polygon WHERE heap_id = ?1')
      .bind(heapId)
      .first<HeapRow>();
    return row ?? null;
  }

  async upsertPolygonRow(
    heapId: string,
    baseHash: string,
    version: number,
    liveZone: Vertex[],
    freezeY: number,
  ): Promise<void> {
    await this.d1
      .prepare(
        'INSERT OR REPLACE INTO heap_polygon (heap_id, base_hash, version, live_zone, freeze_y) VALUES (?1, ?2, ?3, ?4, ?5)',
      )
      .bind(heapId, baseHash, version, JSON.stringify(liveZone), freezeY)
      .run();
  }

  async getBaseVertices(hash: string): Promise<Vertex[] | null> {
    const row = await this.d1
      .prepare('SELECT vertices FROM heap_base WHERE hash = ?1')
      .bind(hash)
      .first<{ vertices: string }>();
    return row ? (JSON.parse(row.vertices) as Vertex[]) : null;
  }

  async upsertBase(hash: string, vertices: Vertex[]): Promise<void> {
    await this.d1
      .prepare('INSERT OR REPLACE INTO heap_base (hash, vertices) VALUES (?1, ?2)')
      .bind(hash, JSON.stringify(vertices))
      .run();
  }
}
```

- [ ] **Step 2: Rewrite `server/tests/helpers/mockDb.ts`**

Replace the entire file:

```ts
import { HeapDB, HeapRow } from '../../src/db';
import { Vertex } from '../../../shared/heapTypes';

/** In-memory HeapDB for use in tests. No D1 or Workers runtime needed. */
export class MockHeapDB implements HeapDB {
  private rows = new Map<string, { base_hash: string; version: number; live_zone: string; freeze_y: number }>();
  private bases = new Map<string, string>();

  async getAllHeapIds(): Promise<string[]> {
    return Array.from(this.rows.keys());
  }

  async getPolygonRow(heapId: string): Promise<HeapRow | null> {
    const r = this.rows.get(heapId);
    if (!r) return null;
    return { heap_id: heapId, ...r };
  }

  async upsertPolygonRow(
    heapId: string,
    baseHash: string,
    version: number,
    liveZone: Vertex[],
    freezeY: number,
  ): Promise<void> {
    this.rows.set(heapId, {
      base_hash: baseHash,
      version,
      live_zone: JSON.stringify(liveZone),
      freeze_y: freezeY,
    });
  }

  async getBaseVertices(hash: string): Promise<Vertex[] | null> {
    const raw = this.bases.get(hash);
    return raw ? (JSON.parse(raw) as Vertex[]) : null;
  }

  async upsertBase(hash: string, vertices: Vertex[]): Promise<void> {
    this.bases.set(hash, JSON.stringify(vertices));
  }

  /** Test helper — seed a polygon row directly. `baseHash` defaults to `heapId`. */
  seedPolygon(heapId: string, version: number, liveZone: Vertex[], baseHash?: string, freezeY = 0): void {
    this.rows.set(heapId, {
      base_hash: baseHash ?? heapId,
      version,
      live_zone: JSON.stringify(liveZone),
      freeze_y: freezeY,
    });
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit
```

Expected: No errors in `db.ts` or `mockDb.ts`.

- [ ] **Step 4: Commit**

```bash
git add server/src/db.ts server/tests/helpers/mockDb.ts
git commit -m "feat: multi-heap DB interface keyed by heap_id"
```

---

## Task 3: Shared types

**Files:**
- Modify: `shared/heapTypes.ts`

- [ ] **Step 1: Replace `shared/heapTypes.ts`**

```ts
export interface Vertex {
  x: number;
  y: number;
}

export type GetHeapResponse =
  | { changed: false; version: number }
  | { changed: true; version: number; baseHash: string; liveZone: Vertex[] };

export interface GetHashesResponse {
  hashes: string[];
}

export interface AppendHeapRequest {
  hash: string;
  x: number;
  y: number;
}

export interface AppendHeapResponse {
  accepted: boolean;
  version: number;
}

export interface SeedHeapRequest {
  vertices: Vertex[];
  overwriteHeap?: boolean;
}

export interface SeedHeapResponse {
  seeded: boolean;
  version: number;
  hash: string;
  vertexCount: number;
}
```

- [ ] **Step 2: Verify TypeScript compiles in server**

```bash
cd server && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add shared/heapTypes.ts
git commit -m "feat: add multi-heap shared types (GetHashesResponse, SeedHeapRequest/Response)"
```

---

## Task 4: Server routes + tests

**Files:**
- Modify: `server/src/routes/heap.ts`
- Modify: `server/tests/routes.test.ts`

- [ ] **Step 1: Write the failing tests first**

Replace the entire contents of `server/tests/routes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import type { GetHeapResponse, GetHashesResponse, AppendHeapResponse, SeedHeapResponse } from '../../shared/heapTypes';

const HEAP_ID = 'aaaa';  // arbitrary stable test heap ID

function makeApp() {
  return createApp(new MockHeapDB());
}

// ── GET /heap/hashes ─────────────────────────────────────────────────────────

describe('GET /heap/hashes', () => {
  it('returns empty array when no heaps exist', async () => {
    const res = await makeApp().request('/heap/hashes');
    expect(res.status).toBe(200);
    const body = await res.json() as GetHashesResponse;
    expect(body.hashes).toEqual([]);
  });

  it('returns all heap IDs', async () => {
    const db = new MockHeapDB();
    db.seedPolygon('hash1', 1, []);
    db.seedPolygon('hash2', 1, []);
    const res = await createApp(db).request('/heap/hashes');
    expect(res.status).toBe(200);
    const body = await res.json() as GetHashesResponse;
    expect(body.hashes).toHaveLength(2);
    expect(body.hashes).toContain('hash1');
    expect(body.hashes).toContain('hash2');
  });
});

// ── GET /heap/:hash ──────────────────────────────────────────────────────────

describe('GET /heap/:hash', () => {
  it('returns 404 for an unknown heap ID', async () => {
    const res = await makeApp().request('/heap/unknownhash');
    expect(res.status).toBe(404);
  });

  it('returns changed:false when client version matches server', async () => {
    const db = new MockHeapDB();
    db.seedPolygon(HEAP_ID, 3, [{ x: 10, y: 5 }]);
    const res = await createApp(db).request(`/heap/${HEAP_ID}?version=3`);
    expect(res.status).toBe(200);
    const body = await res.json() as GetHeapResponse;
    expect(body.changed).toBe(false);
    expect(body.version).toBe(3);
  });

  it('returns changed:true with liveZone when client version is behind', async () => {
    const db = new MockHeapDB();
    db.seedPolygon(HEAP_ID, 3, [{ x: 10, y: 5 }]);
    const res = await createApp(db).request(`/heap/${HEAP_ID}?version=0`);
    expect(res.status).toBe(200);
    const body = await res.json() as GetHeapResponse;
    expect(body.changed).toBe(true);
    if (body.changed) {
      expect(body.version).toBe(3);
      expect(Array.isArray(body.liveZone)).toBe(true);
      expect(typeof body.baseHash).toBe('string');
    }
  });

  it('defaults to version=0 when no version param provided', async () => {
    const db = new MockHeapDB();
    db.seedPolygon(HEAP_ID, 1, []);
    const res = await createApp(db).request(`/heap/${HEAP_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json() as GetHeapResponse;
    expect(body.changed).toBe(true);  // version 1 > 0
  });
});

// ── GET /heap/base/:hash ─────────────────────────────────────────────────────

describe('GET /heap/base/:hash', () => {
  it('returns 404 for an unknown hash', async () => {
    const res = await makeApp().request('/heap/base/unknownhash');
    expect(res.status).toBe(404);
  });

  it('returns base vertices for a known hash', async () => {
    const db = new MockHeapDB();
    await db.upsertBase('myhash', [{ x: 1, y: 2 }]);
    const res = await createApp(db).request('/heap/base/myhash');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ x: 1, y: 2 }]);
  });
});

// ── POST /heap/place ─────────────────────────────────────────────────────────

describe('POST /heap/place', () => {
  it('returns 404 when the heap ID does not exist', async () => {
    const res = await makeApp().request('/heap/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: 'nope', x: 100, y: 200 }),
    });
    expect(res.status).toBe(404);
  });

  it('accepts a point when the polygon is empty', async () => {
    const db = new MockHeapDB();
    db.seedPolygon(HEAP_ID, 1, []);
    const res = await createApp(db).request('/heap/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: HEAP_ID, x: 100, y: 200 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as AppendHeapResponse;
    expect(body.accepted).toBe(true);
    expect(body.version).toBe(2);
  });

  it('rejects a point inside the polygon', async () => {
    const db = new MockHeapDB();
    // A square: (0,0),(100,0),(100,100),(0,100) — centroid (50,50) is inside
    db.seedPolygon(HEAP_ID, 1, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
    const res = await createApp(db).request('/heap/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: HEAP_ID, x: 50, y: 50 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as AppendHeapResponse;
    expect(body.accepted).toBe(false);
    expect(body.version).toBe(1);
  });

  it('accepts a point outside the polygon and bumps version', async () => {
    const db = new MockHeapDB();
    db.seedPolygon(HEAP_ID, 1, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
    const res = await createApp(db).request('/heap/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: HEAP_ID, x: 200, y: 200 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as AppendHeapResponse;
    expect(body.accepted).toBe(true);
    expect(body.version).toBe(2);
  });

  it('returns 400 when hash, x, or y is missing', async () => {
    const res = await makeApp().request('/heap/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 10, y: 20 }),  // missing hash
    });
    expect(res.status).toBe(400);
  });
});

// ── POST /heap/seed ──────────────────────────────────────────────────────────

describe('POST /heap/seed', () => {
  const vertices = [
    { x: 100, y: 400 },
    { x: 300, y: 600 },
    { x: 500, y: 400 },
  ];

  it('seeds a new heap and returns seeded:true with version 1', async () => {
    const res = await makeApp().request('/heap/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as SeedHeapResponse;
    expect(body.seeded).toBe(true);
    expect(body.version).toBe(1);
    expect(body.vertexCount).toBe(3);
    expect(typeof body.hash).toBe('string');
  });

  it('returns 409 when same vertices sent again without overwriteHeap', async () => {
    const app = makeApp();
    // Seed once
    await app.request('/heap/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices }),
    });
    // Try again — same vertices → same hash → conflict
    const res = await app.request('/heap/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices }),
    });
    expect(res.status).toBe(409);
  });

  it('resets live zone and version to 1 when overwriteHeap:true', async () => {
    const db = new MockHeapDB();
    const app = createApp(db);
    // First seed
    const first = await app.request('/heap/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices }),
    });
    const { hash } = await first.json() as SeedHeapResponse;

    // Manually advance version to simulate player activity
    db.seedPolygon(hash, 42, [{ x: 200, y: 500 }]);

    // Overwrite
    const res = await app.request('/heap/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices, overwriteHeap: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as SeedHeapResponse;
    expect(body.seeded).toBe(true);
    expect(body.version).toBe(1);

    // Confirm live zone was reset
    const row = await db.getPolygonRow(hash);
    expect(row?.version).toBe(1);
    expect(JSON.parse(row!.live_zone)).toEqual([]);
  });

  it('rejects empty vertices array with 400', async () => {
    const res = await makeApp().request('/heap/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('two different vertex arrays produce two independent heaps', async () => {
    const app = makeApp();
    const verticesB = [{ x: 10, y: 20 }, { x: 30, y: 40 }, { x: 50, y: 20 }];

    await app.request('/heap/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices }),
    });
    await app.request('/heap/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: verticesB }),
    });

    const hashRes = await app.request('/heap/hashes');
    const { hashes } = await hashRes.json() as GetHashesResponse;
    expect(hashes).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd server && npm test
```

Expected: Many failures — the new routes and updated `MockHeapDB` don't exist yet.

- [ ] **Step 3: Rewrite `server/src/routes/heap.ts`**

Replace the entire file:

```ts
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
      await db.upsertBase(freeze.newBaseHash, freeze.newBaseVertices);
      currentBaseHash = freeze.newBaseHash;
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
    if (!Array.isArray(vertices) || vertices.length === 0) {
      return c.json({ error: 'vertices must be a non-empty array' }, 400);
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
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd server && npm test
```

Expected: All tests pass. Output ends with something like `25 passed`.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/heap.ts server/tests/routes.test.ts
git commit -m "feat: multi-heap routes (/hashes, /:hash, /place, /seed) with overwriteHeap support"
```

---

## Task 5: `HeapClient` — hash-keyed cache + new methods

**Files:**
- Modify: `src/systems/HeapClient.ts`

- [ ] **Step 1: Rewrite `src/systems/HeapClient.ts`**

```ts
import type {
  GetHeapResponse,
  GetHashesResponse,
  AppendHeapRequest,
  AppendHeapResponse,
  Vertex,
} from '../../shared/heapTypes';

const SERVER_URL: string =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_HEAP_SERVER_URL ??
  'http://localhost:8787';

const CACHE_PREFIX = 'heap_cache_';       // + heapId
const BASE_CACHE_PREFIX = 'heap_base_';  // + baseHash (content-addressed, unchanged)

interface HeapCache {
  version: number;
  baseHash: string;
  liveZone: Vertex[];
}

function loadCache(heapId: string): HeapCache | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + heapId);
    return raw ? (JSON.parse(raw) as HeapCache) : null;
  } catch {
    return null;
  }
}

function saveCache(heapId: string, cache: HeapCache): void {
  localStorage.setItem(CACHE_PREFIX + heapId, JSON.stringify(cache));
}

function loadCachedBase(hash: string): Vertex[] | null {
  try {
    const raw = localStorage.getItem(BASE_CACHE_PREFIX + hash);
    return raw ? (JSON.parse(raw) as Vertex[]) : null;
  } catch {
    return null;
  }
}

function saveCachedBase(hash: string, vertices: Vertex[]): void {
  localStorage.setItem(BASE_CACHE_PREFIX + hash, JSON.stringify(vertices));
}

async function fetchBase(hash: string): Promise<Vertex[]> {
  const cached = loadCachedBase(hash);
  if (cached) return cached;
  const res = await fetch(`${SERVER_URL}/heap/base/${hash}`);
  if (!res.ok) throw new Error(`base fetch failed: ${res.status}`);
  const vertices = (await res.json()) as Vertex[];
  saveCachedBase(hash, vertices);
  return vertices;
}

async function buildPolygon(cache: HeapCache): Promise<Vertex[]> {
  if (!cache.baseHash) return cache.liveZone;
  const base = await fetchBase(cache.baseHash);
  return [...base, ...cache.liveZone];
}

export class HeapClient {
  /**
   * Fetch all heap IDs from the server.
   * Returns [] on network failure.
   */
  static async getHashes(): Promise<string[]> {
    try {
      const res = await fetch(`${SERVER_URL}/heap/hashes`);
      if (!res.ok) return [];
      const data = (await res.json()) as GetHashesResponse;
      return data.hashes;
    } catch {
      return [];
    }
  }

  /**
   * Load the full polygon for a specific heap.
   * Uses localStorage cache + server delta strategy.
   * Falls back to last cached data (or []) on network failure.
   */
  static async load(heapId: string): Promise<Vertex[]> {
    const cache = loadCache(heapId);
    const version = cache?.version ?? 0;

    try {
      const res = await fetch(`${SERVER_URL}/heap/${heapId}?version=${version}`);
      if (!res.ok) throw new Error(`heap fetch failed: ${res.status}`);
      const data = (await res.json()) as GetHeapResponse;

      if (!data.changed && cache) {
        return buildPolygon(cache);
      }

      if (data.changed) {
        const newCache: HeapCache = {
          version: data.version,
          baseHash: data.baseHash,
          liveZone: data.liveZone,
        };
        saveCache(heapId, newCache);
        return buildPolygon(newCache);
      }

      return [];
    } catch {
      if (cache) {
        try {
          return await buildPolygon(cache);
        } catch {
          return cache.liveZone;
        }
      }
      return [];
    }
  }

  /**
   * Fire-and-forget block placement for a specific heap.
   * Called after the player summits. Never throws or blocks gameplay.
   */
  static async append(heapId: string, x: number, y: number): Promise<void> {
    const cache = loadCache(heapId);
    try {
      const body: AppendHeapRequest = { hash: heapId, x, y };
      const res = await fetch(`${SERVER_URL}/heap/place`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return;
      const data = (await res.json()) as AppendHeapResponse;
      if (data.accepted && cache) {
        saveCache(heapId, { ...cache, version: data.version });
      }
    } catch {
      // Silently drop — game never depends on server for local progression
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors in `HeapClient.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/systems/HeapClient.ts
git commit -m "feat: HeapClient hash-keyed cache with getHashes(), load(hash), append(hash,x,y)"
```

---

## Task 6: Client — `HeapPolygonLoader.ts` utility

**Files:**
- Create: `src/systems/HeapPolygonLoader.ts`

This module has no Phaser dependency — pure TypeScript, importable from the seed script too.

- [ ] **Step 1: Create `src/systems/HeapPolygonLoader.ts`**

```ts
import { CHUNK_BAND_HEIGHT, MOCK_HEAP_HEIGHT_PX } from '../constants';
import type { Vertex } from './HeapPolygon';
import type { HeapGenerator } from './HeapGenerator';

/**
 * Splits a flat polygon Vertex[] into CHUNK_BAND_HEIGHT bands and calls
 * generator.applyBandPolygon() for each band that has ≥3 vertices.
 *
 * The polygon must be structured as:
 *   left-edge vertices (Y ascending) then right-edge vertices (Y descending).
 * Filtering by Y while preserving array order yields a closed per-band polygon.
 */
export function applyPolygonToGenerator(polygon: Vertex[], generator: HeapGenerator): void {
  if (polygon.length === 0) return;

  let minY = MOCK_HEAP_HEIGHT_PX;
  let maxY = 0;
  for (const v of polygon) {
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }

  const firstBand = Math.floor(minY / CHUNK_BAND_HEIGHT) * CHUNK_BAND_HEIGHT;

  for (let bandTop = firstBand; bandTop <= maxY; bandTop += CHUNK_BAND_HEIGHT) {
    const bandBottom = bandTop + CHUNK_BAND_HEIGHT;
    const bandVertices = polygon.filter((v) => v.y >= bandTop && v.y < bandBottom);
    if (bandVertices.length >= 3) {
      generator.applyBandPolygon(bandTop, bandVertices);
    }
  }
}

/**
 * Returns the Y of the polygon's summit (smallest Y = highest point in world).
 * Returns MOCK_HEAP_HEIGHT_PX if the polygon is empty (world floor fallback).
 * Uses an explicit loop to avoid spread-operator stack overflow on large arrays.
 */
export function polygonTopY(polygon: Vertex[]): number {
  if (polygon.length === 0) return MOCK_HEAP_HEIGHT_PX;
  let min = MOCK_HEAP_HEIGHT_PX;
  for (const v of polygon) {
    if (v.y < min) min = v.y;
  }
  return min;
}

/**
 * Finds the topmost surface Y within the X span [cx - width/2, cx + width/2].
 * Returns MOCK_HEAP_HEIGHT_PX if no vertices overlap (world floor fallback).
 */
export function findSurfaceYFromPolygon(cx: number, width: number, polygon: Vertex[]): number {
  const left = cx - width / 2;
  const right = cx + width / 2;
  let surfaceY = MOCK_HEAP_HEIGHT_PX;

  for (const v of polygon) {
    if (v.x >= left && v.x <= right && v.y < surfaceY) {
      surfaceY = v.y;
    }
  }
  return surfaceY;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/systems/HeapPolygonLoader.ts
git commit -m "feat: add HeapPolygonLoader utility (band splitting, polygonTopY, findSurfaceYFromPolygon)"
```

---

## Task 7: Client — `HeapGenerator.setPolygonTopY()`

**Files:**
- Modify: `src/systems/HeapGenerator.ts`

`topY` currently iterates `this.data` (HeapEntry[]). With an empty entry array (server polygon path) it returns `MOCK_HEAP_HEIGHT_PX` (world floor), which breaks summit detection. Add an override setter.

- [ ] **Step 1: Add `_polygonTopY` field**

Find the private field declarations at the top of the class (around line 30, after `private readonly entryBuckets`). Add:

```ts
  /** Set by GameScene when using the server polygon path. Overrides entry-based topY. */
  private _polygonTopY: number | null = null;
```

- [ ] **Step 2: Replace the `topY` getter**

Find the existing `topY` getter and replace it with:

```ts
  get topY(): number {
    if (this._polygonTopY !== null) return this._polygonTopY;
    let min = MOCK_HEAP_HEIGHT_PX;
    for (const e of this.data) {
      const def = OBJECT_DEFS[e.keyid] ?? OBJECT_DEFS[0];
      const top = e.y - def.height / 2;
      if (top < min) min = top;
    }
    return min;
  }
```

- [ ] **Step 3: Add `setPolygonTopY` method directly after the `topY` getter**

```ts
  /** Override topY for server polygon path (no entries to compute from). */
  setPolygonTopY(y: number): void {
    this._polygonTopY = y;
  }
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add src/systems/HeapGenerator.ts
git commit -m "feat: add setPolygonTopY override to HeapGenerator for server polygon path"
```

---

## Task 8: Client — `BootScene` async polygon load

**Files:**
- Modify: `src/scenes/BootScene.ts`

`BootScene.create()` currently starts `MenuScene` synchronously. Change it to: fetch all heap IDs, load the first one, store both `heapHash` and `heapPolygon` in the Phaser registry, then start `MenuScene`. If the server is unreachable or no heaps exist, falls back to empty state — the game still boots.

- [ ] **Step 1: Modify `src/scenes/BootScene.ts`**

Add the import at the top (after existing imports):

```ts
import { HeapClient } from '../systems/HeapClient';
import type { Vertex } from '../systems/HeapPolygon';
```

Replace the `create()` method body (texture creation calls stay, only the transition changes):

```ts
  create(): void {
    this.createPlatformTexture();
    this.createCloudTexture();
    this.createWallJumpTexture();
    this.createEnemyPercherTexture();
    this.createEnemyGhostTexture();

    HeapClient.getHashes()
      .then((hashes) => {
        if (hashes.length === 0) {
          return Promise.resolve({ hash: '', polygon: [] as Vertex[] });
        }
        const hash = hashes[0];
        return HeapClient.load(hash).then((polygon) => ({ hash, polygon }));
      })
      .then(({ hash, polygon }) => {
        this.game.registry.set('heapHash', hash);
        this.game.registry.set('heapPolygon', polygon);
      })
      .catch(() => {
        this.game.registry.set('heapHash', '');
        this.game.registry.set('heapPolygon', [] as Vertex[]);
      })
      .finally(() => {
        this.scene.start('MenuScene');
      });
  }
```

- [ ] **Step 2: Run the game and verify it boots**

```bash
npm run dev
```

Open `http://localhost:5173`. The game should reach the menu. A failed fetch to `localhost:8787` in the console is expected if the server isn't running — the game still boots.

- [ ] **Step 3: Commit**

```bash
git add src/scenes/BootScene.ts
git commit -m "feat: BootScene fetches heap hashes and loads first polygon into Phaser registry"
```

---

## Task 9: Client — `GameScene` server polygon integration

**Files:**
- Modify: `src/scenes/GameScene.ts`
- Delete: `src/data/devHeap.ts`

- [ ] **Step 1: Update imports in `src/scenes/GameScene.ts`**

Remove these import lines:
```ts
import { DEV_HEAP } from '../data/devHeap';
import { loadHeapAdditions, persistHeapEntry } from '../systems/HeapPersistence';
import { findSurfaceY } from '../systems/HeapSurface';
```

Add in their place:
```ts
import { persistHeapEntry } from '../systems/HeapPersistence';
import type { Vertex } from '../systems/HeapPolygon';
import {
  applyPolygonToGenerator,
  polygonTopY,
  findSurfaceYFromPolygon,
} from '../systems/HeapPolygonLoader';
```

(`loadHeapAdditions` is dropped — local additions are superseded by the server polygon. `persistHeapEntry` stays for the `HeapClient.append` cache-version update path.)

- [ ] **Step 2: Add `_heapPolygon` and `_heapHash` fields**

In the class field declarations (after `private _ghostLastInZone`), add:

```ts
  private _heapPolygon: Vertex[] = [];
  private _heapHash = '';
```

- [ ] **Step 3: Replace `HeapGenerator` construction in `create()`**

Find the existing construction block (approximately):
```ts
    this.chunkRenderer = new HeapChunkRenderer(this);
    this.edgeCollider = new HeapEdgeCollider(this);
    this.heapGenerator = new HeapGenerator(this, this.platforms, [...DEV_HEAP, ...loadHeapAdditions()], this.chunkRenderer, this.edgeCollider);
```

Replace with:
```ts
    this.chunkRenderer = new HeapChunkRenderer(this);
    this.edgeCollider = new HeapEdgeCollider(this);

    const polygon = (this.game.registry.get('heapPolygon') as Vertex[] | undefined) ?? [];
    const heapHash = (this.game.registry.get('heapHash') as string | undefined) ?? '';
    this._heapPolygon = polygon;
    this._heapHash = heapHash;

    this.heapGenerator = new HeapGenerator(
      this, this.platforms, [], this.chunkRenderer, this.edgeCollider,
    );

    if (polygon.length > 0) {
      applyPolygonToGenerator(polygon, this.heapGenerator);
      this.heapGenerator.setPolygonTopY(polygonTopY(polygon));
    }
```

- [ ] **Step 4: Replace `findSurfaceY` calls**

Search for all occurrences:
```bash
grep -n "findSurfaceY" src/scenes/GameScene.ts
```

Replace every `findSurfaceY(px, def.width, this.heapGenerator.entries)` with:
```ts
findSurfaceYFromPolygon(px, def.width, this._heapPolygon)
```

Run grep again to confirm zero remaining occurrences:
```bash
grep -n "findSurfaceY" src/scenes/GameScene.ts
```
Expected: no output.

- [ ] **Step 5: Update `HeapClient.append` calls**

Search for all `HeapClient.append` calls:
```bash
grep -n "HeapClient.append" src/scenes/GameScene.ts
```

Each call currently looks like `HeapClient.append(x, y)`. Update every one to:
```ts
HeapClient.append(this._heapHash, x, y)
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors. If `findSurfaceY` or `DEV_HEAP` are still referenced anywhere, fix those first.

- [ ] **Step 7: Delete `src/data/devHeap.ts`**

```bash
git rm src/data/devHeap.ts
```

- [ ] **Step 8: Smoke test with server running**

In one terminal:
```bash
cd server && npm run dev
```

In another:
```bash
npm run dev
```

Open the game. With an empty DB, the heap area is blank (no polygon yet) but the game boots and the menu is reachable. That's expected — seeding is Task 10.

- [ ] **Step 9: Commit**

```bash
git add src/scenes/GameScene.ts
git commit -m "feat: GameScene uses server polygon, removes DEV_HEAP"
```

---

## Task 10: Seed Script — generate and upload initial heap polygon

**Files:**
- Modify: `package.json` (root)
- Create: `scripts/seed-heap.ts`

- [ ] **Step 1: Add `tsx` to root `package.json` and the `seed` script**

In `package.json`, add `"tsx": "^4.19.2"` to `devDependencies` and `"seed": "npx tsx scripts/seed-heap.ts"` to `scripts`. The full file should look like:

```json
{
  "name": "heap-game",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "cap:sync": "cap sync",
    "cap:android": "cap open android",
    "gen-assets": "node scripts/gen-heap-defs.mjs && node scripts/gen-heap-texture.mjs",
    "seed": "npx tsx scripts/seed-heap.ts"
  },
  "dependencies": {
    "@capacitor/android": "8.2.0",
    "@capacitor/core": "8.2.0",
    "phaser": "3.90.0"
  },
  "devDependencies": {
    "@capacitor/cli": "8.2.0",
    "@types/node": "25.5.0",
    "sharp": "^0.34.5",
    "tsx": "^4.19.2",
    "typescript": "5.9.3",
    "vite": "^6.3.0"
  }
}
```

- [ ] **Step 2: Install the new dep**

```bash
npm install
```

Expected: `tsx` added to `node_modules`.

- [ ] **Step 3: Create `scripts/seed-heap.ts`**

```ts
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
```

- [ ] **Step 4: Run the seed script against the local dev server**

In one terminal:
```bash
cd server && npm run dev
```

In another:
```bash
npm run seed
```

Expected output:
```
Building heap with 500 blocks…
  Generated 500 entries
Computing polygon…
  Polygon: ~800-2000 vertices after simplification
POSTing to http://localhost:8787/heap/seed…
  ✓ Seeded! version=1, vertexCount=<N>, hash=<sha256>
```

If you get `✗ 409: Heap already seeded`, re-run with overwrite:
```bash
OVERWRITE=true npm run seed
```

- [ ] **Step 5: Verify the game loads the polygon**

With the server still running, open `http://localhost:5173`. The heap should now be visible. The player should spawn at the world floor and be able to climb.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json scripts/seed-heap.ts
git commit -m "feat: seed script generates 500-block polygon and uploads to /heap/seed"
```

---

## Task 11: Deploy + Seed production (manual)

**No automated steps — run commands manually.**

- [ ] **Step 1: Apply schema to remote D1**

```bash
cd server && npx wrangler d1 execute heap --remote --file=schema.sql
```

Expected: `Executed SQL file successfully`.

- [ ] **Step 2: Deploy the server**

```bash
cd server && npx wrangler deploy
```

Expected: `Deployed heap-server … https://heap-server.<subdomain>.workers.dev`

- [ ] **Step 3: Seed the production database**

```bash
HEAP_SERVER_URL=https://heap-server.<your-subdomain>.workers.dev npm run seed
```

Expected:
```
  ✓ Seeded! version=1, vertexCount=<N>, hash=<sha256>
```

- [ ] **Step 4: Verify**

```bash
curl -s "https://heap-server.<your-subdomain>.workers.dev/heap/hashes"
# Expected: {"hashes":["<sha256>"]}

curl -s "https://heap-server.<your-subdomain>.workers.dev/heap/<hash>?version=0" | head -c 100
# Expected: {"changed":true,"version":1,"baseHash":"<hash>","liveZone":[]}
```

- [ ] **Step 5: Test game against production**

Update `.env`:
```
VITE_HEAP_SERVER_URL=https://heap-server.<your-subdomain>.workers.dev
```

```bash
npm run dev
```

The game should boot, load the production polygon, and display it.

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Multiple heaps can be seeded independently — each gets its own `heap_id` — Task 4
- ✅ `POST /heap/seed` blocks re-seed without `overwriteHeap:true` (409) — Task 4
- ✅ `overwriteHeap:true` resets live zone to `[]` and version to `1` without changing `heap_id` — Task 4
- ✅ `GET /heap/hashes` lists all active heap IDs — Task 4
- ✅ `GET /heap/:hash` returns per-heap delta — Task 4
- ✅ `POST /heap/place` targets a specific heap via `hash` in body — Task 4
- ✅ `heap_id` is stable through freezes; `base_hash` advances — Tasks 1, 2, 4
- ✅ `HeapClient` cache keyed per `heapId` — Task 5
- ✅ `BootScene` fetches hashes, loads first — Task 8
- ✅ `GameScene` removes `DEV_HEAP`, uses polygon, passes `heapHash` to `append` — Task 9
- ✅ `DEV_HEAP` deleted — Task 9
- ✅ Falls back to empty polygon when server is down — Tasks 5, 8
- ✅ Seed script uses `OVERWRITE=true` env var — Task 10

**Notes on enemy spawning:** `EnemyManager.onPlatformSpawned` fires only when `HeapEntry[]` are added via `heapGenerator.addEntry`. With an empty entry array (server polygon path), enemies don't spawn on the initial heap. Enemies still spawn on blocks placed by the player. Multi-heap enemy seeding is future work.

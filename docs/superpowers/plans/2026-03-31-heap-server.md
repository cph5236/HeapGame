# Heap Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Hono + Cloudflare Workers + D1 server that stores the community heap polygon, serves deltas to clients, accepts player block placements, and deploys via `wrangler deploy`.

**Architecture:** The heap is stored server-side as two regions — a frozen base (cached by SHA-256 hash on the client) and a live zone (returned on every version mismatch). `POST /heap/place` validates that a submitted point expands the polygon (ray-casting point-in-polygon), then appends the vertex and bumps the version. `db.ts` exports a `HeapDB` interface; production uses `D1HeapDB`, tests use `MockHeapDB` — no Workers runtime required for tests.

**Tech Stack:** Hono, Cloudflare Workers, Cloudflare D1, Wrangler 3, TypeScript 5, Vitest

---

## File Map

| File | Status | Responsibility |
|------|--------|----------------|
| `shared/heapTypes.ts` | Create | Wire types shared between client and server |
| `server/package.json` | Create | Server dependencies and scripts |
| `server/tsconfig.json` | Create | TypeScript config for Workers |
| `server/vitest.config.ts` | Create | Vitest config |
| `server/wrangler.toml` | Create | Workers + D1 binding config |
| `server/schema.sql` | Create | D1 schema — applied via wrangler d1 execute |
| `server/src/db.ts` | Create | HeapDB interface + D1HeapDB implementation |
| `server/src/polygon.ts` | Create | Point-in-polygon (ray casting), freeze logic |
| `server/src/routes/heap.ts` | Create | Hono route handlers for all three endpoints |
| `server/src/app.ts` | Create | Hono app factory — `createApp(db: HeapDB): Hono` |
| `server/src/index.ts` | Create | Workers entry point — `export default { fetch }` |
| `server/tests/helpers/mockDb.ts` | Create | In-memory MockHeapDB for tests |
| `server/tests/polygon.test.ts` | Create | Unit tests for polygon math |
| `server/tests/routes.test.ts` | Create | Integration tests using Hono test client + MockHeapDB |
| `src/systems/HeapClient.ts` | Create | Client fetch wrapper + localStorage caching |
| `src/scenes/GameScene.ts` | Modify | Call `HeapClient.append(x, y)` in `placeBlock()` |
| `.env` | Create | `VITE_HEAP_SERVER_URL` for local dev |

---

## Task 1: Shared Types

**Files:**
- Create: `shared/heapTypes.ts`

- [ ] **Step 1: Create shared/heapTypes.ts**

```ts
export interface Vertex {
  x: number;
  y: number;
}

export type GetHeapResponse =
  | { changed: false; version: number }
  | { changed: true; version: number; baseHash: string; liveZone: Vertex[] };

export interface AppendHeapRequest {
  x: number;
  y: number;
}

export interface AppendHeapResponse {
  accepted: boolean;
  version: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add shared/heapTypes.ts
git commit -m "feat: add shared heap wire types"
```

---

## Task 2: Server Scaffold

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/vitest.config.ts`
- Create: `server/wrangler.toml`
- Create: `server/schema.sql`

- [ ] **Step 1: Create server/package.json**

```json
{
  "name": "heap-server",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run"
  },
  "dependencies": {
    "hono": "^4.2.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240208.0",
    "typescript": "^5.4.0",
    "vitest": "^1.3.0",
    "wrangler": "^3.30.0"
  }
}
```

- [ ] **Step 2: Create server/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src/**/*", "../shared/**/*"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create server/vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create server/wrangler.toml**

```toml
name = "heap-server"
main = "src/index.ts"
compatibility_date = "2024-03-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "heap"
database_id = "REPLACE_AFTER_CREATION"
```

Note: `database_id` is filled in during Task 9 (Deploy).

- [ ] **Step 5: Create server/schema.sql**

```sql
CREATE TABLE IF NOT EXISTS heap_polygon (
  id        INTEGER PRIMARY KEY CHECK (id = 1),
  version   INTEGER NOT NULL DEFAULT 0,
  base_hash TEXT    NOT NULL DEFAULT '',
  live_zone TEXT    NOT NULL DEFAULT '[]',
  freeze_y  REAL    NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS heap_base (
  hash     TEXT PRIMARY KEY,
  vertices TEXT NOT NULL
);

INSERT OR IGNORE INTO heap_polygon (id, version, base_hash, live_zone, freeze_y)
VALUES (1, 0, '', '[]', 0);
```

- [ ] **Step 6: Install dependencies**

```bash
cd server && npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 7: Commit**

```bash
git add server/package.json server/package-lock.json server/tsconfig.json server/vitest.config.ts server/wrangler.toml server/schema.sql
git commit -m "feat: scaffold heap server — Hono + Workers + D1 + Wrangler"
```

---

## Task 3: Database Layer

**Files:**
- Create: `server/src/db.ts`
- Create: `server/tests/helpers/mockDb.ts`

No test file for `db.ts` directly — the `D1HeapDB` class is thin SQL wrappers; correctness is verified in Task 9 when the real D1 schema is applied. The `MockHeapDB` is tested implicitly through route tests in Task 5.

- [ ] **Step 1: Create server/src/db.ts**

```ts
import { Vertex } from '../../shared/heapTypes';

export interface HeapRow {
  version: number;
  base_hash: string;
  live_zone: string;   // JSON Vertex[]
  freeze_y: number;
}

/** Abstraction over D1 — allows MockHeapDB in tests. */
export interface HeapDB {
  getPolygonRow(): Promise<HeapRow>;
  updatePolygon(version: number, baseHash: string, liveZone: Vertex[], freezeY: number): Promise<void>;
  getBaseVertices(hash: string): Promise<Vertex[] | null>;
  upsertBase(hash: string, vertices: Vertex[]): Promise<void>;
}

/** Production implementation backed by Cloudflare D1. */
export class D1HeapDB implements HeapDB {
  constructor(private d1: D1Database) {}

  async getPolygonRow(): Promise<HeapRow> {
    const row = await this.d1
      .prepare('SELECT * FROM heap_polygon WHERE id = 1')
      .first<HeapRow>();
    return row!;
  }

  async updatePolygon(
    version: number,
    baseHash: string,
    liveZone: Vertex[],
    freezeY: number,
  ): Promise<void> {
    await this.d1
      .prepare(
        'UPDATE heap_polygon SET version = ?1, base_hash = ?2, live_zone = ?3, freeze_y = ?4 WHERE id = 1',
      )
      .bind(version, baseHash, JSON.stringify(liveZone), freezeY)
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

- [ ] **Step 2: Create server/tests/helpers/mockDb.ts**

```ts
import { HeapDB, HeapRow } from '../../src/db';
import { Vertex } from '../../../shared/heapTypes';

/** In-memory HeapDB for use in tests. No D1 or Workers runtime needed. */
export class MockHeapDB implements HeapDB {
  private row: HeapRow = { version: 0, base_hash: '', live_zone: '[]', freeze_y: 0 };
  private bases = new Map<string, string>();

  async getPolygonRow(): Promise<HeapRow> {
    return { ...this.row };
  }

  async updatePolygon(
    version: number,
    baseHash: string,
    liveZone: Vertex[],
    freezeY: number,
  ): Promise<void> {
    this.row = { version, base_hash: baseHash, live_zone: JSON.stringify(liveZone), freeze_y: freezeY };
  }

  async getBaseVertices(hash: string): Promise<Vertex[] | null> {
    const raw = this.bases.get(hash);
    return raw ? (JSON.parse(raw) as Vertex[]) : null;
  }

  async upsertBase(hash: string, vertices: Vertex[]): Promise<void> {
    this.bases.set(hash, JSON.stringify(vertices));
  }

  /** Test helper — seed the polygon row directly. */
  seedPolygon(version: number, liveZone: Vertex[], baseHash = '', freezeY = 0): void {
    this.row = { version, base_hash: baseHash, live_zone: JSON.stringify(liveZone), freeze_y: freezeY };
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add server/src/db.ts server/tests/helpers/mockDb.ts
git commit -m "feat: add HeapDB interface, D1HeapDB implementation, and MockHeapDB"
```

---

## Task 4: Polygon Math

**Files:**
- Create: `server/src/polygon.ts`
- Create: `server/tests/polygon.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/tests/polygon.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isPointInside, checkFreeze, hashVertices, LIVE_ZONE_MAX, FREEZE_BATCH } from '../src/polygon';
import { Vertex } from '../../shared/heapTypes';

// A simple 10×10 square with corners at (0,0), (10,0), (10,10), (0,10)
const SQUARE: Vertex[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe('isPointInside', () => {
  it('returns true for a point inside the polygon', () => {
    expect(isPointInside({ x: 5, y: 5 }, SQUARE)).toBe(true);
  });

  it('returns false for a point outside the polygon', () => {
    expect(isPointInside({ x: 15, y: 5 }, SQUARE)).toBe(false);
  });

  it('returns false for an empty polygon', () => {
    expect(isPointInside({ x: 5, y: 5 }, [])).toBe(false);
  });

  it('returns false for a polygon with fewer than 3 vertices', () => {
    expect(isPointInside({ x: 5, y: 5 }, [{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe(false);
  });
});

describe('hashVertices', () => {
  it('returns a 64-char hex string', () => {
    expect(hashVertices(SQUARE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns the same hash for identical vertex arrays', () => {
    expect(hashVertices(SQUARE)).toBe(hashVertices([...SQUARE]));
  });

  it('returns different hashes for different vertex arrays', () => {
    const other: Vertex[] = [{ x: 1, y: 1 }];
    expect(hashVertices(SQUARE)).not.toBe(hashVertices(other));
  });
});

describe('checkFreeze', () => {
  it('returns null when live zone is at or under LIVE_ZONE_MAX', () => {
    const liveZone: Vertex[] = Array.from({ length: LIVE_ZONE_MAX }, (_, i) => ({ x: i, y: i }));
    expect(checkFreeze(liveZone, [])).toBeNull();
  });

  it('freezes the bottom FREEZE_BATCH vertices when over LIVE_ZONE_MAX', () => {
    // liveZone sorted Y ascending (summit first = lowest Y = index 0)
    const liveZone: Vertex[] = Array.from({ length: LIVE_ZONE_MAX + 1 }, (_, i) => ({ x: 0, y: i }));
    const existingBase: Vertex[] = [{ x: 99, y: 99 }];

    const result = checkFreeze(liveZone, existingBase);

    expect(result).not.toBeNull();
    expect(result!.newLiveZone).toHaveLength(LIVE_ZONE_MAX + 1 - FREEZE_BATCH);
    expect(result!.newBaseVertices).toHaveLength(1 + FREEZE_BATCH);
    expect(result!.newBaseVertices[0]).toEqual({ x: 99, y: 99 });
    expect(result!.newBaseHash).toMatch(/^[0-9a-f]{64}$/);
    const frozenBatch = liveZone.slice(-FREEZE_BATCH);
    expect(result!.newFreezeY).toBe(frozenBatch[0].y);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && npx vitest run tests/polygon.test.ts
```

Expected: FAIL — `Cannot find module '../src/polygon'`

- [ ] **Step 3: Implement server/src/polygon.ts**

```ts
import { createHash } from 'crypto';
import { Vertex } from '../../shared/heapTypes';

/**
 * Ray-casting point-in-polygon test.
 * Returns true if the point is strictly inside the polygon.
 */
export function isPointInside(point: Vertex, polygon: Vertex[]): boolean {
  if (polygon.length < 3) return false;
  const { x, y } = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** SHA-256 hash of a vertex array serialized as JSON. */
export function hashVertices(vertices: Vertex[]): string {
  return createHash('sha256').update(JSON.stringify(vertices)).digest('hex');
}

export const LIVE_ZONE_MAX = 500;
export const FREEZE_BATCH = 250;

export interface FreezeResult {
  newLiveZone: Vertex[];
  newBaseVertices: Vertex[];
  newBaseHash: string;
  newFreezeY: number;
}

/**
 * If liveZone exceeds LIVE_ZONE_MAX vertices, freeze the bottom FREEZE_BATCH
 * (highest Y = base side, end of the Y-ascending array) into the base.
 * Returns null if no freeze is needed.
 *
 * liveZone must be sorted Y ascending: index 0 = summit (lowest Y), end = base (highest Y).
 */
export function checkFreeze(
  liveZone: Vertex[],
  existingBase: Vertex[],
): FreezeResult | null {
  if (liveZone.length <= LIVE_ZONE_MAX) return null;

  const frozen = liveZone.slice(-FREEZE_BATCH);
  const newLiveZone = liveZone.slice(0, liveZone.length - FREEZE_BATCH);
  const newBaseVertices = [...existingBase, ...frozen];
  const newBaseHash = hashVertices(newBaseVertices);
  const newFreezeY = frozen[0].y;

  return { newLiveZone, newBaseVertices, newBaseHash, newFreezeY };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && npx vitest run tests/polygon.test.ts
```

Expected: PASS — all tests pass

- [ ] **Step 5: Commit**

```bash
git add server/src/polygon.ts server/tests/polygon.test.ts
git commit -m "feat: add polygon math — point-in-polygon and freeze logic"
```

---

## Task 5: Heap Routes

**Files:**
- Create: `server/src/routes/heap.ts`
- Create: `server/src/app.ts`
- Create: `server/tests/routes.test.ts`

- [ ] **Step 1: Write the failing route tests**

Create `server/tests/routes.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { GetHeapResponse, AppendHeapResponse } from '../../shared/heapTypes';

function makeApp() {
  return createApp(new MockHeapDB());
}

describe('GET /heap', () => {
  it('returns changed:false when client version matches server', async () => {
    const app = makeApp();
    const res = await app.request('/heap?version=0');
    expect(res.status).toBe(200);
    const body = await res.json() as GetHeapResponse;
    expect(body.changed).toBe(false);
    expect(body.version).toBe(0);
  });

  it('returns changed:true with liveZone when client version is behind', async () => {
    const db = new MockHeapDB();
    db.seedPolygon(3, [{ x: 10, y: 5 }], '', 0);
    const app = createApp(db);
    const res = await app.request('/heap?version=0');
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
    const app = makeApp();
    const res = await app.request('/heap');
    expect(res.status).toBe(200);
    const body = await res.json() as GetHeapResponse;
    expect(body.changed).toBe(false);
  });
});

describe('GET /heap/base/:hash', () => {
  it('returns 404 for an unknown hash', async () => {
    const app = makeApp();
    const res = await app.request('/heap/base/unknownhash');
    expect(res.status).toBe(404);
  });

  it('returns base vertices for a known hash', async () => {
    const db = new MockHeapDB();
    await db.upsertBase('myhash', [{ x: 1, y: 2 }]);
    const app = createApp(db);
    const res = await app.request('/heap/base/myhash');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ x: 1, y: 2 }]);
  });
});

describe('POST /heap/place', () => {
  it('accepts a point when the polygon is empty', async () => {
    const app = makeApp();
    const res = await app.request('/heap/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 100, y: 200 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as AppendHeapResponse;
    expect(body.accepted).toBe(true);
    expect(body.version).toBe(1);
  });

  it('rejects a point inside the polygon', async () => {
    const db = new MockHeapDB();
    // A square: (0,0),(100,0),(100,100),(0,100) — centroid (50,50) is inside
    db.seedPolygon(1, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
    const app = createApp(db);
    const res = await app.request('/heap/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 50, y: 50 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as AppendHeapResponse;
    expect(body.accepted).toBe(false);
    expect(body.version).toBe(1);
  });

  it('accepts a point outside the polygon and bumps version', async () => {
    const db = new MockHeapDB();
    db.seedPolygon(1, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
    const app = createApp(db);
    const res = await app.request('/heap/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 200, y: 200 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as AppendHeapResponse;
    expect(body.accepted).toBe(true);
    expect(body.version).toBe(2);
  });

  it('returns 400 when x or y is missing', async () => {
    const app = makeApp();
    const res = await app.request('/heap/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 10 }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && npx vitest run tests/routes.test.ts
```

Expected: FAIL — `Cannot find module '../src/app'`

- [ ] **Step 3: Create server/src/routes/heap.ts**

```ts
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
```

- [ ] **Step 4: Create server/src/app.ts**

```ts
import { Hono } from 'hono';
import type { HeapDB } from './db';
import { heapRoutes } from './routes/heap';

export function createApp(db: HeapDB): Hono {
  const app = new Hono();
  app.route('/heap', heapRoutes(db));
  return app;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd server && npx vitest run tests/routes.test.ts
```

Expected: PASS — all tests pass

- [ ] **Step 6: Run all server tests**

```bash
cd server && npx vitest run
```

Expected: PASS — all tests pass

- [ ] **Step 7: Commit**

```bash
git add server/src/app.ts server/src/routes/heap.ts server/tests/routes.test.ts
git commit -m "feat: add Hono heap routes and app factory"
```

---

## Task 6: Workers Entry Point

**Files:**
- Create: `server/src/index.ts`

- [ ] **Step 1: Create server/src/index.ts**

```ts
import { createApp } from './app';
import { D1HeapDB } from './db';

export interface Env {
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const app = createApp(new D1HeapDB(env.DB));
    return app.fetch(request);
  },
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Start local dev server**

```bash
cd server && npm run dev
```

Expected: Wrangler starts, output includes `Ready on http://localhost:8787`. (D1 will error until schema is applied in Task 9 — that's fine for now, the compile check is what matters.)

Stop the dev server with Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts
git commit -m "feat: add Cloudflare Workers entry point"
```

---

## Task 7: HeapClient Service

**Files:**
- Create: `src/systems/HeapClient.ts`
- Create: `.env`

- [ ] **Step 1: Create .env**

```
VITE_HEAP_SERVER_URL=http://localhost:8787
```

- [ ] **Step 2: Create src/systems/HeapClient.ts**

```ts
import type {
  GetHeapResponse,
  AppendHeapRequest,
  AppendHeapResponse,
  Vertex,
} from '../../shared/heapTypes';

const SERVER_URL: string =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_HEAP_SERVER_URL ??
  'http://localhost:8787';

const CACHE_KEY = 'heap_cache';
const BASE_CACHE_PREFIX = 'heap_base_';

interface HeapCache {
  version: number;
  baseHash: string;
  liveZone: Vertex[];
}

function loadCache(): HeapCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as HeapCache) : null;
  } catch {
    return null;
  }
}

function saveCache(cache: HeapCache): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
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
   * Load the full heap polygon.
   * Uses localStorage cache + server delta strategy.
   * Falls back to last cached data (or empty array) on network failure.
   */
  static async load(): Promise<Vertex[]> {
    const cache = loadCache();
    const version = cache?.version ?? 0;

    try {
      const res = await fetch(`${SERVER_URL}/heap?version=${version}`);
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
        saveCache(newCache);
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
   * Fire-and-forget block placement.
   * Called after the player summits. Never throws or blocks gameplay.
   */
  static async append(x: number, y: number): Promise<void> {
    const cache = loadCache();
    try {
      const body: AppendHeapRequest = { x, y };
      const res = await fetch(`${SERVER_URL}/heap/place`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return;
      const data = (await res.json()) as AppendHeapResponse;
      if (data.accepted && cache) {
        saveCache({ ...cache, version: data.version });
      }
    } catch {
      // Silently drop — game never depends on server for local progression
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/systems/HeapClient.ts .env
git commit -m "feat: add HeapClient service with load/append and localStorage caching"
```

---

## Task 8: Wire HeapClient into GameScene

**Files:**
- Modify: `src/scenes/GameScene.ts`

- [ ] **Step 1: Add HeapClient import**

At the top of `src/scenes/GameScene.ts`, add after the existing imports:

```ts
import { HeapClient } from '../systems/HeapClient';
```

- [ ] **Step 2: Call HeapClient.append in placeBlock()**

In `placeBlock()`, after the line `persistHeapEntry(entry);`:

```ts
    // Upload placement to server — fire-and-forget, never blocks gameplay
    void HeapClient.append(entry.x, entry.y);
```

The full updated block should look like:

```ts
    const y = surfaceY - def.height / 2;
    const entry: HeapEntry = { x: px, y, keyid };
    this.heapGenerator.addEntry(entry);
    persistHeapEntry(entry);

    // Upload placement to server — fire-and-forget, never blocks gameplay
    void HeapClient.append(entry.x, entry.y);

    const score = Math.max(0, Math.floor(this.spawnY - surfaceY));
    this.time.delayedCall(2000, () => {
      this.scene.launch('ScoreScene', { score, isPeak });
    });
```

- [ ] **Step 3: Verify the game builds without errors**

```bash
npm run build
```

Expected: no TypeScript errors, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/scenes/GameScene.ts
git commit -m "feat: wire HeapClient.append into placeBlock for server upload"
```

---

## Task 9: Deploy to Cloudflare

**Files:**
- Modify: `server/wrangler.toml` (fill in `database_id`)

- [ ] **Step 1: Authenticate with Cloudflare**

```bash
cd server && npx wrangler login
```

Expected: browser opens for OAuth, then `Successfully logged in`.

- [ ] **Step 2: Create the D1 database**

```bash
npx wrangler d1 create heap
```

Expected output (example):
```
✅ Successfully created DB 'heap' in region WEUR
Created your new D1 database.

[[d1_databases]]
binding = "DB"
database_name = "heap"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

- [ ] **Step 3: Fill database_id into wrangler.toml**

Copy the `database_id` from the output and replace `REPLACE_AFTER_CREATION` in `server/wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "heap"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"   # ← paste real ID here
```

- [ ] **Step 4: Apply schema to local D1**

```bash
npx wrangler d1 execute heap --local --file=schema.sql
```

Expected: `✅ Executed 3 statements` (CREATE TABLE × 2 + INSERT OR IGNORE)

- [ ] **Step 5: Smoke test local dev with real D1**

```bash
npm run dev
```

In another terminal:
```bash
curl http://localhost:8787/heap?version=0
```

Expected:
```json
{"changed":false,"version":0}
```

Stop the dev server.

- [ ] **Step 6: Apply schema to production D1**

```bash
npx wrangler d1 execute heap --file=schema.sql
```

Expected: `✅ Executed 3 statements`

- [ ] **Step 7: Deploy the Worker**

```bash
npx wrangler deploy
```

Expected output (example):
```
✅ Uploaded heap-server
Published heap-server (xx sec)
  https://heap-server.<your-subdomain>.workers.dev
```

- [ ] **Step 8: Smoke test production**

```bash
curl https://heap-server.<your-subdomain>.workers.dev/heap?version=0
```

Expected:
```json
{"changed":false,"version":0}
```

- [ ] **Step 9: Update .env with production URL**

```
VITE_HEAP_SERVER_URL=https://heap-server.<your-subdomain>.workers.dev
```

- [ ] **Step 10: Commit**

```bash
git add server/wrangler.toml .env
git commit -m "feat: configure D1 database_id and production server URL"
```

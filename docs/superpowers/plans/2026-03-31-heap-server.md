# Heap Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js + Express + SQLite server that stores the community heap polygon, serves deltas to clients, and accepts player block placements at the summit.

**Architecture:** The heap is stored server-side as two regions — a frozen base (cached by SHA-256 hash on the client) and a live zone (returned on every version mismatch). `POST /heap/place` validates that a submitted point expands the polygon (ray-casting point-in-polygon), then appends the vertex and bumps the version. When the live zone exceeds 500 vertices, the bottom 250 are frozen into the base.

**Tech Stack:** Node.js 20, Express 4, TypeScript 5, `better-sqlite3`, `compression`, Jest 29, `ts-jest`, `supertest`

---

## File Map

| File | Status | Responsibility |
|------|--------|----------------|
| `shared/heapTypes.ts` | Create | Wire types shared between client and server |
| `server/package.json` | Create | Server dependencies and scripts |
| `server/tsconfig.json` | Create | TypeScript config for server |
| `server/jest.config.js` | Create | Jest config for server tests |
| `server/src/db.ts` | Create | SQLite connection, schema init, data accessors |
| `server/src/polygon.ts` | Create | Point-in-polygon (ray casting), freeze logic |
| `server/src/app.ts` | Create | Express app factory (no `listen` call — testable) |
| `server/src/index.ts` | Create | Entry point — creates db, creates app, calls `listen` |
| `server/src/routes/heap.ts` | Create | Route handlers for all three endpoints |
| `server/tests/polygon.test.ts` | Create | Unit tests for polygon math |
| `server/tests/db.test.ts` | Create | Unit tests for DB accessors |
| `server/tests/routes.test.ts` | Create | Integration tests for all endpoints |
| `src/systems/HeapClient.ts` | Create | Client fetch wrapper + localStorage caching |
| `src/scenes/GameScene.ts` | Modify | Call `HeapClient.append(x, y)` in `placeBlock()` |
| `.env` | Create | `VITE_HEAP_SERVER_URL` for local dev |

---

## Task 1: Shared Types

**Files:**
- Create: `shared/heapTypes.ts`

- [ ] **Step 1: Create shared/heapTypes.ts**

```ts
// shared/heapTypes.ts

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
- Create: `server/jest.config.js`

- [ ] **Step 1: Create server/package.json**

```json
{
  "name": "heap-server",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/server/src/index.js",
    "test": "jest"
  },
  "dependencies": {
    "better-sqlite3": "^9.4.3",
    "compression": "^1.7.4",
    "express": "^4.18.2"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.8",
    "@types/compression": "^1.7.5",
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.12",
    "@types/node": "^20.11.5",
    "@types/supertest": "^6.0.2",
    "jest": "^29.7.0",
    "supertest": "^6.3.4",
    "ts-jest": "^29.1.2",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create server/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "dist",
    "rootDir": "..",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*", "../shared/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create server/jest.config.js**

```js
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  globals: {
    'ts-jest': {
      tsconfig: {
        rootDir: '..',
      },
    },
  },
};
```

- [ ] **Step 4: Install dependencies**

```bash
cd server && npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 5: Commit**

```bash
git add server/package.json server/tsconfig.json server/jest.config.js server/package-lock.json
git commit -m "feat: scaffold heap server package"
```

---

## Task 3: Database Layer

**Files:**
- Create: `server/src/db.ts`
- Create: `server/tests/db.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/tests/db.test.ts`:

```ts
import { createDb, getPolygonRow, updatePolygon, getBaseVertices, upsertBase } from '../src/db';
import { Vertex } from '../../shared/heapTypes';

describe('db', () => {
  it('initializes with a default singleton row', () => {
    const db = createDb(':memory:');
    const row = getPolygonRow(db);
    expect(row.version).toBe(0);
    expect(row.base_hash).toBe('');
    expect(JSON.parse(row.live_zone)).toEqual([]);
    expect(row.freeze_y).toBe(0);
  });

  it('updatePolygon persists and getPolygonRow reads it back', () => {
    const db = createDb(':memory:');
    const verts: Vertex[] = [{ x: 10, y: 5 }, { x: 20, y: 15 }];
    updatePolygon(db, 3, 'abc123', verts, 42.5);
    const row = getPolygonRow(db);
    expect(row.version).toBe(3);
    expect(row.base_hash).toBe('abc123');
    expect(JSON.parse(row.live_zone)).toEqual(verts);
    expect(row.freeze_y).toBe(42.5);
  });

  it('getBaseVertices returns null for unknown hash', () => {
    const db = createDb(':memory:');
    expect(getBaseVertices(db, 'nope')).toBeNull();
  });

  it('upsertBase and getBaseVertices round-trip', () => {
    const db = createDb(':memory:');
    const verts: Vertex[] = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
    upsertBase(db, 'myhash', verts);
    expect(getBaseVertices(db, 'myhash')).toEqual(verts);
  });

  it('upsertBase overwrites existing entry with same hash', () => {
    const db = createDb(':memory:');
    upsertBase(db, 'h', [{ x: 1, y: 1 }]);
    upsertBase(db, 'h', [{ x: 9, y: 9 }]);
    expect(getBaseVertices(db, 'h')).toEqual([{ x: 9, y: 9 }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && npx jest tests/db.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '../src/db'`

- [ ] **Step 3: Implement server/src/db.ts**

```ts
import Database from 'better-sqlite3';
import { Vertex } from '../../shared/heapTypes';

export interface HeapRow {
  version: number;
  base_hash: string;
  live_zone: string;  // JSON Vertex[]
  freeze_y: number;
}

export function createDb(path = './heap.db'): Database.Database {
  const db = new Database(path);
  db.exec(`
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
  `);
  return db;
}

export function getPolygonRow(db: Database.Database): HeapRow {
  return db.prepare('SELECT * FROM heap_polygon WHERE id = 1').get() as HeapRow;
}

export function updatePolygon(
  db: Database.Database,
  version: number,
  baseHash: string,
  liveZone: Vertex[],
  freezeY: number,
): void {
  db.prepare(
    'UPDATE heap_polygon SET version = ?, base_hash = ?, live_zone = ?, freeze_y = ? WHERE id = 1',
  ).run(version, baseHash, JSON.stringify(liveZone), freezeY);
}

export function getBaseVertices(db: Database.Database, hash: string): Vertex[] | null {
  const row = db
    .prepare('SELECT vertices FROM heap_base WHERE hash = ?')
    .get(hash) as { vertices: string } | undefined;
  return row ? (JSON.parse(row.vertices) as Vertex[]) : null;
}

export function upsertBase(db: Database.Database, hash: string, vertices: Vertex[]): void {
  db.prepare('INSERT OR REPLACE INTO heap_base (hash, vertices) VALUES (?, ?)').run(
    hash,
    JSON.stringify(vertices),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && npx jest tests/db.test.ts --no-coverage
```

Expected: PASS — 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add server/src/db.ts server/tests/db.test.ts
git commit -m "feat: add SQLite db layer with schema init and accessors"
```

---

## Task 4: Polygon Math

**Files:**
- Create: `server/src/polygon.ts`
- Create: `server/tests/polygon.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/tests/polygon.test.ts`:

```ts
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
    // Build a live zone of LIVE_ZONE_MAX + 1 vertices, sorted Y ascending (summit first)
    const liveZone: Vertex[] = Array.from({ length: LIVE_ZONE_MAX + 1 }, (_, i) => ({ x: 0, y: i }));
    const existingBase: Vertex[] = [{ x: 99, y: 99 }];

    const result = checkFreeze(liveZone, existingBase);

    expect(result).not.toBeNull();
    // Live zone is trimmed by FREEZE_BATCH
    expect(result!.newLiveZone).toHaveLength(LIVE_ZONE_MAX + 1 - FREEZE_BATCH);
    // New base = old base + frozen batch
    expect(result!.newBaseVertices).toHaveLength(1 + FREEZE_BATCH);
    // First element of new base is the existing base vertex
    expect(result!.newBaseVertices[0]).toEqual({ x: 99, y: 99 });
    // newBaseHash is a valid SHA-256 hex
    expect(result!.newBaseHash).toMatch(/^[0-9a-f]{64}$/);
    // newFreezeY is the Y of the first frozen vertex (lowest Y in frozen batch = highest-Y live zone item minus FREEZE_BATCH)
    const frozenBatch = liveZone.slice(-FREEZE_BATCH);
    expect(result!.newFreezeY).toBe(frozenBatch[0].y);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && npx jest tests/polygon.test.ts --no-coverage
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
cd server && npx jest tests/polygon.test.ts --no-coverage
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
- Create: `server/src/app.ts`
- Create: `server/src/routes/heap.ts`
- Create: `server/tests/routes.test.ts`

- [ ] **Step 1: Write the failing route tests**

Create `server/tests/routes.test.ts`:

```ts
import request from 'supertest';
import { createDb } from '../src/db';
import { createApp } from '../src/app';
import { GetHeapResponse, AppendHeapResponse } from '../../shared/heapTypes';

function makeApp() {
  return createApp(createDb(':memory:'));
}

describe('GET /heap', () => {
  it('returns changed:false when client version matches server', async () => {
    const app = makeApp();
    const res = await request(app).get('/heap?version=0');
    expect(res.status).toBe(200);
    const body = res.body as GetHeapResponse;
    expect(body.changed).toBe(false);
    expect(body.version).toBe(0);
  });

  it('returns changed:true with liveZone when client version is behind', async () => {
    const app = makeApp();
    // Place a block first to bump the version
    await request(app).post('/heap/place').send({ x: 50, y: 50 });
    const res = await request(app).get('/heap?version=0');
    expect(res.status).toBe(200);
    const body = res.body as GetHeapResponse;
    expect(body.changed).toBe(true);
    if (body.changed) {
      expect(body.version).toBe(1);
      expect(Array.isArray(body.liveZone)).toBe(true);
      expect(typeof body.baseHash).toBe('string');
    }
  });

  it('defaults to version=0 when no version param provided', async () => {
    const app = makeApp();
    const res = await request(app).get('/heap');
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(false);
  });
});

describe('GET /heap/base/:hash', () => {
  it('returns 404 for an unknown hash', async () => {
    const app = makeApp();
    const res = await request(app).get('/heap/base/unknownhash');
    expect(res.status).toBe(404);
  });
});

describe('POST /heap/place', () => {
  it('accepts a point when the polygon is empty', async () => {
    const app = makeApp();
    const res = await request(app).post('/heap/place').send({ x: 100, y: 200 });
    expect(res.status).toBe(200);
    const body = res.body as AppendHeapResponse;
    expect(body.accepted).toBe(true);
    expect(body.version).toBe(1);
  });

  it('rejects a point inside the polygon', async () => {
    const app = makeApp();
    // Build a large square polygon by placing 4 corner points
    // The polygon is open until enough points form an enclosure.
    // Easier: directly seed the db with a known polygon, then test via the route.
    // Instead, place 4 exterior points forming a rough polygon, then place a centroid.
    // For simplicity, use the db directly to set up the polygon.
    const db = createDb(':memory:');
    const { updatePolygon } = await import('../src/db');
    // A square: (0,0),(100,0),(100,100),(0,100) — centroid (50,50) is inside
    updatePolygon(db, 1, '', [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ], 0);
    const { createApp } = await import('../src/app');
    const appWithPolygon = createApp(db);
    const res = await request(appWithPolygon).post('/heap/place').send({ x: 50, y: 50 });
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(false);
    expect(res.body.version).toBe(1); // version unchanged
  });

  it('accepts a point outside the polygon and bumps version', async () => {
    const db = createDb(':memory:');
    const { updatePolygon } = await import('../src/db');
    updatePolygon(db, 1, '', [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ], 0);
    const { createApp } = await import('../src/app');
    const appWithPolygon = createApp(db);
    const res = await request(appWithPolygon).post('/heap/place').send({ x: 200, y: 200 });
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(true);
    expect(res.body.version).toBe(2);
  });

  it('returns 400 when x or y is missing', async () => {
    const app = makeApp();
    const res = await request(app).post('/heap/place').send({ x: 10 });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && npx jest tests/routes.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '../src/app'`

- [ ] **Step 3: Create server/src/routes/heap.ts**

```ts
import { Router, Request, Response } from 'express';
import type { Database } from 'better-sqlite3';
import { getPolygonRow, updatePolygon, getBaseVertices, upsertBase } from '../db';
import { isPointInside, checkFreeze } from '../polygon';
import type {
  GetHeapResponse,
  AppendHeapRequest,
  AppendHeapResponse,
  Vertex,
} from '../../../shared/heapTypes';

export function heapRoutes(db: Database): Router {
  const router = Router();

  // GET /heap?version=N
  router.get('/', (_req: Request, res: Response) => {
    const clientVersion = parseInt((_req.query.version as string) ?? '0') || 0;
    const row = getPolygonRow(db);

    if (clientVersion === row.version) {
      return res.json({ changed: false, version: row.version } satisfies GetHeapResponse);
    }

    const liveZone: Vertex[] = JSON.parse(row.live_zone);
    const response: GetHeapResponse = {
      changed: true,
      version: row.version,
      baseHash: row.base_hash,
      liveZone,
    };
    res.json(response);
  });

  // GET /heap/base/:hash
  router.get('/base/:hash', (req: Request, res: Response) => {
    const vertices = getBaseVertices(db, req.params.hash);
    if (!vertices) return res.status(404).json({ error: 'Base not found' });
    res.json(vertices);
  });

  // POST /heap/place
  router.post('/place', (req: Request, res: Response) => {
    const { x, y } = req.body as AppendHeapRequest;
    if (typeof x !== 'number' || typeof y !== 'number') {
      return res.status(400).json({ error: 'x and y must be numbers' });
    }

    const row = getPolygonRow(db);
    const liveZone: Vertex[] = JSON.parse(row.live_zone);

    let baseVertices: Vertex[] = [];
    if (row.base_hash) {
      baseVertices = getBaseVertices(db, row.base_hash) ?? [];
    }

    const fullPolygon = [...baseVertices, ...liveZone];

    if (isPointInside({ x, y }, fullPolygon)) {
      return res.json({
        accepted: false,
        version: row.version,
      } satisfies AppendHeapResponse);
    }

    // Insert into live zone sorted by Y ascending (summit = lowest Y = front)
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
      upsertBase(db, freeze.newBaseHash, freeze.newBaseVertices);
      newBaseHash = freeze.newBaseHash;
      newFreezeY = freeze.newFreezeY;
      finalLiveZone = freeze.newLiveZone;
    }

    updatePolygon(db, newVersion, newBaseHash, finalLiveZone, newFreezeY);

    res.json({ accepted: true, version: newVersion } satisfies AppendHeapResponse);
  });

  return router;
}
```

- [ ] **Step 4: Create server/src/app.ts**

```ts
import express from 'express';
import compression from 'compression';
import type { Database } from 'better-sqlite3';
import { heapRoutes } from './routes/heap';

export function createApp(db: Database) {
  const app = express();
  app.use(compression());
  app.use(express.json());
  app.use('/heap', heapRoutes(db));
  return app;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd server && npx jest tests/routes.test.ts --no-coverage
```

Expected: PASS — all tests pass

- [ ] **Step 6: Commit**

```bash
git add server/src/app.ts server/src/routes/heap.ts server/tests/routes.test.ts
git commit -m "feat: add heap routes — GET /heap, GET /heap/base/:hash, POST /heap/place"
```

---

## Task 6: Server Entry Point

**Files:**
- Create: `server/src/index.ts`

- [ ] **Step 1: Create server/src/index.ts**

```ts
import { createDb } from './db';
import { createApp } from './app';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const DB_PATH = process.env.DB_PATH ?? './heap.db';

const db = createDb(DB_PATH);
const app = createApp(db);

app.listen(PORT, () => {
  console.log(`Heap server running on port ${PORT}`);
});
```

- [ ] **Step 2: Run all server tests**

```bash
cd server && npx jest --no-coverage
```

Expected: PASS — all tests pass

- [ ] **Step 3: Smoke test — start the server and hit the endpoint**

In one terminal:
```bash
cd server && npm run dev
```

In another:
```bash
curl http://localhost:3000/heap?version=0
```

Expected output:
```json
{"changed":false,"version":0}
```

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts
git commit -m "feat: add server entry point"
```

---

## Task 7: HeapClient Service

**Files:**
- Create: `src/systems/HeapClient.ts`
- Create: `.env`

- [ ] **Step 1: Create .env**

```
VITE_HEAP_SERVER_URL=http://localhost:3000
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
  'http://localhost:3000';

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
  let cached = loadCachedBase(hash);
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

      // Server at version 0, no cache — empty polygon
      return [];
    } catch {
      // Network failure — fall back to cache or empty
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

This task wires the server placement upload into the existing `placeBlock()` method. The server polygon → `HeapEdgeCollider` integration (replacing `DEV_HEAP` with server vertices) requires rearchitecting `HeapEdgeCollider` to accept `Vertex[]` directly and is deferred to a follow-up.

- [ ] **Step 1: Add HeapClient import to GameScene.ts**

At the top of `src/scenes/GameScene.ts`, add this import after the existing imports:

```ts
import { HeapClient } from '../systems/HeapClient';
```

- [ ] **Step 2: Call HeapClient.append in placeBlock()**

Find the `placeBlock()` method in `src/scenes/GameScene.ts`. After the line `persistHeapEntry(entry);` (around line 350), add the server upload call:

```ts
    // Upload placement to server — fire-and-forget, never blocks gameplay
    void HeapClient.append(entry.x, entry.y);
```

The full updated section of `placeBlock()` should look like:

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

- [ ] **Step 4: Manual smoke test**

1. Start the server: `cd server && npm run dev`
2. Start the game: `npm run dev`
3. Play until summit, place a block
4. Check server terminal — should log the incoming POST
5. `curl http://localhost:3000/heap?version=0` — should return `changed:true` with version=1 and the placed point in liveZone

- [ ] **Step 5: Commit**

```bash
git add src/scenes/GameScene.ts
git commit -m "feat: wire HeapClient.append into placeBlock for server upload"
```

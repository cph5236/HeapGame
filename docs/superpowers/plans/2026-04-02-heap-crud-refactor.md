# Heap Server CRUD Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hash-as-identity model with GUIDs, refactor server into full CRUD routes for heaps and their base snapshots.

**Architecture:** The `heap` table holds the stable live game state (GUID PK, references current `heap_base`). The `heap_base` table holds immutable polygon snapshots (GUID PK, FK back to parent heap). On freeze, a new `heap_base` row is inserted and `heap.base_id` is updated — the heap GUID never changes. All routes move from `/heap/*` to `/heaps/*`.

**Tech Stack:** Hono 4, Cloudflare Workers + D1, TypeScript 5, Vitest 1 — run tests with `cd server && npm test`

---

## File Map

| Status | File | Change |
|--------|------|--------|
| Modify | `server/schema.sql` | Replace both tables with GUID-keyed versions |
| Modify | `shared/heapTypes.ts` | Replace all request/response types |
| Modify | `server/src/polygon.ts` | Rename `FreezeResult.newBaseHash` → `newBaseVertexHash` |
| Modify | `server/src/db.ts` | New `HeapDB` interface + `D1HeapDB` implementation |
| Modify | `server/src/routes/heap.ts` | Full CRUD rewrite |
| Modify | `server/src/app.ts` | Route prefix `/heap` → `/heaps` |
| Modify | `server/tests/helpers/mockDb.ts` | New `MockHeapDB` matching new interface |
| Modify | `server/tests/polygon.test.ts` | Update `newBaseHash` → `newBaseVertexHash` reference |
| Modify | `server/tests/routes.test.ts` | Full rewrite for new routes |
| Modify | `scripts/seed-heap.ts` | Use new `POST /heaps` + `PUT /heaps/:id/reset` |
| Create | `server/API_README.md` | API reference docs |

---

## Task 1: Update schema.sql

**Files:**
- Modify: `server/schema.sql`

- [ ] **Step 1: Replace schema.sql**

```sql
-- server/schema.sql

DROP TABLE IF EXISTS heap;
DROP TABLE IF EXISTS heap_base;

CREATE TABLE IF NOT EXISTS heap_base (
  id          TEXT PRIMARY KEY,
  heap_id     TEXT NOT NULL,
  vertices    TEXT NOT NULL,
  vertex_hash TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS heap (
  id         TEXT PRIMARY KEY,
  base_id    TEXT NOT NULL,
  live_zone  TEXT NOT NULL DEFAULT '[]',
  freeze_y   REAL NOT NULL DEFAULT 0,
  version    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
```

- [ ] **Step 2: Commit**

```bash
cd /home/connor/Documents/Repos/HeapGame
git add server/schema.sql
git commit -m "schema: replace hash-keyed tables with GUID-keyed heap + heap_base"
```

---

## Task 2: Update shared/heapTypes.ts

**Files:**
- Modify: `shared/heapTypes.ts`

- [ ] **Step 1: Replace the file**

```typescript
// shared/heapTypes.ts

export interface Vertex {
  x: number;
  y: number;
}

// ── Create ──────────────────────────────────────────────────────────────────

export interface CreateHeapRequest {
  vertices: Vertex[];
}

export interface CreateHeapResponse {
  id: string;       // heap GUID — stable identity
  baseId: string;   // initial base snapshot GUID
  version: number;  // always 1 on create
  vertexCount: number;
}

// ── List ─────────────────────────────────────────────────────────────────────

export interface HeapSummary {
  id: string;
  version: number;
  createdAt: string;
}

export interface ListHeapsResponse {
  heaps: HeapSummary[];
}

// ── Read (delta-aware) ───────────────────────────────────────────────────────

export type GetHeapResponse =
  | { changed: false; version: number }
  | { changed: true; version: number; baseId: string; liveZone: Vertex[] };

// ── Place ─────────────────────────────────────────────────────────────────────

export interface PlaceRequest {
  x: number;
  y: number;
}

export interface PlaceResponse {
  accepted: boolean;
  version: number;
}

// ── Reset ─────────────────────────────────────────────────────────────────────

export interface ResetHeapResponse {
  id: string;
  version: number;
  previousVersion: number;
}

// ── Delete ────────────────────────────────────────────────────────────────────

export interface DeleteHeapResponse {
  deleted: boolean;
}
```

- [ ] **Step 2: Commit**

```bash
git add shared/heapTypes.ts
git commit -m "types: replace hash-based types with GUID CRUD request/response types"
```

---

## Task 3: Update polygon.ts FreezeResult

**Files:**
- Modify: `server/src/polygon.ts`

The field `newBaseHash` in `FreezeResult` was previously the DB primary key. It's now only used for the `vertex_hash` integrity column, so rename it to avoid confusion.

- [ ] **Step 1: Rename in FreezeResult interface**

In `server/src/polygon.ts`, change:
```typescript
export interface FreezeResult {
  newLiveZone: Vertex[];
  newBaseVertices: Vertex[];
  newBaseHash: string;
  newFreezeY: number;
}
```
to:
```typescript
export interface FreezeResult {
  newLiveZone: Vertex[];
  newBaseVertices: Vertex[];
  newBaseVertexHash: string;
  newFreezeY: number;
}
```

- [ ] **Step 2: Rename in checkFreeze return**

In `server/src/polygon.ts`, change:
```typescript
  const newBaseHash = hashVertices(newBaseVertices);
  const newFreezeY = frozen[0].y;

  return { newLiveZone, newBaseVertices, newBaseHash, newFreezeY };
```
to:
```typescript
  const newBaseVertexHash = hashVertices(newBaseVertices);
  const newFreezeY = frozen[0].y;

  return { newLiveZone, newBaseVertices, newBaseVertexHash, newFreezeY };
```

- [ ] **Step 3: Update polygon.test.ts**

In `server/tests/polygon.test.ts`, change line 63:
```typescript
    expect(result!.newBaseHash).toMatch(/^[0-9a-f]{64}$/);
```
to:
```typescript
    expect(result!.newBaseVertexHash).toMatch(/^[0-9a-f]{64}$/);
```

- [ ] **Step 4: Run polygon tests to verify they still pass**

```bash
cd server && npm test -- --reporter=verbose
```

Expected: all polygon tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/polygon.ts server/tests/polygon.test.ts
git commit -m "refactor: rename FreezeResult.newBaseHash to newBaseVertexHash"
```

---

## Task 4: Update db.ts interface and MockHeapDB

**Files:**
- Modify: `server/src/db.ts`
- Modify: `server/tests/helpers/mockDb.ts`

- [ ] **Step 1: Replace db.ts**

```typescript
// server/src/db.ts

import { Vertex } from '../../shared/heapTypes';

export interface HeapRow {
  id: string;
  base_id: string;
  live_zone: string;   // JSON Vertex[]
  freeze_y: number;
  version: number;
  created_at: string;
}

export interface HeapSummaryRow {
  id: string;
  version: number;
  created_at: string;
}

/** Abstraction over D1 — allows MockHeapDB in tests. */
export interface HeapDB {
  listHeaps(): Promise<HeapSummaryRow[]>;
  getHeap(id: string): Promise<HeapRow | null>;
  /** Atomically creates the initial heap_base row and the heap row. */
  createHeap(heapId: string, baseId: string, vertices: Vertex[], vertexHash: string, now: string): Promise<void>;
  updateHeap(id: string, baseId: string, version: number, liveZone: Vertex[], freezeY: number): Promise<void>;
  deleteHeap(id: string): Promise<void>;
  getBaseVerticesById(baseId: string): Promise<Vertex[] | null>;
  /** Creates a new base snapshot (used on freeze). */
  createBase(id: string, heapId: string, vertices: Vertex[], vertexHash: string, now: string): Promise<void>;
}

/** Production implementation backed by Cloudflare D1. */
export class D1HeapDB implements HeapDB {
  constructor(private d1: D1Database) {}

  async listHeaps(): Promise<HeapSummaryRow[]> {
    const result = await this.d1
      .prepare('SELECT id, version, created_at FROM heap')
      .all<HeapSummaryRow>();
    return result.results;
  }

  async getHeap(id: string): Promise<HeapRow | null> {
    const row = await this.d1
      .prepare('SELECT id, base_id, live_zone, freeze_y, version, created_at FROM heap WHERE id = ?1')
      .bind(id)
      .first<HeapRow>();
    return row ?? null;
  }

  async createHeap(heapId: string, baseId: string, vertices: Vertex[], vertexHash: string, now: string): Promise<void> {
    await this.d1.batch([
      this.d1
        .prepare('INSERT INTO heap_base (id, heap_id, vertices, vertex_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
        .bind(baseId, heapId, JSON.stringify(vertices), vertexHash, now),
      this.d1
        .prepare('INSERT INTO heap (id, base_id, live_zone, freeze_y, version, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
        .bind(heapId, baseId, '[]', 0, 1, now),
    ]);
  }

  async updateHeap(id: string, baseId: string, version: number, liveZone: Vertex[], freezeY: number): Promise<void> {
    await this.d1
      .prepare('UPDATE heap SET base_id = ?1, version = ?2, live_zone = ?3, freeze_y = ?4 WHERE id = ?5')
      .bind(baseId, version, JSON.stringify(liveZone), freezeY, id)
      .run();
  }

  async deleteHeap(id: string): Promise<void> {
    await this.d1.batch([
      this.d1.prepare('DELETE FROM heap_base WHERE heap_id = ?1').bind(id),
      this.d1.prepare('DELETE FROM heap WHERE id = ?1').bind(id),
    ]);
  }

  async getBaseVerticesById(baseId: string): Promise<Vertex[] | null> {
    const row = await this.d1
      .prepare('SELECT vertices FROM heap_base WHERE id = ?1')
      .bind(baseId)
      .first<{ vertices: string }>();
    return row ? (JSON.parse(row.vertices) as Vertex[]) : null;
  }

  async createBase(id: string, heapId: string, vertices: Vertex[], vertexHash: string, now: string): Promise<void> {
    await this.d1
      .prepare('INSERT INTO heap_base (id, heap_id, vertices, vertex_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind(id, heapId, JSON.stringify(vertices), vertexHash, now)
      .run();
  }
}
```

- [ ] **Step 2: Replace mockDb.ts**

```typescript
// server/tests/helpers/mockDb.ts

import type { HeapDB, HeapRow, HeapSummaryRow } from '../../src/db';
import type { Vertex } from '../../../shared/heapTypes';

interface BaseRecord {
  heap_id: string;
  vertices: string;
  vertex_hash: string;
  created_at: string;
}

/** In-memory HeapDB for use in tests. No D1 or Workers runtime needed. */
export class MockHeapDB implements HeapDB {
  private heaps = new Map<string, Omit<HeapRow, 'id'>>();
  private bases = new Map<string, BaseRecord>();

  async listHeaps(): Promise<HeapSummaryRow[]> {
    return Array.from(this.heaps.entries()).map(([id, row]) => ({
      id,
      version: row.version,
      created_at: row.created_at,
    }));
  }

  async getHeap(id: string): Promise<HeapRow | null> {
    const row = this.heaps.get(id);
    if (!row) return null;
    return { id, ...row };
  }

  async createHeap(heapId: string, baseId: string, vertices: Vertex[], vertexHash: string, now: string): Promise<void> {
    this.bases.set(baseId, { heap_id: heapId, vertices: JSON.stringify(vertices), vertex_hash: vertexHash, created_at: now });
    this.heaps.set(heapId, { base_id: baseId, live_zone: '[]', freeze_y: 0, version: 1, created_at: now });
  }

  async updateHeap(id: string, baseId: string, version: number, liveZone: Vertex[], freezeY: number): Promise<void> {
    const existing = this.heaps.get(id);
    if (!existing) return;
    this.heaps.set(id, { ...existing, base_id: baseId, version, live_zone: JSON.stringify(liveZone), freeze_y: freezeY });
  }

  async deleteHeap(id: string): Promise<void> {
    this.heaps.delete(id);
    for (const [baseId, base] of this.bases.entries()) {
      if (base.heap_id === id) this.bases.delete(baseId);
    }
  }

  async getBaseVerticesById(baseId: string): Promise<Vertex[] | null> {
    const raw = this.bases.get(baseId);
    return raw ? (JSON.parse(raw.vertices) as Vertex[]) : null;
  }

  async createBase(id: string, heapId: string, vertices: Vertex[], vertexHash: string, now: string): Promise<void> {
    this.bases.set(id, { heap_id: heapId, vertices: JSON.stringify(vertices), vertex_hash: vertexHash, created_at: now });
  }

  /** Test helper — seed a heap row directly without going through createHeap. */
  seedHeap(id: string, version: number, liveZone: Vertex[], baseId = id, freezeY = 0): void {
    this.heaps.set(id, {
      base_id: baseId,
      version,
      live_zone: JSON.stringify(liveZone),
      freeze_y: freezeY,
      created_at: '2026-01-01T00:00:00.000Z',
    });
  }

  /** Test helper — seed a base row directly. */
  seedBase(id: string, heapId: string, vertices: Vertex[]): void {
    this.bases.set(id, {
      heap_id: heapId,
      vertices: JSON.stringify(vertices),
      vertex_hash: 'test-hash',
      created_at: '2026-01-01T00:00:00.000Z',
    });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add server/src/db.ts server/tests/helpers/mockDb.ts
git commit -m "refactor: update HeapDB interface and MockHeapDB to GUID-based model"
```

---

## Task 5: Write failing route tests

**Files:**
- Modify: `server/tests/routes.test.ts`

- [ ] **Step 1: Replace routes.test.ts with failing tests for all CRUD routes**

```typescript
// server/tests/routes.test.ts

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import type {
  CreateHeapResponse,
  ListHeapsResponse,
  GetHeapResponse,
  PlaceResponse,
  ResetHeapResponse,
  DeleteHeapResponse,
} from '../../shared/heapTypes';

const VERTICES = [
  { x: 100, y: 400 },
  { x: 300, y: 600 },
  { x: 500, y: 400 },
];

function makeApp() {
  return createApp(new MockHeapDB());
}

// ── POST /heaps ──────────────────────────────────────────────────────────────

describe('POST /heaps', () => {
  it('creates a heap and returns id, baseId, version 1, vertexCount', async () => {
    const res = await makeApp().request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as CreateHeapResponse;
    expect(typeof body.id).toBe('string');
    expect(typeof body.baseId).toBe('string');
    expect(body.id).not.toBe(body.baseId);
    expect(body.version).toBe(1);
    expect(body.vertexCount).toBe(3);
  });

  it('two creates with same vertices produce two heaps with different ids', async () => {
    const app = makeApp();
    const res1 = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    const res2 = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    const b1 = await res1.json() as CreateHeapResponse;
    const b2 = await res2.json() as CreateHeapResponse;
    expect(b1.id).not.toBe(b2.id);
  });

  it('rejects empty vertices with 400', async () => {
    const res = await makeApp().request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects missing vertices with 400', async () => {
    const res = await makeApp().request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('rejects malformed vertex objects with 400', async () => {
    const res = await makeApp().request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: [{ x: 1 }] }),  // missing y
    });
    expect(res.status).toBe(400);
  });
});

// ── GET /heaps ───────────────────────────────────────────────────────────────

describe('GET /heaps', () => {
  it('returns empty array when no heaps exist', async () => {
    const res = await makeApp().request('/heaps');
    expect(res.status).toBe(200);
    const body = await res.json() as ListHeapsResponse;
    expect(body.heaps).toEqual([]);
  });

  it('returns all heaps with id, version, createdAt', async () => {
    const db = new MockHeapDB();
    db.seedHeap('heap-1', 1, []);
    db.seedHeap('heap-2', 3, []);
    const res = await createApp(db).request('/heaps');
    expect(res.status).toBe(200);
    const body = await res.json() as ListHeapsResponse;
    expect(body.heaps).toHaveLength(2);
    const ids = body.heaps.map(h => h.id);
    expect(ids).toContain('heap-1');
    expect(ids).toContain('heap-2');
    const h2 = body.heaps.find(h => h.id === 'heap-2')!;
    expect(h2.version).toBe(3);
    expect(typeof h2.createdAt).toBe('string');
  });
});

// ── GET /heaps/:id ───────────────────────────────────────────────────────────

describe('GET /heaps/:id', () => {
  it('returns 404 for unknown id', async () => {
    const res = await makeApp().request('/heaps/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns changed:false when client version matches', async () => {
    const db = new MockHeapDB();
    db.seedHeap('h1', 5, [{ x: 10, y: 20 }]);
    const res = await createApp(db).request('/heaps/h1?version=5');
    expect(res.status).toBe(200);
    const body = await res.json() as GetHeapResponse;
    expect(body.changed).toBe(false);
    expect(body.version).toBe(5);
  });

  it('returns changed:true with liveZone and baseId when client version is behind', async () => {
    const db = new MockHeapDB();
    db.seedHeap('h1', 3, [{ x: 10, y: 20 }], 'base-guid-1');
    const res = await createApp(db).request('/heaps/h1?version=0');
    expect(res.status).toBe(200);
    const body = await res.json() as GetHeapResponse;
    expect(body.changed).toBe(true);
    if (body.changed) {
      expect(body.version).toBe(3);
      expect(body.baseId).toBe('base-guid-1');
      expect(body.liveZone).toEqual([{ x: 10, y: 20 }]);
    }
  });

  it('defaults version to 0 when not provided', async () => {
    const db = new MockHeapDB();
    db.seedHeap('h1', 1, []);
    const res = await createApp(db).request('/heaps/h1');
    expect(res.status).toBe(200);
    const body = await res.json() as GetHeapResponse;
    expect(body.changed).toBe(true);  // version 1 > 0
  });
});

// ── GET /heaps/:id/base ──────────────────────────────────────────────────────

describe('GET /heaps/:id/base', () => {
  it('returns 404 for unknown heap id', async () => {
    const res = await makeApp().request('/heaps/no-heap/base');
    expect(res.status).toBe(404);
  });

  it('returns base vertices for known heap', async () => {
    const db = new MockHeapDB();
    const baseVertices = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
    db.seedHeap('h1', 1, [], 'base-1');
    db.seedBase('base-1', 'h1', baseVertices);
    const res = await createApp(db).request('/heaps/h1/base');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(baseVertices);
  });
});

// ── PUT /heaps/:id/reset ─────────────────────────────────────────────────────

describe('PUT /heaps/:id/reset', () => {
  it('returns 404 for unknown id', async () => {
    const res = await makeApp().request('/heaps/no-heap/reset', { method: 'PUT' });
    expect(res.status).toBe(404);
  });

  it('resets live_zone to empty, version to 1, and returns previousVersion', async () => {
    const db = new MockHeapDB();
    db.seedHeap('h1', 42, [{ x: 10, y: 20 }], 'base-1');
    const res = await createApp(db).request('/heaps/h1/reset', { method: 'PUT' });
    expect(res.status).toBe(200);
    const body = await res.json() as ResetHeapResponse;
    expect(body.id).toBe('h1');
    expect(body.version).toBe(1);
    expect(body.previousVersion).toBe(42);

    // Confirm state was written to DB
    const row = await db.getHeap('h1');
    expect(row?.version).toBe(1);
    expect(JSON.parse(row!.live_zone)).toEqual([]);
    expect(row?.freeze_y).toBe(0);
  });

  it('preserves base_id on reset', async () => {
    const db = new MockHeapDB();
    db.seedHeap('h1', 10, [{ x: 5, y: 5 }], 'base-preserved');
    await createApp(db).request('/heaps/h1/reset', { method: 'PUT' });
    const row = await db.getHeap('h1');
    expect(row?.base_id).toBe('base-preserved');
  });
});

// ── POST /heaps/:id/place ────────────────────────────────────────────────────

describe('POST /heaps/:id/place', () => {
  it('returns 404 for unknown heap id', async () => {
    const res = await makeApp().request('/heaps/no-heap/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 10, y: 20 }),
    });
    expect(res.status).toBe(404);
  });

  it('accepts a point when live zone is empty and base is empty', async () => {
    const db = new MockHeapDB();
    db.seedHeap('h1', 1, [], 'base-1');
    db.seedBase('base-1', 'h1', []);
    const res = await createApp(db).request('/heaps/h1/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 100, y: 200 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as PlaceResponse;
    expect(body.accepted).toBe(true);
    expect(body.version).toBe(2);
  });

  it('rejects a point inside the polygon', async () => {
    const db = new MockHeapDB();
    const square = [
      { x: 0, y: 0 }, { x: 100, y: 0 },
      { x: 100, y: 100 }, { x: 0, y: 100 },
    ];
    db.seedHeap('h1', 1, square, 'base-1');
    db.seedBase('base-1', 'h1', []);
    const res = await createApp(db).request('/heaps/h1/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 50, y: 50 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as PlaceResponse;
    expect(body.accepted).toBe(false);
    expect(body.version).toBe(1);
  });

  it('accepts a point outside the polygon and bumps version', async () => {
    const db = new MockHeapDB();
    const square = [
      { x: 0, y: 0 }, { x: 100, y: 0 },
      { x: 100, y: 100 }, { x: 0, y: 100 },
    ];
    db.seedHeap('h1', 1, square, 'base-1');
    db.seedBase('base-1', 'h1', []);
    const res = await createApp(db).request('/heaps/h1/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 200, y: 200 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as PlaceResponse;
    expect(body.accepted).toBe(true);
    expect(body.version).toBe(2);
  });

  it('returns 400 when x or y is missing', async () => {
    const db = new MockHeapDB();
    db.seedHeap('h1', 1, [], 'base-1');
    const res = await createApp(db).request('/heaps/h1/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 10 }),  // missing y
    });
    expect(res.status).toBe(400);
  });
});

// ── DELETE /heaps/:id ────────────────────────────────────────────────────────

describe('DELETE /heaps/:id', () => {
  it('returns 404 for unknown id', async () => {
    const res = await makeApp().request('/heaps/no-heap', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('deletes heap and returns deleted:true', async () => {
    const db = new MockHeapDB();
    db.seedHeap('h1', 1, []);
    const res = await createApp(db).request('/heaps/h1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as DeleteHeapResponse;
    expect(body.deleted).toBe(true);

    // Confirm gone from DB
    const row = await db.getHeap('h1');
    expect(row).toBeNull();
  });

  it('heap no longer appears in list after delete', async () => {
    const db = new MockHeapDB();
    db.seedHeap('h1', 1, []);
    db.seedHeap('h2', 1, []);
    await createApp(db).request('/heaps/h1', { method: 'DELETE' });
    const listRes = await createApp(db).request('/heaps');
    const body = await listRes.json() as ListHeapsResponse;
    expect(body.heaps.map(h => h.id)).toEqual(['h2']);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail (routes don't exist yet)**

```bash
cd server && npm test -- --reporter=verbose
```

Expected: tests FAIL with 404s or import errors (routes not implemented yet).

- [ ] **Step 3: Commit failing tests**

```bash
git add server/tests/routes.test.ts
git commit -m "test: add failing CRUD route tests for GUID-based heap API"
```

---

## Task 6: Implement CRUD routes and update app.ts

**Files:**
- Modify: `server/src/routes/heap.ts`
- Modify: `server/src/app.ts`

- [ ] **Step 1: Replace heap.ts with CRUD routes**

```typescript
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
} from '../../../shared/heapTypes';

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

    const { vertices } = body;
    if (
      !Array.isArray(vertices) ||
      vertices.length < 3 ||
      !vertices.every((v) => typeof (v as Vertex)?.x === 'number' && typeof (v as Vertex)?.y === 'number')
    ) {
      return c.json({ error: 'vertices must be an array of at least 3 {x, y} objects' }, 400);
    }

    const heapId = crypto.randomUUID();
    const baseId = crypto.randomUUID();
    const vertexHash = hashVertices(vertices);
    const now = new Date().toISOString();

    await db.createHeap(heapId, baseId, vertices, vertexHash, now);

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
      heaps: rows.map((r) => ({ id: r.id, version: r.version, createdAt: r.created_at })),
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
    } satisfies GetHeapResponse);
  });

  // PUT /heaps/:id/reset — clear live zone and reset version to 1
  app.put('/:id/reset', async (c) => {
    const id = c.req.param('id');
    const row = await db.getHeap(id);
    if (!row) return c.json({ error: 'Heap not found' }, 404);

    const previousVersion = row.version;
    await db.updateHeap(id, row.base_id, 1, [], 0);

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
```

- [ ] **Step 2: Update app.ts — change route prefix to /heaps**

```typescript
// server/src/app.ts

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { HeapDB } from './db';
import { heapRoutes } from './routes/heap';

export function createApp(db: HeapDB): Hono {
  const app = new Hono();
  app.use('*', cors());
  app.route('/heaps', heapRoutes(db));
  return app;
}
```

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/heap.ts server/src/app.ts
git commit -m "feat: implement GUID-based CRUD routes at /heaps"
```

---

## Task 7: Verify all tests pass

**Files:** (none — verify only)

- [ ] **Step 1: Run full test suite**

```bash
cd server && npm test -- --reporter=verbose
```

Expected output (all passing):
```
✓ POST /heaps > creates a heap and returns id, baseId, version 1, vertexCount
✓ POST /heaps > two creates with same vertices produce two heaps with different ids
✓ POST /heaps > rejects empty vertices with 400
✓ POST /heaps > rejects missing vertices with 400
✓ POST /heaps > rejects malformed vertex objects with 400
✓ GET /heaps > returns empty array when no heaps exist
✓ GET /heaps > returns all heaps with id, version, createdAt
✓ GET /heaps/:id > returns 404 for unknown id
✓ GET /heaps/:id > returns changed:false when client version matches
✓ GET /heaps/:id > returns changed:true with liveZone and baseId when client version is behind
✓ GET /heaps/:id > defaults version to 0 when not provided
✓ GET /heaps/:id/base > returns 404 for unknown heap id
✓ GET /heaps/:id/base > returns base vertices for known heap
✓ PUT /heaps/:id/reset > returns 404 for unknown id
✓ PUT /heaps/:id/reset > resets live_zone to empty, version to 1, and returns previousVersion
✓ PUT /heaps/:id/reset > preserves base_id on reset
✓ POST /heaps/:id/place > returns 404 for unknown heap id
✓ POST /heaps/:id/place > accepts a point when live zone is empty and base is empty
✓ POST /heaps/:id/place > rejects a point inside the polygon
✓ POST /heaps/:id/place > accepts a point outside the polygon and bumps version
✓ POST /heaps/:id/place > returns 400 when x or y is missing
✓ DELETE /heaps/:id > returns 404 for unknown id
✓ DELETE /heaps/:id > deletes heap and returns deleted:true
✓ DELETE /heaps/:id > heap no longer appears in list after delete
```

If any test fails, fix it before continuing. Do not proceed to the next task with failing tests.

- [ ] **Step 2: Commit if any fixes were needed**

```bash
git add -p
git commit -m "fix: resolve test failures from CRUD route implementation"
```

---

## Task 8: Update seed script

**Files:**
- Modify: `scripts/seed-heap.ts`

Changes:
- Default flow: `POST /heaps` with vertices → log the returned heap GUID
- `OVERWRITE=true` flow: requires `TARGET_HEAP_ID` env var → `PUT /heaps/:id/reset`

- [ ] **Step 1: Replace seed-heap.ts**

```typescript
/**
 * Seed script — generates an initial heap polygon and uploads it to the server.
 *
 * Usage:
 *   npm run seed                                                    # create new heap
 *   HEAP_SERVER_URL=https://heap-server.workers.dev npm run seed   # target prod
 *   OVERWRITE=true TARGET_HEAP_ID=<guid> npm run seed              # reset existing heap
 *   VERBOSE=true npm run seed                                       # show polygon details
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
import type { CreateHeapResponse, ResetHeapResponse } from '../shared/heapTypes';

// ── Config ────────────────────────────────────────────────────────────────────

const SERVER_URL = process.env.HEAP_SERVER_URL ?? 'http://localhost:8787';
const NUM_BLOCKS = 500;
const SIMPLIFY_EPSILON = 2;
const OVERWRITE = process.env.OVERWRITE === 'true';
const TARGET_HEAP_ID = process.env.TARGET_HEAP_ID ?? '';
const VERBOSE = process.env.VERBOSE === 'true';

// ── Generate HeapEntry[] via seeded PRNG ──────────────────────────────────────

function buildHeap(): HeapEntry[] {
  const state = new HeapState(MOCK_HEAP_HEIGHT_PX, MOCK_SEED);
  const entries: HeapEntry[] = [];

  for (let i = 0; i < NUM_BLOCKS; i++) {
    const keyid = Math.floor(state.seededRandom(i * 3) * 3);
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
  if (VERBOSE) console.log(`  Scanlines: ${rows.length} rows`);

  const full = computeBandPolygon(rows);
  if (VERBOSE) console.log(`  Before simplify: ${full.length} vertices`);

  const simplified = simplifyPolygon(full, SIMPLIFY_EPSILON);
  if (VERBOSE) {
    console.log(`  After simplify (epsilon=${SIMPLIFY_EPSILON}): ${simplified.length} vertices`);
    const yValues = simplified.map(v => v.y).sort((a, b) => a - b);
    console.log(`  Y range: ${yValues[0]} to ${yValues[yValues.length - 1]}`);
  }

  return simplified;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function seed(): Promise<void> {
  if (OVERWRITE) {
    if (!TARGET_HEAP_ID) {
      console.error('OVERWRITE=true requires TARGET_HEAP_ID=<guid>');
      console.error('  Example: TARGET_HEAP_ID=abc123 OVERWRITE=true npm run seed');
      process.exit(1);
    }

    const url = `${SERVER_URL}/heaps/${TARGET_HEAP_ID}/reset`;
    console.log(`Resetting heap ${TARGET_HEAP_ID} at ${url}…`);

    const res = await fetch(url, { method: 'PUT' });
    if (!res.ok) {
      const body = await res.text();
      console.error(`  ✗ ${res.status}: ${body}`);
      process.exit(1);
    }

    const data = await res.json() as ResetHeapResponse;
    console.log(`  ✓ Reset! id=${data.id}, version=${data.version}, previousVersion=${data.previousVersion}`);
    return;
  }

  console.log(`Building heap with ${NUM_BLOCKS} blocks…`);
  const entries = buildHeap();
  if (VERBOSE) {
    const xVals = entries.map(e => e.x).sort((a, b) => a - b);
    const yVals = entries.map(e => e.y).sort((a, b) => a - b);
    console.log(`  Entry X range: ${xVals[0]?.toFixed(1)} to ${xVals[xVals.length - 1]?.toFixed(1)}`);
    console.log(`  Entry Y range: ${yVals[0]?.toFixed(1)} to ${yVals[yVals.length - 1]?.toFixed(1)}`);
  }

  console.log('Computing polygon…');
  const vertices = buildPolygon(entries);
  console.log(`  Polygon: ${vertices.length} vertices after simplification`);

  if (VERBOSE) {
    console.log('Vertex list (first 10):');
    vertices.slice(0, 10).forEach((v, i) => {
      console.log(`    [${i}] x=${v.x.toFixed(1)}, y=${v.y.toFixed(1)}`);
    });
  }

  const url = `${SERVER_URL}/heaps`;
  console.log(`POSTing to ${url}…`);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vertices }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`  ✗ ${res.status}: ${body}`);
    process.exit(1);
  }

  const data = await res.json() as CreateHeapResponse;
  console.log(`  ✓ Created! id=${data.id}, baseId=${data.baseId}, version=${data.version}, vertexCount=${data.vertexCount}`);
  console.log(`  Save this id — you will need it for OVERWRITE: TARGET_HEAP_ID=${data.id}`);
}

seed().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
```

Note: the `randomInt` non-determinism was removed — polygon generation now uses the stable `MOCK_SEED` constant throughout, so the same vertices (and thus the same shape) are produced on every run.

- [ ] **Step 2: Commit**

```bash
git add scripts/seed-heap.ts
git commit -m "feat: update seed script for GUID-based API (create + reset)"
```

---

## Task 9: Write API README

**Files:**
- Create: `server/API_README.md`

- [ ] **Step 1: Create API_README.md**

```markdown
# Heap Server API

Base URL (local): `http://localhost:8787`

---

## POST /heaps

Create a new heap from a polygon defined by a vertex array. Returns a stable GUID that identifies this heap for all future operations.

**Request body**
```json
{
  "vertices": [
    { "x": 100, "y": 400 },
    { "x": 300, "y": 600 },
    { "x": 500, "y": 400 }
  ]
}
```

**Response `201`**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "baseId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  "version": 1,
  "vertexCount": 3
}
```

- `id` — heap GUID, stable across all operations including freezes. **Save this.**
- `baseId` — current base snapshot GUID. Changes when a freeze occurs.

**Errors**
- `400` — `vertices` missing, empty, fewer than 3, or contains non-`{x,y}` objects

---

## GET /heaps

List all heaps.

**Response `200`**
```json
{
  "heaps": [
    { "id": "550e8400-...", "version": 12, "createdAt": "2026-04-02T10:00:00.000Z" }
  ]
}
```

---

## GET /heaps/:id

Get the current state of a heap. Supports delta polling via the `version` query param — if the client is already up-to-date, the live zone is omitted.

**Query params**
- `version` (optional, default `0`) — the client's last known version

**Response `200` — client is up to date**
```json
{ "changed": false, "version": 12 }
```

**Response `200` — client is behind**
```json
{
  "changed": true,
  "version": 12,
  "baseId": "6ba7b810-...",
  "liveZone": [
    { "x": 120, "y": 380 }
  ]
}
```

- `baseId` changes when a freeze occurs. When `baseId` differs from the client's cached value, re-fetch `GET /heaps/:id/base`.

**Errors**
- `404` — heap not found

---

## GET /heaps/:id/base

Get the current base polygon vertices for a heap. The base is the frozen, immutable portion of the heap shape. It changes only when a freeze occurs (when the live zone grows past a threshold).

**Response `200`**
```json
[
  { "x": 100, "y": 400 },
  { "x": 300, "y": 600 },
  { "x": 500, "y": 400 }
]
```

**Errors**
- `404` — heap not found

---

## PUT /heaps/:id/reset

Clear the live zone and reset the version to 1. The base polygon is preserved. Use this to restart player activity on an existing heap without re-seeding the shape.

**Request body:** none

**Response `200`**
```json
{
  "id": "550e8400-...",
  "version": 1,
  "previousVersion": 42
}
```

**Errors**
- `404` — heap not found

---

## POST /heaps/:id/place

Add a block to the heap's live zone. The point is rejected if it falls inside the current polygon (base + live zone combined). If the live zone exceeds `LIVE_ZONE_MAX` (500) vertices, the bottom `FREEZE_BATCH` (250) are promoted to a new base snapshot and the live zone is trimmed.

**Request body**
```json
{ "x": 220, "y": 580 }
```

**Response `200` — accepted**
```json
{ "accepted": true, "version": 13 }
```

**Response `200` — rejected (point inside polygon)**
```json
{ "accepted": false, "version": 12 }
```

**Errors**
- `400` — `x` or `y` missing or not a number
- `404` — heap not found

---

## DELETE /heaps/:id

Delete a heap and all its base snapshots.

**Response `200`**
```json
{ "deleted": true }
```

**Errors**
- `404` — heap not found

---

## Seed Script

```bash
# Create a new heap (prints the GUID — save it)
npm run seed

# Create with verbose polygon stats
VERBOSE=true npm run seed

# Reset an existing heap's live zone (does not change the base polygon)
OVERWRITE=true TARGET_HEAP_ID=550e8400-e29b-41d4-a716-446655440000 npm run seed

# Target a deployed server
HEAP_SERVER_URL=https://heap-server.workers.dev npm run seed
```
```

- [ ] **Step 2: Commit**

```bash
git add server/API_README.md
git commit -m "docs: add API_README.md for heap server CRUD routes"
```

---

## Task 10: Apply schema to local D1 and smoke test

**Files:** (none — wrangler commands only)

This task re-applies the schema to the local D1 database and runs a quick end-to-end smoke test against the running dev server.

- [ ] **Step 1: Reset local D1 database**

From the `server/` directory:
```bash
cd server
npx wrangler d1 execute heap --local --file=schema.sql
```

Expected: output shows both `DROP TABLE` and `CREATE TABLE` statements executed without error.

- [ ] **Step 2: Start local dev server**

In a separate terminal:
```bash
cd server && npm run dev
```

Leave running for the next steps.

- [ ] **Step 3: Smoke test — create a heap**

```bash
curl -s -X POST http://localhost:8787/heaps \
  -H 'Content-Type: application/json' \
  -d '{"vertices":[{"x":100,"y":400},{"x":300,"y":600},{"x":500,"y":400}]}' | jq .
```

Expected response (ids will differ):
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "baseId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  "version": 1,
  "vertexCount": 3
}
```

Copy the `id` value for the next step.

- [ ] **Step 4: Smoke test — list, read, place, reset, delete**

Replace `<HEAP_ID>` with the id from step 3:

```bash
# List
curl -s http://localhost:8787/heaps | jq .

# Read
curl -s http://localhost:8787/heaps/<HEAP_ID> | jq .

# Base
curl -s http://localhost:8787/heaps/<HEAP_ID>/base | jq .

# Place
curl -s -X POST http://localhost:8787/heaps/<HEAP_ID>/place \
  -H 'Content-Type: application/json' \
  -d '{"x":200,"y":500}' | jq .

# Reset
curl -s -X PUT http://localhost:8787/heaps/<HEAP_ID>/reset | jq .

# Delete
curl -s -X DELETE http://localhost:8787/heaps/<HEAP_ID> | jq .

# Confirm gone
curl -s http://localhost:8787/heaps/<HEAP_ID>
```

Expected final response: `{"error":"Heap not found"}` with status 404.

- [ ] **Step 5: Final test run to confirm everything still passes**

```bash
cd server && npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add -p   # stage any incidental fixes only
git commit -m "chore: verify schema applied and smoke tests pass"
```
```

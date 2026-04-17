# Multiple Heaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players pick from multiple server-seeded heaps (each with a name, difficulty, and runtime multipliers) from a dedicated selector scene, with per-heap placeables and a versioned client save.

**Architecture:** Extend the D1 `heap` table and shared types with a `HeapParams` object. `BootScene` fetches the full catalog, picks a default, and runs a lazy v1→v2 save migration. A new `HeapSelectScene` renders the sorted list. Gameplay systems (EnemyManager, coin awards, buildRunScore, ScoreScene) read the active heap's params from the registry and apply them at runtime. Placed items move to a per-heap keyed map with a legacy migration path.

**Tech Stack:** TypeScript, Phaser 3.90, Vite 6, Hono + Cloudflare Workers, D1, Vitest.

**Branch:** `feature/Multi-heap` (already created; design doc committed).

**Spec:** `docs/superpowers/specs/2026-04-16-multiple-heaps-design.md`

---

## File Structure

### Create
- `src/scenes/HeapSelectScene.ts` — new scene, heap list UI
- `src/ui/DifficultyStars.ts` — small helper to render 1.0–5.0 stars with halves
- `server/tests/helpers/` — no new file, extend `mockDb.ts`

### Modify
- `server/schema.sql` — add 5 columns to `heap`
- `shared/heapTypes.ts` — `HeapParams`, extend create/list/get response types
- `server/src/db.ts` — `HeapRow` + `HeapSummaryRow` gain params; `createHeap` signature; new `updateHeapParams`
- `server/src/routes/heap.ts` — accept/return params; validation
- `server/tests/helpers/mockDb.ts` — store/return params
- `server/tests/routes.test.ts` — new tests for params
- `scripts/seed-heap.ts` — read env vars, POST params
- `src/systems/HeapClient.ts` — `list()` returns `HeapSummary[]`
- `src/systems/__tests__/HeapClient.test.ts` — update mocks/assertions
- `src/systems/SaveData.ts` — `schemaVersion`, per-heap `placed`, `selectedHeapId`, migration
- `src/systems/__tests__/SaveData.test.ts` — migration + per-heap tests
- `src/scenes/BootScene.ts` — catalog fetch + default selection + `finalizeLegacyPlaced`
- `src/scenes/MenuScene.ts` — heap picker button; pass active heap ID into `startGame`
- `src/scenes/GameScene.ts` — read `heapParams` from registry; thread into EnemyManager and score paths
- `src/systems/EnemyManager.ts` — accept `spawnRateMult` in ctor, apply to `spawnChance`
- `src/systems/__tests__/EnemyManager.test.ts` — test mult behavior
- `src/systems/buildRunScore.ts` — accept `scoreMult` argument, apply to final total
- `src/systems/__tests__/buildRunScore.test.ts` — test mult
- `src/scenes/ScoreScene.ts` — render coin-mult and score-mult breakdown rows
- `src/systems/PlaceableManager.ts` — accept `heapId`, pass through to SaveData
- `src/scenes/UpgradeScene.ts` / `StoreScene.ts` — only if they touch `placed` (verify during Task 5)

---

## Task 1: Server — schema, params, routes, seed script

**Files:**
- Modify: `server/schema.sql`
- Modify: `shared/heapTypes.ts`
- Modify: `server/src/db.ts`
- Modify: `server/src/routes/heap.ts`
- Modify: `server/tests/helpers/mockDb.ts`
- Modify: `server/tests/routes.test.ts`
- Modify: `scripts/seed-heap.ts`

### Step 1.1: Add `HeapParams` to shared types

- [ ] Edit `shared/heapTypes.ts`. At the top, below the `Vertex` interface, add:

```ts
export interface HeapParams {
  name: string;
  difficulty: number;      // 1.0..5.0 in 0.5 steps
  spawnRateMult: number;
  coinMult: number;
  scoreMult: number;
}

export const DEFAULT_HEAP_PARAMS: HeapParams = {
  name: 'Unnamed Heap',
  difficulty: 1.0,
  spawnRateMult: 1.0,
  coinMult: 1.0,
  scoreMult: 1.0,
};
```

Then update the following interfaces in the same file:

```ts
export interface CreateHeapRequest {
  vertices: Vertex[];
  params?: Partial<HeapParams>;
}

export interface HeapSummary {
  id: string;
  version: number;
  createdAt: string;
  params: HeapParams;
}

export type GetHeapResponse =
  | { changed: false; version: number }
  | { changed: true; version: number; baseId: string; liveZone: Vertex[]; params: HeapParams };
```

### Step 1.2: Write failing schema/db tests

- [ ] Edit `server/tests/helpers/mockDb.ts`. Replace the file's body to support params. Use the content below:

```ts
// server/tests/helpers/mockDb.ts

import type { HeapDB, HeapRow, HeapSummaryRow } from '../../src/db';
import type { HeapParams, Vertex } from '../../../shared/heapTypes';
import { DEFAULT_HEAP_PARAMS } from '../../../shared/heapTypes';

interface BaseRecord {
  heap_id: string;
  vertices: string;
  vertex_hash: string;
  created_at: string;
}

export class MockHeapDB implements HeapDB {
  private heaps = new Map<string, Omit<HeapRow, 'id'>>();
  private bases = new Map<string, BaseRecord>();

  async listHeaps(): Promise<HeapSummaryRow[]> {
    return Array.from(this.heaps.entries()).map(([id, row]) => ({
      id,
      version: row.version,
      created_at: row.created_at,
      name:            row.name,
      difficulty:      row.difficulty,
      spawn_rate_mult: row.spawn_rate_mult,
      coin_mult:       row.coin_mult,
      score_mult:      row.score_mult,
    }));
  }

  async getHeap(id: string): Promise<HeapRow | null> {
    const row = this.heaps.get(id);
    if (!row) return null;
    return { id, ...row };
  }

  async createHeap(
    heapId: string,
    baseId: string,
    vertices: Vertex[],
    vertexHash: string,
    now: string,
    params: HeapParams = DEFAULT_HEAP_PARAMS,
  ): Promise<void> {
    this.bases.set(baseId, {
      heap_id: heapId,
      vertices: JSON.stringify(vertices),
      vertex_hash: vertexHash,
      created_at: now,
    });
    this.heaps.set(heapId, {
      base_id: baseId,
      live_zone: '[]',
      freeze_y: 0,
      version: 1,
      created_at: now,
      name:            params.name,
      difficulty:      params.difficulty,
      spawn_rate_mult: params.spawnRateMult,
      coin_mult:       params.coinMult,
      score_mult:      params.scoreMult,
    });
  }

  async updateHeap(id: string, baseId: string, version: number, liveZone: Vertex[], freezeY: number): Promise<void> {
    const existing = this.heaps.get(id);
    if (!existing) return;
    this.heaps.set(id, { ...existing, base_id: baseId, version, live_zone: JSON.stringify(liveZone), freeze_y: freezeY });
  }

  async updateHeapParams(id: string, params: HeapParams): Promise<void> {
    const existing = this.heaps.get(id);
    if (!existing) return;
    this.heaps.set(id, {
      ...existing,
      name:            params.name,
      difficulty:      params.difficulty,
      spawn_rate_mult: params.spawnRateMult,
      coin_mult:       params.coinMult,
      score_mult:      params.scoreMult,
    });
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
    this.bases.set(id, {
      heap_id: heapId,
      vertices: JSON.stringify(vertices),
      vertex_hash: vertexHash,
      created_at: now,
    });
  }

  seedHeap(id: string, version: number, liveZone: Vertex[], baseId = id, freezeY = 0, params: HeapParams = DEFAULT_HEAP_PARAMS): void {
    this.heaps.set(id, {
      base_id: baseId,
      version,
      live_zone: JSON.stringify(liveZone),
      freeze_y: freezeY,
      created_at: '2026-01-01T00:00:00.000Z',
      name:            params.name,
      difficulty:      params.difficulty,
      spawn_rate_mult: params.spawnRateMult,
      coin_mult:       params.coinMult,
      score_mult:      params.scoreMult,
    });
  }

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

This file will not compile until Step 1.3 widens `HeapRow` and `HeapDB`.

### Step 1.3: Widen `HeapRow`, `HeapSummaryRow`, and `HeapDB`

- [ ] Edit `server/src/db.ts`. Replace the type interfaces and `HeapDB` with:

```ts
// server/src/db.ts

import { HeapParams, Vertex } from '../../shared/heapTypes';
import { DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';

export interface HeapRow {
  id: string;
  base_id: string;
  live_zone: string;
  freeze_y: number;
  version: number;
  created_at: string;
  name: string;
  difficulty: number;
  spawn_rate_mult: number;
  coin_mult: number;
  score_mult: number;
}

export interface HeapSummaryRow {
  id: string;
  version: number;
  created_at: string;
  name: string;
  difficulty: number;
  spawn_rate_mult: number;
  coin_mult: number;
  score_mult: number;
}

export interface HeapDB {
  listHeaps(): Promise<HeapSummaryRow[]>;
  getHeap(id: string): Promise<HeapRow | null>;
  createHeap(
    heapId: string,
    baseId: string,
    vertices: Vertex[],
    vertexHash: string,
    now: string,
    params?: HeapParams,
  ): Promise<void>;
  updateHeap(id: string, baseId: string, version: number, liveZone: Vertex[], freezeY: number): Promise<void>;
  updateHeapParams(id: string, params: HeapParams): Promise<void>;
  deleteHeap(id: string): Promise<void>;
  getBaseVerticesById(baseId: string): Promise<Vertex[] | null>;
  createBase(id: string, heapId: string, vertices: Vertex[], vertexHash: string, now: string): Promise<void>;
}
```

Then update the `D1HeapDB` class in the same file so its methods match:

```ts
export class D1HeapDB implements HeapDB {
  constructor(private d1: D1Database) {}

  async listHeaps(): Promise<HeapSummaryRow[]> {
    const result = await this.d1
      .prepare(
        'SELECT id, version, created_at, name, difficulty, spawn_rate_mult, coin_mult, score_mult FROM heap',
      )
      .all<HeapSummaryRow>();
    return result.results;
  }

  async getHeap(id: string): Promise<HeapRow | null> {
    const row = await this.d1
      .prepare(
        'SELECT id, base_id, live_zone, freeze_y, version, created_at, name, difficulty, spawn_rate_mult, coin_mult, score_mult FROM heap WHERE id = ?1',
      )
      .bind(id)
      .first<HeapRow>();
    return row ?? null;
  }

  async createHeap(
    heapId: string,
    baseId: string,
    vertices: Vertex[],
    vertexHash: string,
    now: string,
    params: HeapParams = DEFAULT_HEAP_PARAMS,
  ): Promise<void> {
    await this.d1.batch([
      this.d1
        .prepare(
          'INSERT INTO heap_base (id, heap_id, vertices, vertex_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5)',
        )
        .bind(baseId, heapId, JSON.stringify(vertices), vertexHash, now),
      this.d1
        .prepare(
          `INSERT INTO heap (id, base_id, live_zone, freeze_y, version, created_at,
                             name, difficulty, spawn_rate_mult, coin_mult, score_mult)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
        )
        .bind(
          heapId, baseId, '[]', 0, 1, now,
          params.name, params.difficulty,
          params.spawnRateMult, params.coinMult, params.scoreMult,
        ),
    ]);
  }

  async updateHeap(id: string, baseId: string, version: number, liveZone: Vertex[], freezeY: number): Promise<void> {
    await this.d1
      .prepare('UPDATE heap SET base_id = ?1, version = ?2, live_zone = ?3, freeze_y = ?4 WHERE id = ?5')
      .bind(baseId, version, JSON.stringify(liveZone), freezeY, id)
      .run();
  }

  async updateHeapParams(id: string, params: HeapParams): Promise<void> {
    await this.d1
      .prepare(
        `UPDATE heap SET name = ?1, difficulty = ?2, spawn_rate_mult = ?3, coin_mult = ?4, score_mult = ?5
         WHERE id = ?6`,
      )
      .bind(params.name, params.difficulty, params.spawnRateMult, params.coinMult, params.scoreMult, id)
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

### Step 1.4: Update the SQL schema

- [ ] Edit `server/schema.sql`. Replace the `heap` table block with:

```sql
CREATE TABLE IF NOT EXISTS heap (
  id              TEXT PRIMARY KEY,
  base_id         TEXT NOT NULL,
  live_zone       TEXT NOT NULL DEFAULT '[]',
  freeze_y        REAL NOT NULL DEFAULT 0,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  name            TEXT NOT NULL DEFAULT 'Unnamed Heap',
  difficulty      REAL NOT NULL DEFAULT 1.0,
  spawn_rate_mult REAL NOT NULL DEFAULT 1.0,
  coin_mult       REAL NOT NULL DEFAULT 1.0,
  score_mult      REAL NOT NULL DEFAULT 1.0
);
```

Local dev uses `IF NOT EXISTS` + wrangler's dev DB. If the wrangler D1 already exists, hand-run this migration statement against it:

```
npx wrangler d1 execute heap --local --command="ALTER TABLE heap ADD COLUMN name TEXT NOT NULL DEFAULT 'Unnamed Heap'; ALTER TABLE heap ADD COLUMN difficulty REAL NOT NULL DEFAULT 1.0; ALTER TABLE heap ADD COLUMN spawn_rate_mult REAL NOT NULL DEFAULT 1.0; ALTER TABLE heap ADD COLUMN coin_mult REAL NOT NULL DEFAULT 1.0; ALTER TABLE heap ADD COLUMN score_mult REAL NOT NULL DEFAULT 1.0;"
```

### Step 1.5: Add param validation helper + route updates

- [ ] Create validation inline in `server/src/routes/heap.ts`. Replace the `app.post('/')` handler and the `app.get('/:id')` handler with:

```ts
// Add near the top of the file, below imports:
import type { HeapParams } from '../../../shared/heapTypes';
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
  const merged: HeapParams = { ...DEFAULT_HEAP_PARAMS, ...(input ?? {}) };
  if (typeof merged.name !== 'string' || merged.name.trim() === '') {
    return { error: 'name must be a non-empty string' };
  }
  merged.name = merged.name.slice(0, 40);
  const dErr = validateDifficulty(merged.difficulty);
  if (dErr) return { error: dErr };
  for (const [k, v] of [
    ['spawnRateMult', merged.spawnRateMult],
    ['coinMult',      merged.coinMult],
    ['scoreMult',     merged.scoreMult],
  ] as const) {
    const err = validateMult(v, k);
    if (err) return { error: err };
  }
  return merged;
}
```

Then replace the `POST /` handler body (keeping its outer shape) to use `resolveParams` and pass the result into `createHeap`:

```ts
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
```

Update the `GET /` handler to return params:

```ts
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
```

Update the `GET /:id` handler to include `params` on the `changed: true` branch:

```ts
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
```

### Step 1.6: Add `ListHeapsResponse` import fix

- [ ] Confirm `server/src/routes/heap.ts` still imports `ListHeapsResponse` from `shared/heapTypes`. No other imports change.

### Step 1.7: Add route tests for params

- [ ] Append the following to `server/tests/routes.test.ts`:

```ts
// ── Heap params ──────────────────────────────────────────────────────────────

describe('POST /heaps with params', () => {
  it('accepts full params and returns them in GET /heaps', async () => {
    const app = makeApp();
    const res = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vertices: VERTICES,
        params: {
          name: 'Frostbite Summit',
          difficulty: 3.5,
          spawnRateMult: 1.5,
          coinMult: 1.3,
          scoreMult: 2.0,
        },
      }),
    });
    expect(res.status).toBe(201);

    const listRes = await app.request('/heaps');
    const list = await listRes.json() as ListHeapsResponse;
    expect(list.heaps).toHaveLength(1);
    expect(list.heaps[0].params).toEqual({
      name: 'Frostbite Summit',
      difficulty: 3.5,
      spawnRateMult: 1.5,
      coinMult: 1.3,
      scoreMult: 2.0,
    });
  });

  it('applies defaults when params omitted', async () => {
    const app = makeApp();
    await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    const list = await (await app.request('/heaps')).json() as ListHeapsResponse;
    expect(list.heaps[0].params).toEqual({
      name: 'Unnamed Heap',
      difficulty: 1.0,
      spawnRateMult: 1.0,
      coinMult: 1.0,
      scoreMult: 1.0,
    });
  });

  it('rejects difficulty out of range', async () => {
    const res = await makeApp().request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES, params: { difficulty: 6 } }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects difficulty not on 0.5 step', async () => {
    const res = await makeApp().request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES, params: { difficulty: 2.3 } }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects non-positive coinMult', async () => {
    const res = await makeApp().request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES, params: { coinMult: 0 } }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /heaps/:id', () => {
  it('includes params on the changed: true branch', async () => {
    const app = makeApp();
    const createRes = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vertices: VERTICES,
        params: { name: 'X', difficulty: 2, spawnRateMult: 1.1, coinMult: 1.2, scoreMult: 1.3 },
      }),
    });
    const created = await createRes.json() as CreateHeapResponse;

    const res = await app.request(`/heaps/${created.id}?version=0`);
    const body = await res.json() as GetHeapResponse;
    expect(body.changed).toBe(true);
    if (body.changed) {
      expect(body.params).toEqual({ name: 'X', difficulty: 2, spawnRateMult: 1.1, coinMult: 1.2, scoreMult: 1.3 });
    }
  });
});
```

### Step 1.8: Run server tests

- [ ] Run: `cd server && npm test -- --run`
- [ ] Expected: All existing tests still pass; new param tests pass.

### Step 1.9: Update seed script

- [ ] Edit `scripts/seed-heap.ts`. Replace the "Config" block and add a `params` block. Update the POST body.

```ts
// Config block — replace the lines after // ── Config ── comment:

const SERVER_URL = process.env.VITE_HEAP_SERVER_URL ?? 'http://localhost:8787';
const NUM_BLOCKS = 200;
const SIMPLIFY_EPSILON = 2;
const OVERWRITE = process.env.OVERWRITE === 'true';
const TARGET_HEAP_ID = process.env.TARGET_HEAP_ID ?? '';
const VERBOSE = process.env.VERBOSE === 'true';

// Heap params from env
const PARAM_NAME      = process.env.NAME       ?? '';
const PARAM_DIFF      = process.env.DIFFICULTY ? Number(process.env.DIFFICULTY) : 1.0;
const PARAM_SPAWN     = process.env.SPAWN_MULT ? Number(process.env.SPAWN_MULT) : 1.0;
const PARAM_COIN      = process.env.COIN_MULT  ? Number(process.env.COIN_MULT)  : 1.0;
const PARAM_SCORE     = process.env.SCORE_MULT ? Number(process.env.SCORE_MULT) : 1.0;
```

Update the POST call (find the `const url = `${SERVER_URL}/heaps`;` line) and replace the body:

```ts
  const params = {
    name:          PARAM_NAME || `Heap #${Date.now().toString(36).slice(-4)}`,
    difficulty:    PARAM_DIFF,
    spawnRateMult: PARAM_SPAWN,
    coinMult:      PARAM_COIN,
    scoreMult:     PARAM_SCORE,
  };
  console.log('Heap params:', params);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vertices, params }),
  });
```

### Step 1.10: Commit

- [ ] `git add -A server/ shared/heapTypes.ts scripts/seed-heap.ts`
- [ ] `git commit -m "feat(server): heap params (name, difficulty, mults) on heap row + routes"`

---

## Task 2: Shared types + HeapClient + BootScene catalog

**Files:**
- Modify: `src/systems/HeapClient.ts`
- Modify: `src/systems/__tests__/HeapClient.test.ts`
- Modify: `src/scenes/BootScene.ts`

### Step 2.1: Update `HeapClient.list` signature + test

- [ ] Edit `src/systems/__tests__/HeapClient.test.ts`. Replace the `describe('HeapClient.list', ...)` block with:

```ts
describe('HeapClient.list', () => {
  it('returns heap summaries with params from server', async () => {
    (global as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        heaps: [
          {
            id: 'abc',
            version: 3,
            createdAt: '2026-04-01T00:00:00.000Z',
            params: { name: 'A', difficulty: 2, spawnRateMult: 1, coinMult: 1, scoreMult: 1 },
          },
        ],
      }),
    });
    const summaries = await HeapClient.list();
    expect(summaries).toHaveLength(1);
    expect(summaries[0].id).toBe('abc');
    expect(summaries[0].params.name).toBe('A');
  });

  it('returns [] when fetch fails', async () => {
    (global as any).fetch = vi.fn().mockRejectedValue(new Error('net'));
    expect(await HeapClient.list()).toEqual([]);
  });

  it('returns [] when response is not ok', async () => {
    (global as any).fetch = vi.fn().mockResolvedValue({ ok: false });
    expect(await HeapClient.list()).toEqual([]);
  });
});
```

### Step 2.2: Run to see failure

- [ ] Run: `npx vitest run src/systems/__tests__/HeapClient.test.ts`
- [ ] Expected: tests fail with type errors on `summaries[0].params`.

### Step 2.3: Update `HeapClient`

- [ ] Edit `src/systems/HeapClient.ts`. Change the `list` method:

```ts
static async list(): Promise<import('../../shared/heapTypes').HeapSummary[]> {
  try {
    const res = await fetch(`${SERVER_URL}/heaps`);
    if (!res.ok) return [];
    const data = (await res.json()) as ListHeapsResponse;
    return data.heaps;
  } catch {
    return [];
  }
}
```

### Step 2.4: Run tests — expect pass

- [ ] Run: `npx vitest run src/systems/__tests__/HeapClient.test.ts`
- [ ] Expected: PASS.

### Step 2.5: Update BootScene to fetch catalog

- [ ] Edit `src/scenes/BootScene.ts`. Replace the `HeapClient.list()` block inside `create()` with:

```ts
import type { HeapSummary } from '../../shared/heapTypes';
import { DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';
import { getSelectedHeapId, setSelectedHeapId } from '../systems/SaveData';

// ...later in create():
HeapClient.list()
  .then((summaries) => {
    this.game.registry.set('heapCatalog', summaries);

    if (summaries.length === 0) {
      this.game.registry.set('activeHeapId', '');
      this.game.registry.set('heapPolygon', [] as Vertex[]);
      this.game.registry.set('heapParams', DEFAULT_HEAP_PARAMS);
      return;
    }

    const stored = getSelectedHeapId();
    const pick = summaries.find((s) => s.id === stored)
              ?? [...summaries].sort((a, b) => a.params.difficulty - b.params.difficulty
                    || a.createdAt.localeCompare(b.createdAt))[0];

    setSelectedHeapId(pick.id);
    this.game.registry.set('activeHeapId', pick.id);
    this.game.registry.set('heapParams',   pick.params);

    return HeapClient.load(pick.id).then((polygon) => {
      this.game.registry.set('heapPolygon', polygon);
    });
  })
  .catch(() => {
    this.game.registry.set('heapCatalog',  [] as HeapSummary[]);
    this.game.registry.set('activeHeapId', '');
    this.game.registry.set('heapPolygon',  [] as Vertex[]);
    this.game.registry.set('heapParams',   DEFAULT_HEAP_PARAMS);
  })
  .finally(() => {
    this.scene.start('MenuScene');
  });
```

Note: `getSelectedHeapId` and `setSelectedHeapId` are created in Task 3. If you run the build now, they will be missing — that's intentional and fixed in Task 3. Do **not** commit until Task 3 is at least at Step 3.3.

### Step 2.6: Defer commit to Task 3

- [ ] No commit yet. Task 3 introduces the SaveData changes BootScene depends on; commit them together.

---

## Task 3: SaveData v1→v2 migration + per-heap placeables

**Files:**
- Modify: `src/systems/SaveData.ts`
- Modify: `src/systems/__tests__/SaveData.test.ts`

### Step 3.1: Write failing migration tests

- [ ] Edit `src/systems/__tests__/SaveData.test.ts`. Append:

```ts
describe('SaveData v1→v2 migration', () => {
  beforeEach(() => {
    localStorage.clear();
    resetCacheForTests();
  });

  it('migrates v1 flat placed[] into _legacyPlaced', () => {
    localStorage.setItem('heap_save', JSON.stringify({
      balance: 100,
      upgrades: {},
      inventory: {},
      placed: [{ id: 'ibeam', x: 10, y: 20 }],
      playerGuid: 'p1',
      playerName: 'tester',
      highScores: {},
    }));

    expect(getPlaced('any-heap')).toEqual([]);                 // fresh key is empty
    expect(getLegacyPlacedForTests()).toEqual([{ id: 'ibeam', x: 10, y: 20 }]);
    expect(getSchemaVersionForTests()).toBe(2);
  });

  it('finalizeLegacyPlaced moves items onto a heap id', () => {
    localStorage.setItem('heap_save', JSON.stringify({
      balance: 0,
      upgrades: {}, inventory: {},
      placed: [{ id: 'ibeam', x: 1, y: 2 }, { id: 'ladder', x: 3, y: 4 }],
      playerGuid: 'p', playerName: 'n', highScores: {},
    }));

    finalizeLegacyPlaced('heap-abc');

    expect(getPlaced('heap-abc')).toEqual([
      { id: 'ibeam',  x: 1, y: 2 },
      { id: 'ladder', x: 3, y: 4 },
    ]);
    expect(getLegacyPlacedForTests()).toBeUndefined();
  });

  it('v2 save passes through unchanged', () => {
    localStorage.setItem('heap_save', JSON.stringify({
      schemaVersion: 2,
      balance: 50,
      upgrades: {}, inventory: {},
      placed: { 'heap-a': [{ id: 'ibeam', x: 0, y: 0 }] },
      selectedHeapId: 'heap-a',
      playerGuid: 'p', playerName: 'n', highScores: {},
    }));
    expect(getPlaced('heap-a')).toHaveLength(1);
    expect(getSelectedHeapId()).toBe('heap-a');
  });
});

describe('SaveData per-heap placeables', () => {
  beforeEach(() => { localStorage.clear(); resetCacheForTests(); });

  it('addPlaced is isolated per heap', () => {
    addPlaced('h1', { id: 'ibeam', x: 0, y: 0 });
    addPlaced('h2', { id: 'ladder', x: 0, y: 0 });
    expect(getPlaced('h1')).toHaveLength(1);
    expect(getPlaced('h2')).toHaveLength(1);
    expect(getPlaced('h3')).toEqual([]);
  });

  it('selectedHeapId persists', () => {
    setSelectedHeapId('heap-xyz');
    expect(getSelectedHeapId()).toBe('heap-xyz');
  });
});
```

At the top of the file, update the import to include the new names:

```ts
import {
  getPlaced, addPlaced, removePlaced, updatePlacedMeta, removeExpiredPlaced,
  getSelectedHeapId, setSelectedHeapId, finalizeLegacyPlaced,
  resetCacheForTests, getLegacyPlacedForTests, getSchemaVersionForTests,
} from '../SaveData';
```

### Step 3.2: Run tests — expect fail

- [ ] Run: `npx vitest run src/systems/__tests__/SaveData.test.ts`
- [ ] Expected: FAIL with "not a function" / type errors.

### Step 3.3: Rewrite `SaveData.ts`

- [ ] Edit `src/systems/SaveData.ts`. Replace the file with:

```ts
import { UPGRADE_DEFS } from '../data/upgradeDefs';
import { ITEM_DEFS } from '../data/itemDefs';
import { MAX_WALKABLE_SLOPE_DEG, MOUNTAIN_CLIMBER_INCREMENT } from '../constants';

const SAVE_KEY = 'heap_save';
const CURRENT_SCHEMA = 2;

export interface PlacedItemSave {
  id:    string;
  x:     number;
  y:     number;
  meta?: Record<string, number>;
}

interface RawSave {
  schemaVersion: number;
  balance:        number;
  upgrades:       Record<string, number>;
  inventory:      Record<string, number>;
  placed:         Record<string, PlacedItemSave[]>;
  selectedHeapId: string;
  playerGuid:     string;
  playerName:     string;
  highScores:     Record<string, number>;
  _legacyPlaced?: PlacedItemSave[];
}

let _cache: RawSave | null = null;

function generateDefaultName(): string {
  const n = Array.from({ length: 5 }, () => Math.floor(Math.random() * 10)).join('');
  return `Trashbag#${n}`;
}

function freshSave(): RawSave {
  return {
    schemaVersion: CURRENT_SCHEMA,
    balance:        0,
    upgrades:       {},
    inventory:      {},
    placed:         {},
    selectedHeapId: '',
    playerGuid:     crypto.randomUUID(),
    playerName:     generateDefaultName(),
    highScores:     {},
  };
}

function migrate(parsed: any): RawSave {
  // v1 has no schemaVersion and `placed` is an array.
  const version = parsed?.schemaVersion ?? 1;
  if (version === CURRENT_SCHEMA && !Array.isArray(parsed.placed)) {
    return {
      schemaVersion: CURRENT_SCHEMA,
      balance:        parsed.balance        ?? 0,
      upgrades:       parsed.upgrades       ?? {},
      inventory:      parsed.inventory      ?? {},
      placed:         parsed.placed         ?? {},
      selectedHeapId: parsed.selectedHeapId ?? '',
      playerGuid:     parsed.playerGuid     ?? crypto.randomUUID(),
      playerName:     parsed.playerName     ?? generateDefaultName(),
      highScores:     parsed.highScores     ?? {},
      _legacyPlaced:  parsed._legacyPlaced,
    };
  }

  // v1 migration.
  const legacyArray: PlacedItemSave[] = Array.isArray(parsed?.placed) ? parsed.placed : [];
  return {
    schemaVersion: CURRENT_SCHEMA,
    balance:        parsed.balance    ?? 0,
    upgrades:       parsed.upgrades   ?? {},
    inventory:      parsed.inventory  ?? {},
    placed:         {},
    selectedHeapId: '',
    playerGuid:     parsed.playerGuid ?? crypto.randomUUID(),
    playerName:     parsed.playerName ?? generateDefaultName(),
    highScores:     parsed.highScores ?? {},
    _legacyPlaced:  legacyArray.length > 0 ? legacyArray : undefined,
  };
}

function load(): RawSave {
  if (_cache) return _cache;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const migrated = migrate(parsed);
      _cache = migrated;
      if ((parsed?.schemaVersion ?? 1) !== CURRENT_SCHEMA) persist(migrated);
      return migrated;
    }
  } catch { /* fall through */ }
  const fresh = freshSave();
  _cache = fresh;
  return fresh;
}

function persist(data: RawSave): void {
  _cache = data;
  localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}

// ── Balance ───────────────────────────────────────────────────────────────────

export function getBalance(): number { return load().balance; }

export function addBalance(amount: number): void {
  const data = load();
  data.balance = Math.max(0, data.balance + amount);
  persist(data);
}

// ── Upgrades ──────────────────────────────────────────────────────────────────

export function getUpgradeLevel(id: string): number { return load().upgrades[id] ?? 0; }

export function purchaseUpgrade(id: string): boolean {
  const def = UPGRADE_DEFS.find(d => d.id === id);
  if (!def) return false;
  const data = load();
  const level = data.upgrades[id] ?? 0;
  if (level >= def.maxLevel) return false;
  const price = def.cost(level + 1);
  if (data.balance < price) return false;
  data.balance -= price;
  data.upgrades[id] = level + 1;
  persist(data);
  return true;
}

// ── Inventory ─────────────────────────────────────────────────────────────────

export function getItemQuantity(id: string): number { return load().inventory[id] ?? 0; }

export function addItem(id: string, qty = 1): void {
  const data = load();
  data.inventory[id] = (data.inventory[id] ?? 0) + qty;
  persist(data);
}

export function spendItem(id: string): boolean {
  const data = load();
  const qty = data.inventory[id] ?? 0;
  if (qty <= 0) return false;
  data.inventory[id] = qty - 1;
  persist(data);
  return true;
}

export function purchaseItem(id: string): boolean {
  const def = ITEM_DEFS.find(d => d.id === id);
  if (!def) return false;
  const data = load();
  if (data.balance < def.cost) return false;
  data.balance -= def.cost;
  data.inventory[id] = (data.inventory[id] ?? 0) + 1;
  persist(data);
  return true;
}

// ── Placed items (per heap) ──────────────────────────────────────────────────

export function getPlaced(heapId: string): PlacedItemSave[] {
  return [...(load().placed[heapId] ?? [])];
}

export function addPlaced(heapId: string, item: PlacedItemSave): void {
  const data = load();
  if (!data.placed[heapId]) data.placed[heapId] = [];
  data.placed[heapId].push(item);
  persist(data);
}

export function removePlaced(heapId: string, index: number): void {
  const data = load();
  const list = data.placed[heapId];
  if (!list) return;
  list.splice(index, 1);
  persist(data);
}

export function updatePlacedMeta(heapId: string, index: number, meta: Record<string, number>): void {
  const data = load();
  const list = data.placed[heapId];
  if (!list || !list[index]) return;
  list[index].meta = meta;
  persist(data);
}

export function removeExpiredPlaced(heapId: string): void {
  const data = load();
  const list = data.placed[heapId];
  if (!list) return;
  data.placed[heapId] = list.filter(p => {
    if (p.meta?.spawnsLeft !== undefined) return p.meta.spawnsLeft > 0;
    return true;
  });
  persist(data);
}

// ── Legacy migration handoff ─────────────────────────────────────────────────

export function finalizeLegacyPlaced(heapId: string): void {
  const data = load();
  if (!data._legacyPlaced || data._legacyPlaced.length === 0) {
    if (data._legacyPlaced) {
      delete data._legacyPlaced;
      persist(data);
    }
    return;
  }
  const existing = data.placed[heapId] ?? [];
  data.placed[heapId] = [...existing, ...data._legacyPlaced];
  delete data._legacyPlaced;
  persist(data);
}

// ── Reset ─────────────────────────────────────────────────────────────────────

export function resetAllData(): void {
  _cache = null;
  localStorage.removeItem(SAVE_KEY);
}

// ── Player config ─────────────────────────────────────────────────────────────

export interface PlayerConfig {
  maxAirJumps:         number;
  wallJump:            boolean;
  dash:                boolean;
  dive:                boolean;
  moneyMultiplier:     number;
  jumpBoost:           number;
  stompBonus:          number;
  peakMultiplier:      number;
  maxWalkableSlopeDeg: number;
}

export function getPlayerConfig(): PlayerConfig {
  const jl = getUpgradeLevel('jump_boost');
  const sl = getUpgradeLevel('stomp_gold');
  const pl = getUpgradeLevel('peak_hunter');
  return {
    maxAirJumps:         1 + getUpgradeLevel('air_jump'),
    wallJump:            getUpgradeLevel('wall_jump') > 0,
    dash:                getUpgradeLevel('dash') > 0,
    dive:                getUpgradeLevel('dive') > 0,
    moneyMultiplier:     1 + getUpgradeLevel('money_mult') * 0.1,
    jumpBoost:           [0, 70, 150, 240][jl],
    stompBonus:          [25, 50, 90, 150][sl],
    peakMultiplier:      [1.25, 1.40, 1.60, 1.85][pl],
    maxWalkableSlopeDeg: MAX_WALKABLE_SLOPE_DEG + getUpgradeLevel('mountain_climber') * MOUNTAIN_CLIMBER_INCREMENT,
  };
}

// ── Player identity ───────────────────────────────────────────────────────────

export function getPlayerGuid(): string { return load().playerGuid; }
export function getPlayerName(): string { return load().playerName; }

export function setPlayerName(name: string): void {
  const trimmed = name.trim().slice(0, 20);
  if (!trimmed) return;
  const data = load();
  data.playerName = trimmed;
  persist(data);
}

// ── Selected heap ────────────────────────────────────────────────────────────

export function getSelectedHeapId(): string { return load().selectedHeapId; }

export function setSelectedHeapId(id: string): void {
  const data = load();
  data.selectedHeapId = id;
  persist(data);
}

// ── High scores ───────────────────────────────────────────────────────────────

export function getLocalHighScore(heapId: string): number {
  return load().highScores[heapId] ?? 0;
}

export function setLocalHighScore(heapId: string, score: number): void {
  const data = load();
  data.highScores[heapId] = score;
  persist(data);
}

// ── Test helpers ──────────────────────────────────────────────────────────────

export function resetCacheForTests(): void { _cache = null; }
export function getLegacyPlacedForTests(): PlacedItemSave[] | undefined { return load()._legacyPlaced; }
export function getSchemaVersionForTests(): number { return load().schemaVersion; }
```

### Step 3.4: Run SaveData tests

- [ ] Run: `npx vitest run src/systems/__tests__/SaveData.test.ts`
- [ ] Expected: PASS.

### Step 3.5: Run the full test suite

- [ ] Run: `npm test -- --run`
- [ ] Expected: Some callsites still fail to compile because `getPlaced()` now requires a `heapId`. Each failing file will be fixed in Task 5. To get the suite green at this checkpoint, temporarily leave the callsite updates for Task 5 — if type-check blocks tests, proceed to Task 5 before running the full suite. Otherwise mark this step as "expected partial fails, fixed in Task 5" and move on.

### Step 3.6: Commit (SaveData + BootScene + HeapClient together)

- [ ] `git add src/systems/SaveData.ts src/systems/__tests__/SaveData.test.ts src/systems/HeapClient.ts src/systems/__tests__/HeapClient.test.ts src/scenes/BootScene.ts`
- [ ] `git commit -m "feat(client): schemaVersion 2 save, per-heap placed, heap catalog in BootScene"`

---

## Task 4: HeapSelectScene + MenuScene button + finalizeLegacyPlaced

**Files:**
- Create: `src/ui/DifficultyStars.ts`
- Create: `src/scenes/HeapSelectScene.ts`
- Modify: `src/scenes/MenuScene.ts`
- Modify: `src/scenes/BootScene.ts`
- Modify: `src/main.ts` (scene registration)

### Step 4.1: DifficultyStars helper

- [ ] Create `src/ui/DifficultyStars.ts`:

```ts
import Phaser from 'phaser';

const STAR_FILLED = '\u2605';  // ★
const STAR_HALF   = '\u2BE8';  // partial fallback — renders as half-star-like glyph
const STAR_EMPTY  = '\u2606';  // ☆

export function formatDifficulty(d: number): string {
  const full = Math.floor(d);
  const half = (d - full) >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return STAR_FILLED.repeat(full) + (half ? STAR_HALF : '') + STAR_EMPTY.repeat(empty);
}

export function drawDifficulty(
  scene: Phaser.Scene,
  x: number,
  y: number,
  d: number,
  fontSize = 18,
): Phaser.GameObjects.Text {
  return scene.add.text(x, y, formatDifficulty(d), {
    fontSize: `${fontSize}px`,
    color: '#ff9922',
    stroke: '#000000',
    strokeThickness: 2,
  }).setOrigin(0, 0.5);
}
```

### Step 4.2: Create HeapSelectScene

- [ ] Create `src/scenes/HeapSelectScene.ts`:

```ts
import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../constants';
import type { HeapSummary } from '../../shared/heapTypes';
import { DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';
import { setSelectedHeapId, finalizeLegacyPlaced } from '../systems/SaveData';
import { HeapClient } from '../systems/HeapClient';
import { drawDifficulty } from '../ui/DifficultyStars';

const ROW_H = 72;
const ROW_PAD_X = 16;

export class HeapSelectScene extends Phaser.Scene {
  constructor() { super({ key: 'HeapSelectScene' }); }

  create(): void {
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0b0c1a);

    this.add.text(GAME_WIDTH / 2, 36, 'SELECT A HEAP', {
      fontSize: '22px', fontStyle: 'bold', color: '#ffffff',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5);

    const close = this.add.text(GAME_WIDTH - 24, 36, '\u2715', {
      fontSize: '22px', color: '#aaaaaa',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    close.on('pointerup', () => this.scene.start('MenuScene'));

    const catalog = (this.game.registry.get('heapCatalog') as HeapSummary[] | undefined) ?? [];

    if (catalog.length === 0) {
      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2,
        'No heaps available — check connection', {
        fontSize: '16px', color: '#8899aa',
        stroke: '#000000', strokeThickness: 2,
        align: 'center', wordWrap: { width: GAME_WIDTH - 40 },
      }).setOrigin(0.5);
      return;
    }

    const sorted = [...catalog].sort((a, b) =>
      a.params.difficulty - b.params.difficulty
      || a.createdAt.localeCompare(b.createdAt));

    const activeId = this.game.registry.get('activeHeapId') as string;
    const listTop = 80;

    sorted.forEach((heap, i) => {
      const y = listTop + i * ROW_H;
      this.drawRow(heap, y, heap.id === activeId);
    });
  }

  private drawRow(heap: HeapSummary, y: number, active: boolean): void {
    const stripe = (Math.floor(y / ROW_H) % 2 === 0) ? 0x141629 : 0x0f1020;
    const rowBg = this.add.rectangle(GAME_WIDTH / 2, y + ROW_H / 2, GAME_WIDTH - 2 * ROW_PAD_X, ROW_H - 4, stripe)
      .setStrokeStyle(active ? 2 : 0, 0xff9922)
      .setInteractive({ useHandCursor: true });

    this.add.text(ROW_PAD_X + 8, y + 18, heap.params.name, {
      fontSize: '18px', fontStyle: 'bold', color: '#ffffff',
      stroke: '#000000', strokeThickness: 2,
    });

    drawDifficulty(this, ROW_PAD_X + 8, y + 48, heap.params.difficulty, 16);

    // Right column: spawn (rat icon + ×N), coin, score
    const rightX = GAME_WIDTH - ROW_PAD_X - 8;

    const rat = this.add.image(rightX - 80, y + 26, 'rat')
      .setOrigin(1, 0.5)
      .setScale(0.8)
      .setCrop(0, 0, 32, 32);       // crop to a single frame if spritesheet
    this.add.text(rightX - 72, y + 20, `${heap.params.spawnRateMult}\u00D7`, {
      fontSize: '13px', color: '#ffcc88', stroke: '#000000', strokeThickness: 2,
    });

    this.add.text(rightX, y + 40, `COIN ${heap.params.coinMult}\u00D7`, {
      fontSize: '13px', color: '#ffdd77', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(1, 0.5);

    this.add.text(rightX, y + 58, `SCORE ${heap.params.scoreMult}\u00D7`, {
      fontSize: '13px', color: '#88ddff', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(1, 0.5);

    rowBg.on('pointerup', () => this.select(heap));
  }

  private select(heap: HeapSummary): void {
    setSelectedHeapId(heap.id);
    this.game.registry.set('activeHeapId', heap.id);
    this.game.registry.set('heapParams',   heap.params);

    HeapClient.load(heap.id).then((polygon) => {
      this.game.registry.set('heapPolygon', polygon);
    }).finally(() => {
      finalizeLegacyPlaced(heap.id);
      this.scene.start('MenuScene');
    });
  }
}
```

### Step 4.3: Register HeapSelectScene

- [ ] Edit `src/main.ts`. Find the `scene: [...]` array in the Phaser config and add `HeapSelectScene` between `MenuScene` and the scene(s) that follow it:

```ts
import { HeapSelectScene } from './scenes/HeapSelectScene';
// ...
scene: [BootScene, MenuScene, HeapSelectScene, GameScene, ScoreScene, UpgradeScene, StoreScene, TexturePreviewScene],
```
(Match the existing array order; just add `HeapSelectScene` to the list.)

### Step 4.4: Add MenuScene heap picker

- [ ] Edit `src/scenes/MenuScene.ts`. Add imports near the top:

```ts
import type { HeapParams } from '../../shared/heapTypes';
import { DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';
import { formatDifficulty } from '../ui/DifficultyStars';
```

Add a class field alongside the other buttons:

```ts
private heapPickerBg!: Phaser.GameObjects.Graphics;
private heapPickerText!: Phaser.GameObjects.Text;
```

Add a new method after `createPrompts`:

```ts
private createHeapPicker(): void {
  const params = (this.game.registry.get('heapParams') as HeapParams | undefined) ?? DEFAULT_HEAP_PARAMS;

  this.heapPickerBg = this.add.graphics().setDepth(8).setAlpha(0);
  this.heapPickerBg.fillStyle(0x000000, 0.5);
  this.heapPickerBg.fillRoundedRect(GAME_WIDTH / 2 - 160, 480, 320, 48, 10);
  this.heapPickerBg.lineStyle(1, 0x8899bb, 0.6);
  this.heapPickerBg.strokeRoundedRect(GAME_WIDTH / 2 - 160, 480, 320, 48, 10);

  const label = `\u25BE ${params.name}  ${formatDifficulty(params.difficulty)}`;
  this.heapPickerText = this.add.text(GAME_WIDTH / 2, 504, label, {
    fontSize: '16px',
    color: '#ffffff',
    stroke: '#000000',
    strokeThickness: 2,
  }).setOrigin(0.5).setAlpha(0).setDepth(9);

  this.heapPickerText.setInteractive(
    new Phaser.Geom.Rectangle(-160, -24, 320, 48),
    Phaser.Geom.Rectangle.Contains,
  );
  this.heapPickerText.on('pointerup', () => this.scene.start('HeapSelectScene'));
}
```

Call it from `create()`, right after `createPrompts(im)`:

```ts
this.createHeapPicker();
```

Fade it in at the end of `runEntranceSequence`:

```ts
this.tweens.add({ targets: [this.heapPickerBg, this.heapPickerText], alpha: 1, duration: 300, delay: 1600 });
```

### Step 4.5: BootScene — call finalizeLegacyPlaced after default pick

- [ ] Edit `src/scenes/BootScene.ts`. In the `HeapClient.list().then(...)` block (from Task 2 Step 2.5), after `setSelectedHeapId(pick.id)`, call:

```ts
finalizeLegacyPlaced(pick.id);
```

Add the import at the top:

```ts
import { getSelectedHeapId, setSelectedHeapId, finalizeLegacyPlaced } from '../systems/SaveData';
```

### Step 4.6: Manual smoke test

- [ ] Run: `npm run dev` and then `curl -sS http://localhost:3000 > /dev/null || echo "dev server not responding"`
- [ ] In a browser, verify:
  - Menu renders with the heap picker button above START RUN showing the current heap name and difficulty.
  - Tapping the picker opens HeapSelectScene with rows sorted by difficulty.
  - Tapping a row returns to menu with the new heap name shown.
- [ ] If the UI looks broken, **do not proceed** — fix visuals in this task.

### Step 4.7: Commit

- [ ] `git add src/ui/DifficultyStars.ts src/scenes/HeapSelectScene.ts src/scenes/MenuScene.ts src/scenes/BootScene.ts src/main.ts`
- [ ] `git commit -m "feat(client): HeapSelectScene + MenuScene picker + legacy placeable migration"`

---

## Task 5: Per-heap placed callsite updates

**Files:**
- Modify: `src/scenes/GameScene.ts`
- Modify: `src/systems/PlaceableManager.ts`
- Modify: `src/scenes/MenuScene.ts` (checkpoint check)
- Modify any other file that imports `getPlaced`, `addPlaced`, `removePlaced`, `updatePlacedMeta`, `removeExpiredPlaced`.

### Step 5.1: Identify callsites

- [ ] Run: `npx grep -rn "getPlaced\|addPlaced\|removePlaced\|updatePlacedMeta\|removeExpiredPlaced" src/`
- [ ] Make a list of every hit. Expected files: `GameScene.ts`, `MenuScene.ts`, `PlaceableManager.ts`. If other files appear, include them below.

### Step 5.2: Thread heapId through PlaceableManager

- [ ] Edit `src/systems/PlaceableManager.ts`. Change its constructor (or `init`, depending on current shape) to accept a `heapId: string` and store it as `private _heapId`. Replace every SaveData call as follows:
  - `getPlaced()` → `getPlaced(this._heapId)`
  - `addPlaced(item)` → `addPlaced(this._heapId, item)`
  - `removePlaced(i)` → `removePlaced(this._heapId, i)`
  - `updatePlacedMeta(i, meta)` → `updatePlacedMeta(this._heapId, i, meta)`
  - `removeExpiredPlaced()` → `removeExpiredPlaced(this._heapId)`

### Step 5.3: Update GameScene callsites

- [ ] Edit `src/scenes/GameScene.ts`. In `init` or `create`, after `this._heapId = heapId;`, pass `this._heapId` into `PlaceableManager` construction/init. Also update any direct calls to `getPlaced(...)` / `removeExpiredPlaced(...)` inside `GameScene` itself to pass `this._heapId`.

### Step 5.4: Update MenuScene checkpoint check

- [ ] Edit `src/scenes/MenuScene.ts`. Change the checkpoint check in `registerInput`:

```ts
const startGame = (): void => {
  const activeHeapId = (this.game.registry.get('activeHeapId') as string) ?? '';
  const hasCheckpoint = getPlaced(activeHeapId).some(
    p => p.id === 'checkpoint' && (p.meta?.spawnsLeft ?? 0) > 0,
  );
  this.scene.start('GameScene', hasCheckpoint ? { useCheckpoint: true } : undefined);
};
```

### Step 5.5: Typecheck + full test run

- [ ] Run: `npx tsc --noEmit`
- [ ] Expected: no errors.
- [ ] Run: `npm test -- --run`
- [ ] Expected: all green.

### Step 5.6: Manual smoke test

- [ ] Run: `npm run dev`
- [ ] Verify: placing an item on Heap A persists, switching to Heap B shows none of A's items. Switching back to A restores A's items.

### Step 5.7: Commit

- [ ] `git add -A src/`
- [ ] `git commit -m "feat(client): per-heap placeables thread heapId through GameScene + PlaceableManager"`

---

## Task 6: Runtime multipliers — spawn, coin, score

**Files:**
- Modify: `src/systems/EnemyManager.ts`
- Modify: `src/systems/__tests__/EnemyManager.test.ts`
- Modify: `src/systems/buildRunScore.ts`
- Modify: `src/systems/__tests__/buildRunScore.test.ts`
- Modify: `src/scenes/GameScene.ts`
- Modify: `src/scenes/ScoreScene.ts`

### Step 6.1: scoreMult test + buildRunScore update

- [ ] Edit `src/systems/__tests__/buildRunScore.test.ts`. Append:

```ts
describe('buildRunScore scoreMult', () => {
  it('multiplies finalScore by scoreMult', () => {
    const stats = { baseHeightPx: 1000, kills: {}, elapsedMs: 10_000 };
    const defs = {} as any;
    const a = buildRunScore(stats, defs, false, 1.0);
    const b = buildRunScore(stats, defs, false, 2.0);
    expect(b.finalScore).toBe(Math.round(a.finalScore * 2));
  });

  it('defaults to 1.0 when omitted', () => {
    const stats = { baseHeightPx: 500, kills: {}, elapsedMs: 5_000 };
    const defs = {} as any;
    const r = buildRunScore(stats, defs, false);
    expect(r.finalScore).toBeGreaterThan(0);
  });
});
```

- [ ] Run: `npx vitest run src/systems/__tests__/buildRunScore.test.ts` — FAIL.

- [ ] Edit `src/systems/buildRunScore.ts`. Change the signature and final total:

```ts
export function buildRunScore(
  stats:     RunStats,
  defs:      Record<EnemyKind, EnemyDef>,
  isFailure: boolean,
  scoreMult: number = 1.0,
): RunScoreResult {
  // ... existing body ...
  return { rows, finalScore: Math.round(total * scoreMult) };
}
```

- [ ] Run: `npx vitest run src/systems/__tests__/buildRunScore.test.ts` — PASS.

### Step 6.2: spawnRateMult test + EnemyManager update

- [ ] Edit `src/systems/__tests__/EnemyManager.test.ts`. Append:

```ts
describe('spawnChance with spawnRateMult', () => {
  it('spawnRateMult scales the chance linearly and clamps at 1', () => {
    const def: any = {
      spawnStartY: 0,
      spawnEndY: -1,
      spawnRampEndY: -1,
      spawnChanceMin: 0.2,
      spawnChanceMax: 0.2,
    };
    expect(spawnChance(def, -100)).toBeCloseTo(0.2);

    expect(scaleSpawnChance(spawnChance(def, -100)!, 2)).toBeCloseTo(0.4);
    expect(scaleSpawnChance(spawnChance(def, -100)!, 10)).toBe(1);
    expect(scaleSpawnChance(spawnChance(def, -100)!, 0.5)).toBeCloseTo(0.1);
  });
});
```

Also add to the imports of that file: `scaleSpawnChance`.

- [ ] Edit `src/systems/EnemyManager.ts`. Export a helper and use it inside `trySpawn`:

```ts
export function scaleSpawnChance(chance: number, mult: number): number {
  return Math.max(0, Math.min(1, chance * mult));
}
```

Update the `EnemyManager` class:

```ts
export class EnemyManager {
  readonly group: Phaser.Physics.Arcade.Group;
  private readonly scene: Phaser.Scene;
  private heapPolygon: Vertex[] = [];
  private spawnRateMult: number;

  constructor(scene: Phaser.Scene, spawnRateMult: number = 1.0) {
    this.scene = scene;
    this.group = scene.physics.add.group();
    this.spawnRateMult = spawnRateMult;
  }

  // ... setPolygon, onPlatformSpawned, etc. unchanged ...
```

Find the block at around line 227 of `EnemyManager.ts`:

```ts
const chance = spawnChance(def, y);
if (chance === null) return;
if (Math.random() >= chance) return;
```

Replace with:

```ts
const rawChance = spawnChance(def, y);
if (rawChance === null) return;
const chance = scaleSpawnChance(rawChance, this.spawnRateMult);
if (Math.random() >= chance) return;
```

- [ ] Run: `npx vitest run src/systems/__tests__/EnemyManager.test.ts` — PASS.

### Step 6.3: Wire spawnRateMult from GameScene

- [ ] Edit `src/scenes/GameScene.ts`. In `init`/`create`, where `this.enemyManager = new EnemyManager(this);` is constructed, replace with:

```ts
const heapParams = (this.game.registry.get('heapParams') as HeapParams | undefined) ?? DEFAULT_HEAP_PARAMS;
this._heapParams = heapParams;
this.enemyManager = new EnemyManager(this, heapParams.spawnRateMult);
```

Add class field and imports:

```ts
import type { HeapParams } from '../../shared/heapTypes';
import { DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';
// ...
private _heapParams!: HeapParams;
```

### Step 6.4: Apply coinMult at coin-award sites

- [ ] In `GameScene.ts`, find every call to `addBalance(...)` that awards **run-earned** coins (stomps, pickups). Wrap:

```ts
addBalance(Math.round(base * this._heapParams.coinMult));
```

Leave store refunds / upgrade flows alone (those are in `StoreScene.ts` / `UpgradeScene.ts`).

- [ ] Run: `npx grep -n "addBalance" src/scenes/GameScene.ts src/systems/EnemyManager.ts` to locate every callsite. For each, decide: is this a run-earned coin? If yes, apply `coinMult`. If no, leave.

- [ ] If `EnemyManager` calls `addBalance` directly, plumb `coinMult` through its constructor too (same pattern as `spawnRateMult`) or have `EnemyManager` emit events and `GameScene` apply the mult.

### Step 6.5: Pass scoreMult into buildRunScore

- [ ] In `GameScene.ts`, find the `buildRunScore(stats, ENEMY_DEFS, isFailure)` call. Change to:

```ts
buildRunScore(stats, ENEMY_DEFS, isFailure, this._heapParams.scoreMult);
```

### Step 6.6: ScoreScene breakdown rows

- [ ] Edit `src/scenes/ScoreScene.ts`. In the scene-data payload accepted by `init`, add `heapParams: HeapParams` alongside existing fields. When `GameScene` launches `ScoreScene`, pass `heapParams: this._heapParams` in the data object.

- [ ] In `ScoreScene`'s breakdown render, after the existing rows, add two more if the mults are not 1.0:

```ts
if (this._heapParams.coinMult !== 1.0) {
  this.renderBreakdownRow(`Coin Mult`, `\u00D7${this._heapParams.coinMult}`);
}
if (this._heapParams.scoreMult !== 1.0) {
  this.renderBreakdownRow(`Score Mult`, `\u00D7${this._heapParams.scoreMult}`);
}
```

Adapt to match the existing `renderBreakdownRow` helper or equivalent code in `ScoreScene`. If the helper isn't named `renderBreakdownRow`, use whatever method currently creates a row — inspect `ScoreScene.ts` and mirror the pattern; the two new rows should read as plain informational lines (no numeric `value` to add to the total).

### Step 6.7: Full test + typecheck

- [ ] Run: `npx tsc --noEmit`
- [ ] Run: `npm test -- --run`
- [ ] Expected: all green.

### Step 6.8: Manual end-to-end smoke test

- [ ] Seed two heaps locally with different mults:

```
NAME="Easy" DIFFICULTY=1 SPAWN_MULT=1 COIN_MULT=1 SCORE_MULT=1 npm run seed
NAME="Hard" DIFFICULTY=4 SPAWN_MULT=2 COIN_MULT=1.5 SCORE_MULT=2 npm run seed
```

- [ ] Run: `npm run dev`
- [ ] Play a run on "Easy", record score and coins earned. Play a similar run on "Hard", verify: enemies spawn ~2× as often; coins earned per stomp visibly higher; final score on score screen shows `Coin Mult ×1.5` and `Score Mult ×2` rows and the total is doubled. Leaderboard submission uses the multiplied score.

### Step 6.9: Commit

- [ ] `git add -A src/`
- [ ] `git commit -m "feat: apply heap spawn/coin/score mults at runtime + ScoreScene breakdown rows"`

---

## Done

All six rollout steps from the spec are complete: server params + validation, shared types, save migration, selector UI, per-heap placeables, runtime multipliers. The branch `feature/Multi-heap` is ready for a final test sweep and PR.

Final verification before merge:
- [ ] `npm test -- --run` green
- [ ] `cd server && npm test -- --run` green
- [ ] `npx tsc --noEmit` clean
- [ ] Manual smoke of both heaps (Task 6.8) passed
- [ ] Legacy-placed items migrated onto the default heap (load a v1 save, confirm items appear on easiest heap)

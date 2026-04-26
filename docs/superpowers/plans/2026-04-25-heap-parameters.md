# Heap Parameters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace world-height-relative enemy spawn fraction fields with absolute px-above-floor values stored per-heap in a new `heap_parameters` D1 table, served via `GET /heaps/:id`, and managed via new admin API endpoints + a minimal admin HTML page.

**Architecture:** A new `heap_parameters` table (one row per heap, JSON blob for enemy spawn params) with a sentinel row (`00000000-0000-0000-0000-000000000000`) as the default fallback. The server resolves and inlines enemy params into the existing `GET /heaps/:id` response (`changed: true` branch). The client caches params alongside the polygon in localStorage and passes them to `EnemyManager` via a new `setEnemyParams()` method, replacing the old `spawnStartFrac` / `spawnEndFrac` / `spawnRampEndFrac` fraction fields on `EnemyDef`.

**Tech Stack:** Cloudflare D1 (SQLite), Hono, TypeScript, Vitest, Phaser 3

---

## File Map

| File | Change |
|---|---|
| `server/schema.sql` | Add `heap_parameters` table |
| `shared/heapTypes.ts` | Add `EnemySpawnParams`, `HeapEnemyParams`, update `GetHeapResponse` |
| `server/src/db.ts` | Add `getEnemyParams` / `upsertEnemyParams` to `HeapDB` interface + `D1HeapDB` |
| `server/tests/helpers/mockDb.ts` | Implement new methods in `MockHeapDB`, seed sentinel in constructor |
| `server/src/routes/heap.ts` | Add `GET/PUT /:id/enemy-params`, include `enemyParams` in `GET /:id` |
| `server/tests/routes.test.ts` | Tests for new routes + `GET /heaps/:id` enemyParams |
| `src/systems/EnemySpawnMath.ts` | Rewrite `spawnChance(params, pxAboveFloor)` |
| `src/systems/__tests__/EnemySpawnMath.test.ts` | Replace fraction-based spawnChance tests |
| `src/systems/__tests__/EnemyManager.test.ts` | Update barrel re-export spawnChance tests |
| `src/data/enemyDefs.ts` | Remove 3 fraction fields from `EnemyDef` + `ENEMY_DEFS`; add `DEFAULT_ENEMY_PARAMS` |
| `src/systems/__tests__/buildRunScore.test.ts` | Remove fraction fields from test defs |
| `src/systems/EnemyManager.ts` | Add `setEnemyParams()`, update `trySpawn` to use per-kind params |
| `src/systems/HeapClient.ts` | Cache `enemyParams` in `HeapCache`, add `getEnemyParams()` |
| `src/systems/__tests__/HeapClient.test.ts` | Add test: `getEnemyParams` returns cached value after `load()` |
| `src/scenes/GameScene.ts` | Call `setEnemyParams` on `EnemyManager` |
| `src/scenes/InfiniteGameScene.ts` | Call `setEnemyParams(DEFAULT_ENEMY_PARAMS)` on each `EnemyManager` |
| `admin/enemy-params.html` | Create — standalone admin UI |

---

### Task 1: Add `heap_parameters` table to schema

**Files:**
- Modify: `server/schema.sql`

- [ ] **Step 1: Add table + sentinel insert to schema.sql**

Append to the end of `server/schema.sql`:

```sql
-- Enemy spawn params — one row per heap. Sentinel row provides defaults.
CREATE TABLE IF NOT EXISTS heap_parameters (
  heap_id      TEXT PRIMARY KEY,
  enemy_params TEXT NOT NULL DEFAULT '{}'
);

-- Sentinel row — default enemy params used when a heap has no specific row.
-- heap_id = all-zeros GUID. INSERT OR IGNORE so re-running the schema is safe.
INSERT OR IGNORE INTO heap_parameters (heap_id, enemy_params) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '{"percher":{"spawnStartPxAboveFloor":0,"spawnEndPxAboveFloor":-1,"spawnRampPxAboveFloor":15000,"spawnChanceMin":0.15,"spawnChanceMax":0.45},"ghost":{"spawnStartPxAboveFloor":5000,"spawnEndPxAboveFloor":-1,"spawnRampPxAboveFloor":20000,"spawnChanceMin":0.10,"spawnChanceMax":0.35}}'
);
```

- [ ] **Step 2: Apply schema to local D1**

```bash
cd /home/connor/Documents/Repos/HeapGame
npx wrangler d1 execute heap-db --local --file=server/schema.sql
```

Expected: `✅ Executed...` with no errors.

- [ ] **Step 3: Commit**

```bash
git add server/schema.sql
git commit -m "feat: add heap_parameters table with sentinel default row"
```

---

### Task 2: Add shared types

**Files:**
- Modify: `shared/heapTypes.ts`

- [ ] **Step 1: Add `EnemySpawnParams`, `HeapEnemyParams`, update `GetHeapResponse`**

In `shared/heapTypes.ts`, add after the `DEFAULT_HEAP_PARAMS` block and before the `CreateHeapRequest` section:

```typescript
// ── Enemy spawn params (served per-heap, replaces EnemyDef fraction fields) ──

export type EnemySpawnParams = {
  spawnStartPxAboveFloor: number;  // enemy does not appear below this many px above floor
  spawnEndPxAboveFloor: number;    // enemy does not appear above this height; -1 = no ceiling
  spawnRampPxAboveFloor: number;   // height at which spawnChanceMax is reached; -1 = flat at min
  spawnChanceMin: number;
  spawnChanceMax: number;
};

export type HeapEnemyParams = Record<string, EnemySpawnParams>;
```

Then update `GetHeapResponse` (replace the existing type):

```typescript
export type GetHeapResponse =
  | { changed: false; version: number }
  | { changed: true; version: number; baseId: string; liveZone: Vertex[]; params: HeapParams; enemyParams: HeapEnemyParams };
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/connor/Documents/Repos/HeapGame
npx tsc --noEmit
```

Expected: no errors relating to the new types (there will be downstream errors in later tasks — that's expected at this stage).

- [ ] **Step 3: Commit**

```bash
git add shared/heapTypes.ts
git commit -m "feat: add EnemySpawnParams, HeapEnemyParams types; update GetHeapResponse"
```

---

### Task 3: DB interface + D1 implementation + MockHeapDB

**Files:**
- Modify: `server/src/db.ts`
- Modify: `server/tests/helpers/mockDb.ts`

- [ ] **Step 1: Add methods to `HeapDB` interface and implement in `D1HeapDB`**

In `server/src/db.ts`, add imports at the top:

```typescript
import { HeapParams, Vertex, HeapEnemyParams } from '../../shared/heapTypes';
```

(Replace the existing two-line import of `HeapParams, Vertex` and `DEFAULT_HEAP_PARAMS` with a single import that adds `HeapEnemyParams`.)

Add these two methods to the `HeapDB` interface:

```typescript
getEnemyParams(heapId: string): Promise<HeapEnemyParams>;
upsertEnemyParams(heapId: string, params: HeapEnemyParams): Promise<void>;
```

Add these two method implementations to `D1HeapDB`:

```typescript
async getEnemyParams(heapId: string): Promise<HeapEnemyParams> {
  const row = await this.d1
    .prepare('SELECT enemy_params FROM heap_parameters WHERE heap_id = ?1')
    .bind(heapId)
    .first<{ enemy_params: string }>();
  if (row) return JSON.parse(row.enemy_params) as HeapEnemyParams;

  const sentinel = await this.d1
    .prepare("SELECT enemy_params FROM heap_parameters WHERE heap_id = '00000000-0000-0000-0000-000000000000'")
    .first<{ enemy_params: string }>();
  return sentinel ? (JSON.parse(sentinel.enemy_params) as HeapEnemyParams) : {};
}

async upsertEnemyParams(heapId: string, params: HeapEnemyParams): Promise<void> {
  await this.d1
    .prepare(
      `INSERT INTO heap_parameters (heap_id, enemy_params) VALUES (?1, ?2)
       ON CONFLICT (heap_id) DO UPDATE SET enemy_params = excluded.enemy_params`,
    )
    .bind(heapId, JSON.stringify(params))
    .run();
}
```

- [ ] **Step 2: Update `MockHeapDB` to implement new methods**

In `server/tests/helpers/mockDb.ts`, add `HeapEnemyParams` to the imports:

```typescript
import type { HeapParams, Vertex, HeapEnemyParams } from '../../../shared/heapTypes';
```

Add a private field and constructor to `MockHeapDB`:

```typescript
private enemyParams = new Map<string, string>();

constructor() {
  const SENTINEL = '00000000-0000-0000-0000-000000000000';
  const sentinelParams: HeapEnemyParams = {
    percher: { spawnStartPxAboveFloor: 0, spawnEndPxAboveFloor: -1, spawnRampPxAboveFloor: 15000, spawnChanceMin: 0.15, spawnChanceMax: 0.45 },
    ghost:   { spawnStartPxAboveFloor: 5000, spawnEndPxAboveFloor: -1, spawnRampPxAboveFloor: 20000, spawnChanceMin: 0.10, spawnChanceMax: 0.35 },
  };
  this.enemyParams.set(SENTINEL, JSON.stringify(sentinelParams));
}
```

Add the two method implementations to `MockHeapDB`:

```typescript
async getEnemyParams(heapId: string): Promise<HeapEnemyParams> {
  const SENTINEL = '00000000-0000-0000-0000-000000000000';
  const raw = this.enemyParams.get(heapId) ?? this.enemyParams.get(SENTINEL) ?? '{}';
  return JSON.parse(raw) as HeapEnemyParams;
}

async upsertEnemyParams(heapId: string, params: HeapEnemyParams): Promise<void> {
  this.enemyParams.set(heapId, JSON.stringify(params));
}
```

Also add a test helper for seeding enemy params directly in tests:

```typescript
seedEnemyParams(heapId: string, params: HeapEnemyParams): void {
  this.enemyParams.set(heapId, JSON.stringify(params));
}
```

- [ ] **Step 3: Run server tests to confirm no regressions**

```bash
cd /home/connor/Documents/Repos/HeapGame/server
npm test
```

Expected: all existing tests pass.

- [ ] **Step 4: Commit**

```bash
cd /home/connor/Documents/Repos/HeapGame
git add server/src/db.ts server/tests/helpers/mockDb.ts
git commit -m "feat: add getEnemyParams/upsertEnemyParams to HeapDB + MockHeapDB"
```

---

### Task 4: Admin routes `GET/PUT /heaps/:id/enemy-params` (TDD)

**Files:**
- Modify: `server/tests/routes.test.ts`
- Modify: `server/src/routes/heap.ts`

- [ ] **Step 1: Write failing tests for `GET /heaps/:id/enemy-params`**

In `server/tests/routes.test.ts`, add these imports if not already present:

```typescript
import type { HeapEnemyParams } from '../../shared/heapTypes';
```

Add a new describe block at the end of the file:

```typescript
// ── GET /heaps/:id/enemy-params ──────────────────────────────────────────────

describe('GET /heaps/:id/enemy-params', () => {
  it('returns 404 for unknown heap', async () => {
    const res = await makeApp().request('/heaps/nonexistent/enemy-params');
    expect(res.status).toBe(404);
  });

  it('returns sentinel params when no heap-specific row exists', async () => {
    const app = makeApp();
    // Create a heap (MockHeapDB seeds sentinel automatically)
    const createRes = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    const { id } = await createRes.json() as { id: string };

    const res = await app.request(`/heaps/${id}/enemy-params`);
    expect(res.status).toBe(200);
    const body = await res.json() as HeapEnemyParams;
    expect(body.percher).toBeDefined();
    expect(body.ghost).toBeDefined();
    expect(body.percher.spawnChanceMin).toBeCloseTo(0.15);
  });

  it('returns heap-specific params when set', async () => {
    const db = new MockHeapDB();
    const app = createApp(db, new MockScoreDB());

    const createRes = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    const { id } = await createRes.json() as { id: string };

    const customParams: HeapEnemyParams = {
      percher: { spawnStartPxAboveFloor: 100, spawnEndPxAboveFloor: -1, spawnRampPxAboveFloor: 5000, spawnChanceMin: 0.5, spawnChanceMax: 0.9 },
    };
    db.seedEnemyParams(id, customParams);

    const res = await app.request(`/heaps/${id}/enemy-params`);
    expect(res.status).toBe(200);
    const body = await res.json() as HeapEnemyParams;
    expect(body.percher.spawnChanceMin).toBeCloseTo(0.5);
    expect(body.ghost).toBeUndefined(); // only percher was set
  });
});

// ── PUT /heaps/:id/enemy-params ──────────────────────────────────────────────

describe('PUT /heaps/:id/enemy-params', () => {
  it('returns 404 for unknown heap', async () => {
    const res = await makeApp().request('/heaps/nonexistent/enemy-params', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it('upserts and returns ok:true', async () => {
    const app = makeApp();
    const createRes = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    const { id } = await createRes.json() as { id: string };

    const params: HeapEnemyParams = {
      percher: { spawnStartPxAboveFloor: 0, spawnEndPxAboveFloor: -1, spawnRampPxAboveFloor: 8000, spawnChanceMin: 0.2, spawnChanceMax: 0.6 },
    };

    const res = await app.request(`/heaps/${id}/enemy-params`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('subsequent GET returns the PUT value', async () => {
    const app = makeApp();
    const createRes = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    const { id } = await createRes.json() as { id: string };

    const params: HeapEnemyParams = {
      ghost: { spawnStartPxAboveFloor: 1000, spawnEndPxAboveFloor: -1, spawnRampPxAboveFloor: 10000, spawnChanceMin: 0.05, spawnChanceMax: 0.3 },
    };
    await app.request(`/heaps/${id}/enemy-params`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const res = await app.request(`/heaps/${id}/enemy-params`);
    const body = await res.json() as HeapEnemyParams;
    expect(body.ghost.spawnStartPxAboveFloor).toBe(1000);
  });

  it('returns 400 for non-object body', async () => {
    const app = makeApp();
    const createRes = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    const { id } = await createRes.json() as { id: string };

    const res = await app.request(`/heaps/${id}/enemy-params`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([1, 2, 3]),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to confirm RED**

```bash
cd /home/connor/Documents/Repos/HeapGame/server
npm test -- --reporter=verbose 2>&1 | grep -E "PASS|FAIL|✓|✗|×" | tail -20
```

Expected: new tests FAIL with 404 (routes not yet registered).

- [ ] **Step 3: Implement routes in `server/src/routes/heap.ts`**

Add these imports at the top (update existing import from `shared/heapTypes`):

```typescript
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
  HeapEnemyParams,
} from '../../../shared/heapTypes';
```

Add the two new routes to `heapRoutes()`, **immediately after the `GET /:id/base` route** (before `GET /:id`):

```typescript
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
```

- [ ] **Step 4: Run tests to confirm GREEN**

```bash
cd /home/connor/Documents/Repos/HeapGame/server
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /home/connor/Documents/Repos/HeapGame
git add server/src/routes/heap.ts server/tests/routes.test.ts
git commit -m "feat: add GET/PUT /heaps/:id/enemy-params admin routes"
```

---

### Task 5: Include `enemyParams` in `GET /heaps/:id` response

**Files:**
- Modify: `server/src/routes/heap.ts`
- Modify: `server/tests/routes.test.ts`

- [ ] **Step 1: Write failing test**

In `server/tests/routes.test.ts`, find the `describe('GET /heaps/:id')` block and add:

```typescript
it('includes enemyParams in changed: true response', async () => {
  const app = makeApp();
  const createRes = await app.request('/heaps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vertices: VERTICES }),
  });
  const { id } = await createRes.json() as CreateHeapResponse;

  const res = await app.request(`/heaps/${id}?version=0`);
  expect(res.status).toBe(200);
  const body = await res.json() as GetHeapResponse;
  expect(body.changed).toBe(true);
  if (body.changed) {
    expect(body.enemyParams).toBeDefined();
    expect(body.enemyParams.percher).toBeDefined();
    expect(body.enemyParams.ghost).toBeDefined();
  }
});
```

- [ ] **Step 2: Run to confirm RED**

```bash
cd /home/connor/Documents/Repos/HeapGame/server
npm test -- --reporter=verbose 2>&1 | grep -E "enemyParams|FAIL|PASS" | head -10
```

Expected: the new test FAILS because `body.enemyParams` is undefined.

- [ ] **Step 3: Update `GET /:id` route to fetch and include `enemyParams`**

In `server/src/routes/heap.ts`, update the `GET /:id` handler. Replace the existing `changed: true` return:

```typescript
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
      name:          row.name,
      difficulty:    row.difficulty,
      spawnRateMult: row.spawn_rate_mult,
      coinMult:      row.coin_mult,
      scoreMult:     row.score_mult,
      worldHeight:   row.world_height,
    },
    enemyParams,
  } satisfies GetHeapResponse);
});
```

- [ ] **Step 4: Run tests to confirm GREEN**

```bash
cd /home/connor/Documents/Repos/HeapGame/server
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /home/connor/Documents/Repos/HeapGame
git add server/src/routes/heap.ts server/tests/routes.test.ts
git commit -m "feat: include enemyParams in GET /heaps/:id changed:true response"
```

---

### Task 6: Rewrite `EnemySpawnMath.spawnChance` (TDD)

**Files:**
- Modify: `src/systems/__tests__/EnemySpawnMath.test.ts`
- Modify: `src/systems/__tests__/EnemyManager.test.ts`
- Modify: `src/systems/EnemySpawnMath.ts`

- [ ] **Step 1: Replace `spawnChance` tests in `EnemySpawnMath.test.ts`**

Replace the entire `spawnChance` describe block (lines 82–146) with:

```typescript
// ---------------------------------------------------------------------------
// spawnChance — absolute px-above-floor values
// pxAboveFloor = worldHeight - y  (computed at call site)
// ---------------------------------------------------------------------------

import type { EnemySpawnParams } from '../../../shared/heapTypes';

const baseParams: EnemySpawnParams = {
  spawnStartPxAboveFloor: 0,      // can spawn from floor upward
  spawnEndPxAboveFloor: -1,       // no ceiling
  spawnRampPxAboveFloor: 40000,   // reaches max at 40000 px above floor
  spawnChanceMin: 0.1,
  spawnChanceMax: 0.5,
};

describe('spawnChance', () => {
  it('returns null below spawnStartPxAboveFloor', () => {
    const params = { ...baseParams, spawnStartPxAboveFloor: 1000 };
    expect(spawnChance(params, 500)).toBeNull();   // 500 px < 1000 px start
  });

  it('returns spawnChanceMin at spawnStartPxAboveFloor', () => {
    expect(spawnChance(baseParams, 0)).toBeCloseTo(0.1);
  });

  it('returns spawnChanceMax at spawnRampPxAboveFloor', () => {
    expect(spawnChance(baseParams, 40000)).toBeCloseTo(0.5);
  });

  it('clamps to spawnChanceMax above the ramp', () => {
    expect(spawnChance(baseParams, 50000)).toBeCloseTo(0.5);
  });

  it('interpolates at midpoint of ramp', () => {
    // t = 20000/40000 = 0.5 → lerp(0.1, 0.5, 0.5) = 0.3
    expect(spawnChance(baseParams, 20000)).toBeCloseTo(0.3);
  });

  it('returns null above spawnEndPxAboveFloor ceiling', () => {
    const params = { ...baseParams, spawnEndPxAboveFloor: 30000 };
    expect(spawnChance(params, 35000)).toBeNull();   // 35000 > ceiling 30000
    expect(spawnChance(params, 20000)).not.toBeNull(); // 20000 < ceiling — ok
  });

  it('returns flat spawnChanceMin when spawnRampPxAboveFloor is -1', () => {
    const params = { ...baseParams, spawnRampPxAboveFloor: -1 };
    expect(spawnChance(params, 0)).toBeCloseTo(0.1);
    expect(spawnChance(params, 50000)).toBeCloseTo(0.1);
  });
});
```

Also update the import at the top of the file: remove `import type { EnemyDef } from '../../data/enemyDefs';` (it is no longer needed in this file once `baseDef` is removed). The `EnemySpawnParams` import added inside the describe block above should be moved to the top of the file.

- [ ] **Step 2: Replace `spawnChance` tests in `EnemyManager.test.ts`**

In `src/systems/__tests__/EnemyManager.test.ts`, replace the `baseDef` variable and the `spawnChance` describe block with:

```typescript
import type { EnemySpawnParams } from '../../../shared/heapTypes';

const baseParams: EnemySpawnParams = {
  spawnStartPxAboveFloor: 0,
  spawnEndPxAboveFloor: -1,
  spawnRampPxAboveFloor: 40000,
  spawnChanceMin: 0.1,
  spawnChanceMax: 0.5,
};

describe('spawnChance (via EnemyManager barrel re-export)', () => {
  it('returns null below start', () => {
    const params = { ...baseParams, spawnStartPxAboveFloor: 1000 };
    expect(spawnChance(params, 500)).toBeNull();
  });

  it('returns spawnChanceMin at floor', () => {
    expect(spawnChance(baseParams, 0)).toBeCloseTo(0.1);
  });

  it('returns spawnChanceMax at ramp end', () => {
    expect(spawnChance(baseParams, 40000)).toBeCloseTo(0.5);
  });

  it('returns flat min when ramp is -1', () => {
    const params = { ...baseParams, spawnRampPxAboveFloor: -1 };
    expect(spawnChance(params, 30000)).toBeCloseTo(0.1);
  });
});
```

Remove the old `import type { EnemyDef } from '../../data/enemyDefs';` line at the top of `EnemyManager.test.ts`.

- [ ] **Step 3: Run tests to confirm RED**

```bash
cd /home/connor/Documents/Repos/HeapGame
npm test src/systems/__tests__/EnemySpawnMath.test.ts src/systems/__tests__/EnemyManager.test.ts
```

Expected: tests FAIL because `spawnChance` still takes `(def, y, worldHeight)`.

- [ ] **Step 4: Rewrite `spawnChance` in `EnemySpawnMath.ts`**

In `src/systems/EnemySpawnMath.ts`, update the import at the top:

```typescript
import type { EnemySpawnParams } from '../../shared/heapTypes';
import type { Vertex } from './HeapPolygon';
```

(Remove `import type { EnemyDef } from '../data/enemyDefs';`)

Replace the `spawnChance` function:

```typescript
/**
 * Returns spawn probability for the given params at the given height above floor.
 * Returns null if the point is outside the enemy's spawn zone.
 * pxAboveFloor = worldHeight - y  (computed at call site).
 */
export function spawnChance(params: EnemySpawnParams, pxAboveFloor: number): number | null {
  if (pxAboveFloor < params.spawnStartPxAboveFloor) return null;
  if (params.spawnEndPxAboveFloor !== -1 && pxAboveFloor > params.spawnEndPxAboveFloor) return null;
  if (params.spawnRampPxAboveFloor === -1) return params.spawnChanceMin;
  const range = params.spawnRampPxAboveFloor - params.spawnStartPxAboveFloor;
  const t = range <= 0 ? 1 : Math.min(1, (pxAboveFloor - params.spawnStartPxAboveFloor) / range);
  return params.spawnChanceMin + t * (params.spawnChanceMax - params.spawnChanceMin);
}
```

- [ ] **Step 5: Run tests to confirm GREEN**

```bash
cd /home/connor/Documents/Repos/HeapGame
npm test src/systems/__tests__/EnemySpawnMath.test.ts src/systems/__tests__/EnemyManager.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/systems/EnemySpawnMath.ts src/systems/__tests__/EnemySpawnMath.test.ts src/systems/__tests__/EnemyManager.test.ts
git commit -m "feat: rewrite spawnChance to use EnemySpawnParams + pxAboveFloor"
```

---

### Task 7: Remove fraction fields from `EnemyDef`; add `DEFAULT_ENEMY_PARAMS`

**Files:**
- Modify: `src/data/enemyDefs.ts`
- Modify: `src/systems/__tests__/buildRunScore.test.ts`

- [ ] **Step 1: Update `src/data/enemyDefs.ts`**

Replace the entire file content:

```typescript
// src/data/enemyDefs.ts
import type { EnemyKind } from '../entities/Enemy';
import type { HeapEnemyParams } from '../../shared/heapTypes';

export interface EnemyDef {
  kind: EnemyKind;

  // Visuals / physics
  textureKey: string;
  width: number;
  height: number;
  speed: number;

  // Surface spawn eligibility
  spawnOnHeapSurface: boolean;
  spawnOnHeapWall: boolean;

  // Score tracking
  displayName: string;
  scoreValue: number;
}

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  percher: {
    kind: 'percher',
    textureKey: 'rat',
    width: 32,
    height: 32,
    speed: 55,
    spawnOnHeapSurface: true,
    spawnOnHeapWall: false,
    displayName: 'RAT',
    scoreValue: 100,
  },
  ghost: {
    kind: 'ghost',
    textureKey: 'vulture-fly-left',
    width: 51,
    height: 43,
    speed: 320,
    spawnOnHeapSurface: true,
    spawnOnHeapWall: false,
    displayName: 'VULTURE',
    scoreValue: 200,
  },
};

// Fallback params used when no server-provided HeapEnemyParams are available
// (offline / infinite mode). Mirrors the sentinel row in heap_parameters.
export const DEFAULT_ENEMY_PARAMS: HeapEnemyParams = {
  percher: {
    spawnStartPxAboveFloor: 0,
    spawnEndPxAboveFloor: -1,
    spawnRampPxAboveFloor: 15000,
    spawnChanceMin: 0.15,
    spawnChanceMax: 0.45,
  },
  ghost: {
    spawnStartPxAboveFloor: 5000,
    spawnEndPxAboveFloor: -1,
    spawnRampPxAboveFloor: 20000,
    spawnChanceMin: 0.10,
    spawnChanceMax: 0.35,
  },
};
```

- [ ] **Step 2: Update `buildRunScore.test.ts` — remove fraction fields from `TEST_DEFS`**

In `src/systems/__tests__/buildRunScore.test.ts`, replace the `TEST_DEFS` variable:

```typescript
const TEST_DEFS: Record<EnemyKind, EnemyDef> = {
  percher: {
    kind: 'percher', textureKey: 'rat', width: 32, height: 32, speed: 55,
    spawnOnHeapSurface: true, spawnOnHeapWall: false,
    displayName: 'RAT', scoreValue: 100,
  },
  ghost: {
    kind: 'ghost', textureKey: 'vulture-fly-left', width: 51, height: 43, speed: 320,
    spawnOnHeapSurface: true, spawnOnHeapWall: false,
    displayName: 'VULTURE', scoreValue: 200,
  },
};
```

- [ ] **Step 3: Run full client test suite to catch any remaining fraction-field references**

```bash
cd /home/connor/Documents/Repos/HeapGame
npm test
```

Expected: all tests pass. If there are TypeScript errors about `spawnStartFrac` or similar, find and remove those references.

- [ ] **Step 4: Commit**

```bash
git add src/data/enemyDefs.ts src/systems/__tests__/buildRunScore.test.ts
git commit -m "feat: remove spawnStartFrac/spawnEndFrac/spawnRampEndFrac from EnemyDef; add DEFAULT_ENEMY_PARAMS"
```

---

### Task 8: Update `EnemyManager` to use `HeapEnemyParams`

**Files:**
- Modify: `src/systems/EnemyManager.ts`

- [ ] **Step 1: Add `HeapEnemyParams` import and `_enemyParams` field**

In `src/systems/EnemyManager.ts`, add to the existing imports:

```typescript
import type { HeapEnemyParams } from '../../shared/heapTypes';
```

Add a private field on the class (after `private readonly _worldHeight: number;`):

```typescript
private _enemyParams: HeapEnemyParams = {};
```

- [ ] **Step 2: Add `setEnemyParams` method**

Add after the existing `setSpawnRateMult` method:

```typescript
setEnemyParams(params: HeapEnemyParams): void {
  this._enemyParams = params;
}
```

- [ ] **Step 3: Update `trySpawn` to use per-kind params**

In `trySpawn`, replace the two lines:

```typescript
const rawChance = spawnChance(def, y, this._worldHeight);
if (rawChance === null) return false;
```

With:

```typescript
const spawnParams = this._enemyParams[def.kind];
if (!spawnParams) return false;
const pxAboveFloor = this._worldHeight - y;
const rawChance = spawnChance(spawnParams, pxAboveFloor);
if (rawChance === null) return false;
```

- [ ] **Step 4: Run tests to confirm GREEN**

```bash
cd /home/connor/Documents/Repos/HeapGame
npm test
```

Expected: all tests pass. (EnemyManager tests don't call `trySpawn` directly — they test the math helpers. The behavior change will be validated in the client integration smoke test.)

- [ ] **Step 5: Commit**

```bash
git add src/systems/EnemyManager.ts
git commit -m "feat: EnemyManager uses setEnemyParams/HeapEnemyParams for per-kind spawn config"
```

---

### Task 9: Client integration — cache `enemyParams` and wire to `EnemyManager`

**Files:**
- Modify: `src/systems/HeapClient.ts`
- Modify: `src/systems/__tests__/HeapClient.test.ts`
- Modify: `src/scenes/GameScene.ts`
- Modify: `src/scenes/InfiniteGameScene.ts`

- [ ] **Step 1: Write failing test for `HeapClient.getEnemyParams`**

In `src/systems/__tests__/HeapClient.test.ts`, add at the end of the `HeapClient.load` describe block:

```typescript
it('getEnemyParams returns enemyParams from the last changed:true response', async () => {
  const heapId = 'heap-enemy-params-001';
  const baseId = 'base-enemy-params-001';
  const baseVertices = [{ x: 0, y: 500 }, { x: 100, y: 700 }, { x: 200, y: 500 }];
  const liveZone: { x: number; y: number }[] = [];
  const enemyParams = {
    percher: { spawnStartPxAboveFloor: 0, spawnEndPxAboveFloor: -1, spawnRampPxAboveFloor: 12000, spawnChanceMin: 0.2, spawnChanceMax: 0.5 },
  };

  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ changed: true, version: 1, baseId, liveZone, params: {}, enemyParams }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => baseVertices,
    }),
  );

  await HeapClient.load(heapId);

  const cached = HeapClient.getEnemyParams(heapId);
  expect(cached).not.toBeNull();
  expect(cached!.percher.spawnRampPxAboveFloor).toBe(12000);
});
```

- [ ] **Step 2: Run to confirm RED**

```bash
cd /home/connor/Documents/Repos/HeapGame
npm test src/systems/__tests__/HeapClient.test.ts
```

Expected: FAIL — `HeapClient.getEnemyParams` does not exist.

- [ ] **Step 3: Update `HeapClient.ts`**

In `src/systems/HeapClient.ts`:

1. Add to existing imports:
```typescript
import type { GetHeapResponse, HeapEnemyParams, ListHeapsResponse, Vertex } from '../../shared/heapTypes';
```

2. Update the `HeapCache` interface:
```typescript
interface HeapCache {
  version: number;
  baseId: string;
  liveZone: Vertex[];
  enemyParams?: HeapEnemyParams;
}
```

3. In the `load()` method, in the `if (data.changed)` branch, update `newCache` to include `enemyParams`:
```typescript
if (data.changed) {
  const newCache: HeapCache = {
    version: data.version,
    baseId: data.baseId,
    liveZone: data.liveZone,
    enemyParams: data.enemyParams,
  };
  saveCache(heapId, newCache);
  return reconstructPolygonFromPoints(await buildPolygon(heapId, newCache));
}
```

4. Add a new static method:
```typescript
static getEnemyParams(heapId: string): HeapEnemyParams | null {
  const cache = loadCache(heapId);
  return cache?.enemyParams ?? null;
}
```

- [ ] **Step 4: Run to confirm GREEN**

```bash
cd /home/connor/Documents/Repos/HeapGame
npm test src/systems/__tests__/HeapClient.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Wire `enemyParams` in `GameScene.ts`**

In `src/scenes/GameScene.ts`:

Add to the existing imports (near the top where `ENEMY_DEFS` is imported):
```typescript
import { ENEMY_DEFS, DEFAULT_ENEMY_PARAMS } from '../data/enemyDefs';
```

After the line that constructs `this.enemyManager` (line ~120):
```typescript
this.enemyManager = new EnemyManager(this, this._heapParams.spawnRateMult, 0, WORLD_WIDTH, this._worldHeight);
```

Add immediately after:
```typescript
const cachedEnemyParams = HeapClient.getEnemyParams(this._heapId);
this.enemyManager.setEnemyParams(cachedEnemyParams ?? DEFAULT_ENEMY_PARAMS);
```

Also add `HeapClient` to imports if not already present (it already is — check the top of the file).

- [ ] **Step 6: Wire `enemyParams` in `InfiniteGameScene.ts`**

In `src/scenes/InfiniteGameScene.ts`:

Add to the imports:
```typescript
import { ENEMY_DEFS, DEFAULT_ENEMY_PARAMS } from '../data/enemyDefs';
```

Find the loop that creates `EnemyManager` instances (around line 123):
```typescript
const em = new EnemyManager(this, 1.0, xMin, xMax);
```

Add immediately after:
```typescript
em.setEnemyParams(DEFAULT_ENEMY_PARAMS);
```

- [ ] **Step 7: Run full test suite**

```bash
cd /home/connor/Documents/Repos/HeapGame
npm test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/systems/HeapClient.ts src/systems/__tests__/HeapClient.test.ts src/scenes/GameScene.ts src/scenes/InfiniteGameScene.ts
git commit -m "feat: HeapClient caches enemyParams; GameScene/InfiniteGameScene wire to EnemyManager"
```

---

### Task 10: Admin UI — minimal enemy params editor

**Files:**
- Create: `admin/enemy-params.html`

- [ ] **Step 1: Create the admin directory and HTML file**

Create `admin/enemy-params.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Heap Enemy Params Admin</title>
  <style>
    body { font-family: monospace; max-width: 700px; margin: 40px auto; padding: 0 16px; background: #111; color: #ddd; }
    h1 { color: #0f0; margin-bottom: 4px; }
    label { display: block; margin: 6px 0 2px; font-size: 13px; color: #aaa; }
    input[type="number"], input[type="text"], select { width: 100%; padding: 6px; background: #222; border: 1px solid #444; color: #ddd; font-family: monospace; box-sizing: border-box; }
    select { cursor: pointer; }
    .section { border: 1px solid #333; padding: 12px; margin: 12px 0; border-radius: 4px; }
    .section h2 { margin: 0 0 10px; font-size: 14px; color: #0cf; text-transform: uppercase; }
    button { margin-top: 16px; padding: 10px 24px; background: #0f0; color: #000; border: none; font-family: monospace; font-size: 14px; font-weight: bold; cursor: pointer; }
    button:hover { background: #0d0; }
    #status { margin-top: 12px; font-size: 13px; }
    .ok { color: #0f0; }
    .err { color: #f44; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  </style>
</head>
<body>
  <h1>Enemy Params Admin</h1>

  <label>Server URL</label>
  <input type="text" id="serverUrl" value="http://localhost:8787" />

  <label>Heap</label>
  <select id="heapSelect"><option value="">— select a heap —</option></select>

  <div id="editor" style="display:none">
    <div class="section" id="section-percher">
      <h2>Percher (RAT)</h2>
      <div class="row">
        <div><label>spawnStartPxAboveFloor</label><input type="number" id="percher-spawnStartPxAboveFloor" /></div>
        <div><label>spawnEndPxAboveFloor (-1 = none)</label><input type="number" id="percher-spawnEndPxAboveFloor" /></div>
      </div>
      <div class="row">
        <div><label>spawnRampPxAboveFloor (-1 = flat)</label><input type="number" id="percher-spawnRampPxAboveFloor" /></div>
        <div></div>
      </div>
      <div class="row">
        <div><label>spawnChanceMin (0–1)</label><input type="number" step="0.01" id="percher-spawnChanceMin" /></div>
        <div><label>spawnChanceMax (0–1)</label><input type="number" step="0.01" id="percher-spawnChanceMax" /></div>
      </div>
    </div>

    <div class="section" id="section-ghost">
      <h2>Ghost (VULTURE)</h2>
      <div class="row">
        <div><label>spawnStartPxAboveFloor</label><input type="number" id="ghost-spawnStartPxAboveFloor" /></div>
        <div><label>spawnEndPxAboveFloor (-1 = none)</label><input type="number" id="ghost-spawnEndPxAboveFloor" /></div>
      </div>
      <div class="row">
        <div><label>spawnRampPxAboveFloor (-1 = flat)</label><input type="number" id="ghost-spawnRampPxAboveFloor" /></div>
        <div></div>
      </div>
      <div class="row">
        <div><label>spawnChanceMin (0–1)</label><input type="number" step="0.01" id="ghost-spawnChanceMin" /></div>
        <div><label>spawnChanceMax (0–1)</label><input type="number" step="0.01" id="ghost-spawnChanceMax" /></div>
      </div>
    </div>

    <button id="saveBtn">Save Changes</button>
    <div id="status"></div>
  </div>

  <script>
    const KINDS = ['percher', 'ghost'];
    const FIELDS = ['spawnStartPxAboveFloor', 'spawnEndPxAboveFloor', 'spawnRampPxAboveFloor', 'spawnChanceMin', 'spawnChanceMax'];

    function serverUrl() { return document.getElementById('serverUrl').value.replace(/\/$/, ''); }

    async function loadHeaps() {
      try {
        const res = await fetch(`${serverUrl()}/heaps`);
        const data = await res.json();
        const sel = document.getElementById('heapSelect');
        sel.innerHTML = '<option value="">— select a heap —</option>';
        for (const h of data.heaps) {
          const opt = document.createElement('option');
          opt.value = h.id;
          opt.textContent = `${h.params.name} (${h.id.slice(0, 8)}…) world=${h.params.worldHeight}px`;
          sel.appendChild(opt);
        }
      } catch (e) {
        setStatus('Failed to load heaps: ' + e.message, false);
      }
    }

    async function loadParams(heapId) {
      try {
        const res = await fetch(`${serverUrl()}/heaps/${heapId}/enemy-params`);
        if (!res.ok) throw new Error(`${res.status}`);
        const params = await res.json();
        for (const kind of KINDS) {
          const kp = params[kind] ?? {};
          for (const field of FIELDS) {
            const el = document.getElementById(`${kind}-${field}`);
            if (el) el.value = kp[field] ?? '';
          }
        }
        document.getElementById('editor').style.display = 'block';
        setStatus('', true);
      } catch (e) {
        setStatus('Failed to load params: ' + e.message, false);
      }
    }

    async function saveParams() {
      const heapId = document.getElementById('heapSelect').value;
      if (!heapId) return;
      const params = {};
      for (const kind of KINDS) {
        params[kind] = {};
        for (const field of FIELDS) {
          const val = parseFloat(document.getElementById(`${kind}-${field}`).value);
          params[kind][field] = isNaN(val) ? -1 : val;
        }
      }
      try {
        const res = await fetch(`${serverUrl()}/heaps/${heapId}/enemy-params`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        });
        const body = await res.json();
        setStatus(res.ok ? '✓ Saved' : `Error: ${JSON.stringify(body)}`, res.ok);
      } catch (e) {
        setStatus('Save failed: ' + e.message, false);
      }
    }

    function setStatus(msg, ok) {
      const el = document.getElementById('status');
      el.textContent = msg;
      el.className = ok ? 'ok' : 'err';
    }

    document.getElementById('heapSelect').addEventListener('change', e => {
      if (e.target.value) loadParams(e.target.value);
      else document.getElementById('editor').style.display = 'none';
    });
    document.getElementById('saveBtn').addEventListener('click', saveParams);
    document.getElementById('serverUrl').addEventListener('change', loadHeaps);

    loadHeaps();
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify the admin page works against local server**

Start the server:
```bash
cd /home/connor/Documents/Repos/HeapGame
npx wrangler dev server/src/index.ts --local --port 8787
```

Open `admin/enemy-params.html` in a browser (e.g. `open admin/enemy-params.html` on Mac or `xdg-open admin/enemy-params.html` on Linux).

Verify: heaps load in dropdown, selecting a heap shows enemy param inputs, Save updates values, subsequent reload shows updated values.

- [ ] **Step 3: Commit**

```bash
git add admin/enemy-params.html
git commit -m "feat: add admin/enemy-params.html standalone editor for per-heap enemy spawn config"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| `heap_parameters` table + sentinel row | Task 1 |
| `EnemySpawnParams` / `HeapEnemyParams` types | Task 2 |
| Remove `spawnStartFrac`/`spawnEndFrac`/`spawnRampEndFrac` from `EnemyDef` | Task 7 |
| `EnemySpawnMath.spawnChance` new signature | Task 6 |
| `GET /heaps/:id` includes `enemyParams` | Task 5 |
| `GET /heaps/:id/enemy-params` admin endpoint | Task 4 |
| `PUT /heaps/:id/enemy-params` admin endpoint | Task 4 |
| Fallback to sentinel when no heap-specific row | Tasks 3, 4 |
| `GameScene` reads `enemyParams` and passes to `EnemyManager` | Task 9 |
| Admin UI with heap dropdown and save | Task 10 |

**Type consistency check:**
- `EnemySpawnParams` defined in Task 2 (`shared/heapTypes.ts`), used in Tasks 6, 8, 9 — consistent.
- `HeapEnemyParams = Record<string, EnemySpawnParams>` defined in Task 2, used in Tasks 3, 4, 5, 8, 9 — consistent.
- `getEnemyParams` / `upsertEnemyParams` method names defined in Task 3, called in Tasks 4, 5 — consistent.
- `setEnemyParams` defined in Task 8, called in Task 9 — consistent.
- `DEFAULT_ENEMY_PARAMS` defined in Task 7, used in Task 9 — consistent.
- `HeapClient.getEnemyParams(heapId)` defined in Task 9 step 3, called in Task 9 step 5 — consistent.

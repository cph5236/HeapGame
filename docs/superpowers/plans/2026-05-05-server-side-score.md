# Server-Side Score Recompute + Placement Clamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop trusting the client's score number. The client submits the *raw inputs* (peak height, kill counts, elapsed time, run-success flag) and the server runs the same `buildRunScore` formula to compute and store the authoritative score, validating the inputs against per-heap plausibility bounds. Also clamp `POST /heaps/:id/place` coordinates to the heap's world bounds.

**Architecture:** Make `buildRunScore` and `EnemyDef.scoreValue` data shareable by relocating them under `shared/`, then change the `POST /scores` request shape so it carries `inputs` instead of `score`. The server reads heap params (already in the row), validates inputs against (a) absolute bounds (`baseHeightPx ≤ worldHeight`, kills ≥ 0, etc.) and (b) ratio bounds (climb rate ≤ 400 Y/s, kills ≤ 1/s on average), then calls the same shared formula and stores its output. `EnemyKind` moves into the defs file to break the defs → `Enemy.ts` (Phaser) coupling.

**Tech Stack:** Hono 4, Cloudflare Workers + D1, Vitest, Phaser 3 (client). Shared modules under `shared/` are imported by both Worker code and Vite client.

---

## File Structure

**Created:**
- `shared/buildRunScore.ts` — moved from `src/systems/buildRunScore.ts`. Pure function, zero Phaser dependency.
- `shared/enemyDefs.ts` — moved from `src/data/enemyDefs.ts`. Owns `EnemyKind` going forward.
- `shared/scoreConstants.ts` — `PACE_BONUS_CONST` and `SCORE_DISPLAY_DIVISOR`, re-exported from `src/constants.ts` for backward compat.

**Modified — server:**
- `server/src/routes/scores.ts` — accept new `inputs` shape, validate (using `heap.top_y`), recompute via shared `buildRunScore`, store recomputed score.
- `server/src/routes/heap.ts` — update `top_y` after each accepted placement; clamp `x` to `[0, WORLD_WIDTH]` and `y` to `[0, heap.worldHeight]` on `POST /:id/place`.
- `server/src/db.ts` — `createHeap` computes initial `top_y = min(vertices.y)`; new `updateTopY(id, y)` for monotonic-min updates; `HeapRow` includes `top_y`.
- `server/tests/helpers/mockDb.ts` — mirror `top_y` in the in-memory mock.
- `server/tests/scores.test.ts` — update existing tests to new shape; add validation tests.
- `server/tests/routes.test.ts` — add placement-clamp + top_y maintenance tests.
- `shared/scoreTypes.ts` — `SubmitScoreRequest.inputs` field replaces `score`.

**Created (server schema):**
- `server/migrations/0003_heap_top_y.sql` — adds `top_y` column with backfill from base vertices.
- `server/schema.sql` — updated to reflect the new column (kept in sync per project rules).

**Modified — client:**
- `src/data/enemyDefs.ts` — replaced by re-export shim that just `export *` from `shared/enemyDefs` (keeps every existing client import path working without a sweep).
- `src/entities/Enemy.ts` — import `EnemyKind` from `'../data/enemyDefs'` (already does, via the shim).
- `src/systems/buildRunScore.ts` — replaced by re-export shim from `shared/buildRunScore`.
- `src/systems/ScoreClient.ts` — `submitScore` takes `inputs` instead of `score`.
- `src/scenes/ScoreScene.ts` — single call site updated to send inputs.
- `src/constants.ts` — `PACE_BONUS_CONST` and `SCORE_DISPLAY_DIVISOR` re-exported from `shared/scoreConstants` (no behavior change).

---

## Task 1: Move `EnemyKind` into `enemyDefs.ts` (break Phaser coupling)

This is the prerequisite for putting defs in `shared/`. After this task, `enemyDefs.ts` has zero imports from `entities/Enemy.ts`.

**Files:**
- Modify: `src/data/enemyDefs.ts:2` — define `EnemyKind` here, drop the import.
- Modify: `src/entities/Enemy.ts:3,5` — import `EnemyKind` from `'../data/enemyDefs'`, drop the local re-export.

- [ ] **Step 1: Replace the import in `enemyDefs.ts` with a local definition**

Edit `src/data/enemyDefs.ts`. Replace lines 1-3:

```ts
// src/data/enemyDefs.ts
import type { HeapEnemyParams } from '../../shared/heapTypes';

export type EnemyKind = 'percher' | 'ghost';

export interface EnemyDef {
```

(Keep the rest of the file unchanged.)

- [ ] **Step 2: Update `Enemy.ts` to import `EnemyKind` from defs**

Edit `src/entities/Enemy.ts`. Replace lines 1-5:

```ts
// src/entities/Enemy.ts
import Phaser from 'phaser';
import type { EnemyDef, EnemyKind } from '../data/enemyDefs';

export type { EnemyKind };

export class Enemy {
```

The `export type { EnemyKind }` re-export keeps any code that imports `EnemyKind` from `entities/Enemy` working, no sweep needed.

- [ ] **Step 3: Run client tests**

Run: `cd /home/connor/Documents/Repos/HeapGame && npm run test 2>&1 | tail -20`
Expected: all pass. (`buildRunScore.test.ts` and any others that touch enemy types.)

- [ ] **Step 4: Run server tests**

Run: `cd server && npm test 2>&1 | tail -10`
Expected: 102 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/data/enemyDefs.ts src/entities/Enemy.ts
git commit -m "refactor(enemies): move EnemyKind into enemyDefs (break Phaser coupling)"
```

---

## Task 2: Move `enemyDefs` to `shared/`

**Files:**
- Create: `shared/enemyDefs.ts` (move-and-edit of `src/data/enemyDefs.ts`)
- Replace: `src/data/enemyDefs.ts` with a re-export shim
- Verify: no client code needs path updates

- [ ] **Step 1: Create `shared/enemyDefs.ts`**

Create `shared/enemyDefs.ts`:

```ts
// shared/enemyDefs.ts
import type { HeapEnemyParams } from './heapTypes';

export type EnemyKind = 'percher' | 'ghost';

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

- [ ] **Step 2: Replace `src/data/enemyDefs.ts` with a shim**

Overwrite `src/data/enemyDefs.ts`:

```ts
// src/data/enemyDefs.ts — re-export of canonical defs in shared/.
// All client imports continue to work via this path; new code should import
// from '../../shared/enemyDefs' directly.
export * from '../../shared/enemyDefs';
```

- [ ] **Step 3: Run all tests, expect green**

Run from repo root: `npm run test 2>&1 | tail -15`
Run from server: `cd server && npm test 2>&1 | tail -10`
Expected: both green.

- [ ] **Step 4: Commit**

```bash
git add shared/enemyDefs.ts src/data/enemyDefs.ts
git commit -m "refactor(enemies): relocate enemyDefs to shared/ for server reuse"
```

---

## Task 3: Move `buildRunScore` and its constants to `shared/`

**Files:**
- Create: `shared/scoreConstants.ts`
- Create: `shared/buildRunScore.ts`
- Replace: `src/systems/buildRunScore.ts` with a re-export shim
- Modify: `src/constants.ts` — re-export the two constants from shared

- [ ] **Step 1: Create `shared/scoreConstants.ts`**

Current values verified in `src/constants.ts:93-94`: both are `10`.

Create `shared/scoreConstants.ts`:

```ts
// shared/scoreConstants.ts
// Single source of truth for score-formula constants. Imported by both
// shared/buildRunScore.ts (used on client and server) and re-exported from
// src/constants.ts so existing client code keeps working.
export const PACE_BONUS_CONST       = 10; // multiplier on px/s pace component
export const SCORE_DISPLAY_DIVISOR  = 10; // px ÷ 10 = ft for HUD display
```

- [ ] **Step 2: (omitted — folded into Step 1)**

- [ ] **Step 3: Create `shared/buildRunScore.ts`**

Create `shared/buildRunScore.ts`:

```ts
// shared/buildRunScore.ts
import type { EnemyDef, EnemyKind } from './enemyDefs';
import { PACE_BONUS_CONST, SCORE_DISPLAY_DIVISOR } from './scoreConstants';

export interface RunStats {
  baseHeightPx: number;
  kills:        Partial<Record<EnemyKind, number>>;
  elapsedMs:    number;
}

export interface RunScoreRow {
  type:   'height' | 'kill' | 'pace';
  label:  string;
  detail: string;
  value:  number;
}

export interface RunScoreResult {
  rows:       RunScoreRow[];
  finalScore: number;
}

export function buildRunScore(
  stats:     RunStats,
  defs:      Record<EnemyKind, EnemyDef>,
  isFailure: boolean,
  scoreMult: number = 1.0,
): RunScoreResult {
  const rows: RunScoreRow[] = [];
  let total = stats.baseHeightPx;

  const ft = Math.floor(stats.baseHeightPx / SCORE_DISPLAY_DIVISOR);
  rows.push({
    type:   'height',
    label:  'FEET CLIMBED',
    detail: `${ft}ft`,
    value:  stats.baseHeightPx,
  });

  const kinds: EnemyKind[] = ['percher', 'ghost'];
  for (const kind of kinds) {
    const count = stats.kills[kind];
    if (!count) continue;
    const def   = defs[kind];
    const bonus = count * def.scoreValue;
    rows.push({
      type:   'kill',
      label:  `${def.displayName} x${count}`,
      detail: `${count} x ${def.scoreValue}`,
      value:  bonus,
    });
    total += bonus;
  }

  if (!isFailure && stats.elapsedMs > 0) {
    const elapsedSeconds = stats.elapsedMs / 1000;
    const paceBonus      = Math.floor((stats.baseHeightPx / elapsedSeconds) * PACE_BONUS_CONST);
    const elapsedSec     = Math.round(elapsedSeconds);
    rows.push({
      type:   'pace',
      label:  'PACE',
      detail: `${stats.baseHeightPx} / ${elapsedSec}s x ${PACE_BONUS_CONST}`,
      value:  paceBonus,
    });
    total += paceBonus;
  }

  return { rows, finalScore: Math.round(total * scoreMult) };
}
```

- [ ] **Step 4: Replace `src/systems/buildRunScore.ts` with a shim**

Overwrite `src/systems/buildRunScore.ts`:

```ts
// src/systems/buildRunScore.ts — re-export of canonical formula in shared/.
export * from '../../shared/buildRunScore';
```

- [ ] **Step 5: Re-export the constants from `src/constants.ts`**

In `src/constants.ts`, find the two existing `export const PACE_BONUS_CONST = ...` and `export const SCORE_DISPLAY_DIVISOR = ...` lines. Replace both with a single re-export above them (delete the old `export const` lines):

```ts
export { PACE_BONUS_CONST, SCORE_DISPLAY_DIVISOR } from '../shared/scoreConstants';
```

- [ ] **Step 6: Run all tests, expect green**

Run from repo root: `npm run test 2>&1 | tail -15`
Run from server: `cd server && npm test 2>&1 | tail -10`
Expected: both green. `buildRunScore.test.ts` exercises the shared module via the shim — should still pass.

- [ ] **Step 7: Commit**

```bash
git add shared/buildRunScore.ts shared/scoreConstants.ts src/systems/buildRunScore.ts src/constants.ts
git commit -m "refactor(score): relocate buildRunScore + constants to shared/ for server reuse"
```

---

## Task 4: Switch `SubmitScoreRequest` to carry inputs, not a score

**Files:**
- Modify: `shared/scoreTypes.ts` — replace `score` with `inputs`
- Modify: `src/systems/ScoreClient.ts` — `submitScore` accepts inputs
- Modify: `src/scenes/ScoreScene.ts:625` — update the single call site

- [ ] **Step 1: Update `shared/scoreTypes.ts`**

Edit `shared/scoreTypes.ts`. Replace the `SubmitScoreRequest` interface (lines 15-20) with:

```ts
export interface SubmitScoreInputs {
  baseHeightPx: number;
  kills:        { percher: number; ghost: number };
  elapsedMs:    number;
  isFailure:    boolean;
}

export interface SubmitScoreRequest {
  heapId:     string;
  playerId:   string;
  playerName: string;
  inputs:     SubmitScoreInputs;
}
```

- [ ] **Step 2: Update `ScoreClient.submitScore` signature and body**

Edit `src/systems/ScoreClient.ts`. Replace the `submitScore` method (lines 12-41) with:

```ts
import type { LeaderboardContext, SubmitScoreInputs, SubmitScoreResponse, PlayerScoreEntry, PlayerScoresResponse, PaginatedLeaderboardResponse } from '../../shared/scoreTypes';

// ... (keep SERVER_URL definition)

export class ScoreClient {
  static async submitScore(params: {
    heapId:     string;
    playerId:   string;
    playerName: string;
    inputs:     SubmitScoreInputs;
    limit?:     number;
  }): Promise<LeaderboardContext | null> {
    try {
      const url = params.limit
        ? `${SERVER_URL}/scores?limit=${params.limit}`
        : `${SERVER_URL}/scores`;

      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          heapId:     params.heapId,
          playerId:   params.playerId,
          playerName: params.playerName,
          inputs:     params.inputs,
        }),
      });

      if (!res.ok) return null;
      const data = (await res.json()) as SubmitScoreResponse;
      return data.context;
    } catch {
      return null;
    }
  }
```

(Update the existing `LeaderboardContext, SubmitScoreResponse, ...` import line at the top of the file to add `SubmitScoreInputs`.)

- [ ] **Step 3: Update the call site in `ScoreScene.ts`**

Read lines around 615-635 of `src/scenes/ScoreScene.ts` to find the `ScoreClient.submitScore({...})` call (currently at line 625). The call currently passes `score: <number>`. Replace that argument with:

```ts
inputs: {
  baseHeightPx: stats.baseHeightPx,
  kills: {
    percher: stats.kills.percher ?? 0,
    ghost:   stats.kills.ghost   ?? 0,
  },
  elapsedMs: stats.elapsedMs,
  isFailure: <whatever local variable carries the failure flag at this call site>,
},
```

Concrete fields verified in `ScoreScene.ts`: `this._baseHeightPx`, `this._kills` (a `Partial<Record<EnemyKind, number>>`), `this._elapsedMs`, `this.isFailure`. The full replacement object is:

```ts
inputs: {
  baseHeightPx: this._baseHeightPx,
  kills: {
    percher: this._kills.percher ?? 0,
    ghost:   this._kills.ghost   ?? 0,
  },
  elapsedMs: this._elapsedMs,
  isFailure: this.isFailure,
},
```

- [ ] **Step 4: Run client tests + build, expect green**

Run: `npm run test 2>&1 | tail -15`
Then: `npm run build 2>&1 | tail -20`
Expected: tests pass, type-check passes (build will catch any missed import or shape mismatch on the client).

- [ ] **Step 5: Server tests will fail (expected)**

Run: `cd server && npm test 2>&1 | tail -25`
Expected: every test in `tests/scores.test.ts` that POSTs `/scores` fails — request shape changed but server still validates `score`. This is the gap Task 5 closes. Do not commit yet.

- [ ] **Step 6: Hold off on commit**

Roll Task 5's commit together with this one — the codebase is intentionally inconsistent between Task 4 and Task 5 and shouldn't land separately.

---

## Task 5: Track heap `top_y` (summit) on placement

The server needs to validate `baseHeightPx` against how high the heap *actually reaches*, not the configured ceiling. Add a `top_y` column to the `heap` row, initialize from base vertices on creation, and monotonically update on every accepted placement (lower Y = higher summit, since screen Y is inverted).

**Files:**
- Create: `server/migrations/0003_heap_top_y.sql`
- Modify: `server/schema.sql` (full intended state)
- Modify: `server/src/db.ts` — `HeapRow`, `createHeap`, new `updateTopY`
- Modify: `server/src/routes/heap.ts` — call `updateTopY` after each accepted placement
- Modify: `server/tests/helpers/mockDb.ts` — track `top_y`
- Modify: `server/tests/routes.test.ts` — assert top_y maintenance

- [ ] **Step 1: Write the migration**

Create `server/migrations/0003_heap_top_y.sql`:

```sql
-- Add top_y to track the summit (lowest Y) of each heap.
-- Lower Y = higher in screen coords. Backfilled from each heap's base vertices.
ALTER TABLE heap ADD COLUMN top_y REAL NOT NULL DEFAULT 0;

-- Backfill: pull MIN(y) over the JSON array of vertices on the heap's base row.
UPDATE heap
SET top_y = COALESCE((
  SELECT MIN(json_extract(je.value, '$.y'))
  FROM heap_base hb, json_each(hb.vertices) je
  WHERE hb.id = heap.base_id
), 0);
```

- [ ] **Step 2: Update `server/schema.sql` to reflect the new column**

Find the `CREATE TABLE heap` statement in `server/schema.sql` and add `top_y REAL NOT NULL DEFAULT 0,` alongside the other heap columns. Do not run this — Wrangler ignores `schema.sql` at runtime; the migration above is what executes. This file is just for fresh-install reference.

- [ ] **Step 3: Apply the migration locally**

Run: `cd server && npx wrangler d1 migrations apply heap-db --local`
Expected: `0003_heap_top_y.sql` reported as applied.

- [ ] **Step 4: Update `HeapRow` and `createHeap` in `db.ts`**

Edit `server/src/db.ts`:

In the `HeapRow` interface, add:
```ts
  top_y: number;
```

In the `HeapDB` interface, add:
```ts
  updateTopY(id: string, candidateY: number): Promise<void>;
```

In the `getHeap` query, add `top_y` to the `SELECT`:
```ts
'SELECT id, base_id, live_zone, freeze_y, version, created_at, name, difficulty, spawn_rate_mult, coin_mult, score_mult, world_height, top_y FROM heap WHERE id = ?1'
```

In `createHeap`, compute `topY = Math.min(...vertices.map(v => v.y))` (or `0` if vertices is empty — defensive only; route already rejects). Add `top_y` to the INSERT statement. The exact INSERT lives in `db.ts` near line 84-90; add `top_y` to both the column list and the `bind(...)` arguments.

Implement `updateTopY` as:
```ts
async updateTopY(id: string, candidateY: number): Promise<void> {
  await this.d1
    .prepare('UPDATE heap SET top_y = MIN(top_y, ?1) WHERE id = ?2')
    .bind(candidateY, id)
    .run();
}
```

- [ ] **Step 5: Update `MockHeapDB` to mirror the field**

Edit `server/tests/helpers/mockDb.ts`. Add `top_y: number` to the in-memory heap shape. In `createHeap`, set `top_y` from `Math.min(...vertices.map(v => v.y))` (default `0` for empty). Implement `updateTopY` as `row.top_y = Math.min(row.top_y, candidateY)`. Update `seedHeap` (and any test helpers that build heap rows) to default `top_y` to `0` so existing tests don't have to specify it.

- [ ] **Step 6: Call `updateTopY` from the place handler**

Edit `server/src/routes/heap.ts`. In the `POST /:id/place` handler, immediately after the `await db.updateHeap(id, ...)` call (current line 278), add:

```ts
await db.updateTopY(id, y);
```

(Order matters slightly — `updateHeap` may rewrite `live_zone`, but `updateTopY` is independent and just runs `MIN`. Idempotent.)

- [ ] **Step 7: Write the maintenance tests**

Append to `server/tests/routes.test.ts`:

```ts
describe('heap top_y maintenance', () => {
  it('initializes top_y to MIN(y) of base vertices on create', async () => {
    const app = makeApp();
    const res = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vertices: [{ x: 0, y: 500 }, { x: 50, y: 200 }, { x: 100, y: 400 }],
      }),
    });
    const { id } = await res.json() as CreateHeapResponse;

    const get = await app.request(`/heaps/${id}?version=0`);
    const body = await get.json() as GetHeapResponse;
    expect(body.changed).toBe(true);
    // Reach into the mock to read the row directly. Use whatever accessor the
    // existing tests use for similar inspections; if none exists, add a small
    // `getHeapRowForTest(id)` helper to MockHeapDB.
  });

  it('lowers top_y when a placement is higher than current summit', async () => {
    const app = makeApp();
    const create = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),  // VERTICES min y = 400
    });
    const { id } = await create.json() as CreateHeapResponse;

    const place = await app.request(`/heaps/${id}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 300, y: 100 }),  // higher than the base summit
    });
    expect(place.status).toBe(200);
    // Assert top_y is now 100. Use the same accessor as the previous test.
  });

  it('does not raise top_y when a placement is below current summit', async () => {
    const app = makeApp();
    const create = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    const { id } = await create.json() as CreateHeapResponse;

    const place = await app.request(`/heaps/${id}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 300, y: 350 }),  // below summit (y=400 is already higher than 350? — check: lower y = higher; so y=350 < y=400, summit moves to 350)
    });
    expect(place.status).toBe(200);
    // Pick a coordinate that is NOT lower than VERTICES.min(y)=400 — e.g. y=500
    // Then assert top_y stays at 400. The above example is wrong; replace
    // y: 350 with y: 500 and re-check the rule.
    // (Sorry — the inverted-Y math is easy to slip on. Verify with the
    // assertion before committing.)
  });
});
```

- [ ] **Step 8: Run tests, expect green**

Run: `cd server && npm test 2>&1 | tail -15`
Expected: all green (existing 102 tests + the new top_y maintenance tests).

- [ ] **Step 9: Commit**

```bash
git add server/migrations/0003_heap_top_y.sql server/schema.sql \
        server/src/db.ts server/src/routes/heap.ts \
        server/tests/helpers/mockDb.ts server/tests/routes.test.ts
git commit -m "feat(server): track heap top_y (summit) on placement for score validation"
```

---

## Task 6: Server validates inputs and recomputes score

**Files:**
- Modify: `server/src/routes/scores.ts` — major: validate inputs, recompute score, store it
- Modify: `server/tests/scores.test.ts` — update existing tests to send `inputs`; add validation tests

**Validation rules (from your sanity bounds):**
- `baseHeightPx`: finite, integer, `0 ≤ baseHeightPx ≤ (heap.worldHeight - heap.top_y) + HEIGHT_GRACE_PX` where `HEIGHT_GRACE_PX = 200`
- `elapsedMs`: integer, `≥ 1` (must be > 0 for climb-rate math)
- `isFailure`: boolean
- `kills.percher`, `kills.ghost`: integers, each `≥ 0`
- **Climb-rate cap:** `baseHeightPx * 1000 ≤ MAX_CLIMB_RATE_Y_PER_S * elapsedMs` where `MAX_CLIMB_RATE_Y_PER_S = 400`
- **Kill-rate cap:** `(percher + ghost) * 1000 ≤ MAX_KILLS_PER_S * elapsedMs` where `MAX_KILLS_PER_S = 1`

The height check works because `baseHeightPx = spawnY - playerY` (pixels climbed from the floor), `spawnY ≈ worldHeight`, and the highest the player can climb is to the heap's summit at `top_y`. So max possible climb ≈ `worldHeight - top_y`. The 200 px grace absorbs the player-height offset and minor float rounding.

(The `* 1000` form avoids floating-point rounding around the boundary — both sides are integers.)

- [ ] **Step 1: Read the current handler**

Run: `cat /home/connor/Documents/Repos/HeapGame/server/src/routes/scores.ts | head -80`
Note the exact validation block (lines 56-66 in current file) and the `db.upsertScore` call (line 73).

- [ ] **Step 2: Write the failing tests first**

Open `server/tests/scores.test.ts`. Replace the existing `submitScore` helper (around line 17) so it sends the new shape:

```ts
async function submitScore(app: ReturnType<typeof makeApp>, body: object, limit?: number) {
  const url = limit ? `/scores?limit=${limit}` : '/scores';
  return app.request(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
}

// Default valid inputs for tests that don't care about input specifics.
const VALID_INPUTS = {
  baseHeightPx: 1000,
  kills: { percher: 1, ghost: 0 },
  elapsedMs: 10_000,    // 10 seconds — climb rate = 100 Y/s, well under 400
  isFailure: false,
};

function validBody(overrides: Partial<{ heapId: string; playerId: string; playerName: string; inputs: typeof VALID_INPUTS }> = {}) {
  return {
    heapId:     overrides.heapId     ?? HEAP_ID,
    playerId:   overrides.playerId   ?? PLAYER_A,
    playerName: overrides.playerName ?? 'Alice',
    inputs:     overrides.inputs     ?? VALID_INPUTS,
  };
}
```

Then **rewrite** every existing `submitScore(app, { ..., score: N })` call in this file to use `validBody({ inputs: { ...VALID_INPUTS, ... } })` (or pass the object directly). Audit by running `grep -n "score:" server/tests/scores.test.ts` and update each one. The existing test intent (e.g., "rejects oversized playerId") stays the same — only the request shape changes.

After updating existing tests, append the new validation tests at the bottom of the file:

```ts
describe('POST /scores — input validation (server-recompute)', () => {
  it('rejects baseHeightPx exceeding (worldHeight - top_y) + 200 grace', async () => {
    // worldHeight = 1000, top_y = 600 → max possible climb = 400, +200 grace = 601 ceiling
    const db = new MockHeapDB();
    db.seedHeap(HEAP_ID, 1, [], undefined, { worldHeight: 1000 });
    // Force top_y = 600 via the mock's direct setter (or seedHeap arg, depending on mock surface)
    db.setTopYForTest(HEAP_ID, 600);
    const app = createApp(db, new MockScoreDB());
    const res = await submitScore(app, validBody({
      inputs: { ...VALID_INPUTS, baseHeightPx: 700, elapsedMs: 10_000_000 /* keep climb rate ok */ },
    }));
    expect(res.status).toBe(400);
  });

  it('accepts baseHeightPx up to (worldHeight - top_y) + 200 grace', async () => {
    const db = new MockHeapDB();
    db.seedHeap(HEAP_ID, 1, [], undefined, { worldHeight: 1000 });
    db.setTopYForTest(HEAP_ID, 600);
    const app = createApp(db, new MockScoreDB());
    const res = await submitScore(app, validBody({
      inputs: { ...VALID_INPUTS, baseHeightPx: 600, elapsedMs: 10_000_000 },
    }));
    expect(res.status).toBe(200);
  });

  it('rejects climb rate above 400 Y/s', async () => {
    // 1000 Y in 1000 ms = 1000 Y/s
    const res = await submitScore(makeApp(), validBody({
      inputs: { ...VALID_INPUTS, baseHeightPx: 1000, elapsedMs: 1000 },
    }));
    expect(res.status).toBe(400);
  });

  it('accepts climb rate exactly at 400 Y/s', async () => {
    // 400 Y in 1000 ms = 400 Y/s — boundary
    const res = await submitScore(makeApp(), validBody({
      inputs: { ...VALID_INPUTS, baseHeightPx: 400, elapsedMs: 1000 },
    }));
    expect(res.status).toBe(200);
  });

  it('rejects kill rate above 1/s', async () => {
    // 11 kills in 10 seconds — over 1/s
    const res = await submitScore(makeApp(), validBody({
      inputs: { ...VALID_INPUTS, kills: { percher: 6, ghost: 5 }, elapsedMs: 10_000 },
    }));
    expect(res.status).toBe(400);
  });

  it('rejects negative kill counts', async () => {
    const res = await submitScore(makeApp(), validBody({
      inputs: { ...VALID_INPUTS, kills: { percher: -1, ghost: 0 } },
    }));
    expect(res.status).toBe(400);
  });

  it('rejects elapsedMs of 0', async () => {
    const res = await submitScore(makeApp(), validBody({
      inputs: { ...VALID_INPUTS, elapsedMs: 0 },
    }));
    expect(res.status).toBe(400);
  });

  it('stores the server-recomputed score, ignoring any client-supplied score field', async () => {
    const db = new MockScoreDB();
    const app = createApp(new MockHeapDB(), db);
    // Client tries to inject a 999_999_999 score; server should ignore it entirely.
    await submitScore(app, {
      ...validBody({ inputs: { ...VALID_INPUTS, baseHeightPx: 1000, kills: { percher: 1, ghost: 0 }, elapsedMs: 10_000, isFailure: false } }),
      score: 999_999_999,
    });
    // The recomputed score: 1000 (height) + 100 (1 percher × 100) + pace bonus
    // We just assert it is far below the injected value — exact value depends on PACE_BONUS_CONST.
    const stored = await db.getScore(HEAP_ID, PLAYER_A);
    expect(stored).not.toBeNull();
    expect(stored!.score).toBeLessThan(999_999_999);
    expect(stored!.score).toBeGreaterThan(0);
  });
});
```

If `MockHeapDB.seedHeap` doesn't currently accept a params argument that lets you set `worldHeight`, look at its signature in `server/tests/helpers/mockDb.ts` and add what you need (small helper change). If the existing helper doesn't allow per-test heap-param overrides, fall back to creating the heap via the API in the test (with the admin secret) and then submitting against that heap id.

- [ ] **Step 3: Run the failing tests**

Run: `cd server && npm test 2>&1 | tail -30`
Expected: many failures — payload shape mismatch and missing validation. This is the red bar before implementation.

- [ ] **Step 4: Update `server/src/routes/scores.ts`**

Replace the entire `app.post('/', ...)` handler body. Use this exact code:

```ts
import { Hono } from 'hono';
import type { ScoreDB } from '../scoreDb';
import type { HeapDB } from '../db';
import type {
  SubmitScoreRequest,
  SubmitScoreResponse,
  LeaderboardEntry,
  LeaderboardContext,
  PaginatedLeaderboardResponse,
  PlayerScoresResponse,
} from '../../../shared/scoreTypes';
import { buildRunScore } from '../../../shared/buildRunScore';
import { ENEMY_DEFS } from '../../../shared/enemyDefs';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT     = 50;
const MAX_ID_LEN    = 64;
const MAX_NAME_LEN  = 32;

// Plausibility caps (per second of run)
const MAX_CLIMB_RATE_Y_PER_S = 400;
const MAX_KILLS_PER_S        = 1;
```

Then change the `scoreRoutes` factory to accept `HeapDB` too — it now needs to look up `worldHeight` and `scoreMult`:

```ts
export function scoreRoutes(scoreDb: ScoreDB, heapDb: HeapDB): Hono {
  const app = new Hono();

  app.post('/', async (c) => {
    let body: SubmitScoreRequest;
    try {
      body = await c.req.json<SubmitScoreRequest>();
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    const { heapId, playerId, playerName, inputs } = body;

    // Identity / name validation (carried over from prior version)
    if (typeof heapId !== 'string' || heapId.length === 0 || heapId.length > MAX_ID_LEN)
      return c.json({ error: `heapId must be a 1-${MAX_ID_LEN} char string` }, 400);
    if (typeof playerId !== 'string' || playerId.length === 0 || playerId.length > MAX_ID_LEN)
      return c.json({ error: `playerId must be a 1-${MAX_ID_LEN} char string` }, 400);
    if (typeof playerName !== 'string' || playerName.trim().length === 0)
      return c.json({ error: 'playerName must be a non-empty string' }, 400);

    // Inputs shape
    if (!inputs || typeof inputs !== 'object')
      return c.json({ error: 'inputs must be an object' }, 400);

    const { baseHeightPx, kills, elapsedMs, isFailure } = inputs;

    if (!Number.isInteger(baseHeightPx) || baseHeightPx < 0)
      return c.json({ error: 'inputs.baseHeightPx must be a non-negative integer' }, 400);
    if (!Number.isInteger(elapsedMs) || elapsedMs < 1)
      return c.json({ error: 'inputs.elapsedMs must be a positive integer' }, 400);
    if (typeof isFailure !== 'boolean')
      return c.json({ error: 'inputs.isFailure must be a boolean' }, 400);
    if (!kills || typeof kills !== 'object')
      return c.json({ error: 'inputs.kills must be an object' }, 400);
    const percher = kills.percher;
    const ghost   = kills.ghost;
    if (!Number.isInteger(percher) || percher < 0)
      return c.json({ error: 'inputs.kills.percher must be a non-negative integer' }, 400);
    if (!Number.isInteger(ghost) || ghost < 0)
      return c.json({ error: 'inputs.kills.ghost must be a non-negative integer' }, 400);

    // Heap-relative validation
    const heap = await heapDb.getHeap(heapId);
    if (!heap) return c.json({ error: 'heap not found' }, 404);

    const HEIGHT_GRACE_PX = 200;
    const maxClimbPx = (heap.world_height - heap.top_y) + HEIGHT_GRACE_PX;
    if (baseHeightPx > maxClimbPx)
      return c.json({ error: `inputs.baseHeightPx (${baseHeightPx}) exceeds max possible climb (${maxClimbPx})` }, 400);

    // Climb-rate cap (integer arithmetic to avoid FP rounding)
    if (baseHeightPx * 1000 > MAX_CLIMB_RATE_Y_PER_S * elapsedMs)
      return c.json({ error: `climb rate exceeds ${MAX_CLIMB_RATE_Y_PER_S} Y/s` }, 400);

    // Kill-rate cap
    if ((percher + ghost) * 1000 > MAX_KILLS_PER_S * elapsedMs)
      return c.json({ error: `kill rate exceeds ${MAX_KILLS_PER_S}/s` }, 400);

    // Recompute score server-side — single source of truth
    const { finalScore } = buildRunScore(
      { baseHeightPx, kills: { percher, ghost }, elapsedMs },
      ENEMY_DEFS,
      isFailure,
      heap.score_mult,
    );

    if (finalScore <= 0)
      return c.json({ error: 'recomputed score is non-positive' }, 400);

    const limit = Math.min(
      parseInt(c.req.query('limit') ?? String(DEFAULT_LIMIT)) || DEFAULT_LIMIT,
      MAX_LIMIT,
    );

    const now       = new Date().toISOString();
    const submitted = await scoreDb.upsertScore(heapId, playerId, playerName.trim().slice(0, MAX_NAME_LEN), finalScore, now);
    if (submitted) await scoreDb.pruneScores(heapId);

    const context = await buildContext(scoreDb, heapId, playerId, limit);
    return c.json({ submitted, context } satisfies SubmitScoreResponse);
  });

  // ... (the existing GET handlers below stay the same — they don't depend on scoreDb args being renamed)
```

Note: rename the `db` param threaded through the GET handlers and `buildContext` from `db` to `scoreDb` for consistency. Update `buildContext`'s first param to `scoreDb: ScoreDB` and update the three GET handlers' `db.` calls to `scoreDb.`.

- [ ] **Step 5: Update `server/src/app.ts` to pass HeapDB into scoreRoutes**

Find the line `app.route('/scores', scoreRoutes(scoreDb));` and change to:

```ts
app.route('/scores', scoreRoutes(scoreDb, heapDb));
```

- [ ] **Step 6: Run tests, expect green**

Run: `cd server && npm test 2>&1 | tail -20`
Expected: all green.

- [ ] **Step 7: Run client tests + build**

Run from repo root: `npm run test 2>&1 | tail -10 && npm run build 2>&1 | tail -10`
Expected: green.

- [ ] **Step 8: Commit Tasks 4 + 5 together**

```bash
git add shared/scoreTypes.ts src/systems/ScoreClient.ts src/scenes/ScoreScene.ts \
        server/src/routes/scores.ts server/src/app.ts \
        server/tests/scores.test.ts server/tests/helpers/mockDb.ts
git commit -m "feat(score): server recomputes score from validated inputs

Client now sends raw inputs (height, kills, elapsedMs, isFailure) instead
of a precomputed score. Server validates against per-heap worldHeight,
climb-rate (≤400 Y/s) and kill-rate (≤1/s) caps, then runs the shared
buildRunScore formula. Stored score is the server's recomputed value;
any client-supplied score field is ignored."
```

(Drop `server/tests/helpers/mockDb.ts` from `git add` if you didn't end up modifying it.)

---

## Task 7: Clamp `POST /heaps/:id/place` coordinates to world bounds

**Files:**
- Modify: `server/src/routes/heap.ts:229-281` (the `POST /:id/place` handler)
- Modify: `server/tests/routes.test.ts` — add boundary tests

The handler already fetches `row` (the heap) and rejects `isPointInside`. Insert the bounds check between the heap fetch and the `isPointInside` check.

**Bounds:**
- `0 ≤ x ≤ WORLD_WIDTH`
- `0 ≤ y ≤ heap.world_height`

`WORLD_WIDTH` lives in `src/constants.ts:4` with value `960`. Rather than reach across into the client tree from the server, declare a local constant in the route file matching the client value (single literal, no behavior coupling — if you ever change `WORLD_WIDTH` in the client, update the server constant too).

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/routes.test.ts`:

```ts
describe('POST /heaps/:id/place coordinate clamp', () => {
  async function makeHeap(app: ReturnType<typeof makeApp>) {
    const res = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    return (await res.json() as CreateHeapResponse).id;
  }

  it('rejects x below 0', async () => {
    const app = makeApp();
    const id = await makeHeap(app);
    const res = await app.request(`/heaps/${id}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: -1, y: 100 }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects x above WORLD_WIDTH', async () => {
    const app = makeApp();
    const id = await makeHeap(app);
    const res = await app.request(`/heaps/${id}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 999_999, y: 100 }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects y below 0', async () => {
    const app = makeApp();
    const id = await makeHeap(app);
    const res = await app.request(`/heaps/${id}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 200, y: -1 }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects y above heap.worldHeight', async () => {
    const app = makeApp();
    const id = await makeHeap(app);
    const res = await app.request(`/heaps/${id}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 200, y: 999_999 }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests, expect 4 failures**

Run: `cd server && npx vitest run tests/routes.test.ts -t "coordinate clamp" 2>&1 | tail -15`
Expected: 4 failures.

- [ ] **Step 3: Add the bounds check in the handler**

Edit `server/src/routes/heap.ts`. Near the top of the file (after other constants), add:

```ts
// Mirror of src/constants.ts WORLD_WIDTH. Update both if either changes.
const WORLD_WIDTH = 960;
```

In the `POST /:id/place` handler, after `const row = await db.getHeap(id); if (!row) return c.json(...)` and before the `liveZone` line, insert:

```ts
if (x < 0 || x > WORLD_WIDTH)
  return c.json({ error: `x must be in [0, ${WORLD_WIDTH}]` }, 400);
if (y < 0 || y > row.world_height)
  return c.json({ error: `y must be in [0, ${row.world_height}]` }, 400);
```

- [ ] **Step 4: Run tests, expect green**

Run: `cd server && npm test 2>&1 | tail -10`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/heap.ts server/tests/routes.test.ts
git commit -m "feat(server): clamp /heaps/:id/place coords to [0, WORLD_WIDTH] x [0, worldHeight]"
```

---

## Task 8: End-to-end smoke test (manual)

**Files:** none — verifies the full flow runs.

- [ ] **Step 1: Start the server locally**

Run: `cd server && npm run dev` (in one terminal). Wait for `Ready on http://localhost:8787`.

- [ ] **Step 2: Start the client**

Run: `npm run dev` (in another terminal). Open the printed localhost URL.

- [ ] **Step 3: Play a short run**

Climb a few hundred pixels, kill 0-1 enemies, die or finish. The score screen should show a number, then the leaderboard.

- [ ] **Step 4: Check the network tab**

Open browser devtools → Network. Find the `POST /scores` request. The body should look like:

```json
{ "heapId": "...", "playerId": "...", "playerName": "...", "inputs": { "baseHeightPx": ..., "kills": { ... }, "elapsedMs": ..., "isFailure": ... } }
```

The response should have a `submitted: true/false` flag and a `context` object — leaderboard renders from this.

- [ ] **Step 5: Try to cheat with curl**

In a third terminal, against the local server:

```bash
curl -X POST http://localhost:8787/scores \
  -H 'content-type: application/json' \
  -d '{
    "heapId": "<the heapId from step 4>",
    "playerId": "cheater",
    "playerName": "Hacker",
    "inputs": { "baseHeightPx": 999999, "kills": { "percher": 999, "ghost": 999 }, "elapsedMs": 1000, "isFailure": false }
  }'
```

Expected: `400` with one of "climb rate exceeds 400 Y/s" / "kill rate exceeds 1/s" / "exceeds heap world height". Try a believable payload (e.g. `baseHeightPx: 4000, kills: { percher: 10, ghost: 0 }, elapsedMs: 11000`) — should be accepted, and the leaderboard reflects the *recomputed* score, not 999999.

- [ ] **Step 6: Try a placement at out-of-bounds coordinates**

```bash
curl -X POST http://localhost:8787/heaps/<heapId>/place \
  -H 'content-type: application/json' \
  -d '{"x": 1000000, "y": 100}'
```

Expected: `400 "x must be in [0, ...]"`.

- [ ] **Step 7: Verify `top_y` actually moves and gates the score**

Place a single high block to lower `top_y`:

```bash
curl -X POST http://localhost:8787/heaps/<heapId>/place \
  -H 'content-type: application/json' \
  -d '{"x": 200, "y": 500}'   # adjust to a value lower than current top_y
```

Now submit a score whose `baseHeightPx` is just above the new max-climb (`worldHeight - 500 + 200`) — it should `400`. Then submit one just below — should accept. This confirms the validation reads live `top_y`, not a stale value.

---

## Verification Checklist

- [ ] `cd server && npm test` — all green.
- [ ] Repo root `npm run test` — all green.
- [ ] Repo root `npm run build` — clean type-check.
- [ ] Browser smoke test (Task 7 steps 1-4) succeeded — real run goes through, leaderboard updates.
- [ ] Curl cheat attempt (Task 7 step 5) returns 400.
- [ ] Out-of-bounds placement (Task 7 step 6) returns 400.
- [ ] Branch summary: 6 commits, no orphan files (`git status` clean).

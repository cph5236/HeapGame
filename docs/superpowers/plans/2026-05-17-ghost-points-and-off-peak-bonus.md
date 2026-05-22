# Ghost Points + Off-Peak Bonus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a player places a block, the server silently inserts N random ghost points to keep the heap wide, and returns a flat coin bonus when the placement is below the heap's current summit.

**Architecture:** `ghost_point_count` is a new INTEGER column on the `heap` table (D1 migration required). The server place handler inserts ghost points alongside the player's point in one version bump and returns `bonusCoins` in `PlaceResponse`. `HeapClient.append` is changed to return the response instead of discarding it; `GameScene` threads the bonus to `ScoreScene`; `buildCoinBreakdown` gains an `off_peak_bonus` flat-add row.

**Tech Stack:** Hono (server routes), Cloudflare D1 (SQL), Vitest (tests), Phaser 3 TypeScript (client).

---

## File Map

| File | Change |
|---|---|
| `server/migrations/0006_add_ghost_point_count.sql` | CREATE — ALTER TABLE migration |
| `server/schema.sql` | Modify — add ghost_point_count column |
| `server/src/db.ts` | Modify — HeapRow, HeapSummaryRow, all D1HeapDB SQL |
| `server/tests/helpers/mockDb.ts` | Modify — add ghost_point_count to all methods |
| `shared/heapTypes.ts` | Modify — HeapParams.ghostPointCount, PlaceResponse.bonusCoins |
| `server/src/routes/heap.ts` | Modify — place handler, params handlers, resolveParams |
| `server/tests/routes.test.ts` | Modify — ghost point count + bonusCoins tests |
| `src/systems/coinBreakdown.ts` | Modify — off_peak_bonus row type + logic |
| `src/systems/__tests__/coinBreakdown.test.ts` | Modify — tests for new row |
| `src/systems/HeapClient.ts` | Modify — append returns PlaceResponse | null |
| `src/systems/__tests__/HeapClient.test.ts` | Modify — update network-error test |
| `src/scenes/GameScene.ts` | Modify — capture bonusCoins from append |
| `src/scenes/ScoreScene.ts` | Modify — accept bonusCoins, pass to breakdown |
| `admin/index.html` | Modify — ghostPointCount in Edit + Create forms |

---

### Task 1: DB migration

**Files:**
- Create: `server/migrations/0006_add_ghost_point_count.sql`
- Modify: `server/schema.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- server/migrations/0006_add_ghost_point_count.sql
-- Adds ghost_point_count column to heap. DEFAULT 1 backfills all existing rows
-- automatically — no separate UPDATE needed.
ALTER TABLE heap ADD COLUMN ghost_point_count INTEGER NOT NULL DEFAULT 1;
```

- [ ] **Step 2: Update server/schema.sql**

Find the `CREATE TABLE IF NOT EXISTS heap` block in `server/schema.sql`. Add `ghost_point_count INTEGER NOT NULL DEFAULT 1` after the `top_y` line:

```sql
  top_y           REAL    NOT NULL DEFAULT 0,
  ghost_point_count INTEGER NOT NULL DEFAULT 1
```

- [ ] **Step 3: Apply migration to local dev DB**

```bash
cd server && npx wrangler d1 migrations apply heap-db --local
```

Expected: `✅ Migration 0006_add_ghost_point_count.sql applied successfully`

- [ ] **Step 4: Commit**

```bash
git add server/migrations/0006_add_ghost_point_count.sql server/schema.sql
git commit -m "feat: add ghost_point_count column to heap table"
```

---

### Task 2: DB layer — HeapRow, D1HeapDB, MockHeapDB

**Files:**
- Modify: `server/src/db.ts`
- Modify: `server/tests/helpers/mockDb.ts`

- [ ] **Step 1: Add ghost_point_count to HeapRow and HeapSummaryRow in server/src/db.ts**

In both `HeapRow` and `HeapSummaryRow` interfaces, add after `top_y`:
```typescript
  ghost_point_count: number;
```

- [ ] **Step 2: Update D1HeapDB.listHeaps SQL**

Change the SELECT to include `ghost_point_count`:
```typescript
'SELECT id, version, created_at, name, difficulty, spawn_rate_mult, coin_mult, score_mult, world_height, top_y, ghost_point_count FROM heap'
```

- [ ] **Step 3: Update D1HeapDB.getHeap SQL**

```typescript
'SELECT id, base_id, live_zone, freeze_y, version, created_at, name, difficulty, spawn_rate_mult, coin_mult, score_mult, world_height, top_y, ghost_point_count FROM heap WHERE id = ?1'
```

- [ ] **Step 4: Update D1HeapDB.createHeap SQL and bind**

Replace the INSERT in createHeap:
```typescript
this.d1
  .prepare(
    `INSERT INTO heap (id, base_id, live_zone, freeze_y, version, created_at,
                       name, difficulty, spawn_rate_mult, coin_mult, score_mult, world_height, top_y,
                       ghost_point_count)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
  )
  .bind(
    heapId, baseId, '[]', 0, 1, now,
    params.name, params.difficulty,
    params.spawnRateMult, params.coinMult, params.scoreMult, params.worldHeight,
    initialTopY,
    params.ghostPointCount,
  ),
```

- [ ] **Step 5: Update D1HeapDB.updateHeapParams SQL and bind**

```typescript
async updateHeapParams(id: string, params: HeapParams): Promise<void> {
  await this.d1
    .prepare(
      `UPDATE heap SET name = ?1, difficulty = ?2, spawn_rate_mult = ?3, coin_mult = ?4, score_mult = ?5, world_height = ?6, ghost_point_count = ?7
       WHERE id = ?8`,
    )
    .bind(params.name, params.difficulty, params.spawnRateMult, params.coinMult, params.scoreMult, params.worldHeight, params.ghostPointCount, id)
    .run();
}
```

- [ ] **Step 6: Update MockHeapDB — createHeap, updateHeapParams, seedHeap**

In `MockHeapDB.createHeap`, add `ghost_point_count: params.ghostPointCount` to the stored object after `top_y`:
```typescript
this.heaps.set(heapId, {
  // ... existing fields ...
  top_y: initialTopY,
  ghost_point_count: params.ghostPointCount,
});
```

In `MockHeapDB.updateHeapParams`, add `ghost_point_count: params.ghostPointCount` to the spread:
```typescript
this.heaps.set(id, {
  ...existing,
  name:             params.name,
  difficulty:       params.difficulty,
  spawn_rate_mult:  params.spawnRateMult,
  coin_mult:        params.coinMult,
  score_mult:       params.scoreMult,
  world_height:     params.worldHeight,
  ghost_point_count: params.ghostPointCount,
});
```

In `MockHeapDB.seedHeap`, add `ghost_point_count: params.ghostPointCount` to the stored object:
```typescript
this.heaps.set(id, {
  // ... existing fields ...
  world_height:    params.worldHeight,
  top_y: 0,
  ghost_point_count: params.ghostPointCount,
});
```

Also update `MockHeapDB.listHeaps` to include `ghost_point_count`:
```typescript
return Array.from(this.heaps.entries()).map(([id, row]) => ({
  // ... existing fields ...
  top_y:             row.top_y,
  ghost_point_count: row.ghost_point_count,
}));
```

- [ ] **Step 7: Run tests to confirm no regressions**

```bash
cd server && npm test
```

Expected: all existing tests pass (TypeScript will error if any code uses the old interfaces).

- [ ] **Step 8: Commit**

```bash
git add server/src/db.ts server/tests/helpers/mockDb.ts
git commit -m "feat: wire ghost_point_count through DB interfaces and MockHeapDB"
```

---

### Task 3: Shared types

**Files:**
- Modify: `shared/heapTypes.ts`

- [ ] **Step 1: Add ghostPointCount to HeapParams**

In the `HeapParams` interface, add after `isInfinite`:
```typescript
  ghostPointCount: number;  // random extra points added per accepted placement
```

- [ ] **Step 2: Add default to DEFAULT_HEAP_PARAMS**

```typescript
export const DEFAULT_HEAP_PARAMS: HeapParams = {
  name: 'Unnamed Heap',
  difficulty: 1.0,
  spawnRateMult: 1.0,
  coinMult: 1.0,
  scoreMult: 1.0,
  worldHeight: 50_000,
  ghostPointCount: 1,
};
```

- [ ] **Step 3: Add bonusCoins to PlaceResponse**

```typescript
export interface PlaceResponse {
  accepted: boolean;
  version: number;
  bonusCoins?: number;
}
```

- [ ] **Step 4: Run both test suites to confirm no TypeScript errors**

```bash
cd /path/to/HeapGame && npm test && cd server && npm test
```

Expected: passing. If TypeScript complains about `ghostPointCount` missing in any spread/object literal, add it there.

- [ ] **Step 5: Commit**

```bash
git add shared/heapTypes.ts
git commit -m "feat: add ghostPointCount to HeapParams and bonusCoins to PlaceResponse"
```

---

### Task 4: Server routes — resolveParams, place handler, params handlers

**Files:**
- Modify: `server/src/routes/heap.ts`

- [ ] **Step 1: Add ghost + bonus constants near top of file (after existing constants)**

After `const HEAP_TOP_ZONE_PX = 300;` add:
```typescript
const OFF_PEAK_THRESHOLD_PX = 100; // px below top_y that earns off-peak bonus
const OFF_PEAK_BONUS_COINS  = 10;  // flat coins awarded for off-peak placement
```

- [ ] **Step 2: Add ghostPointCount to resolveParams**

After the `scoreMult` validation loop in `resolveParams`, add:
```typescript
  merged.ghostPointCount = Math.max(0, Math.floor(merged.ghostPointCount ?? 1));
```

- [ ] **Step 3: Add ghostPointCount to GET /heaps list mapping**

In the `app.get('/')` handler's `rows.map(...)`, add `ghostPointCount` to the params shape:
```typescript
params: {
  name:            r.name,
  difficulty:      r.difficulty,
  spawnRateMult:   r.spawn_rate_mult,
  coinMult:        r.coin_mult,
  scoreMult:       r.score_mult,
  worldHeight:     r.world_height,
  ghostPointCount: r.ghost_point_count,
},
```

- [ ] **Step 4: Add ghostPointCount to GET /heaps/:id mapping**

In the `app.get('/:id')` handler's `changed: true` response:
```typescript
params: {
  name:            row.name,
  difficulty:      row.difficulty,
  spawnRateMult:   row.spawn_rate_mult,
  coinMult:        row.coin_mult,
  scoreMult:       row.score_mult,
  worldHeight:     row.world_height,
  ghostPointCount: row.ghost_point_count,
},
```

- [ ] **Step 5: Add ghostPointCount to PUT /heaps/:id/params merge**

In the `resolveParams({...})` call inside `app.put('/:id/params')`:
```typescript
const merged = resolveParams({
  name:            body.name           ?? existing.name,
  difficulty:      body.difficulty     ?? existing.difficulty,
  spawnRateMult:   body.spawnRateMult  ?? existing.spawn_rate_mult,
  coinMult:        body.coinMult       ?? existing.coin_mult,
  scoreMult:       body.scoreMult      ?? existing.score_mult,
  worldHeight:     existing.world_height,
  ghostPointCount: body.ghostPointCount ?? existing.ghost_point_count,
});
```

- [ ] **Step 6: Add ghostPointCount to PUT /heaps/:id/reset merge**

In the `const merged: HeapParams = {...}` inside `app.put('/:id/reset')`:
```typescript
const merged: HeapParams = {
  name:            bodyParams.name            ?? row.name,
  difficulty:      bodyParams.difficulty      ?? row.difficulty,
  spawnRateMult:   bodyParams.spawnRateMult   ?? row.spawn_rate_mult,
  coinMult:        bodyParams.coinMult        ?? row.coin_mult,
  scoreMult:       bodyParams.scoreMult       ?? row.score_mult,
  worldHeight:     bodyParams.worldHeight     ?? row.world_height,
  ghostPointCount: bodyParams.ghostPointCount ?? row.ghost_point_count,
};
```

- [ ] **Step 7: Insert ghost points and compute bonusCoins in POST /heaps/:id/place**

Find the section after the `liveZone.splice(insertIdx, 0, newVertex)` / `liveZone.push(newVertex)` block (where player point is inserted) and before the `checkFreeze` call. Add:

```typescript
    // Ghost points: spread heap shape without player input
    const ghostCount = Math.max(0, Math.floor(row.ghost_point_count ?? 1));
    for (let i = 0; i < ghostCount; i++) {
      const gx = PLACE_X_MIN + Math.random() * (PLACE_X_MAX - PLACE_X_MIN);
      const gy = row.top_y + Math.random() * (liveZoneBottomY - row.top_y);
      const gv: Vertex = { x: gx, y: gy };
      const gIdx = liveZone.findIndex((v) => v.y > gy);
      if (gIdx === -1) liveZone.push(gv); else liveZone.splice(gIdx, 0, gv);
    }

    const bonusCoins = y > row.top_y + OFF_PEAK_THRESHOLD_PX ? OFF_PEAK_BONUS_COINS : undefined;
```

- [ ] **Step 8: Return bonusCoins in the place response**

Change the final `return c.json(...)` in the place handler from:
```typescript
    return c.json({ accepted: true, version: newVersion } satisfies PlaceResponse);
```
to:
```typescript
    return c.json({ accepted: true, version: newVersion, bonusCoins } satisfies PlaceResponse);
```

- [ ] **Step 9: Run server tests**

```bash
cd server && npm test
```

Expected: all existing tests still pass. TypeScript will verify the `satisfies PlaceResponse` shape includes `bonusCoins?`.

- [ ] **Step 10: Commit**

```bash
git add server/src/routes/heap.ts
git commit -m "feat: server place handler inserts ghost points and returns off-peak bonus"
```

---

### Task 5: Server tests — ghost points and bonusCoins (TDD)

**Files:**
- Modify: `server/tests/routes.test.ts`

- [ ] **Step 1: Write failing test — ghost points count**

Add inside the `describe('POST /heaps/:id/place', ...)` block:

```typescript
  it('inserts ghostPointCount extra points into liveZone alongside the player point', async () => {
    const db = new MockHeapDB();
    const params: HeapParams = { ...DEFAULT_HEAP_PARAMS, ghostPointCount: 2 };
    db.seedHeap('h1', 1, [], 'base-1', 0, params);
    db.seedBase('base-1', 'h1', []);

    const app = createApp(db, new MockScoreDB());
    const res = await app.request('/heaps/h1/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 300, y: 150 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as PlaceResponse;
    expect(body.accepted).toBe(true);

    // Fetch the heap and verify liveZone has 1 player + 2 ghost = 3 points
    const heapRes = await app.request('/heaps/h1?version=0');
    const heap = await heapRes.json() as Extract<GetHeapResponse, { changed: true }>;
    expect(heap.liveZone).toHaveLength(3);
  });

  it('inserts zero ghost points when ghostPointCount is 0', async () => {
    const db = new MockHeapDB();
    const params: HeapParams = { ...DEFAULT_HEAP_PARAMS, ghostPointCount: 0 };
    db.seedHeap('h1', 1, [], 'base-1', 0, params);
    db.seedBase('base-1', 'h1', []);

    const app = createApp(db, new MockScoreDB());
    const res = await app.request('/heaps/h1/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 300, y: 150 }),
    });
    const heap = await (await app.request('/heaps/h1?version=0')).json() as Extract<GetHeapResponse, { changed: true }>;
    expect(heap.liveZone).toHaveLength(1); // only player point
  });
```

- [ ] **Step 2: Write failing test — bonusCoins**

Also add inside the same `describe` block (top_y defaults to 0 in seedHeap, so threshold is at y > 100):

```typescript
  it('returns bonusCoins when placement is more than 100px below top_y', async () => {
    const db = new MockHeapDB();
    db.seedHeap('h1', 1, [], 'base-1', 0, { ...DEFAULT_HEAP_PARAMS, ghostPointCount: 0 });
    db.seedBase('base-1', 'h1', []);

    const res = await createApp(db, new MockScoreDB()).request('/heaps/h1/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 300, y: 101 }), // 101 > 0 + 100
    });
    const body = await res.json() as PlaceResponse;
    expect(body.accepted).toBe(true);
    expect(body.bonusCoins).toBe(10);
  });

  it('does not return bonusCoins when placement is at or within 100px of top_y', async () => {
    const db = new MockHeapDB();
    db.seedHeap('h1', 1, [], 'base-1', 0, { ...DEFAULT_HEAP_PARAMS, ghostPointCount: 0 });
    db.seedBase('base-1', 'h1', []);

    const res = await createApp(db, new MockScoreDB()).request('/heaps/h1/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 300, y: 100 }), // 100 is NOT > 100
    });
    const body = await res.json() as PlaceResponse;
    expect(body.accepted).toBe(true);
    expect(body.bonusCoins).toBeUndefined();
  });
```

- [ ] **Step 3: Run tests to see them fail**

```bash
cd server && npm test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|✓|✗|ghost|bonus"
```

Expected: the four new tests fail.

- [ ] **Step 4: Confirm tests pass after Task 4 implementation**

```bash
cd server && npm test
```

Expected: all tests pass. If any fail, re-check the ghost insertion and bonusCoins logic in `heap.ts`.

- [ ] **Step 5: Commit**

```bash
git add server/tests/routes.test.ts
git commit -m "test: ghost point count and off-peak bonusCoins in place handler"
```

---

### Task 6: coinBreakdown — off_peak_bonus row (TDD)

**Files:**
- Modify: `src/systems/coinBreakdown.ts`
- Modify: `src/systems/__tests__/coinBreakdown.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `src/systems/__tests__/coinBreakdown.test.ts`:

```typescript
  it('adds off_peak_bonus row when offPeakBonus > 0', () => {
    const result = buildCoinBreakdown({
      score: 500,
      scoreToCoins: 100,
      moneyMultiplier: 1,
      isPeak: false,
      peakMultiplier: 1.25,
      isFailure: false,
      offPeakBonus: 10,
    });
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]).toEqual({ type: 'off_peak_bonus', multiplier: 10, runningTotal: 15 });
    expect(result.finalCoins).toBe(15);
  });

  it('does NOT add off_peak_bonus row when offPeakBonus is 0 or absent', () => {
    const result = buildCoinBreakdown({
      score: 500,
      scoreToCoins: 100,
      moneyMultiplier: 1,
      isPeak: false,
      peakMultiplier: 1.25,
      isFailure: false,
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].type).toBe('base');
  });

  it('applies off_peak_bonus before death_penalty when both present', () => {
    const result = buildCoinBreakdown({
      score: 500,
      scoreToCoins: 100,
      moneyMultiplier: 1,
      isPeak: false,
      peakMultiplier: 1.25,
      isFailure: true,
      offPeakBonus: 10,
    });
    // base: 5, off_peak_bonus: +10 = 15, death_penalty: floor(15 * 0.5) = 7
    expect(result.rows[1]).toEqual({ type: 'off_peak_bonus', multiplier: 10, runningTotal: 15 });
    expect(result.rows[2]).toEqual({ type: 'death_penalty', multiplier: 0.5, runningTotal: 7 });
    expect(result.finalCoins).toBe(7);
  });
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- src/systems/__tests__/coinBreakdown.test.ts
```

Expected: the three new tests fail with "Expected ... to have length 2" etc.

- [ ] **Step 3: Update MultiplierRow union type**

In `src/systems/coinBreakdown.ts`, change:
```typescript
export type MultiplierRow = {
  type: 'money_mult' | 'heap_coin_mult' | 'peak_hunter' | 'death_penalty' | 'off_peak_bonus';
  multiplier: number;
  runningTotal: number;
};
```

- [ ] **Step 4: Add offPeakBonus to BreakdownInput**

```typescript
export interface BreakdownInput {
  score:           number;
  scoreToCoins:    number;
  moneyMultiplier: number;
  heapCoinMult?:   number;
  isPeak:          boolean;
  peakMultiplier:  number;
  isFailure:       boolean;
  offPeakBonus?:   number;  // flat coins added when placement is off-peak
}
```

- [ ] **Step 5: Insert off_peak_bonus row in buildCoinBreakdown**

Add between the `heap_coin_mult` and `peak_hunter` checks:
```typescript
  if ((input.offPeakBonus ?? 0) > 0) {
    running += input.offPeakBonus!;
    rows.push({ type: 'off_peak_bonus', multiplier: input.offPeakBonus!, runningTotal: running });
  }
```

Note: insert it BEFORE the `death_penalty` check so the order is: base → money_mult → heap_coin_mult → off_peak_bonus → peak_hunter → death_penalty.

Wait — check the spec: off_peak_bonus is added AFTER existing rows. Specifically, the spec says "pushes a flat-add row after the existing rows" and the death_penalty test above expects off_peak_bonus before death_penalty. Insert between heap_coin_mult and peak_hunter so both the peak bonus and death penalty apply on top of it.

- [ ] **Step 6: Run tests to confirm they pass**

```bash
npm test -- src/systems/__tests__/coinBreakdown.test.ts
```

Expected: all tests including the three new ones pass.

- [ ] **Step 7: Commit**

```bash
git add src/systems/coinBreakdown.ts src/systems/__tests__/coinBreakdown.test.ts
git commit -m "feat: add off_peak_bonus flat-add row to buildCoinBreakdown"
```

---

### Task 7: HeapClient.append — return PlaceResponse | null

**Files:**
- Modify: `src/systems/HeapClient.ts`
- Modify: `src/systems/__tests__/HeapClient.test.ts`

- [ ] **Step 1: Update the import in HeapClient.ts**

`PlaceResponse` is already in `shared/heapTypes.ts`. Add it to the import at the top of `src/systems/HeapClient.ts`:
```typescript
import type { ..., PlaceResponse } from '../../shared/heapTypes';
```
(Check the existing import line and add `PlaceResponse` to whatever is already imported from heapTypes.)

- [ ] **Step 2: Change append signature and implementation**

Replace the `append` method:
```typescript
  static async append(heapId: string, x: number, y: number): Promise<PlaceResponse | null> {
    try {
      const res = await fetchWithLog(`${SERVER_URL}/heaps/${heapId}/place`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x, y }),
      });
      if (!res.ok) return null;
      return await res.json() as PlaceResponse;
    } catch {
      return null;
    }
  }
```

- [ ] **Step 3: Update the network-error test in HeapClient.test.ts**

Find the test `'does not throw on network error'` and change `.toBeUndefined()` to `.toBeNull()`:
```typescript
  it('does not throw on network error', async () => {
    const heapId = 'heap-guid-007';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')));

    await expect(HeapClient.append(heapId, 100, 200)).resolves.toBeNull();
  });
```

- [ ] **Step 4: Run client tests**

```bash
npm test -- src/systems/__tests__/HeapClient.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/systems/HeapClient.ts src/systems/__tests__/HeapClient.test.ts
git commit -m "feat: HeapClient.append returns PlaceResponse | null instead of void"
```

---

### Task 8: GameScene — capture bonusCoins and pass to ScoreScene

**Files:**
- Modify: `src/scenes/GameScene.ts`

- [ ] **Step 1: Capture bonusCoins in placeBlock()**

In `GameScene.placeBlock()`, find:
```typescript
    const appendDone = HeapClient.append(this._heapId, px, py).then(() =>
      HeapClient.load(this._heapId),
    ).then(freshPolygon => {
```

Replace with:
```typescript
    let bonusCoinsFromServer = 0;
    const appendDone = HeapClient.append(this._heapId, px, py).then(placeResp => {
      bonusCoinsFromServer = placeResp?.bonusCoins ?? 0;
      return HeapClient.load(this._heapId);
    }).then(freshPolygon => {
```

- [ ] **Step 2: Pass bonusCoins to ScoreScene launch**

Find the `this.scene.launch('ScoreScene', {` call (inside the `appendDone.then(...)` callback ~2000ms delayed). Add `bonusCoins: bonusCoinsFromServer` to the object:
```typescript
        this.scene.launch('ScoreScene', {
          score:        runResult.finalScore,
          heapId:       this._heapId,
          isPeak,
          baseHeightPx,
          kills:        this._runKills,
          elapsedMs,
          heapParams:   this._heapParams,
          bonusCoins:   bonusCoinsFromServer,
        });
```

- [ ] **Step 3: Run build to confirm no TypeScript errors**

```bash
npm run build 2>&1 | grep -E "error|warning" | head -20
```

Expected: no errors. If ScoreScene's `init` doesn't yet accept `bonusCoins`, the build will warn — that's fixed in Task 9.

- [ ] **Step 4: Commit**

```bash
git add src/scenes/GameScene.ts
git commit -m "feat: GameScene captures bonusCoins from PlaceResponse and passes to ScoreScene"
```

---

### Task 9: ScoreScene — accept bonusCoins and display in breakdown

**Files:**
- Modify: `src/scenes/ScoreScene.ts`

- [ ] **Step 1: Add bonusCoins field to ScoreScene**

Add a private field at the top with the other private fields:
```typescript
  private _bonusCoins: number = 0;
```

- [ ] **Step 2: Read bonusCoins in init()**

In the `init(data: { ... })` method, add `bonusCoins?` to the data type and assignment:
```typescript
    bonusCoins?:         number;
```
And in the body:
```typescript
    this._bonusCoins = data.bonusCoins ?? 0;
```

- [ ] **Step 3: Pass bonusCoins to buildCoinBreakdown**

In `create()`, find the `buildCoinBreakdown({...})` call and add `offPeakBonus`:
```typescript
    const result = buildCoinBreakdown({
      score:           this.score,
      scoreToCoins:    SCORE_TO_COINS_DIVISOR,
      moneyMultiplier: cfg.moneyMultiplier,
      heapCoinMult:    this._heapParams.coinMult,
      isPeak:          this.isPeak,
      peakMultiplier:  cfg.peakMultiplier,
      isFailure:       this.isFailure,
      offPeakBonus:    this._bonusCoins,
    });
```

- [ ] **Step 4: Add off_peak_bonus to rowLabel()**

In the `rowLabel()` private method, add `'off_peak_bonus'` to the type union and the labels map:

Change the method signature:
```typescript
  private rowLabel(type: 'money_mult' | 'heap_coin_mult' | 'peak_hunter' | 'death_penalty' | 'off_peak_bonus'): string {
```

Add to the labels map:
```typescript
      off_peak_bonus: 'Off-peak Bonus \u{1F4E6}',
```

- [ ] **Step 5: Add off_peak_bonus to ROW_COLORS in createCoinsPanel()**

In `createCoinsPanel()`, find the `ROW_COLORS` object and add:
```typescript
      off_peak_bonus: { accent: 0x44aaff, accentHex: '#44aaff', labelHex: '#88ccff' },
```

- [ ] **Step 6: Run build and full test suite**

```bash
npm run build 2>&1 | grep error
npm test
```

Expected: no TypeScript errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/scenes/ScoreScene.ts
git commit -m "feat: ScoreScene displays off-peak bonus in coin breakdown"
```

---

### Task 10: Admin UI �� ghostPointCount fields

**Files:**
- Modify: `admin/index.html`

- [ ] **Step 1: Add ghostPointCount input to Edit Params form**

Find the Edit Params form section (elements with `id="ep-*"`). After the `ep-scoreMult` row and before the locked `ep-worldHeight` row, add:
```html
<div><label>ghostPointCount</label><input type="number" step="1" min="0" id="ep-ghostPointCount" /></div>
```

- [ ] **Step 2: Populate ghostPointCount in openEditPanel**

Find the `openEditPanel` function (or wherever `ep-scoreMult` is set). After `$('ep-scoreMult').value = heap.params.scoreMult;`, add:
```javascript
$('ep-ghostPointCount').value = heap.params.ghostPointCount ?? 1;
```

- [ ] **Step 3: Read ghostPointCount in the Edit save handler**

Find where `scoreMult` is read from the edit form (e.g. `parseFloat($('ep-scoreMult').value)`). After it, add:
```javascript
ghostPointCount: parseInt($('ep-ghostPointCount').value, 10) || 1,
```
Include it in the PUT /heaps/:id/params request body.

- [ ] **Step 4: Add ghostPointCount input to Create Heap form**

Find the Create Heap form section (elements with `id="cp-*"`). After the `cp-scoreMult` row, add:
```html
<div><label>ghostPointCount</label><input type="number" step="1" min="0" id="cp-ghostPointCount" value="1" /></div>
```

- [ ] **Step 5: Read ghostPointCount in the Create handler**

Find where `scoreMult` is read from the create form. After it, add:
```javascript
ghostPointCount: parseInt($('cp-ghostPointCount').value, 10) || 1,
```
Include it in the POST /heaps request body params.

- [ ] **Step 6: Commit**

```bash
git add admin/index.html
git commit -m "feat: add ghostPointCount to admin UI edit and create forms"
```

---

### Task 11: Final checks

- [ ] **Step 1: Run full client test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run full server test suite**

```bash
cd server && npm test
```

Expected: all tests pass.

- [ ] **Step 3: Run build**

```bash
cd /path/to/HeapGame && npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 4: Apply migration to production (when ready to ship)**

```bash
cd server && npx wrangler d1 migrations apply heap-db --remote
```

---

## Spec note correction

The design spec at `docs/superpowers/specs/2026-05-17-ghost-points-and-off-peak-bonus-design.md` incorrectly stated "No DB migration needed — ghostPointCount lives in the existing params JSON column." This is wrong: heap params are individual columns, not JSON. Migration `0006_add_ghost_point_count.sql` (Task 1) is the correct approach. The spec document should be updated to reflect this — but since the plan documents the correct approach, this is informational only.

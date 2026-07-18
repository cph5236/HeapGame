# Heap Locking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock harder heaps behind easier ones — a heap with `lockedByHeapId` set is visually locked in the heap selector until the player beats the prerequisite heap (any successful block placement), configurable from the admin UI.

**Architecture:** A nullable `locked_by_heap_id` column on the `heap` table (heap_core D1) rides the existing params paths (list/get/create/update/reset) — every hand-written `HeapRow → HeapParams` literal is touched explicitly. The client persists `beatenHeapIds` in SaveData (required-with-default, cloud-merge union) and a pure `getLockState` resolver gates `select()` in HeapSelectScene. Server-side chain-walk validation rejects lock cycles.

**Tech Stack:** TypeScript 5.9, Hono on Cloudflare Workers, D1 (SQLite), Phaser 3.90, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-17-heap-locking-design.md`

## Global Constraints

- Work on branch `feature/heap-locking` (already created off main). Never push to main; PR at the end.
- Do NOT push after every commit — commit locally; push only when the user says to (global CLAUDE.md rule).
- `npm run build` must pass before any claim of "done" (catches TS errors tests miss).
- Schema change follows the `adding-d1-migrations` skill (two-file rule: migration file + updated `server/schema/heap_core.sql`).
- Fail open on the client: a `lockedByHeapId` pointing at a heap missing from the catalog never locks anything.
- "Beat" = any successful placement (`placeBlock()` in GameScene), at any height. Infinite mode untouched.
- End commit messages with the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Run all tests from the repo root: `npm test -- --run` (server tests are part of the same Vitest setup; scope with a path when iterating).

---

### Task 1: Shared type + heap_core migration

**Files:**
- Modify: `shared/heapTypes.ts`
- Create: `server/migrations/heap_core/0003_locked_by_heap.sql`
- Modify: `server/schema/heap_core.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `HeapParams.lockedByHeapId?: string | null` (optional; absent/null = unlocked). DB column `heap.locked_by_heap_id TEXT` (nullable). Later tasks rely on the exact spelling `lockedByHeapId` / `locked_by_heap_id`.

- [ ] **Step 1: Invoke the `adding-d1-migrations` skill** (Skill tool) and follow its workflow for the heap_core database. The concrete change is the two files below.

- [ ] **Step 2: Create the migration file**

`server/migrations/heap_core/0003_locked_by_heap.sql`:

```sql
-- heap_core / 0003_locked_by_heap.sql
-- Heap locking: a heap with locked_by_heap_id set is locked in the client
-- selector until the player beats that prerequisite heap. Nullable, no FK
-- (SQLite ALTER cannot add FKs; the client fails open on dangling pointers).

ALTER TABLE heap ADD COLUMN locked_by_heap_id TEXT;
```

- [ ] **Step 3: Update the consolidated schema** — in `server/schema/heap_core.sql`, add the column as the last line of the `heap` CREATE TABLE:

```sql
  negative_item_spawn_rate REAL NOT NULL DEFAULT 0.85,
  locked_by_heap_id TEXT
);
```

(Change the existing `negative_item_spawn_rate` line to end with a comma.)

- [ ] **Step 4: Add the field to `HeapParams`** in `shared/heapTypes.ts` (after `negativeItemSpawnRate`):

```ts
  negativeItemSpawnRate: number;  // weight for choosing a hindering item when one spawns
  /** Heap id the player must beat before this heap unlocks; null/absent = unlocked. */
  lockedByHeapId?: string | null;
```

`DEFAULT_HEAP_PARAMS` stays unchanged (field absent = unlocked).

- [ ] **Step 5: Apply the migration locally** using the skill's apply procedure for heap_core (local only — remote auto-applies on merge to main).

- [ ] **Step 6: Verify** — `npm run build` passes; the skill's local-verification step shows the column on `heap`.

- [ ] **Step 7: Commit**

```bash
git add shared/heapTypes.ts server/migrations/heap_core/0003_locked_by_heap.sql server/schema/heap_core.sql
git commit -m "feat(server): add heap.locked_by_heap_id column + HeapParams.lockedByHeapId

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Server — DB layers, route threading, cycle validation

**Files:**
- Modify: `server/src/db.ts`
- Modify: `server/tests/helpers/mockDb.ts`
- Modify: `server/src/routes/heap.ts`
- Create: `server/tests/heapLock.test.ts`

**Interfaces:**
- Consumes: Task 1's `lockedByHeapId` / `locked_by_heap_id` names.
- Produces: `HeapRow.locked_by_heap_id: string | null`, `HeapSummaryRow.locked_by_heap_id: string | null`; every params response includes `lockedByHeapId` (null when unset); `PUT /heaps/:id/params` accepts `lockedByHeapId: string | null` with 400 on unknown id / self-lock / cycle. **Explicit-null semantics:** `{ "lockedByHeapId": null }` clears the lock; omitting the key leaves it unchanged (`'lockedByHeapId' in body` checks, NOT `??` — `null ?? x` returns `x` and would make locks unclearable).

- [ ] **Step 1: Write the failing tests** — create `server/tests/heapLock.test.ts`:

```ts
// server/tests/heapLock.test.ts

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import type { CreateHeapResponse, ListHeapsResponse, GetHeapResponse } from '../../shared/heapTypes';

const VERTICES = [
  { x: 100, y: 400 },
  { x: 300, y: 600 },
  { x: 500, y: 400 },
];

function makeApp() {
  return createApp(new MockHeapDB(), new MockScoreDB(), {});
}
type App = ReturnType<typeof makeApp>;

async function createHeap(app: App, params: Record<string, unknown> = {}): Promise<string> {
  const res = await app.request('/heaps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vertices: VERTICES, params: { name: 'H', ...params } }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as CreateHeapResponse).id;
}

function setLock(app: App, heapId: string, lockedByHeapId: string | null) {
  return app.request(`/heaps/${heapId}/params`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lockedByHeapId }),
  });
}

async function lockOf(app: App, heapId: string): Promise<string | null | undefined> {
  const res = await app.request('/heaps');
  const body = (await res.json()) as ListHeapsResponse;
  return body.heaps.find(h => h.id === heapId)?.params.lockedByHeapId;
}

describe('heap locking — threading', () => {
  it('defaults to null and round-trips through list', async () => {
    const app = makeApp();
    const a = await createHeap(app);
    expect(await lockOf(app, a)).toBeNull();

    const b = await createHeap(app, { lockedByHeapId: a });
    expect(await lockOf(app, b)).toBe(a);
  });

  it('appears in GET /heaps/:id params', async () => {
    const app = makeApp();
    const a = await createHeap(app);
    const b = await createHeap(app, { lockedByHeapId: a });
    const res = await app.request(`/heaps/${b}`);
    const body = (await res.json()) as GetHeapResponse;
    expect(body.changed && body.params.lockedByHeapId).toBe(a);
  });

  it('PUT /params sets and explicit null clears; omitting the key preserves', async () => {
    const app = makeApp();
    const a = await createHeap(app);
    const b = await createHeap(app);

    expect((await setLock(app, b, a)).status).toBe(200);
    expect(await lockOf(app, b)).toBe(a);

    // Unrelated params edit without the key must NOT touch the lock.
    const res = await app.request(`/heaps/${b}/params`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coinMult: 2 }),
    });
    expect(res.status).toBe(200);
    expect(await lockOf(app, b)).toBe(a);

    expect((await setLock(app, b, null)).status).toBe(200);
    expect(await lockOf(app, b)).toBeNull();
  });

  it('reset preserves the lock (no body and params body)', async () => {
    const app = makeApp();
    const a = await createHeap(app);
    const b = await createHeap(app, { lockedByHeapId: a });

    expect((await app.request(`/heaps/${b}/reset`, { method: 'PUT' })).status).toBe(200);
    expect(await lockOf(app, b)).toBe(a);

    const res = await app.request(`/heaps/${b}/reset`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    });
    expect(res.status).toBe(200);
    expect(await lockOf(app, b)).toBe(a);
  });
});

describe('heap locking — validation', () => {
  it('rejects an unknown prerequisite id', async () => {
    const app = makeApp();
    const a = await createHeap(app);
    expect((await setLock(app, a, 'no-such-heap')).status).toBe(400);
  });

  it('rejects an unknown prerequisite on create', async () => {
    const app = makeApp();
    const res = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES, params: { name: 'H', lockedByHeapId: 'no-such-heap' } }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects self-lock', async () => {
    const app = makeApp();
    const a = await createHeap(app);
    expect((await setLock(app, a, a)).status).toBe(400);
  });

  it('rejects a direct A<->B cycle', async () => {
    const app = makeApp();
    const a = await createHeap(app);
    const b = await createHeap(app);
    expect((await setLock(app, b, a)).status).toBe(200);
    expect((await setLock(app, a, b)).status).toBe(400);
  });

  it('rejects the closing edit of an A->B->C->A cycle', async () => {
    const app = makeApp();
    const a = await createHeap(app);
    const b = await createHeap(app);
    const c = await createHeap(app);
    expect((await setLock(app, a, b)).status).toBe(200); // A locked by B
    expect((await setLock(app, b, c)).status).toBe(200); // B locked by C
    expect((await setLock(app, c, a)).status).toBe(400); // closes the cycle
  });

  it('accepts a valid linear chain', async () => {
    const app = makeApp();
    const a = await createHeap(app);
    const b = await createHeap(app);
    const c = await createHeap(app);
    expect((await setLock(app, b, a)).status).toBe(200);
    expect((await setLock(app, c, b)).status).toBe(200);
  });

  it('rejects a non-string non-null lockedByHeapId', async () => {
    const app = makeApp();
    const a = await createHeap(app);
    const res = await app.request(`/heaps/${a}/params`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lockedByHeapId: 42 }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -- --run server/tests/heapLock.test.ts`. Expected: FAIL (`lockedByHeapId` undefined in responses / statuses 200 instead of 400).

- [ ] **Step 3: Map the column in `server/src/db.ts`**

Add to BOTH `HeapRow` and `HeapSummaryRow` interfaces (after `negative_item_spawn_rate`):

```ts
  locked_by_heap_id: string | null;
```

`D1HeapDB.listHeaps` and `D1HeapDB.getHeap`: append `, locked_by_heap_id` to each SELECT column list.

`D1HeapDB.createHeap`: add the column and an 18th bind:

```ts
          `INSERT INTO heap (id, base_id, live_zone, freeze_y, version, created_at,
                             name, difficulty, spawn_rate_mult, coin_mult, score_mult, world_height, top_y, ghost_point_count,
                             base_item_spawn_rate, positive_item_spawn_rate, negative_item_spawn_rate, locked_by_heap_id)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)`,
```

with `params.lockedByHeapId ?? null` appended to `.bind(...)`.

`D1HeapDB.updateHeapParams`: add `locked_by_heap_id = ?11` to the SET list, shift the WHERE bind to `?12`, and bind `params.lockedByHeapId ?? null` before `id`.

- [ ] **Step 4: Map the column in `server/tests/helpers/mockDb.ts`** — add `locked_by_heap_id` to the object literals in `listHeaps` (from `row.locked_by_heap_id`), `createHeap` (`params.lockedByHeapId ?? null`), `updateHeapParams` (`params.lockedByHeapId ?? null`), and `seedHeap` (`params.lockedByHeapId ?? null`).

- [ ] **Step 5: Thread + validate in `server/src/routes/heap.ts`**

(a) In `resolveParams`, after the item-spawn-rate lines:

```ts
  // Heap lock pointer: string id or null (null/absent = unlocked). Existence
  // and cycle checks need DB access and run in validateLockTarget instead.
  if (merged.lockedByHeapId !== undefined && merged.lockedByHeapId !== null) {
    if (typeof merged.lockedByHeapId !== 'string' || merged.lockedByHeapId.length === 0 || merged.lockedByHeapId.length > MAX_ID_LEN) {
      return { error: 'lockedByHeapId must be a heap id string or null' };
    }
  }
```

(b) New async validator below `resolveParams`:

```ts
/**
 * DB-backed validation for a non-null lockedByHeapId. Walks the existing
 * lock chain from the proposed prerequisite: if it reaches the heap being
 * edited, this edit would close a lock cycle — every heap in a cycle is
 * permanently locked for every player (fail-open never triggers because no
 * prerequisite is missing), so cycles must be rejected here.
 */
async function validateLockTarget(db: HeapDB, heapId: string, lockedByHeapId: string): Promise<string | null> {
  const rows = await db.listHeaps();
  const lockedBy = new Map(rows.map((r) => [r.id, r.locked_by_heap_id ?? null]));
  if (!lockedBy.has(lockedByHeapId)) return 'lockedByHeapId must reference an existing heap';
  if (lockedByHeapId === heapId) return 'a heap cannot be locked by itself';
  let cursor: string | null = lockedByHeapId;
  for (let hops = 0; cursor !== null && hops <= lockedBy.size; hops++) {
    if (cursor === heapId) return 'lockedByHeapId would create a lock cycle';
    cursor = lockedBy.get(cursor) ?? null;
  }
  return null;
}
```

(c) POST `/` (create): after the `resolveParams` check, add:

```ts
    if (resolved.lockedByHeapId != null) {
      const lockErr = await validateLockTarget(db, '', resolved.lockedByHeapId);
      if (lockErr) return c.json({ error: lockErr }, 400);
    }
```

(The new heap's GUID doesn't exist yet, so `''` can never match — only the existence check can fire, which is exactly right for create.)

(d) GET `/` list literal and GET `/:id` params literal: add

```ts
          lockedByHeapId:  r.locked_by_heap_id ?? null,
```

(in GET `/:id` the variable is `row`, not `r`).

(e) PUT `/:id/reset`: in the `merged` literal add

```ts
        lockedByHeapId: 'lockedByHeapId' in bodyParams ? bodyParams.lockedByHeapId : row.locked_by_heap_id,
```

and before `await db.updateHeapParams(id, merged);`:

```ts
      if ('lockedByHeapId' in bodyParams && merged.lockedByHeapId != null) {
        const lockErr = await validateLockTarget(db, id, merged.lockedByHeapId);
        if (lockErr) return c.json({ error: lockErr }, 400);
      }
```

(f) PUT `/:id/params`: in the object passed to `resolveParams` add

```ts
      lockedByHeapId: 'lockedByHeapId' in body ? body.lockedByHeapId : existing.locked_by_heap_id,
```

and after the `'error' in merged` check:

```ts
    if ('lockedByHeapId' in body && merged.lockedByHeapId != null) {
      const lockErr = await validateLockTarget(db, id, merged.lockedByHeapId);
      if (lockErr) return c.json({ error: lockErr }, 400);
    }
```

- [ ] **Step 6: Run the tests** — `npm test -- --run server/tests/heapLock.test.ts` → all PASS; then the full suite `npm test -- --run` → no regressions (existing `routes.test.ts` params-shape assertions may need `lockedByHeapId: null` added if they use `toEqual` on full params objects — fix any that fail).

- [ ] **Step 7: `npm run build`** — passes.

- [ ] **Step 8: Commit**

```bash
git add server/src/db.ts server/src/routes/heap.ts server/tests/helpers/mockDb.ts server/tests/heapLock.test.ts
git commit -m "feat(server): thread lockedByHeapId through heap CRUD with chain-walk cycle validation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: SaveData — beatenHeapIds (required-with-default, merge union)

**Files:**
- Modify: `src/systems/SaveData.ts`
- Test: `src/systems/__tests__/SaveData.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `getBeatenHeapIds(): string[]`, `markHeapBeaten(heapId: string): void` exported from `src/systems/SaveData.ts`. `RawSave.beatenHeapIds: string[]` is **required** (not optional) so a missed line in `mergeCloudSave`'s hand-built return literal is a compile error, not a silent wipe.

- [ ] **Step 1: Write the failing tests** — append to `src/systems/__tests__/SaveData.test.ts` (import `getBeatenHeapIds, markHeapBeaten, mergeCloudSave` — `mergeCloudSave` and its `RawSave` type are already imported by the existing `describe('mergeCloudSave')` block at line ~542; reuse its save-builder helper if one exists, otherwise cast partials as shown):

```ts
describe('beatenHeapIds', () => {
  it('defaults to empty and marks heaps beaten with dedup', () => {
    expect(getBeatenHeapIds()).toEqual([]);
    markHeapBeaten('heap-1');
    markHeapBeaten('heap-1');
    markHeapBeaten('heap-2');
    expect(getBeatenHeapIds()).toEqual(['heap-1', 'heap-2']);
  });

  it('persists across cache reset', () => {
    markHeapBeaten('heap-1');
    resetCacheForTests();
    expect(getBeatenHeapIds()).toEqual(['heap-1']);
  });

  it('old saves without the field load with []', () => {
    store['heap_save'] = JSON.stringify({ schemaVersion: 5, balance: 10 });
    resetCacheForTests();
    expect(getBeatenHeapIds()).toEqual([]);
  });
});

describe('mergeCloudSave — beatenHeapIds', () => {
  it('unions local and cloud beaten heaps', () => {
    const local = { ...JSON.parse(JSON.stringify(baseSave())), beatenHeapIds: ['a', 'b'] };
    const cloud = { ...JSON.parse(JSON.stringify(baseSave())), beatenHeapIds: ['b', 'c'] };
    const merged = mergeCloudSave(local, cloud);
    expect([...merged.beatenHeapIds].sort()).toEqual(['a', 'b', 'c']);
  });

  it('tolerates a cloud save missing the field entirely', () => {
    const local = { ...baseSave(), beatenHeapIds: ['a'] };
    const cloud = baseSave() as any;
    delete cloud.beatenHeapIds;
    expect(mergeCloudSave(local, cloud).beatenHeapIds).toEqual(['a']);
  });

  it('playerSecret survives the merge (auth-lockout regression)', () => {
    const local = { ...baseSave(), playerSecret: 'secret-local' };
    const cloud = { ...baseSave(), balance: 999_999 };  // cloud wins primary
    expect(mergeCloudSave(local, cloud).playerSecret).toBe('secret-local');
  });
});
```

Define `baseSave()` above these describes (a complete `RawSave`; import the `RawSave` type from `../SaveData`) — unless the existing `mergeCloudSave` describe block (~line 542) already has an equivalent full-save builder, in which case reuse that and just add `beatenHeapIds: []` to it:

```ts
function baseSave(): RawSave {
  return {
    schemaVersion: 5,
    balance: 0,
    upgrades: {},
    inventory: {},
    placed: {},
    selectedHeapId: '',
    playerGuid: 'guid-test',
    playerName: 'Tester',
    highScores: {},
    beatenHeapIds: [],
    cosmeticsOwned: [],
    cosmeticsEquipped: {},
  };
}
```

If a playerSecret-survives-merge test already exists in the mergeCloudSave block, skip that one case.

- [ ] **Step 2: Run to verify failure** — `npm test -- --run src/systems/__tests__/SaveData.test.ts`. Expected: FAIL (`getBeatenHeapIds` not exported; TS error on `beatenHeapIds`).

- [ ] **Step 3: Implement in `src/systems/SaveData.ts`**

(a) `RawSave` — after `highScores`:

```ts
  /** Heaps this player has beaten (any successful placement). Required, not
   *  optional: mergeCloudSave returns a hand-built literal, and an optional
   *  field silently vanishes there instead of failing the build. */
  beatenHeapIds:  string[];
```

(b) `freshSave()` — after `highScores: {}`: `beatenHeapIds: [],`

(c) `migrate()` — in the `version === CURRENT_SCHEMA` branch, after `highScores`: `beatenHeapIds: parsed.beatenHeapIds ?? [],`. In the v1, v4, and v2→v3 branches, after `highScores`: `beatenHeapIds: [],` (pre-dates those schemas).

(d) New exports next to `getLocalHighScore` (~line 475):

```ts
// ── Beaten heaps (heap-lock feature) ─────────────────────────────────────────

export function getBeatenHeapIds(): string[] { return [...load().beatenHeapIds]; }

export function markHeapBeaten(heapId: string): void {
  const data = load();
  if (data.beatenHeapIds.includes(heapId)) return;
  data.beatenHeapIds.push(heapId);
  persist(data);
}
```

(e) `mergeCloudSave` — after the `cosmeticsOwned` union:

```ts
  // Union beaten heaps — a heap beaten on either device stays beaten.
  const beatenHeapIds = [...new Set([
    ...(local.beatenHeapIds ?? []), ...(cloud.beatenHeapIds ?? []),
  ])];
```

and in the return literal, after `highScores,`: `beatenHeapIds,`.

- [ ] **Step 4: Run the tests** — `npm test -- --run src/systems/__tests__/SaveData.test.ts` → PASS; `npm run build` → passes (this is what proves no other RawSave literal misses the required field — fix any that error).

- [ ] **Step 5: Commit**

```bash
git add src/systems/SaveData.ts src/systems/__tests__/SaveData.test.ts
git commit -m "feat(client): SaveData beatenHeapIds — required-with-default, cloud-merge union

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: GameScene — record the beat on successful placement

**Files:**
- Modify: `src/scenes/GameScene.ts:676-680`

**Interfaces:**
- Consumes: `markHeapBeaten` from Task 3.
- Produces: nothing new — side effect only.

- [ ] **Step 1: Implement** — in `src/scenes/GameScene.ts`, extend the existing SaveData import at line 51 (`import { addBalance, addItem } from '../systems/SaveData';`) with `markHeapBeaten`, and in `placeBlock()` immediately after `this.blockPlaced = true;`:

```ts
    // Any successful placement beats this heap — recorded before the outro so
    // a crash mid-animation can't lose it (unlocks lockedByHeapId dependents).
    markHeapBeaten(this._heapId);
```

- [ ] **Step 2: Verify** — `npm run build` passes (no unit test: Phaser scene, covered by the Task 8 smoke test). `grep -n "markHeapBeaten" src/scenes/GameScene.ts` shows exactly the import and the one call inside `placeBlock()` before the outro.

- [ ] **Step 3: Commit**

```bash
git add src/scenes/GameScene.ts
git commit -m "feat(client): record heap as beaten on successful placement

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Pure lock resolver

**Files:**
- Create: `src/scenes/heapLockLogic.ts`
- Test: `src/scenes/__tests__/heapLockLogic.test.ts`

**Interfaces:**
- Consumes: nothing (pure; structurally typed so tests don't need HeapSummary).
- Produces: `getLockState(heap, catalog, beatenIds)` returning `{ locked: false } | { locked: true; prereqName: string }` — Task 6 calls this from HeapSelectScene with `HeapSummary` values (which satisfy `LockableHeap` structurally).

- [ ] **Step 1: Write the failing tests** — `src/scenes/__tests__/heapLockLogic.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getLockState, type LockableHeap } from '../heapLockLogic';

const heap = (id: string, name: string, lockedByHeapId?: string | null): LockableHeap =>
  ({ id, params: { name, lockedByHeapId } });

describe('getLockState', () => {
  const easy = heap('easy', 'Easy Heap');
  const hard = heap('hard', 'Hard Heap', 'easy');
  const catalog = [easy, hard];

  it('unlocked when lockedByHeapId is absent or null', () => {
    expect(getLockState(easy, catalog, [])).toEqual({ locked: false });
    expect(getLockState(heap('x', 'X', null), catalog, [])).toEqual({ locked: false });
  });

  it('locked with prerequisite name when prereq exists and is unbeaten', () => {
    expect(getLockState(hard, catalog, [])).toEqual({ locked: true, prereqName: 'Easy Heap' });
  });

  it('unlocked once the prerequisite is beaten', () => {
    expect(getLockState(hard, catalog, ['easy'])).toEqual({ locked: false });
  });

  it('fails open when the prerequisite is missing from the catalog', () => {
    const orphan = heap('orphan', 'Orphan', 'deleted-heap');
    expect(getLockState(orphan, catalog, [])).toEqual({ locked: false });
  });

  it('beating an unrelated heap does not unlock', () => {
    expect(getLockState(hard, catalog, ['hard', 'other'])).toEqual({ locked: true, prereqName: 'Easy Heap' });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -- --run src/scenes/__tests__/heapLockLogic.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/scenes/heapLockLogic.ts`:

```ts
/**
 * Pure lock-state resolver for HeapSelectScene, extracted so it can be
 * unit-tested without a live Phaser scene (the scene classes import Phaser as
 * a value, which the Node test env can't load — same pattern as
 * heapSelectStats.ts).
 *
 * A heap is locked iff its lockedByHeapId is set, that heap exists in the
 * catalog, and the player has not beaten it. Fail open: a dangling pointer
 * (prerequisite deleted server-side) never locks a heap.
 */

export interface LockableHeap {
  id: string;
  params: { name: string; lockedByHeapId?: string | null };
}

export type LockState = { locked: false } | { locked: true; prereqName: string };

export function getLockState(
  heap: LockableHeap,
  catalog: readonly LockableHeap[],
  beatenIds: readonly string[],
): LockState {
  const prereqId = heap.params.lockedByHeapId;
  if (!prereqId) return { locked: false };
  const prereq = catalog.find((h) => h.id === prereqId);
  if (!prereq) return { locked: false };  // dangling pointer — fail open
  if (beatenIds.includes(prereqId)) return { locked: false };
  return { locked: true, prereqName: prereq.params.name };
}
```

- [ ] **Step 4: Run the tests** — `npm test -- --run src/scenes/__tests__/heapLockLogic.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scenes/heapLockLogic.ts src/scenes/__tests__/heapLockLogic.test.ts
git commit -m "feat(client): pure heap lock-state resolver with fail-open semantics

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: HeapSelectScene — locked rows + guarded select()

**Files:**
- Modify: `src/scenes/HeapSelectScene.ts`

**Interfaces:**
- Consumes: `getLockState` (Task 5), `getBeatenHeapIds` (Task 3).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Implement**

(a) Imports — add `getBeatenHeapIds` to the existing SaveData import (line 4) and add:

```ts
import { getLockState } from './heapLockLogic';
```

(b) Fields — add:

```ts
  private beatenIds: string[] = [];
  private starting = false;
```

(c) In `create()`, right after `this.sorted = ...` is assigned: `this.beatenIds = getBeatenHeapIds();`

(d) In `drawRow()`, change the row-tap registration from `once` to `on` (the `starting` guard below takes over double-start protection, and a denied tap on a locked row must not consume the handler):

```ts
    rowBg.on('pointerup', () => this.select(this.sorted[this.rowBgs.indexOf(rowBg)]));
```

(e) At the end of `drawRow()`, just before `return rowBg;` — dim locked rows and label them (added last so the overlay renders on top; it is NOT interactive, so the row and the trophy button underneath still receive input — the leaderboard stays peekable):

```ts
    const lock = getLockState(heap, this.sorted, this.beatenIds);
    if (lock.locked) {
      this.add.rectangle(
        logicalWidth(this) / 2, y + ROW_H / 2,
        logicalWidth(this) - 2 * ROW_PAD_X, ROW_H - 6,
        0x05060c, 0.62,
      );
      this.add.text(lx, midY, `🔒 Beat ${lock.prereqName} to unlock`, {
        fontSize: '15px', fontStyle: 'bold', color: '#ffcc88',
        stroke: '#000000', strokeThickness: 3,
      }).setOrigin(0, 0.5);
    }
```

(f) Guard `select()` itself — NOT the tap handler, because keyboard ENTER reaches `select()` through `confirmSelection()` and must be gated too:

```ts
  private select(heap: HeapSummary): void {
    const lock = getLockState(heap, this.sorted, this.beatenIds);
    if (lock.locked) {
      this.cameras.main.shake(120, 0.004);  // denial feedback
      return;
    }
    if (this.starting) return;  // double-start guard (replaces the old `once`)
    this.starting = true;

    setSelectedHeapId(heap.id);
    // ... rest of the existing method unchanged
```

- [ ] **Step 2: Verify visually** — invoke the `heap-scene-preview` skill for HeapSelectScene (the catalog comes from the server registry; the local seed/dev server must contain at least one heap whose `lockedByHeapId` points at another — set it via `PUT /heaps/:id/params` against the local worker if needed). Confirm: locked row dimmed with the 🔒 line; unlocked rows unchanged.

- [ ] **Step 3: `npm run build`** — passes; full `npm test -- --run` still green (the `HeapSelectScene.refreshYouStats.test.ts` scene test must not break).

- [ ] **Step 4: Commit**

```bash
git add src/scenes/HeapSelectScene.ts
git commit -m "feat(client): locked heap rows — dim overlay, unlock hint, guarded select()

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Admin UI — "Locked by" dropdown

**Files:**
- Modify: `admin/index.html`

**Interfaces:**
- Consumes: `PUT /heaps/:id/params` accepting `lockedByHeapId: string | null` (Task 2); `HeapSummary.params.lockedByHeapId` in the list payload.
- Produces: nothing.

- [ ] **Step 1: Add the control** — in the edit panel (~line 90), fill the empty `<div>` beside `negativeItemSpawnRate`:

```html
    <div class="row">
      <div><label>negativeItemSpawnRate (weight)</label><input type="number" step="0.05" min="0" id="ep-negativeItemSpawnRate" /></div>
      <div><label>Locked by <span class="muted">(player must beat first)</span></label><select id="ep-lockedBy"></select></div>
    </div>
```

- [ ] **Step 2: Populate it** — in `showEditPanel(heap)` (~line 336, after the `ep-worldHeight` line), listing every *other* heap by name:

```js
      const lockSel = $('ep-lockedBy');
      lockSel.innerHTML = '<option value="">None</option>' + cachedHeaps
        .filter(h => h.id !== heap.id)
        .map(h => `<option value="${h.id}">${escapeHtml(h.params.name)}</option>`)
        .join('');
      lockSel.value = heap.params.lockedByHeapId ?? '';
```

- [ ] **Step 3: Send it** — in `onSaveParams()` (~line 401), add to `body`:

```js
        lockedByHeapId: $('ep-lockedBy').value || null,
```

(Empty selection sends explicit `null`, which the server treats as "clear the lock" — required, since omitting the key means "leave unchanged".)

- [ ] **Step 4: Verify** — open the admin page against the local worker (per the admin page's own server-url field), edit a heap: dropdown lists the other heaps, saving a lock then re-opening the panel shows it selected, saving "None" clears it, and picking a heap that would close a cycle surfaces the server's 400 error in the status line.

- [ ] **Step 5: Commit**

```bash
git add admin/index.html
git commit -m "feat(admin): Locked-by dropdown on heap edit panel

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Final verification

**Files:** none new.

- [ ] **Step 1: Full suite + build** — `npm test -- --run` all green; `npm run build` passes.

- [ ] **Step 2: Smoke test** — invoke the `smoke-testing-heap` skill: with two local heaps A and B where B is locked by A — (1) selector shows B dimmed with "🔒 Beat A to unlock"; (2) tapping/ENTER on B shakes and does not start it; (3) B's leaderboard button still opens; (4) play A and place a block; (5) return to the selector — B is now unlocked and selectable.

- [ ] **Step 3: Verify the change end-to-end** — invoke the `verify` skill if the smoke test above did not already exercise every touched flow.

- [ ] **Step 4: Finish the branch** — invoke the `superpowers:finishing-a-development-branch` skill (expected outcome: PR to main; remote migration 0003 auto-applies on merge). Note the spec's rollout warning in the PR body: only lock newly added heaps — retroactively locking a live heap strands players who have played but never beaten it.

# Infinite Mode Server Params Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `InfiniteGameScene` consume the infinite heap's server DB params (enemy spawn config, spawn/coin/score multipliers) the way `GameScene` does for normal heaps, with the existing height-based difficulty curve layered on top.

**Architecture:** A real `heap` row for the infinite ID (`FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF`) already exists in prod and locally. The client gains a base-independent `HeapClient.primeEnemyParams` (via `GET /heaps/:id/enemy-params`, since the infinite heap has no base polygon). `BootScene` uses the real FFF catalog row (merged with the client-only `isInfinite: true` flag) instead of a fully synthetic entry, falling back to synthetic only when offline. `InfiniteGameScene` reads its params from the registry + enemy-params cache.

**Tech Stack:** TypeScript 5.9, Phaser 3.90, Vitest, Cloudflare Worker (Hono + D1).

## Global Constraints

- Branch off `main`; PR before merge, never push direct to main. (Work happens on `feature/infinite-server-params`, already created.)
- No new D1 migration — the infinite `heap` row already exists. No schema change.
- `npm run build` must pass before claiming done (catches TS errors tests miss).
- Leaderboard / score submission is OUT OF SCOPE — do not touch `scores.ts`, score-submission validation, or the `ScoreScene` submit path.
- Default multiplier values are `1.0`; the change must preserve current behavior when the DB holds defaults.

---

### Task 1: `HeapClient.primeEnemyParams`

Add a base-independent method that fetches a heap's enemy params from
`GET /heaps/:id/enemy-params` and writes them into the same localStorage cache
`getEnemyParams()` already reads, without requiring a base polygon fetch.

**Files:**
- Modify: `src/systems/HeapClient.ts` (add static method after `getEnemyParams`, ~`:181`)
- Test: `src/systems/__tests__/HeapClient.test.ts` (append a `describe` block)

**Interfaces:**
- Consumes: existing module-private `loadCache(heapId)`, `saveCache(heapId, cache)`, `fetchWithLog`, `SERVER_URL`, and `HeapCache` interface (`{ version; baseId; liveZone; enemyParams? }`).
- Produces: `static primeEnemyParams(heapId: string): Promise<void>` — after a successful call, `HeapClient.getEnemyParams(heapId)` returns the fetched params.

- [ ] **Step 1: Write the failing tests**

Append to `src/systems/__tests__/HeapClient.test.ts`:

```ts
// ── primeEnemyParams() ──────────────────────────────────────────────────────────

describe('HeapClient.primeEnemyParams', () => {
  const HEAP = 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF';
  const PARAMS = {
    percher: { spawnStartPxAboveFloor: 0, spawnEndPxAboveFloor: -1, spawnRampPxAboveFloor: 15000, spawnChanceMin: 0.15, spawnChanceMax: 0.45 },
  };

  it('fetches /enemy-params and makes getEnemyParams return them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => PARAMS }));
    await HeapClient.primeEnemyParams(HEAP);
    expect(global.fetch).toHaveBeenCalledWith(`${BASE}/heaps/${HEAP}/enemy-params`);
    expect(HeapClient.getEnemyParams(HEAP)).toEqual(PARAMS);
  });

  it('is a no-op on non-ok response (getEnemyParams stays null)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await HeapClient.primeEnemyParams(HEAP);
    expect(HeapClient.getEnemyParams(HEAP)).toBeNull();
  });

  it('is a no-op when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')));
    await expect(HeapClient.primeEnemyParams(HEAP)).resolves.toBeUndefined();
    expect(HeapClient.getEnemyParams(HEAP)).toBeNull();
  });

  it('merges enemyParams into an existing cache without clobbering liveZone/baseId', async () => {
    localStorageStub.setItem(
      `heap_cache_${HEAP}`,
      JSON.stringify({ version: 5, baseId: 'b1', liveZone: [{ x: 1, y: 2 }] }),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => PARAMS }));
    await HeapClient.primeEnemyParams(HEAP);
    const cache = JSON.parse(localStorageStub.getItem(`heap_cache_${HEAP}`)!);
    expect(cache.baseId).toBe('b1');
    expect(cache.liveZone).toEqual([{ x: 1, y: 2 }]);
    expect(cache.enemyParams).toEqual(PARAMS);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/systems/__tests__/HeapClient.test.ts -t primeEnemyParams`
Expected: FAIL — `HeapClient.primeEnemyParams is not a function`.

- [ ] **Step 3: Implement the method**

In `src/systems/HeapClient.ts`, add after the `getEnemyParams` method (around `:181`). Add the `HeapEnemyParams` import to the existing top-of-file type import from `../../shared/heapTypes` if not already present (it is).

```ts
  /**
   * Fetch a heap's enemy spawn config from the base-independent
   * GET /heaps/:id/enemy-params endpoint and cache it so getEnemyParams() can
   * read it synchronously. Used for the procedural infinite heap, which has no
   * base polygon and so cannot use load(). No-op on network failure — callers
   * fall back to DEFAULT_ENEMY_PARAMS.
   */
  static async primeEnemyParams(heapId: string): Promise<void> {
    try {
      const res = await fetchWithLog(`${SERVER_URL}/heaps/${heapId}/enemy-params`);
      if (!res.ok) return;
      const enemyParams = (await res.json()) as HeapEnemyParams;
      const cache = loadCache(heapId) ?? { version: 0, baseId: '', liveZone: [] };
      saveCache(heapId, { ...cache, enemyParams });
    } catch {
      // silent — caller falls back to DEFAULT_ENEMY_PARAMS
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/systems/__tests__/HeapClient.test.ts -t primeEnemyParams`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/systems/HeapClient.ts src/systems/__tests__/HeapClient.test.ts
git commit -m "feat: HeapClient.primeEnemyParams for base-independent enemy config fetch"
```

---

### Task 2: `buildInfiniteEntry` catalog helper + BootScene integration

Extract the infinite catalog entry into a pure, testable helper that prefers the
real server FFF row (merged with `isInfinite: true`) and falls back to a synthetic
entry when the server returns no infinite row. Wire it into `BootScene`.

**Files:**
- Create: `src/data/infiniteCatalog.ts`
- Create: `src/data/__tests__/infiniteCatalog.test.ts`
- Modify: `src/scenes/BootScene.ts:88-111` (replace the inline synthetic entry + dedupe)

**Interfaces:**
- Consumes: `INFINITE_HEAP_ID` (`src/data/infiniteDefs.ts`), `MOCK_HEAP_HEIGHT_PX` (`src/constants.ts`), `HeapSummary` (`shared/heapTypes.ts`).
- Produces: `buildInfiniteEntry(summaries: HeapSummary[]): HeapSummary` — returns the infinite catalog entry to append after dedupe. Always has `params.isInfinite === true`.

- [ ] **Step 1: Write the failing tests**

Create `src/data/__tests__/infiniteCatalog.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildInfiniteEntry } from '../infiniteCatalog';
import { INFINITE_HEAP_ID } from '../infiniteDefs';
import type { HeapSummary } from '../../../shared/heapTypes';

function realRow(): HeapSummary {
  return {
    id: INFINITE_HEAP_ID,
    version: 1,
    createdAt: '2026-06-22T00:00:00.000Z',
    topY: 1,
    params: {
      name: 'Infinite', difficulty: 5, spawnRateMult: 2, coinMult: 3, scoreMult: 1.5,
      worldHeight: 50000000, ghostPointCount: 1,
      baseItemSpawnRate: 0.33, positiveItemSpawnRate: 0.15, negativeItemSpawnRate: 0.85,
    },
  };
}

describe('buildInfiniteEntry', () => {
  it('uses the real FFF row and forces isInfinite=true, preserving its mults', () => {
    const entry = buildInfiniteEntry([realRow(), { id: 'other' } as HeapSummary]);
    expect(entry.id).toBe(INFINITE_HEAP_ID);
    expect(entry.params.isInfinite).toBe(true);
    expect(entry.params.spawnRateMult).toBe(2);
    expect(entry.params.coinMult).toBe(3);
    expect(entry.params.scoreMult).toBe(1.5);
    expect(entry.params.worldHeight).toBe(50000000);
  });

  it('falls back to a synthetic entry when no FFF row is present', () => {
    const entry = buildInfiniteEntry([{ id: 'other' } as HeapSummary]);
    expect(entry.id).toBe(INFINITE_HEAP_ID);
    expect(entry.params.isInfinite).toBe(true);
    expect(entry.params.spawnRateMult).toBe(1.0);
    expect(entry.params.coinMult).toBe(1.0);
    expect(entry.params.scoreMult).toBe(1.0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/data/__tests__/infiniteCatalog.test.ts`
Expected: FAIL — cannot find module `../infiniteCatalog`.

- [ ] **Step 3: Create the helper**

Create `src/data/infiniteCatalog.ts`:

```ts
import type { HeapSummary } from '../../shared/heapTypes';
import { INFINITE_HEAP_ID } from './infiniteDefs';
import { MOCK_HEAP_HEIGHT_PX } from '../constants';

/** Offline / not-seeded fallback — keeps infinite playable without a server row. */
const SYNTHETIC_INFINITE_ENTRY: HeapSummary = {
  id: INFINITE_HEAP_ID,
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  topY: NaN,
  params: {
    name: 'Infinite Heap',
    difficulty: 5.0,
    spawnRateMult: 1.0,
    coinMult: 1.0,
    scoreMult: 1.0,
    worldHeight: MOCK_HEAP_HEIGHT_PX,
    isInfinite: true,
    ghostPointCount: 1,
    baseItemSpawnRate: 0.33,
    positiveItemSpawnRate: 0.15,
    negativeItemSpawnRate: 0.85,
  },
};

/**
 * Build the infinite-heap catalog entry. Prefers the real server FFF row (so DB
 * params drive the run), merging in the client-only `isInfinite` flag the DB has
 * no column for. Falls back to a synthetic entry when the server returned no
 * infinite row (offline / not seeded).
 */
export function buildInfiniteEntry(summaries: HeapSummary[]): HeapSummary {
  const real = summaries.find(s => s.id === INFINITE_HEAP_ID);
  if (!real) return SYNTHETIC_INFINITE_ENTRY;
  return { ...real, params: { ...real.params, isInfinite: true } };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/data/__tests__/infiniteCatalog.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire into BootScene**

In `src/scenes/BootScene.ts`, replace the inline `infiniteEntry` object and dedupe
(`:90-111`) with the helper. The current block is:

```ts
        const infiniteEntry: HeapSummary = {
          id: INFINITE_HEAP_ID,
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          topY: NaN,
          params: {
            name: 'Infinite Heap',
            difficulty: 5.0,
            spawnRateMult: 1.0,
            coinMult: 1.0,
            scoreMult: 1.0,
            worldHeight: MOCK_HEAP_HEIGHT_PX,
            isInfinite: true,
            ghostPointCount: 1,
            baseItemSpawnRate: 0.33,
            positiveItemSpawnRate: 0.15,
            negativeItemSpawnRate: 0.85,
          },
        };
        const deduped = summaries.filter(s => s.id !== INFINITE_HEAP_ID);
        deduped.push(infiniteEntry);
        this.game.registry.set('heapCatalog', deduped);
```

Replace with:

```ts
        const deduped = summaries.filter(s => s.id !== INFINITE_HEAP_ID);
        deduped.push(buildInfiniteEntry(summaries));
        this.game.registry.set('heapCatalog', deduped);
```

Add the import near the other `src/data` imports:

```ts
import { buildInfiniteEntry } from '../data/infiniteCatalog';
```

Then remove the now-unused `MOCK_HEAP_HEIGHT_PX` import from BootScene **only if**
it is no longer referenced elsewhere in the file (check: `grep -n MOCK_HEAP_HEIGHT_PX src/scenes/BootScene.ts`). If still used, leave it.

- [ ] **Step 6: Verify build + full client tests**

Run: `npm run build`
Expected: succeeds (no TS errors — e.g. unused import).
Run: `npx vitest run src/data/__tests__/infiniteCatalog.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/data/infiniteCatalog.ts src/data/__tests__/infiniteCatalog.test.ts src/scenes/BootScene.ts
git commit -m "feat: BootScene uses real infinite heap row, synthetic only as offline fallback"
```

---

### Task 3: Prime enemyParams on infinite selection

Cache the infinite heap's enemyParams before `InfiniteGameScene` starts, mirroring
the way the normal-heap path calls `HeapClient.load()`. Two call sites: the
`HeapSelectScene` infinite branch, and the `BootScene` auto-pick when infinite is
the stored selection.

This is Phaser scene wiring (not unit-testable in isolation); verified by build +
the Task 4 smoke test.

**Files:**
- Modify: `src/scenes/HeapSelectScene.ts:273-278` (infinite branch of `select`)
- Modify: `src/scenes/BootScene.ts:129` (the `pick` branch, before/around `HeapClient.load(pick.id)`)

**Interfaces:**
- Consumes: `HeapClient.primeEnemyParams` (Task 1), `INFINITE_HEAP_ID`.

- [ ] **Step 1: HeapSelectScene infinite branch**

In `src/scenes/HeapSelectScene.ts`, the infinite branch of `select` currently is:

```ts
    if (heap.params.isInfinite) {
      this.game.registry.set('heapPolygon', []);
      finalizeLegacyPlaced(heap.id);
      this.scene.start('MenuScene');
      return;
    }
```

Change to prime enemyParams before starting MenuScene (fire-and-forget is fine —
`getEnemyParams` falls back to default if it hasn't resolved, but awaiting keeps it
ready; use `.finally` to match the non-infinite branch's pattern):

```ts
    if (heap.params.isInfinite) {
      this.game.registry.set('heapPolygon', []);
      HeapClient.primeEnemyParams(heap.id).finally(() => {
        finalizeLegacyPlaced(heap.id);
        this.scene.start('MenuScene');
      });
      return;
    }
```

`HeapClient` is already imported in this file (used at `:280`).

- [ ] **Step 2: BootScene auto-pick branch**

In `src/scenes/BootScene.ts`, the auto-pick branch (`:129`) calls
`HeapClient.load(pick.id)`. The infinite heap's `load()` would 404 on its
placeholder base, so guard it and prime enemyParams instead when the pick is
infinite. Current:

```ts
        return HeapClient.load(pick.id).then((polygon) => {
          this.game.registry.set('heapPolygon', polygon);
          this.game.registry.set('heapCatalogReady', true);
          this.game.events.emit('heapCatalogReady');
        });
```

Replace with:

```ts
        const ready = () => {
          this.game.registry.set('heapCatalogReady', true);
          this.game.events.emit('heapCatalogReady');
        };
        if (pick.params.isInfinite) {
          this.game.registry.set('heapPolygon', []);
          return HeapClient.primeEnemyParams(pick.id).then(ready);
        }
        return HeapClient.load(pick.id).then((polygon) => {
          this.game.registry.set('heapPolygon', polygon);
          ready();
        });
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/scenes/HeapSelectScene.ts src/scenes/BootScene.ts
git commit -m "feat: prime infinite enemyParams on selection and auto-pick"
```

---

### Task 4: `InfiniteGameScene` consumes server params

Read the infinite heap's params from the registry + enemy-params cache and apply
them: enemy config, spawn-rate (DB mult × height curve), coin mult, score mult, and
the params forwarded to `ScoreScene`.

This is Phaser scene wiring; verified by build + browser smoke test against the
local FFF row.

**Files:**
- Modify: `src/scenes/InfiniteGameScene.ts` — imports, a `_heapParams` field, `:152`, `:408-412`, `handleStomp` reward (`:560`), `handleDeath` (`:491-526`).

**Interfaces:**
- Consumes: `HeapClient.getEnemyParams` (Task 1), registry `heapParams` (set by Task 2/3), `HeapParams`/`DEFAULT_HEAP_PARAMS`, `INFINITE_HEAP_ID`.

- [ ] **Step 1: Add imports + field**

In `src/scenes/InfiniteGameScene.ts`, add imports:

```ts
import { HeapClient } from '../systems/HeapClient';
import type { HeapParams } from '../../shared/heapTypes';
```

(`DEFAULT_HEAP_PARAMS` is already imported at `:58`.)

Add a field alongside the other private fields (near `:102`):

```ts
  private _heapParams!: HeapParams;
```

- [ ] **Step 2: Read params + apply enemy config in `create()`**

Near the top of `create()`, after `this.playerConfig = getPlayerConfig();` (`:133`),
read the registry params:

```ts
    this._heapParams = (this.game.registry.get('heapParams') as HeapParams | undefined) ?? DEFAULT_HEAP_PARAMS;
```

Then replace the hardcoded enemy params line (`:152`):

```ts
      em.setEnemyParams(DEFAULT_ENEMY_PARAMS);
```

with:

```ts
      em.setEnemyParams(HeapClient.getEnemyParams(INFINITE_HEAP_ID) ?? DEFAULT_ENEMY_PARAMS);
```

`DEFAULT_ENEMY_PARAMS` is already imported (`:28`); keep it as the fallback.

- [ ] **Step 3: Layer spawn-rate mult with the height curve**

In `update()`, the difficulty ramp (`:408-412`) currently is:

```ts
    const spawnMult = INFINITE_MIN_SPAWN_MULT +
      factor * (INFINITE_MAX_SPAWN_MULT - INFINITE_MIN_SPAWN_MULT);

    for (const em of this.enemyManagers) {
      em.setSpawnRateMult(spawnMult);
```

Change to fold in the DB multiplier:

```ts
    const curveMult = INFINITE_MIN_SPAWN_MULT +
      factor * (INFINITE_MAX_SPAWN_MULT - INFINITE_MIN_SPAWN_MULT);
    const spawnMult = this._heapParams.spawnRateMult * curveMult;

    for (const em of this.enemyManagers) {
      em.setSpawnRateMult(spawnMult);
```

(The debug overlay at `:450` references `spawnMult` — it keeps working unchanged.)

- [ ] **Step 4: Apply coin mult to the stomp reward**

In `handleStomp` (`:560`), the reward line currently is:

```ts
    const reward = this.playerConfig.stompBonus;
```

Change to:

```ts
    const reward = Math.round(this.playerConfig.stompBonus * this._heapParams.coinMult);
```

- [ ] **Step 5: Apply score mult + forward real params in `handleDeath`**

In `handleDeath`, the `buildRunScore` call (`:491-496`) passes `1.0`:

```ts
    const runResult  = buildRunScore(
      { baseHeightPx: score, kills: this._runKills, elapsedMs },
      ENEMY_DEFS,
      true,
      1.0,
    );
```

Change the last argument to the DB score mult:

```ts
    const runResult  = buildRunScore(
      { baseHeightPx: score, kills: this._runKills, elapsedMs },
      ENEMY_DEFS,
      true,
      this._heapParams.scoreMult,
    );
```

Then the `ScoreScene` launch (`:520-525`) currently forwards a hardcoded params block:

```ts
        heapParams: {
          ...DEFAULT_HEAP_PARAMS,
          name: '∞ Infinite Heap',
          difficulty: 5.0,
          isInfinite: true,
        },
```

Change to forward the real params (preserving the decorative display name and the
`isInfinite` flag so `ScoreScene`'s stop-target logic at `:1073` still routes to
`InfiniteGameScene`):

```ts
        heapParams: {
          ...this._heapParams,
          name: '∞ Infinite Heap',
          isInfinite: true,
        },
```

- [ ] **Step 6: Verify build + full client test suite**

Run: `npm run build`
Expected: succeeds.
Run: `npm test`
Expected: all client tests pass (no regressions; Task 1 + Task 2 tests included).

- [ ] **Step 7: Commit**

```bash
git add src/scenes/InfiniteGameScene.ts
git commit -m "feat: InfiniteGameScene consumes server heap params (enemy/spawn/coin/score)"
```

- [ ] **Step 8: Browser smoke test (manual, against local DB)**

Preconditions: local D1 has the FFF `heap` row + `heap_parameters` row (confirmed),
the worker is running (`cd server && npx wrangler dev`), and `npm run dev` serves the
client. With the dev server already running on `localhost:3000`:

1. Open the game, select **Infinite**, start a run.
2. Confirm enemies (percher/ghost) spawn consistent with the DB config (percher from
   the floor, ghost only above ~5000px).
3. In a terminal, bump the DB coin mult and re-run to confirm the effect:
   `cd server && npx wrangler d1 execute heap --local --command "UPDATE heap SET coin_mult=3 WHERE id='FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF';"`
   Reload (BootScene refetches the catalog), stomp an enemy, confirm the `+N` coin
   marker is ~3× the base stomp bonus.
4. Restore: `UPDATE heap SET coin_mult=1 ...`.

Document the smoke result; do not mark the task done until the in-game effect is
observed.

---

## Self-Review

**Spec coverage:**
- BootScene real FFF row + `isInfinite` merge → Task 2. ✓
- enemyParams via base-independent endpoint → Task 1 + Task 3 (priming) + Task 4 (consume). ✓
- spawnRateMult × height curve → Task 4 Step 3. ✓
- coinMult on stomp reward → Task 4 Step 4. ✓
- scoreMult in death scoring + ScoreScene → Task 4 Step 5. ✓
- Offline fallbacks (synthetic entry, DEFAULT_ENEMY_PARAMS) → Task 2 + Task 1. ✓
- Non-goal (leaderboard) → Global Constraints; no task touches scores.ts. ✓

**Type consistency:** `primeEnemyParams(heapId: string): Promise<void>` used identically in Tasks 3. `buildInfiniteEntry(summaries: HeapSummary[]): HeapSummary` used in Task 2 BootScene wiring. `_heapParams: HeapParams` read once, consumed in Steps 3-5. `getEnemyParams` returns `HeapEnemyParams | null`; `?? DEFAULT_ENEMY_PARAMS` handles null. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

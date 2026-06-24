# Infinite mode: consume server heap params

**Date:** 2026-06-24
**Bug:** "Infinite mode ignores server heap params (enemy spawn config, spawn/coin/score mult)" (`Todo/Bugs.md`)

## Problem

`InfiniteGameScene` is self-contained and ignores the infinite heap's DB row. It
hardcodes `DEFAULT_ENEMY_PARAMS`, derives spawn rate only from a height-based
difficulty curve, and never applies `coinMult` or `scoreMult`. Changing the
infinite heap's DB values has no effect on a run. Designer-tunability is the
intended behavior.

A real `heap` row for the infinite ID (`FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF`)
already exists in prod (and now locally), created via the admin UI:

- `heap` row: `world_height=50000000`, `top_y=1`, all mults `1.0`, item rates at
  defaults.
- `heap_parameters` row: real percher/ghost enemy spawn config.

`BootScene` discards the server's FFF entry and fabricates a synthetic catalog
entry instead, so the real row is never consulted.

## Goal

Make `InfiniteGameScene` consume the infinite heap's server params the same way
`GameScene` consumes a normal heap, while keeping the height-based difficulty
curve layered on top. No new migration (the row exists). No schema change.

## Non-goals

- **Leaderboard / score submission.** Because the prod `world_height` is 50M, the
  server's `maxClimbPx` validation already passes for tall infinite runs, so
  `POST /scores` no longer 404s. We do not change score submission, validation, or
  the `ScoreScene` submit path. Applying `scoreMult` client-side only keeps the
  on-screen number consistent with the server's recompute (both `1.0` today).
- No changes to `GameScene`'s existing param flow.

## Design

The fix mirrors `GameScene`'s data flow for the infinite heap. Three touch points
plus one small `HeapClient` addition.

### 1. `HeapClient.primeEnemyParams(heapId)` — new method

`enemyParams` reach the client only via cache, which `HeapClient.load()` populates.
But `load()` fetches the base polygon first and bails (caching nothing) if the base
404s — and the infinite heap has no real base (procedural; placeholder `base_id`).

Add a base-independent method that uses the existing `GET /heaps/:id/enemy-params`
endpoint (requires only the heap row):

```ts
static async primeEnemyParams(heapId: string): Promise<void> {
  try {
    const res = await fetchWithLog(`${SERVER_URL}/heaps/${heapId}/enemy-params`);
    if (!res.ok) return;                       // offline / missing → leave cache as-is
    const enemyParams = (await res.json()) as HeapEnemyParams;
    const cache = loadCache(heapId) ?? { version: 0, baseId: '', liveZone: [] };
    saveCache(heapId, { ...cache, enemyParams });
  } catch {
    // silent — InfiniteGameScene falls back to DEFAULT_ENEMY_PARAMS
  }
}
```

`getEnemyParams(heapId)` already reads `cache.enemyParams`, so after priming,
`InfiniteGameScene` reads enemyParams synchronously, identically to `GameScene`.

### 2. `BootScene` — use the real FFF row, merge `isInfinite`

In the `HeapClient.list()` handler, stop fabricating params. Find the server's FFF
entry and merge in the client-only `isInfinite: true` flag (the DB has no such
column; `MenuScene`/`HeapSelectScene` route on it). If the server returns no FFF
row (offline / not seeded), fall back to today's synthetic entry so infinite still
works offline.

```ts
const real = summaries.find(s => s.id === INFINITE_HEAP_ID);
const infiniteEntry: HeapSummary = real
  ? { ...real, params: { ...real.params, isInfinite: true } }
  : SYNTHETIC_INFINITE_ENTRY;   // existing hardcoded block, kept as offline fallback
const deduped = summaries.filter(s => s.id !== INFINITE_HEAP_ID);
deduped.push(infiniteEntry);
```

When infinite is the auto-picked/stored selection, BootScene's pick branch should
also `primeEnemyParams(INFINITE_HEAP_ID)` (the non-infinite path already `load()`s).

### 3. `HeapSelectScene.select()` — prime enemyParams for infinite

The infinite branch currently sets `heapPolygon = []` and skips `HeapClient.load()`.
Add `HeapClient.primeEnemyParams(heap.id)` there so enemyParams are cached before
the scene starts — the mirror of the normal path's `load()`.

### 4. `InfiniteGameScene` — read params from registry + cache

- Store `_heapParams = registry.get('heapParams') ?? DEFAULT_HEAP_PARAMS`.
- Enemy config (replaces hardcoded `DEFAULT_ENEMY_PARAMS` at `:152`):
  ```ts
  const enemyParams = HeapClient.getEnemyParams(INFINITE_HEAP_ID) ?? DEFAULT_ENEMY_PARAMS;
  em.setEnemyParams(enemyParams);
  ```
- Spawn rate (`:408-412`) — **layer** DB mult with the height curve so designer
  tuning and difficulty ramp compose:
  ```ts
  const curveMult = INFINITE_MIN_SPAWN_MULT + factor * (INFINITE_MAX_SPAWN_MULT - INFINITE_MIN_SPAWN_MULT);
  em.setSpawnRateMult(this._heapParams.spawnRateMult * curveMult);
  ```
  Default `spawnRateMult=1.0` ⇒ unchanged behavior.
- Stomp coin reward (`handleStomp`, mirrors `GameScene:755`):
  ```ts
  const reward = Math.round(this.playerConfig.stompBonus * this._heapParams.coinMult);
  ```
- `handleDeath` (`:491-526`):
  - `buildRunScore(..., isFailure=true, this._heapParams.scoreMult)` instead of `1.0`.
  - Forward the real `_heapParams` to `ScoreScene` instead of the hardcoded
    `{ ...DEFAULT_HEAP_PARAMS, name, difficulty, isInfinite }` block, so the
    coin/score breakdown panel reflects the real mults. Preserve a sensible display
    name (`_heapParams.name` is "Infinite").

## Data flow

```
BootScene.list() ──► catalog includes real FFF row (params, isInfinite:true)
       │                       │
       │                       └─► registry 'heapParams' (mults, item rates) ──► InfiniteGameScene._heapParams
       │
HeapSelectScene.select(infinite) ─► HeapClient.primeEnemyParams(FFF)
                                          │
                                  GET /heaps/FFF/enemy-params ─► cache.enemyParams
                                          │
                          InfiniteGameScene: getEnemyParams(FFF) ─► em.setEnemyParams(...)
```

## Error handling / fallbacks

- Server FFF row absent (offline): BootScene synthetic fallback ⇒ infinite still
  playable with default-ish mults.
- `primeEnemyParams` fails: `getEnemyParams` returns `null` ⇒ `DEFAULT_ENEMY_PARAMS`.
- `heap_parameters` row absent for FFF: server returns the sentinel
  (`00000000-…`) enemy config — same default the normal heaps get.

## Testing

- **`HeapClient.primeEnemyParams`** (unit, mocked fetch): caches enemyParams on 200;
  no-op on non-ok / throw; merges into an existing cache without clobbering
  `liveZone`/`baseId`.
- **`BootScene` catalog merge** (unit): real FFF row → `isInfinite:true` merged;
  missing FFF → synthetic fallback; exactly one infinite entry (dedupe).
- **Spawn-rate layering** (unit, extracted pure helper if practical): `spawnRateMult
  × curveMult`; defaults preserve current values.
- **Stomp reward** (unit): `round(stompBonus × coinMult)`.
- **Smoke (browser, local DB has FFF + heap_parameters):** select Infinite → run →
  confirm percher/ghost spawn per DB config; tune a DB mult and confirm effect.

## Touch points

- `src/systems/HeapClient.ts` — add `primeEnemyParams`.
- `src/scenes/BootScene.ts` — real FFF row merge + prime on infinite auto-pick.
- `src/scenes/HeapSelectScene.ts` — `primeEnemyParams` in the infinite branch.
- `src/scenes/InfiniteGameScene.ts` — `_heapParams`, enemyParams, spawn layering,
  coin mult, score mult, ScoreScene params.

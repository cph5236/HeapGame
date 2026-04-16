# Multiple Heaps — Design

**Date:** 2026-04-16
**Status:** Approved (pending implementation plan)

## Overview

Let the player choose which heap to play from a selector on the main menu. Each heap is a distinct server-side entity with its own name, difficulty rating, and gameplay multipliers (spawn rate, coin reward, score). Heaps are authored by running `npm run seed` with env-var parameters. Leaderboards, placed items, and cached polygons are keyed per heap; coins, upgrades, inventory, and player identity remain global.

## Goals

- Seed heaps with a range of difficulties; each heap stored as a first-class server object with its parameters.
- Player selects a heap from a dedicated scene on the menu; selection persists across sessions.
- Per-heap placeables (no cross-heap contamination of placed items).
- Per-heap spawn/coin/score multipliers applied at runtime.
- Introduce `schemaVersion` in the client save and migrate the existing flat `placed[]` to the new per-heap shape without data loss.

## Non-goals

- Admin UI for editing heap params after creation (seed script is the authoring tool).
- Per-heap economy (coins, upgrades, inventory stay global — Q1 choice A).
- Infinite heap, multi-heap leaderboard aggregation, or cross-heap progression mechanics.

---

## Section 1: Server — D1 schema + API

### Schema changes (`server/schema.sql`)

```sql
ALTER TABLE heap ADD COLUMN name             TEXT NOT NULL DEFAULT 'Unnamed Heap';
ALTER TABLE heap ADD COLUMN difficulty       REAL NOT NULL DEFAULT 1.0;   -- 1.0..5.0, step 0.5
ALTER TABLE heap ADD COLUMN spawn_rate_mult  REAL NOT NULL DEFAULT 1.0;
ALTER TABLE heap ADD COLUMN coin_mult        REAL NOT NULL DEFAULT 1.0;
ALTER TABLE heap ADD COLUMN score_mult       REAL NOT NULL DEFAULT 1.0;
```

Defaults let the existing production heap survive the migration without data fixup.

### Shared types (`shared/heapTypes.ts`)

```ts
export interface HeapParams {
  name: string;
  difficulty: number;      // 1.0..5.0 in 0.5 steps
  spawnRateMult: number;
  coinMult: number;
  scoreMult: number;
}

export interface CreateHeapRequest {
  vertices: Vertex[];
  params?: Partial<HeapParams>;   // missing fields take DB defaults
}

export interface HeapSummary {
  id: string;
  version: number;
  createdAt: string;
  params: HeapParams;              // NEW
}

// GetHeapResponse `changed: true` branch gains `params: HeapParams`.
```

### `HeapDB` interface

- `createHeap(..., params: HeapParams)` — write all columns.
- `listHeaps()` — return rows including params.
- `getHeap(id)` — return row including params.
- `updateHeapParams(id, params: HeapParams)` — reserved for future admin UI (ship stub, not used yet).

### Routes

- `POST /heaps` — accept optional `params`, fall through to defaults for missing fields. Validate: `difficulty` is a multiple of 0.5 in `[1, 5]`; each mult is a positive finite number.
- `GET /heaps` — return `HeapSummary[]` with params.
- `GET /heaps/:id` — include params on the `changed: true` branch.
- `PUT /heaps/:id/reset` — unchanged (does not touch params).

### Seed script (`scripts/seed-heap.ts`)

New env vars: `NAME`, `DIFFICULTY`, `SPAWN_MULT`, `COIN_MULT`, `SCORE_MULT`. Defaults: `Heap #${short(guid)}`, `1.0`, `1.0`, `1.0`, `1.0`. Example:

```
NAME="Frostbite Summit" DIFFICULTY=4 SPAWN_MULT=1.5 COIN_MULT=1.3 SCORE_MULT=2.0 npm run seed
```

Sent as `params` in the create body.

---

## Section 2: Client — BootScene & HeapSelectScene

### BootScene

1. `HeapClient.list()` now returns `HeapSummary[]` (not `string[]`). Stash in registry as `heapCatalog`.
2. Resolve active heap: if `SaveData.getSelectedHeapId()` is present in the catalog, use it; else pick the lowest-difficulty heap (tie-break: earliest `createdAt`) and persist.
3. `HeapClient.load(activeId)` preloads only the active heap's polygon.
4. After active heap is known, call `SaveData.finalizeLegacyPlaced(activeHeapId)` to move any v1 legacy placed items into the per-heap map.

Registry keys after boot: `heapCatalog: HeapSummary[]`, `activeHeapId: string`, `heapPolygon: Vertex[]`, `heapParams: HeapParams`.

### MenuScene

New button row between title and `START RUN`: `▾ {activeHeap.name} · {★×difficulty}`. Tapping opens `HeapSelectScene`.

### HeapSelectScene (new)

- Full-screen dark panel, header `SELECT A HEAP` + close `✕`.
- Scrollable list, rows sorted ascending by difficulty, tie-broken by ascending `createdAt`.
- Each row (~72px tall):
  - Left: heap name (18px bold) + difficulty stars (full/half/empty in Heap orange `#ff9922`).
  - Right: small rat sprite with `1.5×` (spawn mult), plus text badges `COIN 1.3×` and `SCORE 2.0×`.
  - Active row highlighted with orange border.
- Tap row → `SaveData.setSelectedHeapId(id)`, kick off `HeapClient.load(id)` prefetch, brief confirmation flash (~150ms), return to `MenuScene`.
- Empty-catalog fallback: "No heaps available — check connection" with back button.

### Star renderer

Given `difficulty` in `[1, 5]`:
- `floor(d)` full stars
- one half-star if `d - floor(d) >= 0.5`
- empties to reach 5 total

---

## Section 3: SaveData — schema v2 migration + per-heap placeables

### New `RawSave` shape

```ts
interface RawSave {
  schemaVersion: 2;
  balance:    number;                             // global
  upgrades:   Record<string, number>;             // global
  inventory:  Record<string, number>;             // global
  placed:     Record<string, PlacedItemSave[]>;   // per-heap
  selectedHeapId: string;
  playerGuid: string;
  playerName: string;
  highScores: Record<string, number>;             // per-heap (existing)
  _legacyPlaced?: PlacedItemSave[];               // transient, used only during migration
}
```

### Migration (v1 → v2), inside `load()`

1. If `parsed.schemaVersion === 2`, pass through.
2. Else treat as v1:
   - Move `parsed.placed` (flat array) into `_legacyPlaced`.
   - Set `placed = {}`, `selectedHeapId = ''`, `schemaVersion = 2`.
   - Persist.
3. `BootScene` calls `SaveData.finalizeLegacyPlaced(defaultHeapId)` after `HeapClient.list()` resolves. This copies `_legacyPlaced` into `placed[defaultHeapId]` (appending if already populated) and deletes the field.

Two-phase because `load()` must stay synchronous and network-free (runs in tests and before BootScene).

### API changes

- `getPlaced(heapId: string)` — was `getPlaced()`.
- `addPlaced(heapId, item)`, `removePlaced(heapId, index)`, `updatePlacedMeta(heapId, index, meta)`, `removeExpiredPlaced(heapId)`.
- `getSelectedHeapId(): string`, `setSelectedHeapId(id: string): void`.
- `finalizeLegacyPlaced(defaultHeapId: string): void`.
- `resetAllData()` unchanged in contract (clears everything, regenerates identity).

### Callsites to update

`GameScene`, `PlaceableManager`, `MenuScene` (checkpoint lookup in `startGame`). Grep: `getPlaced`, `addPlaced`, `removePlaced`, `updatePlacedMeta`, `removeExpiredPlaced`.

---

## Section 4: Runtime multipliers

### `spawnRateMult` → EnemyManager

`EnemyManager` constructor gains `spawnRateMult: number`. Spawn frequency scales linearly — e.g. halve the spawn interval at `×2.0`. Exact knob verified at implementation time against `EnemyManager`'s current timer/probability model.

### `coinMult` → run-earned coin rewards

Applied at the point of awarding coins from gameplay events (stomps, pickups) *before* `addBalance`: `Math.round(base * heapParams.coinMult)`. Does **not** apply to store refunds, upgrade purchases, or any non-run balance change.

### `scoreMult` → final run score

Applied inside `buildRunScore` as the last step:

```ts
const total = Math.round((kills + pace + height) * scoreMult);
```

`buildRunScore` signature gains `scoreMult: number` (default `1.0` keeps existing tests intact). Multiplied total is what's submitted to `/scores` and stored locally in `highScores`. Leaderboards remain per-heap, so ranking is fair.

### ScoreScene breakdown panel

Two new line items in the breakdown:
- `Coin Mult: ×{heapParams.coinMult}`
- `Score Mult: ×{heapParams.scoreMult}`

Heap params threaded through `ScoreScene`'s existing scene-data payload (no refetch).

---

## Section 5: Seed script + HeapSelectScene visuals

### Seed script env vars

| Env var | Type | Default |
|---|---|---|
| `NAME` | string | `Heap #${short(guid)}` |
| `DIFFICULTY` | 0.5-step in [1, 5] | 1.0 |
| `SPAWN_MULT` | positive number | 1.0 |
| `COIN_MULT` | positive number | 1.0 |
| `SCORE_MULT` | positive number | 1.0 |

Validates range and step. `OVERWRITE` path unchanged — reset only clears the live zone, not params.

### HeapSelectScene visuals

- Mobile-first (`GAME_WIDTH=480`), full-height dark panel.
- Header `SELECT A HEAP` + close `✕`.
- Scroll list: each row 72px, alternating subtle stripe (matches leaderboard).
- Left: name (18px bold) + difficulty stars (`#ff9922`, supports halves).
- Right: rat sprite + `1.5×` (spawn), `COIN 1.3×`, `SCORE 2.0×` text badges.
- Active row: orange border.
- Sort: ascending difficulty, then ascending createdAt.

---

## Section 6: Tests + rollout

### Tests

- **Server routes:** POST/GET with and without params; defaults applied; difficulty step/range validation; HeapSummary includes params.
- **MockHeapDB:** params round-trip.
- **SaveData migration:** v1 flat `placed[]` → `placed: {}` + `_legacyPlaced` + `schemaVersion: 2`. Then `finalizeLegacyPlaced('heap-abc')` moves items into `placed['heap-abc']` and clears the field.
- **SaveData per-heap placeables:** `addPlaced('h1', item)` does not leak to `getPlaced('h2')`.
- **HeapClient.list:** returns `HeapSummary[]` with params.
- **buildRunScore:** `scoreMult: 2.0` doubles total; default `1.0` matches existing snapshots.
- **HeapSelectScene:** sort correctness; empty-catalog fallback.

### Rollout (each step mergeable standalone)

1. Server schema + API + seed script (backward compatible via defaults).
2. Shared types + `HeapClient.list()` signature + BootScene catalog fetch.
3. SaveData v1→v2 migration (no behavior change; `_legacyPlaced` holds data).
4. HeapSelectScene + MenuScene button + `finalizeLegacyPlaced` call.
5. Per-heap `placed` API + callsite updates in GameScene/PlaceableManager.
6. Runtime multiplier wiring (EnemyManager, coin rewards, buildRunScore, ScoreScene lines).

### Out of scope

- Admin UI for editing heap params post-creation.
- Per-heap economy (coins, upgrades, inventory).
- Infinite heap (separate Todo item).
- Multi-heap leaderboard aggregation.

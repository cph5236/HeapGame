# Heap Parameters — Per-Heap Enemy Spawn Config

**Date:** 2026-04-24
**Status:** Approved

---

## Problem

Enemy spawn zone fields (`spawnStartFrac`, `spawnEndFrac`, `spawnRampEndFrac`) are fractions of `worldHeight`. On a large world (5,000,000 px) with a small heap (~30,000 px of content), enemies whose zones are defined as fractions of the full world height never appear — the entire heap sits in the bottom 0.6% of the world but a ghost with `spawnStartFrac: 0.9` requires being in the bottom 10%.

## Goal

- Replace world-height-relative fraction fields with absolute px-above-floor values so spawn zones are anchored to the heap's playable content height.
- Store these values per-heap in the database so individual heaps can be tuned without a code deploy.
- Expose a minimal admin API for reading and updating a heap's enemy params.

---

## Schema

### New table: `heap_parameters`

```sql
CREATE TABLE IF NOT EXISTS heap_parameters (
  heap_id      TEXT PRIMARY KEY,
  enemy_params TEXT NOT NULL DEFAULT '{}'
);
```

- One row per heap. `enemy_params` is a JSON object keyed by enemy kind.
- A **sentinel row** with `heap_id = '00000000-0000-0000-0000-000000000000'` is inserted at migration time and holds the baseline defaults for all enemy kinds.
- If a heap has no row in `heap_parameters`, the server returns the sentinel row's config instead. No merging — it is a full replacement.
- The sentinel row is inserted by a migration script (not the seed script) so it is always present in both local and production D1.

### `enemy_params` JSON structure

```json
{
  "percher": {
    "spawnStartPxAboveFloor": 0,
    "spawnEndPxAboveFloor": -1,
    "spawnRampPxAboveFloor": 15000,
    "spawnChanceMin": 0.15,
    "spawnChanceMax": 0.45
  },
  "ghost": {
    "spawnStartPxAboveFloor": 5000,
    "spawnEndPxAboveFloor": -1,
    "spawnRampPxAboveFloor": 20000,
    "spawnChanceMin": 0.10,
    "spawnChanceMax": 0.35
  }
}
```

**Field semantics (all values in px measured upward from the world floor):**

| Field | Meaning | -1 meaning |
|---|---|---|
| `spawnStartPxAboveFloor` | Enemy does not appear below this height | n/a (use 0 for floor) |
| `spawnEndPxAboveFloor` | Enemy does not appear above this height | No ceiling |
| `spawnRampPxAboveFloor` | Height at which `spawnChanceMax` is reached | No ramp — flat at min |
| `spawnChanceMin` | Spawn probability at `spawnStartPxAboveFloor` | n/a |
| `spawnChanceMax` | Spawn probability at `spawnRampPxAboveFloor` | n/a |

---

## `EnemyDef` changes

Remove the three fraction fields from `EnemyDef`:

```diff
- spawnStartFrac: number;
- spawnEndFrac: number;
- spawnRampEndFrac: number;
```

The remaining fields in `EnemyDef` (kind, textureKey, width, height, speed, spawnOnHeapSurface, spawnOnHeapWall, displayName, scoreValue) are unchanged — visual/physics/scoring stays hardcoded.

The runtime spawn params (the five fields above) are received from the server at heap load time and stored separately from `ENEMY_DEFS`.

---

## `EnemySpawnMath` changes

`spawnChance` currently takes `(def, y, worldHeight)` and resolves fractions internally. It is rewritten to take absolute px-above-floor values directly:

```ts
spawnChance(params: EnemySpawnParams, pxAboveFloor: number): number | null
```

Where `EnemySpawnParams` is the per-kind object from the server. `pxAboveFloor` is computed at the call site as `worldHeight - y`.

---

## Server API

### Existing endpoint: `GET /heaps/:id`

`GetHeapResponse` gains an `enemyParams` field:

```ts
// shared/heapTypes.ts
export type EnemySpawnParams = {
  spawnStartPxAboveFloor: number;
  spawnEndPxAboveFloor: number;   // -1 = no ceiling
  spawnRampPxAboveFloor: number;  // -1 = flat
  spawnChanceMin: number;
  spawnChanceMax: number;
};

export type HeapEnemyParams = Record<string, EnemySpawnParams>;

// Added to the changed: true branch of GetHeapResponse
enemyParams: HeapEnemyParams;
```

Server resolution: look up `heap_parameters` by `heap_id`; if no row, fetch the sentinel row (`00000000-0000-0000-0000-000000000000`).

### New admin endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/heaps/:id/enemy-params` | Returns the heap's `enemy_params` JSON (or sentinel if none set) |
| `PUT` | `/heaps/:id/enemy-params` | Upserts a `heap_parameters` row for this heap |

The `PUT` body is the full `HeapEnemyParams` JSON object. No partial updates — the client sends the complete config.

---

## Client changes

- `GameScene` reads `enemyParams` from the heap load response and stores it.
- Passes the per-kind `EnemySpawnParams` to `EnemyManager` (or directly to `EnemySpawnMath`) at spawn time.
- `EnemyManager` no longer needs `worldHeight` for fraction resolution — it still needs it to compute `pxAboveFloor = worldHeight - y`.

---

## Admin UI

A minimal standalone HTML page (or small Vite route) with:
- A dropdown to select a heap by ID/name
- One section per enemy kind with labeled number inputs for the five spawn params
- A save button that calls `PUT /heaps/:id/enemy-params`
- No auth for now (internal tool only)

---

## Testing

- **Unit:** `EnemySpawnMath.spawnChance` tests updated to use the new `EnemySpawnParams` signature and `pxAboveFloor` input.
- **Server:** Routes tests for `GET` and `PUT /heaps/:id/enemy-params`; fallback to sentinel row when no heap-specific row exists.
- **Integration:** `GET /heaps/:id` response includes `enemyParams` when `changed: true`.

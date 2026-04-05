# Enemy Defs & Spawn Rework — Design Spec

**Date:** 2026-04-04
**Branch:** feature/HeapServer

---

## Problem

Enemies stopped spawning after the heap moved to a server-authoritative loading model. The `applyBandPolygon` path (used for all server-loaded bands) never calls `onPlatformSpawned`, so `EnemyManager` never receives spawn events. Additionally, all enemy configuration is scattered as flat constants in `src/constants.ts` with no per-enemy structure, making it hard to add new enemy types or tune behavior.

---

## Goals

1. Fix the spawn bug — enemies must appear on server-loaded heaps.
2. Introduce a typed `ENEMY_DEFS` data file as the single source of truth for all per-enemy configuration.
3. Remove all per-enemy flat constants from `src/constants.ts`.

---

## `EnemyDef` Interface

New file: `src/data/enemyDefs.ts`

```ts
export interface EnemyDef {
  kind: EnemyKind;

  // Visuals / physics
  textureKey: string;      // Phaser texture key; falls back to 'enemy-fallback' if not loaded
  width: number;
  height: number;
  speed: number;           // px/sec horizontal patrol speed; 0 = stationary

  // Surface spawn eligibility
  spawnOnHeapSurface: boolean;  // spawn on roughly horizontal surfaces (angle < 30°)
  spawnOnHeapWall: boolean;     // spawn on steep surfaces (angle ≥ 30°)

  // Geographic spawn zone (world Y; lower Y = higher on heap)
  spawnStartY: number;     // enemy does not appear below this Y value
  spawnEndY: number;       // enemy does not appear above this Y value; -1 = no ceiling

  // Spawn chance linear ramp
  spawnChanceMin: number;  // probability at spawnStartY (0–1)
  spawnChanceMax: number;  // probability at spawnRampEndY (0–1)
  spawnRampEndY: number;   // Y at which spawnChanceMax is reached; -1 = ramp never fully arrives
}

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  percher: {
    kind: 'percher',
    textureKey: 'enemy-percher',
    width: 24,
    height: 24,
    speed: 0,
    spawnOnHeapSurface: true,
    spawnOnHeapWall: false,
    spawnStartY: /* world bottom */ 50000,
    spawnEndY: -1,
    spawnChanceMin: 0.1,
    spawnChanceMax: 0.35,
    spawnRampEndY: 10000,
  },
  ghost: {
    kind: 'ghost',
    textureKey: 'enemy-ghost',
    width: 36,
    height: 36,
    speed: 240,
    spawnOnHeapSurface: true,
    spawnOnHeapWall: false,
    spawnStartY: 40000,
    spawnEndY: -1,
    spawnChanceMin: 0.03,
    spawnChanceMax: 0.12,
    spawnRampEndY: 5000,
  },
};
```

Numeric starting values above are placeholders — tune during playtesting.

---

## Spawn Wiring Fix

### Root cause

`HeapGenerator.applyBandPolygon` renders server-loaded bands directly without firing any spawn callback. The `onPlatformSpawned` callback only fires on the synchronous `spawnEntry` path (player-placed blocks and the initial local-data load path).

### Fix

`HeapGenerator` gains a second optional callback:

```ts
onBandLoaded?: (bandTopY: number, vertices: Vertex[]) => void;
```

Called at the end of `applyBandPolygon`. `GameScene` wires it to `enemyManager.onBandLoaded`.

### Surface angle detection

`EnemyManager` gains a private helper:

```ts
private computeSurfaceAngle(v1: Vertex, v2: Vertex): number
// Returns degrees from horizontal (0 = flat, 90 = vertical)
```

Edges with angle < 30° are treated as surfaces (`spawnOnHeapSurface`). Edges ≥ 30° are treated as walls (`spawnOnHeapWall`).

### Spawn position for band edges

When iterating polygon edges in `onBandLoaded`, the spawn X is the horizontal midpoint of the edge and Y is the top of the edge (min Y of the two vertices). This gives a natural "standing on the surface" position.

### Unified spawn chance formula

For a candidate spawn at world Y:

```
if Y > def.spawnStartY → skip (below zone)
if def.spawnEndY !== -1 && Y < def.spawnEndY → skip (above zone)

if def.spawnRampEndY === -1:
  chance = def.spawnChanceMin  // flat rate, no ramp
else:
  t = clamp((spawnStartY - Y) / (spawnStartY - spawnRampEndY), 0, 1)
  chance = lerp(spawnChanceMin, spawnChanceMax, t)

roll Math.random() — spawn if < chance
```

---

## `EnemyManager` Refactor

- Remove all `ENEMY_*` constant imports.
- Collapse `trySpawnPercher` and `trySpawnGhost` into a single `trySpawn(def, x, y, surfaceAngle)`.
- Remove `findClearanceAbove` — clearance gating is replaced by `spawnOnHeapSurface` / `spawnOnHeapWall` surface-type flags.
- `onPlatformSpawned` becomes a thin loop: iterate `Object.values(ENEMY_DEFS)`, call `trySpawn` with angle `0` (flat platform).
- New `onBandLoaded(bandTopY, vertices)`: iterate polygon edges, compute midpoint and angle per edge, call `trySpawn` for each def.

---

## `Enemy` Refactor

- Constructor accepts `EnemyDef` instead of `EnemyKind`.
- Texture key comes from `def.textureKey`, with fallback:
  ```ts
  const key = scene.textures.exists(def.textureKey) ? def.textureKey : 'enemy-fallback';
  ```
- `enemy-fallback` texture is generated programmatically in `GameScene.preload` (a plain colored rectangle — no asset file required).
- Width/height/speed read from def. Kind-based ternary removed.

---

## File Changes

| File | Change |
|---|---|
| `src/data/enemyDefs.ts` | **Create** — `EnemyDef` interface + `ENEMY_DEFS` record |
| `src/entities/Enemy.ts` | **Modify** — accept `EnemyDef`, use `textureKey` with fallback |
| `src/systems/EnemyManager.ts` | **Modify** — remove constant imports, collapse spawn methods, add `onBandLoaded` + `trySpawn` + `computeSurfaceAngle` |
| `src/systems/HeapGenerator.ts` | **Modify** — add `onBandLoaded` callback, call from `applyBandPolygon` |
| `src/scenes/GameScene.ts` | **Modify** — wire `onBandLoaded`, generate fallback texture in preload |
| `src/constants.ts` | **Modify** — remove 6 per-enemy constants; keep `ENEMY_CULL_DISTANCE` |

### Constants removed from `src/constants.ts`
- `ENEMY_PERCHER_WIDTH`
- `ENEMY_PERCHER_HEIGHT`
- `ENEMY_GHOST_SIZE`
- `ENEMY_GHOST_SPEED`
- `ENEMY_PERCHER_CLEARANCE`
- `ENEMY_PERCHER_SPAWN_CHANCE`
- `ENEMY_GHOST_SPAWN_CHANCE`

---

## Out of Scope

- New enemy types (design accommodates them; implementation deferred)
- Enemy behavior beyond current patrol/perch patterns
- Difficulty scaling beyond the linear spawn ramp

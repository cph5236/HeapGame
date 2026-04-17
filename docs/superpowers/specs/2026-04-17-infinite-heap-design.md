# Infinite Heap Mode — Design Spec
_2026-04-17_

## Overview

Infinite Heap is a survival-based game mode where the player climbs a procedurally generated, endlessly growing world of 3 parallel heap columns. There is no placement win condition — the run ends only when the player dies. Score is height climbed. All infinite runs compete on a single shared leaderboard.

---

## 1. World Layout

**Dimensions**

```
INFINITE_WORLD_WIDTH = WORLD_WIDTH * 3 + INFINITE_GAP_WIDTH * 2
INFINITE_GAP_WIDTH   = 250px
```

Three heap columns:
- Left:   `x = 0` → `WORLD_WIDTH`
- Center: `x = WORLD_WIDTH + INFINITE_GAP_WIDTH` → `WORLD_WIDTH * 2 + INFINITE_GAP_WIDTH`
- Right:  `x = WORLD_WIDTH * 2 + INFINITE_GAP_WIDTH * 2` → `INFINITE_WORLD_WIDTH`

**Horizontal wrap** — the world wraps at both edges. Exiting the right edge of heap 3 places the player at `x = 0` (heap 1) and vice versa. The wrap is a valid traversal path alongside bridges and portals. Implemented via a manual player X check in `InfiniteGameScene.update()` — if `player.x < 0` set `player.x = INFINITE_WORLD_WIDTH`, and vice versa. Phaser physics bodies do not natively wrap.

---

## 2. Heap Generation

**3 independent HeapGenerators**, each seeded with a fresh random value at scene init (different every run). Each generator is bounded to its column's X range via an X offset parameter. Generation is otherwise identical to the existing system: async web worker, 500px bands, polygon collision bodies.

**Callbacks** (`onPlatformSpawned`, `onBandLoaded`) fire per-generator and are used to trigger enemy spawning and bridge/portal spawning respectively.

---

## 3. Scene Architecture

`InfiniteGameScene` is a standalone Phaser Scene — not a subclass of `GameScene`. It composes existing systems:

| System | Instance count | Notes |
|---|---|---|
| `HeapGenerator` | 3 | One per column, independent seeds |
| `EnemyManager` | 3 | One per column, X-bounded patrol |
| `TrashWallManager` | 1 | Spans full world width |
| `PortalManager` | 1 | Cross-heap trash can portals |
| `BridgeSpawner` | 1 | Horizontal platforms across gaps |
| `PlaceableManager` | 1 | Filtered surface spawning |
| `Player` | 1 | Unchanged |
| `InputManager` | 1 | Unchanged |
| `HUD` | 1 | Unchanged |

**CameraController** — extracted from `GameScene` into a shared utility. Centers on player X (clamped to world bounds), follows Y with existing lookahead. Both `GameScene` and `InfiniteGameScene` use it.

---

## 4. Entry Point & GUID

**GUID:** `FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF`

This GUID serves two purposes:
1. **SaveData key** — placed items (ladders, I-beams) persist across infinite runs under this GUID
2. **Leaderboard key** — all infinite run scores are submitted under this GUID

The infinite heap appears in `HeapSelectScene` as a normal entry. `HeapParams` gains an `isInfinite: boolean` flag. When the client loads a heap with `isInfinite: true`, it routes to `InfiniteGameScene` instead of `GameScene`. No server heap record is needed — the heap is fully local/procedural.

---

## 5. Bridges

**`BridgeSpawner`** runs after each band flushes across all 3 generators. It scans the two gap zones and places 1–2 horizontal bridge objects per band. Each bridge is a static physics body (plank/debris sprite) positioned at a Y sampled from the surfaces on either side of the gap.

**`bridgeDefs.ts`** — tunable settings:
- Spawn frequency (bridges per band)
- Y sampling range / surface snap threshold
- Width range and sprite variants
- Gap coverage rules (min/max X span)

---

## 6. Portals (Trash Cans)

**`PortalManager`** spawns paired trash can portals as bands load. Each pair links two cans on different heap columns at different heights. Player enters a can → teleports to its paired can with brief invincibility. Pairs are stored in a runtime registry (not persisted between runs). Roughly 1 pair per 3 bands.

**`portalDefs.ts`** — tunable settings:
- Spawn frequency (bands between portal pairs)
- Height delta range between paired cans
- Invincibility duration on portal exit
- Portal sprite/animation

---

## 7. Difficulty Ramp

Difficulty is driven by a single `difficultyFactor` computed each frame:

```
heightFactor    = clamp(heightClimbed / MAX_RAMP_HEIGHT, 0, 1)
timeFactor      = clamp(timeElapsed / MAX_RAMP_TIME, 0, 1)
difficultyFactor = heightFactor * 0.7 + timeFactor * 0.3
```

Height is weighted more heavily (primary skill expression). Time prevents stalling.

`difficultyFactor` drives:
- **Enemy spawn rate** — `spawnRateMult` passed to all 3 `EnemyManager` instances
- **Trash wall speed** — speed scalar passed to `TrashWallManager`

**`infiniteDefs.ts`** — tunable constants:
- `MAX_RAMP_HEIGHT`, `MAX_RAMP_TIME`
- `MIN_SPAWN_MULT`, `MAX_SPAWN_MULT`
- `MIN_WALL_SPEED`, `MAX_WALL_SPEED`
- Height/time weighting coefficients
- `INFINITE_SURFACE_SNAP_THRESHOLD` (placed item surface match tolerance)

---

## 8. Placed Items

Placed items persist under `FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF` in `SaveData` using the existing per-heap structure.

**Checkpoints are disabled** — removed from the hotbar entirely when `isInfinite: true`.

**Surface filtering** — since the heap is procedurally different each run, `PlaceableManager.spawnSavedItems()` calls `findSurfaceY()` at each saved item's X position. If the surface Y is within `INFINITE_SURFACE_SNAP_THRESHOLD` (default 100px, defined in `infiniteDefs.ts`) of the saved Y, the item spawns. Otherwise it is silently skipped for that run.

Placement during a run works identically to normal mode. Items bought and placed are saved under the infinite GUID and filtered on future runs.

---

## 9. Win / Loss & Score

**Loss conditions:**
- Trash wall catches the player
- Enemy kills the player

No checkpoint respawn. On death → `ScoreScene` with `isFailure: true`.

**Score** — height climbed in pixels from spawn Y. Submitted to leaderboard under the infinite GUID.

**ScoreScene** — reused as-is. An `isInfinite: true` flag in init data hides placement-specific breakdown rows (coin mult, score mult) that don't apply to infinite runs.

---

## 10. New Files

| File | Purpose |
|---|---|
| `src/scenes/InfiniteGameScene.ts` | Main infinite mode scene |
| `src/systems/PortalManager.ts` | Portal pair spawning + teleport logic |
| `src/systems/BridgeSpawner.ts` | Bridge object spawning across gaps |
| `src/systems/CameraController.ts` | Extracted camera follow logic (shared) |
| `src/data/bridgeDefs.ts` | Bridge spawn tuning |
| `src/data/portalDefs.ts` | Portal spawn tuning |
| `src/data/infiniteDefs.ts` | Difficulty ramp constants |

## 11. Modified Files

| File | Change |
|---|---|
| `shared/heapTypes.ts` | Add `isInfinite: boolean` to `HeapParams` |
| `src/scenes/HeapSelectScene.ts` | Route `isInfinite` heaps to `InfiniteGameScene` |
| `src/scenes/GameScene.ts` | Extract camera logic to `CameraController` |
| `src/scenes/ScoreScene.ts` | Hide placement rows when `isInfinite: true` |
| `src/systems/PlaceableManager.ts` | Surface filtering in `spawnSavedItems`, gate checkpoint from hotbar |
| `src/systems/HeapGenerator.ts` | Accept X offset parameter |
| `src/constants.ts` | Add `INFINITE_WORLD_WIDTH`, `INFINITE_GAP_WIDTH` |
| `scripts/seed-heap.ts` | Seed server with infinite heap record (`FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF`) so leaderboard submissions have a valid heap to reference |

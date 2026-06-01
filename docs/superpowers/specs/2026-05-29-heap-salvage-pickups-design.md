# Heap Salvage — Pickup System Design

**Date:** 2026-05-29
**Branch:** `feature/salvage-pickups` (git worktree)
**Status:** Approved — proceeding to plan + implementation

## Summary

Add collectible **salvage items** that spawn on heap walkable surfaces during a
run. Walking beside one shows a proximity overlay describing its effect and point
value. The player presses **GRAB** (`E` on desktop / on-screen button on mobile)
to pick it up. Carried items **stack**: their player-modifiers compose and their
point values sum. Reaching the top and placing the block **cashes in** the summed
bonus as extra score. Dying loses carried salvage (the top was never reached).

This is distinct from `PlaceableManager` (player-bought, player-placed store items
such as ladder/ibeam/checkpoint/shield). Salvage is world-spawned and run-scoped.

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Workspace | Git **worktree** (explicit request overrides the no-worktree convention) |
| Effect model | **Carry-to-top + bonus** |
| Effect flavor | **Mixed good & bad** (risk/reward) |
| Pickup input | **Press to grab** after the overlay shows |
| Carry capacity | **Stack multiple** — effects & bonus stack |
| Scope | GameScene (normal mode); InfiniteGameScene is a follow-up |

## Components

Each unit has one clear purpose, a small interface, and is testable in isolation.

### 1. `src/data/pickupDefs.ts` (pure data + pure aggregation)

```ts
export interface PickupEffect {
  speedMult:      number;  // multiplies PLAYER_SPEED (1 = no change)
  jumpBonus:      number;  // added to jumpBoost (px/s, positive = higher jump)
  extraAirJumps:  number;  // added to maxAirJumps
}

export interface PickupDef {
  id:          string;
  name:        string;
  description: string;   // shown in overlay, e.g. "+ Jump, slower"
  color:       number;   // tint / fallback rect colour
  effect:      PickupEffect;
  scoreBonus:  number;   // points cashed at the top
}

export interface CarryModifiers {
  speedMult:     number;
  jumpBonus:     number;
  extraAirJumps: number;
  totalBonus:    number;
}

export function aggregateModifiers(carried: readonly PickupDef[]): CarryModifiers;
```

`aggregateModifiers` multiplies `speedMult`, sums `jumpBonus`, `extraAirJumps`,
and `scoreBonus`. Empty stack → identity `{ speedMult:1, jumpBonus:0,
extraAirJumps:0, totalBonus:0 }`.

Initial item set (mixed good/bad):

| id | name | speedMult | jumpBonus | extraAirJumps | scoreBonus | flavor |
|---|---|---|---|---|---|---|
| `spring-coil` | Spring Coil | 1.0 | +120 | 0 | 250 | + jump |
| `worn-boot` | Worn Boot | 1.25 | 0 | 0 | 250 | + speed |
| `balloon` | Balloon | 1.0 | 0 | +1 | 500 | + air jump |
| `engine-block` | Engine Block | 0.7 | 0 | 0 | 1200 | heavy: − speed, big points |
| `rusty-anchor` | Rusty Anchor | 0.8 | −80 | 0 | 1800 | − speed & jump, huge points |

(Exact numbers tunable; balance verified in smoke testing.)

### 2. `src/systems/PickupManager.ts`

Scene-agnostic manager, mirroring `EnemyManager` / `PlaceableManager` structure.

- **Spawn:** `onPlatformSpawned(x, platformTopY)` — called from
  `HeapGenerator.onPlatformSpawned`. Uses the pure helper
  `shouldSpawnPickup(rand, lastSpawnY, platformTopY, minGapPx, chance)` to gate
  spawning by per-platform chance and a minimum vertical spacing so pickups are
  not clustered. Picks a def at random (weighted later if needed) and spawns a
  static `Image` sitting on the surface.
- **Per-frame `update(playerX, playerY)`:** uses pure helper
  `findNearestInRange(playerX, playerY, pickups, rangePx)` → nearest uncollected
  pickup index or `-1`. Drives the overlay (world-space panel above that item)
  and enables the mobile GRAB button. Desktop `E` / mobile button →
  `grab(index)`.
- **`grab(index)`:** removes the sprite, pushes the def to `carried[]`,
  recomputes `aggregateModifiers(carried)`, calls
  `player.setCarryModifiers(...)`, updates HUD, plays a pickup SFX, emits a
  `pickup:grab` log event.
- **Accessors:** `getCarriedBonus()`, `getCarriedCount()`,
  `getCarriedModifiers()`.
- **Cull:** drop pickups that fall well below the camera (same pattern as
  enemies/chunks).

Pure helpers (`shouldSpawnPickup`, `findNearestInRange`) live as exported
functions for unit testing; Phaser objects stay in the class.

### 3. `Player` modifier hook (`src/entities/Player.ts`)

- Fields: `carrySpeedMult = 1`, `carryJumpBonus = 0`, `carryExtraAirJumps = 0`.
- `setCarryModifiers({ speedMult, jumpBonus, extraAirJumps })`: stores values;
  when `extraAirJumps` grows, refresh `airJumpsRemaining` to the new effective
  max so the benefit is immediately usable.
- Introduce a private `get jumpVelocity()` returning
  `PLAYER_JUMP_VELOCITY - (this.jumpBoost + this.carryJumpBonus)` and replace the
  3–4 duplicated `PLAYER_JUMP_VELOCITY - this.jumpBoost` expressions (small
  cleanup that also fixes a latent inconsistency risk).
- Movement: ground move speed becomes `PLAYER_SPEED * this.carrySpeedMult`
  (placement-mode speed unaffected).
- Effective max air-jumps: `this.maxAirJumps + this.carryExtraAirJumps` via a
  private getter; reset sites use it.

### 4. UI

- **Proximity overlay:** world-space panel anchored above the in-range pickup:
  item name, effect description, `+N pts`, and the grab prompt (`Press E` /
  `GRAB`). Hidden when nothing is in range. Sized for the 448×970 test phone.
- **HUD carried indicator:** compact text near the score showing carried count
  and pending bonus, e.g. `Salvage x3  +1750`. Lives in / alongside `HUD.ts`.
- **Mobile GRAB button:** on-screen button shown only while a pickup is in range
  (mirrors the existing PLACE button pattern in `GameScene`).

### 5. Scoring (`shared/buildRunScore.ts`)

- Add optional `salvageBonus?: number` to `RunStats`.
- When `salvageBonus > 0`, emit a `'salvage'` row (`label: 'SALVAGE'`) and add it
  into `total` (so it is multiplied by `scoreMult` like everything else).
- `RunScoreRow.type` union gains `'salvage'`.
- `GameScene.placeBlock()` (success) passes
  `salvageBonus: pickupManager.getCarriedBonus()`; death paths pass `0`
  (carried salvage is lost on death).

## Data Flow

```
HeapGenerator.onPlatformSpawned(entry, topY)
  → PickupManager.onPlatformSpawned (shouldSpawnPickup? → spawn Image)
per frame:
  PickupManager.update(playerX, playerY)
    → findNearestInRange → overlay + mobile GRAB visibility
    → on GRAB: carried.push(def); player.setCarryModifiers(aggregate); HUD
placeBlock() [success]:
  buildRunScore({ ..., salvageBonus: getCarriedBonus() }) → 'salvage' row
death paths:
  buildRunScore({ ..., salvageBonus: 0 })
```

## Testing (TDD)

Pure-logic units (Vitest):

1. `aggregateModifiers` — empty → identity; single; stacking (mult composes, sums
   add); the example set.
2. `shouldSpawnPickup` — respects min vertical gap; respects chance bounds
   (0 → never, 1 → always when gap satisfied).
3. `findNearestInRange` — out of range → −1; picks nearest; skips collected.
4. `buildRunScore` with `salvageBonus` — adds row only when > 0; included in
   `×scoreMult` total; absent when 0/undefined (no regression to existing tests).

Phaser-heavy wiring (sprites, input, overlay, HUD) verified via
`npm run scene-preview` screenshots and `npm run build` + full `npm test`.

## Out of Scope (follow-ups)

- InfiniteGameScene wiring (PickupManager is built scene-agnostic to allow it).
- Persisting/saving carried salvage across runs (run-scoped only).
- Weighted/biased spawn tables and per-heap tuning.

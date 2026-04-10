# TrashWall Design Spec
**Date:** 2026-04-10  
**Branch:** feature/Mountain-Climber-upgrade  
**Status:** Approved

---

## Overview

The TrashWall is a full-width, ever-rising hazard that chases the player up the heap. It spawns below the player shortly after the game starts, creeps upward at a constant base speed, and accelerates as the player climbs higher in the world. It enforces an effective lower bound on where the player can safely be — falling below the culled collision zone is no longer a viable escape route. If the wall catches the player, the player freezes, the wall visibly swallows them, and the game-over flow triggers.

---

## Architecture

**New files:**
- `src/data/trashWallDef.ts` — `TrashWallDef` type + `TRASH_WALL_DEF` constant
- `src/systems/TrashWallManager.ts` — all runtime state, rendering, movement, kill detection

**Modified files:**
- `src/entities/Player.ts` — add `setControlsEnabled(enabled: boolean)` and `freeze()`
- `src/scenes/GameScene.ts` — instantiate `TrashWallManager`, call `spawn()` and `update()`

No changes to `EnemyManager`, `Enemy`, or `enemyDefs`.

---

## Data Shape — `TrashWallDef`

```ts
export type TrashWallDef = {
  spawnBelowPlayerDistance: number; // px below player Y at spawn
  maxLaggingDistance:       number; // wall can never be more than this below player (slightly > cull distance)
  speedMin:                 number; // px/s at world bottom (MOCK_HEAP_HEIGHT_PX)
  speedMax:                 number; // px/s at yForMaxSpeed
  yForMaxSpeed:             number; // world Y where speedMax is reached (high up the heap)
  warningDistance:          number; // px above wall top to trigger warning (future: play sound)
  warningSound:             string; // sound key — placeholder until audio is added
  killZoneHeight:           number; // px of lethal band at wall's top edge
  undulateAmplitude:        number; // px trash sprites protrude above wall surface
  undulateSpeed:            number; // oscillation cycles per second
  undulateCount:            number; // number of trash sprites in the pool along the top edge
};
```

Default values (designer-tunable in `trashWallDef.ts`):

| Field | Value | Notes |
|---|---|---|
| `spawnBelowPlayerDistance` | 1200 | px below spawn Y |
| `maxLaggingDistance` | 2200 | slightly above `ENEMY_CULL_DISTANCE` (2000) |
| `speedMin` | 40 | px/s near world floor |
| `speedMax` | 120 | px/s at high altitude |
| `yForMaxSpeed` | 5000 | world Y (near top of heap) |
| `warningDistance` | 600 | px above wall top |
| `warningSound` | `'trashwall-warning'` | placeholder |
| `killZoneHeight` | 30 | px lethal band at top |
| `undulateAmplitude` | 40 | px protrusion |
| `undulateSpeed` | 0.6 | cycles/sec |
| `undulateCount` | 12 | sprites along top |

---

## Movement Mechanics

Each frame `update(playerY: number, delta: number)` runs:

**1. Speed interpolation** (faster at altitude, slower at floor):
```
t = clamp((wallY - yForMaxSpeed) / (MOCK_HEAP_HEIGHT_PX - yForMaxSpeed), 0, 1)
speed = speedMax - t * (speedMax - speedMin)
```

**2. Advance wall upward:**
```
wallY -= speed * (delta / 1000)
```

**3. Max-lag clamp** — wall can never fall more than `maxLaggingDistance` behind player:
```
wallY = Math.min(wallY, playerY + maxLaggingDistance)
```

**4. Spawn** — called once from `GameScene.create()` after final player position is set (including checkpoint repositioning):
```
wallY = playerY + spawnBelowPlayerDistance
```

---

## Visual Rendering

Rendered each frame via two layers:

**Body (`Phaser.GameObjects.Graphics`, depth 5):**
- Dark brown fill: `0x3B1F0A`
- `fillRect(0, wallY, WORLD_WIDTH, MOCK_HEAP_HEIGHT_PX)` — spans full width, infinite downward
- `clear()` + redraw each frame as wall moves

**Undulating trash sprites (pool of `undulateCount` `Phaser.GameObjects.Image`, depth 6):**
- Created at `spawn()` from random textures in `src/sprites/` (excluding `player/trashbag.png`)
- Each sprite is assigned: random X along wall width, random phase offset, random amplitude scalar (0.5–1.0)
- Each frame Y position:
  ```
  spriteY = wallY - (amplitude * scalar * Math.sin(time * speed * 2π + phase))
  ```
- When Y < `wallY` the sprite protrudes above the wall. When swallowed (Y approaches `wallY + killZoneHeight`) the wall body covers it naturally — no special animation needed.
- Sprites are randomly repositioned along X each time they complete a full cycle (optional variation).

**Warning flag:**
- `this.isWarning: boolean` — set true when `playerY > wallY - warningDistance`
- `GameScene` can read this; sound hookup deferred to future audio pass

**Depth layering:**
| Layer | Depth |
|---|---|
| Heap fill | 1–4 |
| Wall body | 5 |
| Trash undulate sprites | 6 |
| Player (normal) | 10 |
| Player (swallowed) | 4 (set on kill) |

---

## Kill Detection & Game Over

Each frame after movement:
```
if (!this.killed && playerY >= wallY - killZoneHeight) {
  this.killed = true;
  this.onKill();
}
```

`onKill` is a `() => void` callback passed at construction — `TrashWallManager` does not reference `GameScene` directly.

`GameScene` provides:
```ts
() => {
  this.player.freeze();                        // controls off, velocity zeroed, gravity off
  this.player.sprite.setDepth(4);             // visually swallowed by wall
  this.time.delayedCall(800, () => {
    this.onPlayerDead();                       // same flow as enemy overlap death
  });
}
```

`onPlayerDead()` — unchanged. Score screen launches with `checkpointAvailable` flag as normal.

---

## Player Additions

Two new methods on `Player`:

```ts
private controlsEnabled = true;

setControlsEnabled(enabled: boolean): void {
  this.controlsEnabled = enabled;
}

freeze(): void {
  this.setControlsEnabled(false);
  this.sprite.setVelocity(0, 0);
  this.sprite.body.setAllowGravity(false);
  if (this.onLadder) this.exitLadder();
}
```

`update()` gains an early return immediately after the ladder block:
```ts
if (!this.controlsEnabled) return;
```
The ladder block still runs (so `exitLadder()` in `freeze()` handles that path cleanly). The `controlsEnabled` check only skips the normal physics block beneath it.

`setControlsEnabled(false)` — input disabled, physics still runs (player falls).  
`freeze()` — input disabled + velocity zeroed + gravity off (player locked in space).

---

## GameScene Integration

```ts
private trashWallManager!: TrashWallManager;
```

In `create()`, after final player position is resolved (after checkpoint reposition block):
```ts
this.trashWallManager = new TrashWallManager(this, TRASH_WALL_DEF, () => {
  this.player.freeze();
  this.player.sprite.setDepth(4);
  this.time.delayedCall(800, () => { this.onPlayerDead(); });
});
this.trashWallManager.spawn(this.player.sprite.y);
```

In `update()`, before enemy update:
```ts
this.trashWallManager.update(this.player.sprite.y, delta);
```

---

## Testing

- Unit tests for movement math: speed interpolation, max-lag clamp, spawn position
- Unit test: kill fires when `playerY >= wallY - killZoneHeight`, not before
- Unit test: kill does not fire twice (killed flag)
- Manual smoke: wall rises visibly, speeds up at altitude, swallows player on contact
- Manual smoke: checkpoint respawn places wall below checkpoint Y, not world spawn Y

---

## Out of Scope

- Warning sound hookup (deferred to audio pass; `warningSound` field reserved)
- Wall texture / tiling (dark brown flat fill is sufficient for now)
- Difficulty scaling beyond Y-based speed interpolation

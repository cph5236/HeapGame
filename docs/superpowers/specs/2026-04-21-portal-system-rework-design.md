# Portal System Rework — Design Spec
_Date: 2026-04-21_

## Overview

Rework the `InfiniteGameScene` portal system to spawn portals on eligible heap surfaces with sprite visuals, particle effects, and Y-interval-based spawn timing instead of the current rigid band-count trigger.

---

## 1. `PortalDef` changes

`src/data/portalDefs.ts`

Replace `bandsPerPair` with Y-interval and range config. Add sprite asset fields.

```typescript
export interface PortalDef {
  spawnPortalEveryY:  [number, number];  // [min, max] px of climb between entrance spawns
  portalRange:        [number, number];  // [min, max] px above entrance to place exit
  invincibilityMs:    number;
  width:              number;
  height:             number;
  clearanceRequired:  number;            // px of clear air above surface (PLAYER_HEIGHT * 1.5)
  spriteKey:          string;            // Phaser texture key
  spritePath:         string;            // asset path loaded in BootScene
}

export const PORTAL_DEF: PortalDef = {
  spawnPortalEveryY:  [200, 400],
  portalRange:        [300, 500],
  invincibilityMs:    2_000,
  width:              40,
  height:             50,
  clearanceRequired:  72,               // PLAYER_HEIGHT (48) * 1.5
  spriteKey:          'portal-trashcan',
  spritePath:         'src/sprites/Portal/Trashcan-portal.jpg',
};
```

---

## 2. `PortalManager` architecture

`src/systems/PortalManager.ts`

### Constructor signature

```typescript
constructor(
  scene:                Phaser.Scene,
  player:               Player,
  colBounds:            [number, number][],
  def:                  PortalDef,
  onTeleport:           (invincibilityMs: number) => void,
  findEligibleSurface:  (colIdx: number, x: number, nearY: number) => number | null,
)
```

`findEligibleSurface` is the only geometry interface — all surface and clearance logic lives in the caller (`InfiniteGameScene`), keeping `PortalManager` free of heap geometry knowledge.

### State

- Remove `bandsSinceLastPair`
- Add `nextPortalY: number` — initialized to `player.sprite.y - randBetween(def.spawnPortalEveryY)` in constructor

### Spawn trigger (in `update()`)

```
if (player.sprite.y <= nextPortalY):
  attemptSpawnPair(nextPortalY)
  nextPortalY -= randBetween(def.spawnPortalEveryY)
```

`onBandLoaded` is removed entirely — spawning is player-Y driven.

### `attemptSpawnPair(entranceY)`

1. Pick a random column index and random X within its bounds
2. Call `findEligibleSurface(colIdx, x, entranceY)` — returns surface Y or `null`
3. If `null` → skip spawn, `nextPortalY` already advanced
4. If valid surface found → place entrance at `(x, surfaceY)`
5. For the exit: pick any random column (can be same or different), random X, call `findEligibleSurface` with `nearY = surfaceY - randBetween(def.portalRange)`
6. If exit surface also valid → create the pair; otherwise skip

### `PortalPair` interface

```typescript
interface PortalPair {
  aX: number; aY: number;
  bX: number; bY: number;
  aSprite:  Phaser.GameObjects.Image;
  bSprite:  Phaser.GameObjects.Image;
  aEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  bEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
}
```

---

## 3. Surface finding + clearance check

**Callback implementation in `InfiniteGameScene`:**

```typescript
findEligibleSurface: (colIdx, x, nearY) => {
  const layerGen = this.layerGenerators[colIdx];
  const bandTop  = Math.floor(nearY / CHUNK_BAND_HEIGHT) * CHUNK_BAND_HEIGHT;
  const rows     = layerGen.rowsForBand(bandTop);

  // Topmost row (first row with smallest Y) containing x — that is the surface
  const surfaceRow = rows.find(r => x >= r.leftX && x <= r.rightX);
  if (!surfaceRow) return null;

  // Check clearanceRequired px of air above the surface point
  const clearTop = surfaceRow.y - PORTAL_DEF.clearanceRequired;
  const hasObstruction = rows.some(
    r => r.y > clearTop && r.y < surfaceRow.y && x >= r.leftX && x <= r.rightX
  );

  return hasObstruction ? null : surfaceRow.y;
}
```

All geometry logic is encapsulated in this callback. `PortalManager` only acts on the returned value.

**Known limitation:** clearance check only scans rows within the same 500px band. If a surface sits within 72px of the band top, obstructions in the band above are not checked. Acceptable given band height vs clearance ratio — revisit if `clearanceRequired` is ever increased significantly.

---

## 4. Sprites + particles

### Portal sprite

- `Phaser.GameObjects.Image` using `def.spriteKey`
- Sized to `def.width × def.height`
- Rotated **45°**
- Origin `(0.5, 1.0)` — base sits on the surface point

### Particle texture keys

16 recycle item textures loaded as `recycle-item-0` through `recycle-item-15` from `src/sprites/Heap_sprites/recycle_items/recycle_items_00.png` … `_15.png`.

A constant `RECYCLE_ITEM_COUNT = 16` is defined in `constants.ts` to avoid hardcoding the count in multiple places.

### Entrance portal — suction particles

- Particles spawn in a ~60px radius around the portal center
- Random texture from `recycle-item-0..15` per particle
- `moveToX/Y` set to portal center — particles drift inward
- Scale shrinks to 0 as they arrive
- Continuous emit, lifespan ~1200ms

### Exit portal — ejection particles

- Particles spawn at portal center
- Shoot outward in the upward-outward direction (matching the 45° sprite rotation)
- Speed range `[80, 160]` px/s with gravity pulling back down
- Alpha fades out over ~800ms
- Periodic burst pattern (not continuous stream)

---

## 5. `BootScene` + `InfiniteGameScene` wiring

### `BootScene`

Load portal sprite using `PORTAL_DEF` fields (no hardcoded paths):
```typescript
this.load.image(PORTAL_DEF.spriteKey, PORTAL_DEF.spritePath);
for (let i = 0; i < RECYCLE_ITEM_COUNT; i++) {
  this.load.image(`recycle-item-${i}`, recycleItemUrls[i]);
}
```

`recycleItemUrls` follows the same URL-import pattern used for other sprites in `BootScene`.

### `InfiniteGameScene`

1. Remove the `this.portalManager?.onBandLoaded(bandTopY)` call from col 0's generator callback
2. Construct `PortalManager` with updated signature passing `findEligibleSurface` callback
3. `portalManager.update()` call in `update()` is unchanged

### Culling

In `PortalManager.update()`, after the spawn check: iterate `pairs` and destroy any pair whose portals have scrolled more than one screen height below `camera.worldView.bottom`. Destroy both sprites, both emitters, splice from array.

---

## Files changed

| File | Change |
|------|--------|
| `src/data/portalDefs.ts` | Replace `bandsPerPair/minHeightDelta/maxHeightDelta` with new fields; add sprite fields |
| `src/systems/PortalManager.ts` | Full rework: Y-driven spawning, surface callback, sprites, particles, culling |
| `src/scenes/BootScene.ts` | Load portal sprite + 16 recycle item textures |
| `src/scenes/InfiniteGameScene.ts` | Remove `onBandLoaded` portal hook; pass `findEligibleSurface` callback |
| `src/constants.ts` | Add `RECYCLE_ITEM_COUNT = 16` |

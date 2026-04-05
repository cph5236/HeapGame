# Placement Rework — Design Spec
_2026-04-03_

## Problem

The current placement ghost renders a block at the heap surface Y directly below the player X. This surface Y is often above or below the player's visible position, making the ghost feel disconnected and confusing. The block size and position don't correspond to where the player actually is.

## Goal

Remove the ghost block entirely. Use the player's physics contact with the heap surface as the placement signal. Require a 1-second hold to confirm placement, with a progress bar on the button.

---

## Section 1 — Surface Detection & Placement Point

**Removed entirely:**
- `placementGhost` Graphics object and all draw calls
- `_ghostLastX`, `_ghostLastSurfaceY`, `_ghostLastValid`, `_ghostLastInZone` state fields
- `updatePlacementGhost()` method
- All calls to `findSurfaceYFromPolygon` from `GameScene`

**Placement validity condition:**
```
inTopZone && player.sprite.body.blocked.down
```
- `inTopZone` is already computed each frame (`player.sprite.y < heapGenerator.topY + HEAP_TOP_ZONE_PX`)
- `blocked.down` is Phaser arcade physics — true when the player is resting on a surface
- Together these mean: player is near the heap peak AND standing on something (which in the top zone can only be the heap surface)

**Placement payload:**
```ts
{ x: player.x, y: player.y }  // player center, unchanged on server
```
Server receives `{x, y}` and treats it as a polygon vertex — no server changes required.

**Constants:** `HEAP_TOP_ZONE_PX` already exists in `src/constants.ts` and remains configurable there.

---

## Section 2 — Hold-to-Confirm & InputManager Changes

### New constant
```ts
// src/constants.ts
export const PLACE_HOLD_DURATION_MS = 1000;
```

### InputManager changes
Replace impulse-based placement with a continuous hold boolean:

| Before | After |
|--------|-------|
| `placeJustPressed: boolean` | `placeHeld: boolean` |
| `pendingPlace: boolean` | _(removed)_ |
| `triggerPlace()` | `startPlace()` / `endPlace()` |

- Mobile button: `pointerdown` → `im.startPlace()` sets `placeHeld = true`; `pointerup` + `pointerout` → `im.endPlace()` sets `placeHeld = false`
- Desktop: GameScene reads `this.placeKey.isDown` directly — no InputManager involvement

### GameScene hold timer
New field: `_holdElapsed = 0`

Each frame in `update()`:
```
if (inTopZone && blocked.down && !blockPlaced && holdInputActive):
    _holdElapsed += delta
    if _holdElapsed >= PLACE_HOLD_DURATION_MS:
        placeBlock()
        _holdElapsed = 0
else:
    _holdElapsed = 0
```

`holdInputActive` = `this.placeKey.isDown` (desktop) or `im.placeHeld` (mobile).

**Center zone** (`player.x` in the center 75% of the world) is folded into the validity condition — the hold timer only advances when all conditions pass. If the player drifts out of the center zone mid-hold, the bar resets silently. No flash message required.

Full validity condition:
```
inTopZone && blocked.down && inCenterZone && !blockPlaced && holdInputActive
```
where `inCenterZone = player.x >= WORLD_WIDTH * 0.125 && player.x <= WORLD_WIDTH * 0.875`

---

## Section 3 — Progress Bar UI

### New field
```ts
private _holdBar!: Phaser.GameObjects.Graphics;
```
Created in `create()`, scroll-factor 0, depth above the place button (depth 26).

### Draw logic
Shared helper method:
```ts
private _drawHoldBar(progress: number, x: number, y: number, w: number, h: number): void
```
- Clears and redraws each frame when `progress > 0`
- Fills a rect from left edge, width = `w * progress`, white at 70% opacity (`0xffffff`, 0.7)
- Rounded appearance via `fillRoundedRect` (Phaser Graphics API)
- Cleared when `progress === 0`

### Mobile anchor
- Positioned along the bottom quarter of `placeBtnBg` (same screen coords)
- While holding: button stroke swaps to `0x88ddff` (brighter blue) to indicate active state
- On release before completion: stroke resets to `0x4488dd`, bar clears

### Desktop anchor
- Positioned directly beneath `topZoneText`, matching its width
- Same fill style

### Visibility
- `_holdBar` is only drawn when `showPlaceUI && _holdElapsed > 0`
- At 100% fill, `placeBlock()` fires immediately — bar doesn't linger

---

## placeBlock() Changes

`placeBlock()` requires the following targeted changes:

- Remove `findSurfaceYFromPolygon` call and `surfaceY` variable
- Remove "no surface" guard (pre-call validity condition handles this)
- Remove "move to center" guard and flash message (folded into hold validity condition)
- Change payload: `HeapClient.append(heapId, player.x, player.y)` (player center)
- Change score calc: `Math.max(0, Math.floor(this.spawnY - player.y))`
- `OBJECT_DEFS[keyid]` selection stays for item type variety; `def.width`/`def.height` no longer used

## What Does Not Change

- Server routes (`POST /heaps/:id/place`) — unchanged
- `HeapClient.append()` signature — unchanged (`heapId, x, y`)
- `HEAP_TOP_ZONE_PX` — already in constants, already configurable
- ScoreScene transition logic — unchanged

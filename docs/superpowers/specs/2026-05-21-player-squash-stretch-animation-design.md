# Player Squash-and-Stretch Animation — Design Spec

**Date:** 2026-05-21  
**Branch:** feature/GameplayImprovements  
**Status:** Approved — ready for implementation plan

---

## Overview

Add real-time procedural squash-and-stretch animation to the trash bag player character. The effect is purely cosmetic — physics and hitbox are never affected. A new `PlayerAnimator` class owns all visual logic. The existing `Player` class exposes a read-only state snapshot and is otherwise unchanged.

A new sprite (`trashbag-nostrings.png`) replaces the original. The red bow strings are removed from the PNG and replaced with two procedurally drawn bezier curves that react to the player's velocity state each frame.

---

## Architecture

### Files

| File | Change |
|---|---|
| `src/sprites/player/trashbag-nostrings.png` | New asset — bag body without bow strings (already created) |
| `src/entities/PlayerAnimator.ts` | New class — owns all squash/stretch + string rendering |
| `src/entities/Player.ts` | Switch sprite key; add jump flags + `animState` getter |
| `src/scenes/BootScene.ts` | Load `trashbag-nostrings` image |
| Game scenes (GameScene, InfiniteGameScene, etc.) | Construct, update, and destroy `PlayerAnimator` |

### Relationship

`Player` handles physics exclusively. `PlayerAnimator` reads a snapshot from `Player` each frame and manipulates the sprite's scale/rotation plus a Graphics overlay. The animator never reads from the physics body and never writes velocity.

```
Player.update(delta)          → physics, velocity, jump flags
player.animState              → read-only snapshot
PlayerAnimator.update(delta, animState) → scale, rotation, strings
```

---

## PlayerAnimState Snapshot Interface

```typescript
interface PlayerAnimState {
  vy:             number;   // current vertical velocity (positive = down)
  onGround:       boolean;
  onWall:         boolean;
  frozen:         boolean;  // Player.freeze() was called
  justLanded:     boolean;  // true for one frame on touchdown
  justJumped:     boolean;  // true for one frame — ground or coyote jump
  justAirJumped:  boolean;  // true for one frame — air jump
  justWallJumped: boolean;  // true for one frame — wall jump
  justDied:       boolean;  // true for one frame — always false from animState getter; scene overrides on death frame
}
```

All `just*` flags are set to `true` at their trigger site in `Player.update()` and cleared at the end of the same `update()` call.

`justDied` always returns false from the `animState` getter. The scene spreads an override on the death frame (see Scene Integration).

---

## State Machine

### States (enum `AnimState`)

```
IDLE | LAUNCHING | AIR_JUMP | APEX | FALLING | LANDING | WALL_SLIDE
```

### Transition Rules

Evaluated top-to-bottom each frame. First match wins.

| Condition | State |
|---|---|
| `frozen` or `justDied` | dormant (no update) |
| timed state active and no interrupt | stay in timed state |
| `justLanded` | → LANDING (timed, ~400ms) |
| `justJumped` | → LAUNCHING (timed, ~600ms) |
| `justAirJumped` | → AIR_JUMP (timed, ~500ms) |
| `onWall && !onGround && vy > 0` | → WALL_SLIDE |
| `!onGround && \|vy\| < 80` | → APEX |
| `!onGround && vy > 80` | → FALLING |
| `onGround` | → IDLE |

### Interrupt Conditions (break out of any timed state immediately)

| Interrupt | Triggered by | Transitions to |
|---|---|---|
| `frozen === true` | `Player.freeze()` | hold scale, animator dormant |
| `justDied` | scene on death frame | scale → 1.0, animator dormant |
| `justLanded` | landing during LAUNCHING/AIR_JUMP | LANDING |
| `justWallJumped` | wall jump during LAUNCHING/AIR_JUMP | new LAUNCHING |

---

## Scale & Rotation Targets by State

All values are targets — the animator lerps toward them each frame (`ANIM_LERP_SPEED = 12`). Timed states use a keyframe curve (small `{ t, scaleX, scaleY }` array) scrubbed by `stateTimer` instead of a lerp.

| State | scaleX | scaleY | angle | Notes |
|---|---|---|---|---|
| IDLE | 1.00 ↔ 1.05 | 1.00 ↔ 0.95 | 0° | Sine-driven breathing, period ~2.2s |
| LAUNCHING | 0.72 → 1.00 | 1.38 → 1.00 | 0° | Keyframe curve over ~600ms |
| AIR_JUMP | 0.80 → 1.00 | 1.30 → 1.00 | 0° | Sharp pop, damps over ~500ms (Variant B) |
| APEX | 1.06 | 0.94 | ±2° wiggle | Fast sine rotation, period ~450ms |
| FALLING | 0.88 | 1.15 | 0° | Held target, lerp entry |
| LANDING | 1.45 → 0.88 → 1.06 → 1.00 | 0.55 → 1.15 → 0.96 → 1.00 | 0° | Keyframe curve over ~400ms |
| WALL_SLIDE | 1.10 ↔ 1.12 | 0.92 ↔ 0.90 | 0° | Gentle oscillation |

**Physics body protection:** After every scale write, call `body.setSize(PLAYER_WIDTH / sprite.scaleX, PLAYER_HEIGHT / sprite.scaleY)` to keep the hitbox pinned at original pixel dimensions.

---

## Bow Strings

### Rendering

A single `Phaser.GameObjects.Graphics` object at `depth 11` (sprite is at depth 10). Cleared and redrawn each frame as two quadratic bezier curves — one left string, one right string.

Draw call per string:
```
beginPath()
moveTo(attachX, attachY)
quadraticCurveTo(cpX, cpY, endX, endY)
strokePath()
```
Stroke: white, lineWidth 2.5.

### Attachment Point

Fixed in sprite-local coordinates at `(0, -PLAYER_HEIGHT * 0.44)` — the center of the red collar. Converted to world coords each frame: `attachX = sprite.x`, `attachY = sprite.y - PLAYER_HEIGHT * 0.44 * sprite.scaleY`.

The scaleY factor on the offset ensures the attachment point moves correctly when the bag is tall (launching) or squashed (landing).

### Control Point Targets by State

Control points are lerped each frame (same `ANIM_LERP_SPEED`). L = left string, R = right string. Offsets are relative to the attachment point in world pixels.

| State | L control point | L end point | R control point | R end point | Notes |
|---|---|---|---|---|---|
| IDLE | (-9, +16) | (-12, +30) | (+9, +16) | (+12, +30) | Drooping down, gentle sway |
| LAUNCHING | (-3, +20) | (-2, +40) | (+3, +20) | (+2, +40) | Trail straight down |
| AIR_JUMP | (-3, +20) | (-2, +40) | (+3, +20) | (+2, +40) | Trail straight down on pop |
| APEX | (-20, +6) | (-30, +8) | (+20, +6) | (+30, +8) | Float sideways |
| FALLING | (-5, -10) | (-6, -22) | (+5, -10) | (+6, -22) | Float upward, flapping ±diagonal |
| LANDING | starts from FALLING → wide → idle | — | — | — | Keyframe curve matches bag |
| WALL_SLIDE | (-4, +10) | (-3, +24) | (+10, +12) | (+14, +26) | Pushed to free side |

FALLING strings flap: control point oscillates between `(-5,-10)` and `(-12,-4)` at ~0.55s period to simulate wind flutter.

LANDING string keyframes (mirrors on R side):
- `t=0.00`: FALLING position (strings up)
- `t=0.28`: wide flare `(-24, +8) → (-30, +14)`
- `t=0.65`: partial settle `(-10, +12) → (-11, +24)`
- `t=1.00`: idle position `(-9, +16) → (-12, +30)`

---

## Player.ts Changes

1. **Sprite key**: `'trashbag'` → `'trashbag-nostrings'`
2. **New private flags**: `_justJumped`, `_justAirJumped`, `_justWallJumped` — each set `true` at their respective jump call sites, cleared at the bottom of `update()`
3. **`animState` getter**: assembles and returns `PlayerAnimState` from existing fields + new flags
4. **No physics changes**: all existing movement, collision, and gravity logic is untouched

---

## Scene Integration

```typescript
// Scene create()
this.playerAnimator = new PlayerAnimator(this.player.sprite, this);

// Scene update(time, delta)
this.player.update(delta);
this.playerAnimator.update(delta, this.player.animState);

// Scene shutdown / destroy
this.playerAnimator.destroy();
```

`justDied` is assembled by the scene on the death frame:
```typescript
// when the scene kills the player
const state = { ...this.player.animState, justDied: true };
this.playerAnimator.update(delta, state);
```

---

## Constants

All tunable values live as private constants at the top of `PlayerAnimator.ts`:

```typescript
const LERP_SPEED        = 12;     // lerp factor per second
const APEX_VY_THRESHOLD = 80;     // px/s — |vy| below this = apex
const LAUNCH_DURATION   = 600;    // ms
const AIR_JUMP_DURATION = 500;    // ms
const LANDING_DURATION  = 400;    // ms
const IDLE_PERIOD       = 2200;   // ms — breathing sine period
const FALL_FLAP_PERIOD  = 550;    // ms — string flutter period
const APEX_WIGGLE_PERIOD = 450;   // ms — apex rotation sine period
const STRING_STROKE_W   = 2.5;    // px
const COLLAR_OFFSET_Y   = -0.44;  // fraction of PLAYER_HEIGHT
```

---

## Testing Strategy

- **No new unit tests** for `PlayerAnimator` — it is purely visual with no logic worth unit-testing
- **Existing `Player.test.ts`** tests are unaffected; all physics behaviour is unchanged
- **`npm run build`** catches TypeScript errors in the new class and interface
- **`npm run scene-preview`** for visual verification before merge
- **Browser smoke test**: manually trigger each of the 7 states and confirm bag + strings respond correctly

---

## Out of Scope

- Wind particle trails (suggested but deferred)
- Debris bulge (suggested but deferred)
- Anticipation crouch with movement delay (explicitly excluded — pure visual only)

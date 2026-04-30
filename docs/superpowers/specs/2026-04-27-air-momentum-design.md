# Air Momentum Design

**Date:** 2026-04-27
**Branch:** feature/mobile-controls

## Overview

Replace the direct `setVelocityX()` air movement model with an impulse-based momentum system. While airborne, tilt/keyboard input applies a force to a stored `momentumX` value each frame rather than setting velocity directly. Opposing input gets a configurable advantage factor to help the player stop quickly. Directional swipe jumps seed `momentumX` at the moment of jumping. Applies to both mobile (tilt) and PC (keyboard).

## Constants (constants.ts)

| Constant | Purpose | Starting value |
|---|---|---|
| `AIR_TILT_FORCE` | Force per unit tilt per ms while airborne | tune in testing |
| `AIR_MOMENTUM_DECAY` | Per-ms decay multiplier applied when input is ~zero | tune in testing |
| `MOMENTUM_STOP_ADV_FACTOR` | Extra multiplier when input opposes current momentum | `1.5` |
| `SWIPE_JUMP_HORIZONTAL_MAX` | Max horizontal velocity injected by a diagonal swipe jump | at or below `PLAYER_SPEED` |

## Momentum Model (Player.ts)

### New field

```ts
private momentumX = 0;
```

### Ground path — unchanged

When `onGround`, tilt/keyboard sets `setVelocityX()` directly as today. `momentumX` is zeroed on landing and on wall contact.

### Air path — replaces direct setVelocityX

While airborne and `dashActive === 0`:

1. Derive `inputDir` from tilt factor (mobile) or keyboard (PC) — same ±1 scale as today.
2. Compute `force = inputDir * AIR_TILT_FORCE * delta`.
3. If `force` and `momentumX` are opposite signs, multiply `force` by `MOMENTUM_STOP_ADV_FACTOR`.
4. `momentumX = clamp(momentumX + force, -PLAYER_SPEED, PLAYER_SPEED)`.
5. When `inputDir` is near zero (< 0.01), apply passive decay: `momentumX *= decay_per_ms ^ delta`.
6. `setVelocityX(momentumX)`.

### Resets

- **Landing:** `momentumX = 0`
- **Wall contact** (`body.blocked.left || body.blocked.right`): `momentumX = 0`
- **Dash fires:** `momentumX = 0` (dash takes over, resumes from zero when dash expires)

## Swipe Angle → Horizontal Impulse (InputManager.ts + Player.ts)

### InputManager changes

Add alongside `pendingJump`:

```ts
pendingJumpVx = 0;
```

When classifying a swipe-up (both the `tracking` branch and the fast-flick-from-drag branch), compute:

```ts
this.pendingJumpVx = (dx / Math.sqrt(dx * dx + dy * dy)) * SWIPE_JUMP_HORIZONTAL_MAX;
```

Clear `pendingJumpVx = 0` in `update()` alongside the other pending flags.

For tap (zero-angle jump), `pendingJumpVx` stays 0 — no horizontal impulse.

### Player changes

At the moment a jump fires (ground jump, air jump, or wall jump), set:

```ts
this.momentumX = im.pendingJumpVx;
```

This overwrites rather than adds — the swipe direction is the player's intent at that instant. If `pendingJumpVx` is 0 (tap or keyboard jump), `momentumX` is cleared to zero at jump time, which is correct since ground path already zeroed it.

## Scope

- `src/constants.ts` — 4 new constants
- `src/systems/InputManager.ts` — `pendingJumpVx` field, set in swipe-up classifiers, cleared in `update()`
- `src/entities/Player.ts` — `momentumX` field, air movement block rewrite, reset on land/wall/dash, read `im.pendingJumpVx` at jump time
- `src/entities/__tests__/Player.test.ts` — tests for momentum accumulation, stop advantage, swipe impulse, resets
- `src/systems/__tests__/InputManager.test.ts` — tests for `pendingJumpVx` on angled and vertical swipes

## Out of Scope

- Dash itself is unchanged (it still overrides `setVelocityX` directly for `DASH_DURATION_MS`)
- No air momentum during dash
- No momentum on ladder (ladder path returns early, unchanged)

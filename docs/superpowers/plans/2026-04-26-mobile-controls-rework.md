# Mobile Controls Rework

**Date:** 2026-04-26
**Branch:** feature/Infinite-heap (or new branch)
**Status:** REVIEW — annotate each section before implementation

---

## Goal

Audit every movement type and its current mobile implementation. For each, the user will explain what feels clunky so we can redesign the input scheme from scratch or in targeted patches.

---

## Current Input Architecture

All mobile input lives in `src/systems/InputManager.ts`. The scheme:

- **Tilt (DeviceOrientation gamma)** → walk left/right
- **Tap (touchend that isn't a swipe)** → jump
- **Swipe (fast horizontal touch)** → dash
- **On-screen button** → place block

---

## Movement Types — Annotate Each

### 1. Walk (Left / Right)

**Current mobile:** Tilt phone left/right (gyroscope gamma).
- Dead zone: ±5° (`TILT_DEAD_ZONE_DEG`)
- Full speed at: ±25° (`TILT_MAX_DEG`)
- Speed is binary (full speed or zero) — no analog ramp

**iOS note:** Requires explicit permission tap in MenuScene on first load.

**What's clunky?**
> I think we should remove the dead zone in the middle or make it smaller currently its slightly too large maybe only a 2 degree dead zone would be snappy, next the speed being binary doesnt feel good on mobile on pc its fine but on mobile the tilt angle should contribute to speed with a max of 25 bringing the player up to full speed.

---

### 2. Jump

**Current mobile:** Tap anywhere on screen (any touch that doesn't qualify as a dash swipe).

Covers all jump variants:
- Ground jump
- Air jump (double jump, if `MAX_AIR_JUMPS > 0`)
- Wall jump (if touching a wall while airborne)

**What's clunky?**
> Jump is hard because its hard to jump at a say diagnal direction off of the heap. currently if you want to jump you need to jump and tilt your phone fast. what I'm thinking for this is maybe the above will make it feel better so you can tily your phone only a little and jump at that angle. Also The jump needs to take into consideration the phone tilt at the time of screen pressed. 

---

### 3. Dash

**Current mobile:** Fast horizontal swipe.
- Min distance: 60 px (`SWIPE_MIN_DISTANCE_PX`)
- Max duration: 350 ms (`SWIPE_MAX_TIME_MS`)
- Directionality ratio: |dx|/|dy| > 2.0 (`SWIPE_DIRECTION_RATIO`)

Swipe direction determines dash direction (left or right).

**Conflict:** Swipe and tap share the same touchend event — swipe detection happens first; anything that fails swipe validation becomes a jump tap. This means a slow or slightly diagonal swipe silently becomes a jump.

**What's clunky?**
> Swipe left or right feels fine for dash. We can have a whole swipe system where different direction swipes can be different things like a swipe down is a dive, left right is dash, up would be a jump. 

---

### 4. Wall Slide

**Current mobile:** Fully automatic — no input needed. Player slides at reduced speed when pressing into a wall while airborne.

**What's clunky?**
> nothing needs here

---

### 5. Dive

**Current mobile:** ❌ NOT IMPLEMENTED.

Desktop: Hold ↓ or S while airborne to dive straight down fast.

There is no equivalent touch gesture. Mobile players cannot dive.

**What's clunky?**
> swipe down

---

### 6. Place Block

**Current mobile:** On-screen "PLACE BLOCK" button (center-top, 280×56 px).
- Shown only when player is in the live zone placement area
- Hold for 1 second (`PLACE_HOLD_DURATION_MS`) with a progress bar
- Button sends `placeHeld` signal to InputManager

**What's clunky?**
> nothing clunky here I think this is actually pretty good

---

### 7. Pause / Menu Navigation

**Current mobile:** Unknown — check if pause is reachable on mobile without a physical keyboard.

**What's clunky?**
> I dont think we currenty have a pause menu

---

## Known Systemic Issues

1. **Tilt + tap conflict** — While tilting, tapping also fires. There's no way to walk and jump without the tap always landing in the tilt stream.
2. **Swipe vs tap ambiguity** — A drag that's too slow or too diagonal silently jumps instead of dashing. No feedback to player.
3. **No analog walk** — Tilt is full speed or zero (binary). There are tilt angles but no ramping applied.
4. **Dive missing** — No mobile input.
5. **iOS permission friction** — Extra tap in MenuScene before tilt works at all.

---

## Alternative Schemes to Consider (pre-discussion)

These are options for discussion, not commitments:

| Scheme | Walk | Jump | Dash | Dive |
|---|---|---|---|---|
| **Tilt + tap (current)** | Tilt | Tap | Swipe | ❌ |
| **Virtual D-pad + buttons** | Left/right buttons | Jump button | Dash button | Down button |
| **Split-screen tap zones** | Tap left half = walk left, right half = walk right | Double-tap | Swipe | Tap + hold? |
| **Joystick + jump button** | Analog stick | Button | Flick stick? | Stick down? |
| **Tilt + dedicated buttons** | Tilt (current) | Jump button (always visible) | Dash button | Down button |

---

## Implementation Scope

### Design decisions

- **Keep tilt for walk** — go analog instead of binary
- **Keep tap for jump** — but add swipe-up as an alternate jump trigger
- **Unify all swipes** into a 4-direction classifier (replaces the current horizontal-only check)
- **Dive** — swipe-down fires a one-shot velocity burst (mobile can't hold a key, so it's an impulse)
- **Jump horizontal kick** — at jump time on mobile, snapshot tilt and apply it as vx so the arc goes in the tilted direction even from a standing start

---

### Tasks

#### Task 1 — `constants.ts`
- `TILT_DEAD_ZONE_DEG`: 5 → 2
- Add `DRAG_THRESHOLD_PX = 15`
- Remove `SWIPE_DIRECTION_RATIO` (replaced by dominant-axis comparison)
- `TILT_MAX_DEG = 25` stays

#### Task 2 — `InputManager.ts`: analog tilt + touch state machine + unified swipe

The state machine is the new backbone of touch handling. The swipe classifier runs *inside* it, so these are one task.

**Analog tilt:**
- Add `tiltFactor: number` — normalized [-1, 1]:
  - `|gamma| < 2°` → 0 (dead zone)
  - `|gamma| >= 25°` → ±1
  - Linear ramp between: `sign(gamma) * (|gamma| - 2) / (25 - 2)`
- Keep `goLeft`/`goRight` as convenience booleans derived from `tiltFactor` (ladder + dash fallback)

**Touch state machine** — private `touchState: 'idle' | 'tracking' | 'drag'`:

```
touchstart → 'tracking', record startX/Y/Time, update currentTouchY

touchmove (only when 'tracking'):
  adx = |currentX - startX|, ady = |currentY - startY|
  if ady > adx AND ady >= DRAG_THRESHOLD_PX → state = 'drag'
  always: currentTouchY = currentY

touchend:
  if 'drag'     → clear dragUp/dragDown, reset to 'idle', RETURN (suppressed)
  if 'tracking' → run swipe classifier below, reset to 'idle'
```

**Swipe classifier** (runs in `touchend` only when state was `'tracking'`):
```
dx = endX - startX,  dy = endY - startY
adx = |dx|,          ady = |dy|,   dt = now - startTime

if adx > ady AND adx >= SWIPE_MIN_DISTANCE_PX AND dt < SWIPE_MAX_TIME_MS:
    → horizontal swipe → pendingDash = true, pendingDashDir = sign(dx)

elif ady > adx AND ady >= SWIPE_MIN_DISTANCE_PX AND dt < SWIPE_MAX_TIME_MS AND dy > 0:
    → swipe-down → pendingDive = true

elif ady > adx AND ady >= SWIPE_MIN_DISTANCE_PX AND dt < SWIPE_MAX_TIME_MS AND dy < 0:
    → swipe-up → pendingJump = true

else:
    → tap → pendingJump = true
```

**New public outputs:**
- `tiltFactor: number` — analog walk speed scalar
- `dragUp: boolean` — live, `state === 'drag' && currentTouchY < startY - DRAG_THRESHOLD_PX`
- `dragDown: boolean` — live, `state === 'drag' && currentTouchY > startY + DRAG_THRESHOLD_PX`
- `diveJustFired: boolean` — consumed per frame (same pattern as `dashJustFired`)

**New listener:** `touchmove` on `window` (passive).

**Remove:** `SWIPE_DIRECTION_RATIO` constant and import.

**Why suppression is correct:**
- `InputManager` owns all gesture state — no leakage into Player/Scene
- `Player.ts` reads `dragUp`/`dragDown` without knowing they suppress other gestures
- Horizontal swipes can't enter drag state (`ady > adx` guard in touchmove)
- A stationary tap can't enter drag state (`ady < DRAG_THRESHOLD_PX`)
- Adding future gesture types = adding a new state, touching nothing else

#### Task 3 — `Player.ts`: analog walk, tilt-kick jump, mobile dive, ladder drag

**Analog walk:**
- Replace the tilt branch of horizontal movement with `im.tiltFactor * PLAYER_SPEED`
- Keyboard keys remain binary override (if keyboardLeft → -PLAYER_SPEED, keyboardRight → PLAYER_SPEED, else tiltFactor × speed)
- Ladder section keeps `im.goLeft` / `im.goRight` booleans (no change)

**Tilt-kick jump** (mobile only):
- At the point where `setVelocityY(PLAYER_JUMP_VELOCITY)` fires, if `im.isMobile`:
  - `setVelocityX(im.tiltFactor * PLAYER_SPEED)`
- Applies to ground jump, air jump, and wall jump (wall jump already overrides vx so skip there)

**Mobile dive:**
- Add `diveActive: number` timer (ms remaining), parallel to `dashActive`
- When `im.diveJustFired` and `this.diveEnabled` and `!onGround`:
  - `setVelocityY(PLAYER_DIVE_SPEED)`
  - `body.setMaxVelocityY(PLAYER_DIVE_SPEED)`
  - `this.diveActive = DASH_DURATION_MS` (reuse same short window, ~150 ms)
- During `diveActive > 0`: sustain `maxVelocityY` at `PLAYER_DIVE_SPEED`
- On expiry: restore `maxVelocityY` to `PLAYER_MAX_FALL_SPEED`
- Desktop dive (hold-down key) unchanged

**Ladder drag (mobile):**
- In the ladder block, replace:
  - `goUp   = jumpKeys || im.jumpJustPressed` → add `|| im.dragUp`
  - `goDown = downKeys` → add `|| im.dragDown`
- No other changes — suppression is handled entirely inside `InputManager`
- On mobile, `im.dragDown` drives descent; tap (`im.jumpJustPressed`) still climbs up

#### Task 4 — Controls UI polish

**Hint text updates:**
- In `GameScene` mobile hint: add "Dive — Swipe down", update jump line to "Tap or swipe up"

**Controls icon:**
- Change the info button (ⓘ) in `GameScene` to a `?` character
- Style: white fill, black stroke/outline (use Phaser text stroke: `stroke: '#000000', strokeThickness: 3` or similar)

**Controls accessible from main menu:**
- Add the same `?` button to `MenuScene` (match position/style to `GameScene`)
- Tapping it opens the same controls overlay (extract the overlay into a shared helper or duplicate the panel — keep it simple)
- The overlay in `MenuScene` should show both desktop and mobile control sets (or just mobile if on mobile)

---

### Files touched
| File | Change |
|---|---|
| `src/constants.ts` | `TILT_DEAD_ZONE_DEG` 5→2, remove `SWIPE_DIRECTION_RATIO`, add `DRAG_THRESHOLD_PX` |
| `src/systems/InputManager.ts` | `tiltFactor`, touch state machine, unified swipe, `dragUp`/`dragDown`, `pendingDive`/`diveJustFired` |
| `src/entities/Player.ts` | Analog walk, tilt-kick jump, mobile dive timer, ladder drag |
| `src/constants.ts` | `TILT_DEAD_ZONE_DEG` 5→2, remove `SWIPE_DIRECTION_RATIO`, add `DRAG_THRESHOLD_PX` |
| `src/scenes/GameScene.ts` | Mobile hint text, `?` icon style |
| `src/scenes/MenuScene.ts` | Add `?` button + controls overlay |

### Out of scope
- Pause menu (doesn't exist yet, separate task)
- InfiniteGameScene needs no separate treatment — it uses the same Player and InputManager
- No virtual D-pad or joystick
- No configurable control scheme setting

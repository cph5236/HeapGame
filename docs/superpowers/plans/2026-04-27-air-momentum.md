# Air Momentum Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the direct `setVelocityX` air movement model with impulse-based momentum that persists and decays, with a stop-advantage factor for opposing input and diagonal-swipe horizontal seeding at jump time.

**Architecture:** `momentumX` lives on `Player` and is the sole source of horizontal velocity while airborne. Ground movement is untouched. `InputManager` gains `pendingJumpVx` to pass swipe angle to Player at jump time.

**Tech Stack:** TypeScript, Phaser 3, Vitest

---

## Files

| File | Change |
|---|---|
| `src/constants.ts` | Add 4 constants |
| `src/systems/InputManager.ts` | Add `pendingJumpVx`, set in swipe-up classifiers, clear in `update()` |
| `src/entities/Player.ts` | Add `momentumX`, rewrite airborne movement block, seed at jump, reset on land/wall/dash |
| `src/entities/__tests__/Player.test.ts` | Tests for air momentum accumulation, stop advantage, swipe seed, resets |
| `src/systems/__tests__/InputManager.test.ts` | Tests for `pendingJumpVx` on angled and vertical swipes |

---

## Task 1: Add constants

**Files:**
- Modify: `src/constants.ts`

- [ ] **Step 1: Add the four constants after the mobile controls block (line 55)**

```typescript
// Air momentum
export const AIR_TILT_FORCE          = 0.8;  // px/s added per ms at full tilt — reach PLAYER_SPEED in ~250ms
export const AIR_MOMENTUM_DECAY      = 0.994; // per-ms decay factor when input is ~zero (0.994^16 ≈ 0.906 per frame)
export const MOMENTUM_STOP_ADV_FACTOR = 1.5;  // multiplier when input opposes current momentum
export const SWIPE_JUMP_HORIZONTAL_MAX = 160; // max horizontal px/s seeded by a diagonal swipe jump
```

- [ ] **Step 2: Verify build passes**

```bash
npm run build 2>&1 | tail -5
```
Expected: `✓ built in`

- [ ] **Step 3: Commit**

```bash
git add src/constants.ts
git commit -m "feat(momentum): add air momentum constants"
```

---

## Task 2: Add `pendingJumpVx` to InputManager

**Files:**
- Modify: `src/systems/InputManager.ts`

- [ ] **Step 1: Write failing tests**

Add to `src/systems/__tests__/InputManager.test.ts`:

```typescript
describe('InputManager — pendingJumpVx', () => {
  it('is 0 for a straight-up swipe (dx=0)', async () => {
    const { im, fire, listeners } = await makeMobileIM();
    fire('touchstart', { touches: [{ clientX: 100, clientY: 300 }] });
    fire('touchend', { changedTouches: [{ clientX: 100, clientY: 230 }] }); // dy=-70, dx=0
    expect(im.pendingJumpVx).toBe(0);
  });

  it('is positive for a swipe up-right at ~45 degrees', async () => {
    const { im, fire } = await makeMobileIM();
    fire('touchstart', { touches: [{ clientX: 100, clientY: 300 }] });
    // dx=50 right, dy=-50 up → 45 deg → normalizedHx = 50/sqrt(5000) ≈ 0.707
    fire('touchend', { changedTouches: [{ clientX: 150, clientY: 250 }] });
    expect(im.pendingJumpVx).toBeGreaterThan(0);
  });

  it('is negative for a swipe up-left', async () => {
    const { im, fire } = await makeMobileIM();
    fire('touchstart', { touches: [{ clientX: 100, clientY: 300 }] });
    fire('touchend', { changedTouches: [{ clientX: 50, clientY: 250 }] });
    expect(im.pendingJumpVx).toBeLessThan(0);
  });

  it('is cleared to 0 by update()', async () => {
    const { im, fire } = await makeMobileIM();
    fire('touchstart', { touches: [{ clientX: 100, clientY: 300 }] });
    fire('touchend', { changedTouches: [{ clientX: 150, clientY: 250 }] });
    im.update(16, false);
    expect(im.pendingJumpVx).toBe(0);
  });

  it('is set from a fast flick that crossed the drag threshold', async () => {
    const { im, fire } = await makeMobileIM();
    fire('touchstart', { touches: [{ clientX: 100, clientY: 300 }] });
    // Move enough to enter drag state (ady > DRAG_THRESHOLD_PX=15)
    fire('touchmove', { touches: [{ clientX: 105, clientY: 280 }] });
    // Lift fast with enough travel (ady >= SWIPE_MIN_DISTANCE_PX=60, dx=15 right)
    fire('touchend', { changedTouches: [{ clientX: 115, clientY: 230 }] });
    expect(im.pendingJumpVx).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A2 "pendingJumpVx"
```
Expected: 5 failures referencing `pendingJumpVx`

- [ ] **Step 3: Add `pendingJumpVx` public field**

In `src/systems/InputManager.ts`, add after `pendingDive`:

```typescript
pendingJumpVx = 0;
```

And the matching private field alongside `pendingJump`:

```typescript
private pendingJumpVx = 0;
```

Wait — `pendingJumpVx` should be the public-facing field (consumed each frame). Add it as a public field alongside `jumpJustPressed`:

```typescript
// Consumed-per-frame impulse flags (cleared at start of each update)
jumpJustPressed = false;
jumpVx          = 0;   // horizontal component of swipe-up gesture, 0 for tap
dashJustFired   = false;
```

And a private staging field alongside `pendingJump`:

```typescript
private pendingJumpVx: number = 0;
```

- [ ] **Step 4: Clear `jumpVx` in `update()`**

In the `update()` method, alongside the other pending flag transfers (lines 75-81), add:

```typescript
this.jumpJustPressed = this.pendingJump;
this.jumpVx          = this.pendingJumpVx;  // add this line
this.dashJustFired   = this.pendingDash;
this.diveJustFired   = this.pendingDive;
if (this.pendingDash) this.dashDir = this.pendingDashDir;
this.pendingJump    = false;
this.pendingJumpVx  = 0;                    // add this line
this.pendingDash    = false;
this.pendingDive    = false;
```

- [ ] **Step 5: Compute `pendingJumpVx` in the swipe-up classifier (tracking branch)**

In `onTouchEnd`, replace the `// Swipe up → jump` branch:

```typescript
} else if (ady > adx && ady >= SWIPE_MIN_DISTANCE_PX && dt < SWIPE_MAX_TIME_MS && dy < 0) {
  // Swipe up → jump; extract horizontal component for momentum seed
  this.pendingJump   = true;
  this.pendingJumpVx = (dx / Math.sqrt(dx * dx + dy * dy)) * SWIPE_JUMP_HORIZONTAL_MAX;
```

Also update the import at the top of `InputManager.ts` to include the new constant:

```typescript
import {
  TILT_DEAD_ZONE_DEG,
  TILT_MAX_DEG,
  SWIPE_MIN_DISTANCE_PX,
  SWIPE_MAX_TIME_MS,
  DRAG_THRESHOLD_PX,
  SWIPE_JUMP_HORIZONTAL_MAX,
} from '../constants';
```

- [ ] **Step 6: Compute `pendingJumpVx` in the fast-flick-from-drag branch**

In `onTouchEnd`, in the drag branch (added in the swipe-fix session), replace:

```typescript
if (ady >= SWIPE_MIN_DISTANCE_PX && dt < SWIPE_MAX_TIME_MS) {
  if (dy < 0) this.pendingJump = true;
  else        this.pendingDive = true;
}
```

With:

```typescript
if (ady >= SWIPE_MIN_DISTANCE_PX && dt < SWIPE_MAX_TIME_MS) {
  if (dy < 0) {
    this.pendingJump   = true;
    this.pendingJumpVx = (dx / Math.sqrt(dx * dx + dy * dy)) * SWIPE_JUMP_HORIZONTAL_MAX;
  } else {
    this.pendingDive = true;
  }
}
```

- [ ] **Step 7: Run tests**

```bash
npm test -- --reporter=verbose 2>&1 | grep -E "(pendingJumpVx|PASS|FAIL)"
```
Expected: all 5 new tests pass

- [ ] **Step 8: Commit**

```bash
git add src/systems/InputManager.ts src/systems/__tests__/InputManager.test.ts
git commit -m "feat(momentum): add pendingJumpVx to InputManager for diagonal swipe jumps"
```

---

## Task 3: Add `momentumX` to Player — airborne movement

**Files:**
- Modify: `src/entities/Player.ts`
- Modify: `src/entities/__tests__/Player.test.ts`

- [ ] **Step 1: Write failing tests**

Add a new `describe` block to `src/entities/__tests__/Player.test.ts`. The `imState` mock will need `jumpVx` added (see step 3 before adding tests):

```typescript
describe('Player — air momentum', () => {
  it('accumulates rightward momentum while airborne with full right tilt', async () => {
    const { player } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: false, right: false, down: false }, velocity: { x: 0, y: 100 } },
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: false, jumpBoost: 0 },
    });
    imState.tiltFactor = 1;
    player.update(16);
    const vx = (player as any).momentumX;
    expect(vx).toBeGreaterThan(0);
    expect(vx).toBeLessThan(PLAYER_SPEED);
  });

  it('applies stop-advantage factor when tilt opposes momentum', async () => {
    const { player } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: false, right: false, down: false }, velocity: { x: 0, y: 100 } },
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: false, jumpBoost: 0 },
    });
    // Seed positive momentum
    (player as any).momentumX = 100;
    // Tilt left (opposing)
    imState.tiltFactor = -1;
    player.update(16);
    const delta = 100 - (player as any).momentumX; // how much it dropped
    // Without advantage: drop = 1 * AIR_TILT_FORCE * 16 = 12.8
    // With advantage (×1.5): drop = 19.2
    expect(delta).toBeCloseTo(19.2, 0);
  });

  it('decays toward zero when tilt is zero', async () => {
    const { player } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: false, right: false, down: false }, velocity: { x: 0, y: 100 } },
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: false, jumpBoost: 0 },
    });
    (player as any).momentumX = 100;
    imState.tiltFactor = 0;
    player.update(16);
    expect((player as any).momentumX).toBeLessThan(100);
    expect((player as any).momentumX).toBeGreaterThan(0);
  });

  it('zeroes momentumX on landing', async () => {
    const { player } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: false, right: false, down: false }, velocity: { x: 0, y: 100 } },
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: false, jumpBoost: 0 },
    });
    (player as any).momentumX = 150;
    // Now simulate landing
    (player as any).sprite.body.blocked.down = true;
    player.update(16);
    expect((player as any).momentumX).toBe(0);
  });

  it('zeroes momentumX on wall contact', async () => {
    const { player } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: true, right: false, down: false }, velocity: { x: 0, y: 100 } },
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: false, jumpBoost: 0 },
    });
    (player as any).momentumX = 150;
    player.update(16);
    expect((player as any).momentumX).toBe(0);
  });

  it('seeds momentumX from jumpVx on swipe-jump', async () => {
    const { player } = await makePlayer({
      onGround: true,
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: false, jumpBoost: 0 },
    });
    imState.jumpJustPressed = true;
    imState.jumpVx = 120;
    player.update(16);
    expect((player as any).momentumX).toBe(120);
  });

  it('seeds momentumX from body.velocity.x on tap-jump (jumpVx=0)', async () => {
    const { player } = await makePlayer({
      onGround: true,
      bodyOverrides: { blocked: { left: false, right: false, down: true }, velocity: { x: 150, y: 0 } },
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: false, jumpBoost: 0 },
    });
    imState.jumpJustPressed = true;
    imState.jumpVx = 0;
    player.update(16);
    expect((player as any).momentumX).toBe(150);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --reporter=verbose 2>&1 | grep -E "(air momentum|FAIL)" | head -20
```
Expected: all 7 new tests fail (momentumX undefined)

- [ ] **Step 3: Add `jumpVx` to the `imState` mock in Player.test.ts**

In the `imState` object (around line 50), add:

```typescript
const imState = {
  tiltFactor: 0,
  goLeft: false,
  goRight: false,
  isMobile: false,
  jumpJustPressed: false,
  jumpVx: 0,            // add this
  dashJustFired: false,
  dashDir: 1 as 1 | -1,
  diveJustFired: false,
  dragUp: false,
  dragDown: false,
  placeHeld: false,
};
```

And in `beforeEach`, add the reset:

```typescript
imState.jumpVx = 0;
```

- [ ] **Step 4: Add `momentumX` field and new imports to Player.ts**

At the top of `Player.ts`, extend the import from `'../constants'`:

```typescript
import {
  PLAYER_SPEED,
  PLAYER_JUMP_VELOCITY,
  PLAYER_WIDTH,
  PLAYER_HEIGHT,
  WORLD_WIDTH,
  MOCK_HEAP_HEIGHT_PX,
  PLAYER_DASH_VELOCITY,
  DASH_COOLDOWN_MS,
  DASH_DURATION_MS,
  PLAYER_MAX_FALL_SPEED,
  PLAYER_DIVE_SPEED,
  WALL_SLIDE_SPEED,
  AIR_TILT_FORCE,
  AIR_MOMENTUM_DECAY,
  MOMENTUM_STOP_ADV_FACTOR,
} from '../constants';
```

Add the field after `diveActive`:

```typescript
private momentumX: number = 0;
```

- [ ] **Step 5: Rewrite the airborne horizontal movement block**

Replace lines 140–163 (the full `if (dashActive === 0)` horizontal block):

```typescript
// Horizontal movement
const keyboardLeft  = this.leftKeys.some(k => k.isDown);
const keyboardRight = this.rightKeys.some(k => k.isDown);
this.dashActive = Math.max(0, this.dashActive - delta);

if (this.dashActive === 0) {
  if (this.inSlopeZone && !keyboardLeft && !keyboardRight && im.tiltFactor === 0) {
    // Eject outward along the wall surface
    this.sprite.setVelocityX(this.slopeEjectDir * PLAYER_SPEED);
    this.momentumX = 0;
  } else if (onGround) {
    // Ground: direct velocity control (unchanged feel)
    this.momentumX = 0;
    if (keyboardLeft) {
      this.sprite.setVelocityX(-PLAYER_SPEED);
      this.sprite.setFlipX(true);
    } else if (keyboardRight) {
      this.sprite.setVelocityX(PLAYER_SPEED);
      this.sprite.setFlipX(false);
    } else {
      const tiltVx = im.tiltFactor * PLAYER_SPEED;
      this.sprite.setVelocityX(tiltVx);
      if (tiltVx < 0) this.sprite.setFlipX(true);
      else if (tiltVx > 0) this.sprite.setFlipX(false);
    }
  } else {
    // Airborne: impulse-based momentum
    const inputDir = keyboardLeft ? -1 : keyboardRight ? 1 : im.tiltFactor;
    if (Math.abs(inputDir) > 0.01) {
      const force = inputDir * AIR_TILT_FORCE * delta;
      const opposing = this.momentumX !== 0 && Math.sign(force) !== Math.sign(this.momentumX);
      this.momentumX += opposing ? force * MOMENTUM_STOP_ADV_FACTOR : force;
    } else {
      this.momentumX *= Math.pow(AIR_MOMENTUM_DECAY, delta);
      if (Math.abs(this.momentumX) < 0.5) this.momentumX = 0;
    }
    this.momentumX = Math.max(-PLAYER_SPEED, Math.min(PLAYER_SPEED, this.momentumX));
    this.sprite.setVelocityX(this.momentumX);
    if (this.momentumX < 0) this.sprite.setFlipX(true);
    else if (this.momentumX > 0) this.sprite.setFlipX(false);
  }
}
```

- [ ] **Step 6: Zero `momentumX` on wall contact**

In the wall-slide section (around line 204), add the reset:

```typescript
// Wall slide — cap downward velocity when touching a wall while falling
if (!onGround && onWall && body.velocity.y > WALL_SLIDE_SPEED) {
  this.sprite.setVelocityY(WALL_SLIDE_SPEED);
  this.momentumX = 0;  // add this line
}
```

- [ ] **Step 7: Seed `momentumX` at jump time**

Replace the ground-jump and air-jump velocity lines inside `if (jumpPressed)` (around line 180):

```typescript
if (jumpPressed) {
  const onWallForJump = this.wallJumpEnabled && (body.blocked.left || body.blocked.right);
  if (canGroundJump) {
    this.momentumX = im.jumpVx !== 0 ? im.jumpVx : body.velocity.x;
    this.sprite.setVelocityX(this.momentumX);
    this.sprite.setVelocityY(PLAYER_JUMP_VELOCITY - this.jumpBoost);
    this.coyoteTimer = 0;
  } else if (!onWallForJump && this.airJumpsRemaining > 0) {
    this.momentumX = im.jumpVx !== 0 ? im.jumpVx : body.velocity.x;
    this.sprite.setVelocityX(this.momentumX);
    this.sprite.setVelocityY(PLAYER_JUMP_VELOCITY - this.jumpBoost);
    this.airJumpsRemaining--;
  }
}
```

Also seed on wall jump (around line 194) so wall-jump velocity carries through:

```typescript
if (this.wallJumpEnabled && !onGround && jumpPressed && this.wallJumpsRemaining > 0) {
  if (onWall) {
    const dir = body.blocked.left ? 1 : -1;
    this.momentumX = dir * PLAYER_SPEED * 1.5;
    this.sprite.setVelocityX(this.momentumX);
    this.sprite.setVelocityY(PLAYER_JUMP_VELOCITY - this.jumpBoost);
    this.wallJumpsRemaining--;
  }
}
```

- [ ] **Step 8: Zero `momentumX` when dash fires**

In the dash block (around line 166), add the reset:

```typescript
if (dashTriggered && this.dashCooldown === 0) {
  const dir = im.dashJustFired ? im.dashDir : (keyboardLeft ? -1 : keyboardRight ? 1 : (this.sprite.flipX ? -1 : 1));
  this.momentumX = 0;  // add this line
  this.sprite.setVelocityX(dir * PLAYER_DASH_VELOCITY);
  this.dashCooldown = DASH_COOLDOWN_MS;
  this.dashActive   = DASH_DURATION_MS;
}
```

- [ ] **Step 9: Remove the old mobile-jump tilt kick lines**

The old code had `if (im.isMobile) this.sprite.setVelocityX(im.tiltFactor * PLAYER_SPEED);` at jump time. These are now replaced by the `momentumX` seeding in Step 7. Confirm they're gone (the Step 7 replacement already omits them).

- [ ] **Step 10: Run all tests**

```bash
npm test 2>&1 | tail -10
```
Expected: all tests pass (including the 7 new air momentum tests)

- [ ] **Step 11: Commit**

```bash
git add src/entities/Player.ts src/entities/__tests__/Player.test.ts
git commit -m "feat(momentum): air momentum system with stop-advantage factor and swipe-jump seeding"
```

---

## Task 4: Full build verification

- [ ] **Step 1: Run build**

```bash
npm run build 2>&1 | tail -5
```
Expected: `✓ built in`

- [ ] **Step 2: Run full test suite**

```bash
npm test 2>&1 | tail -6
```
Expected: all test files pass, test count ≥ 323 (316 existing + 7 new Player + 5 new IM = 328)

- [ ] **Step 3: Commit if anything was missed**

```bash
git add -p
git commit -m "fix(momentum): cleanup after air momentum implementation"
```

---

## Tuning Notes

The four constants in `src/constants.ts` control feel. Starting values:

| Constant | Value | Effect |
|---|---|---|
| `AIR_TILT_FORCE` | `0.8` | Full tilt reaches PLAYER_SPEED in ~250ms |
| `AIR_MOMENTUM_DECAY` | `0.994` | Loses ~50% momentum in ~110ms with no input |
| `MOMENTUM_STOP_ADV_FACTOR` | `1.5` | Opposing tilt stops 50% faster |
| `SWIPE_JUMP_HORIZONTAL_MAX` | `160` | 80% of PLAYER_SPEED at maximum diagonal |

All are tunable without touching logic.

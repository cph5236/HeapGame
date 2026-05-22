# Player Movement Snappiness — Items #4–#16

**Branch:** `feature/player-snappiness` (continues from Tier-1 work: jump buffer, variable jump height, asymmetric gravity)

**Context:** This plan covers the remaining audit items from the Player.ts movement review. Items #1–#3 (the highest-impact "feel" upgrades) have already been implemented on this branch. The items below are roughly ordered by impact; the user may trim before execution.

**Trim guidance for the user:** Tier-2 items (#4–#11) all change observable behavior; Tier-3 items (#12–#16) are polish or pure refactors. If you want to ship the Tier-1 work first and iterate, dropping everything below #11 still leaves a substantially snappier player.

---

## Tier 2 — Items that change observable behavior

### #4 — Wall-leave coyote time

**Problem.** Ground coyote (`120 ms`) gives forgiveness when stepping off a ledge. The wall-jump path has no equivalent: the instant the player stops touching the wall, `onWall` is false and a wall-jump input is silently dropped, even though `wallJumpsRemaining` is still ≥ 1.

**Implementation.**
1. Add constant `WALL_COYOTE_MS = 100` to `constants.ts`.
2. Add field `private wallCoyoteTimer = 0` and `private lastWallSide: -1 | 0 | 1 = 0`.
3. In `update()`, after computing `onWall`:
   - If `onWall`: refresh `wallCoyoteTimer = WALL_COYOTE_MS`, set `lastWallSide = body.blocked.left ? -1 : 1`.
   - Else: `wallCoyoteTimer = Math.max(0, wallCoyoteTimer - delta)`.
4. In the wall-jump branch, replace `onWall` predicate with `onWall || this.wallCoyoteTimer > 0`. When firing, use `body.blocked.left ? 1 : (body.blocked.right ? -1 : -this.lastWallSide)` for direction.
5. Consume by setting `wallCoyoteTimer = 0` after firing.

**Tests.**
- Touch left wall → leave wall → press jump within window → wall-jump fires to the right.
- Same, but press jump after window expires → no wall-jump.
- Wall-jump in coyote window does not consume `wallJumpsRemaining` twice on subsequent frames.

**Risk:** Low. Mirrors existing ground-coyote pattern exactly.

---

### #5 — Corner / head-bump correction

**Problem.** Jumping into a slab corner — even by 1–4 px overlap — stops the player dead. Phaser arcade has no built-in corner forgiveness.

**Implementation.**
1. Add constants `HEAD_BUMP_PROBE_PX = 5` and `HEAD_BUMP_NUDGE_PX = 4`.
2. In `update()`, after the jump block and before the wall-slide block:
   ```ts
   if (body.blocked.up && body.velocity.y < 0) {
     const probe = HEAD_BUMP_PROBE_PX;
     // Try shifting left, then right; if either side has no overlap, nudge there.
     // Requires a free-space query against the slab static group; expose via callback
     // wired from GameScene/InfiniteGameScene during player setup.
     if (this.headBumpProbe?.(this.sprite.x - probe, this.sprite.y)) {
       this.sprite.x -= HEAD_BUMP_NUDGE_PX;
     } else if (this.headBumpProbe?.(this.sprite.x + probe, this.sprite.y)) {
       this.sprite.x += HEAD_BUMP_NUDGE_PX;
     }
   }
   ```
3. Add `public headBumpProbe?: (x: number, y: number) => boolean` on `Player`.
4. In `GameScene` and `InfiniteGameScene`, wire it after creating the slab group: probe via `Phaser.Geom.Rectangle.ContainsPoint` against `HeapEdgeCollider` lookup, or a small `body.overlap`-style query against `slabsGroup`.

**Tests.**
- Mock `headBumpProbe` that returns `false` for left and `true` for right at given (x, y) → player x shifts +4 px when `blocked.up && vy < 0`.
- No callback set → no-op (does not throw).
- `blocked.up` true but `vy >= 0` → no nudge (player isn't jumping into anything).

**Risk:** Medium. Probe wiring crosses Player ↔ Scene boundaries; depending on how `HeapEdgeCollider` exposes lookups, this could require a new helper. Investigate `src/systems/HeapEdgeCollider.ts` before coding.

---

### #6 — Dash refresh on ground/wall contact

**Problem.** Dash cooldown only ticks down with time. Cannot chain dash → land → dash within the cooldown window. Celeste-style "refresh on touch" feels much better for traversal.

**Implementation.**
1. Add constant `DASH_REFRESH_ON_LAND = true` (gate, in case design wants pure-cooldown later).
2. In the landing-reset block (currently lines that reset `airJumpsRemaining` and `wallJumpsRemaining`):
   ```ts
   if (DASH_REFRESH_ON_LAND && this.dashEnabled) {
     this.dashCooldown = 0;
   }
   ```
3. Optionally also refresh on `onWall && !onGround` if the design wants wall-contact refresh.

**Tests.**
- Dash → set `onGround = true` → update → `dashCooldown === 0`.
- Pure cooldown decay without contact still works (no contact → cooldown ticks down only).
- `dashEnabled = false` → no refresh logic runs.

**Risk:** Low. Single conditional addition.

**Design note:** Worth discussing whether wall-touch should also refresh, since it changes the optimal traversal pattern. Recommend ground-only initially.

---

### #7 — Smooth dash exit (carry momentum)

**Problem.** Today, when `dashActive` hits 0 the next frame's airborne branch reads `momentumX = 0` (set when dash fired) and `setVelocityX(0)`-style behavior takes over, causing a visible "stop."

**Implementation.**
1. When `dashActive` decrements to 0 (transition frame), if airborne, seed `momentumX` from current `body.velocity.x`, clamped:
   ```ts
   const prevDashActive = this.dashActive;
   this.dashActive = Math.max(0, this.dashActive - delta);
   if (prevDashActive > 0 && this.dashActive === 0 && !onGround) {
     this.momentumX = Phaser.Math.Clamp(body.velocity.x, -PLAYER_AIR_MAX_SPEED, PLAYER_AIR_MAX_SPEED);
   }
   ```
2. No new constants required.

**Tests.**
- Dash with `dir = 1` → tick `dashActive` to expiry while airborne → `momentumX` ≈ `PLAYER_DASH_VELOCITY` (clamped to `PLAYER_AIR_MAX_SPEED`).
- Dash ends while grounded → `momentumX` stays 0 (ground branch already zeros it).
- Dash never fires (no expiry transition) → no spurious seeding.

**Risk:** Low. Local change inside dash block.

---

### #8 — Air jump fallback from wall

**Problem.** Pressing jump while touching a wall takes the wall-jump branch *only if* `wallJumpsRemaining > 0`. If exhausted, the conditional `!onWallForJump && this.airJumpsRemaining > 0` blocks the air-jump fallback. Player gets nothing.

**Implementation choice — present two options to user before coding:**

**Option A (recommended):** Drop wall-jump charge tracking entirely. One wall-jump per wall-touch is the more standard design.
- Remove `wallJumpsRemaining` field and all references.
- Wall-jump path always fires when `onWall && jumpPressed && !onGround && wallJumpEnabled`.
- Add a "wall-jump cooldown" of ~150 ms to prevent re-firing on the same wall contact.

**Option B:** Allow air-jump fallback when wall jumps exhausted.
- Change condition to `(this.airJumpsRemaining > 0 && (!onWallForJump || this.wallJumpsRemaining === 0))`.
- Keeps the per-landing charge system intact.

**Tests.**
- (Option A) Touch wall, jump → fires. Jump again same contact within cooldown → does not fire. Leave wall, return → fires again.
- (Option B) `wallJumpsRemaining = 0`, on wall, has air jump, press jump → air jump fires.

**Risk:** Medium (Option A) or Low (Option B). Option A is a design change; recommend asking the user first.

---

### #9 — Consume coyote on air jump (latent footgun)

**Problem.** Only the ground-jump branch sets `coyoteTimer = 0`. Currently inert because the `else if` means air-jump never runs when coyote is active. But if a future edit swaps order or merges branches, the player could double-jump from a single press.

**Implementation.**
Move `this.coyoteTimer = 0;` to the outer `if (jumpPressed)` block, before the inner conditional. Or, equivalently, set it on every jump path (ground, air, wall).

```ts
if (jumpPressed) {
  this.coyoteTimer = 0; // any jump consumes the coyote window
  // ... existing branches ...
}
```

**Tests.** Unchanged behavior for current code paths; this is a defensive refactor. Add one regression test: with `coyoteTimer > 0` and `airJumpsRemaining > 0`, only one of `_justJumped` / `_justAirJumped` ever fires per press.

**Risk:** None. Pure cleanup.

---

### #10 — `TERRAIN_STICK_SPEED` constant ↔ comment mismatch

**Problem.** Constant value is `100`; comment in `constants.ts:37` claims `300/60fps = 5 px/frame > 4 px SCAN_STEP`. At the current value the math breaks: `100/60 ≈ 1.67 px/frame`, below the 4 px slab spacing the stick is supposed to bridge. This is likely the source of "slope stutter" reports.

**Investigation steps before coding:**
1. `git log -p src/constants.ts` to confirm whether the value or the comment regressed (squishbugs memory says `TERRAIN_STICK_SPEED=300` was the squishbug fix value).
2. If value regressed: restore to `300` and verify slope walking visually via `npm run scene-preview` against `GameScene` or `InfiniteGameScene` with a known-slope heap.
3. If 300 caused some other regression: keep `100` and rewrite the comment to reflect actual behavior.

**Tests.** Add a regression test:
- Grounded player, `body.velocity.y = 0`, `body.blocked.down = true`, no slope zone → `setVelocityY(TERRAIN_STICK_SPEED)` called.
- Same but `body.velocity.y = -1` (just jumped) → `setVelocityY(TERRAIN_STICK_SPEED)` NOT called (this test already exists; verify it still passes).

**Risk:** Low. Restoring `300` is the most likely correct fix; visual smoke test required.

---

### #11 — `onGround` derivation extraction

**Problem.** [Player.ts:183-184](src/entities/Player.ts#L183) packs three predicates into a single expression with two negations and a magic threshold. Any single misfire produces a spurious `_justLanded` or a missed jump.

**Implementation.**
```ts
const groundedByPhysics = body.blocked.down && !this.inSlopeZone;
const groundedByFloor   = this.sprite.y >= floorY;
const wallFalseGround   = onWall && body.velocity.y > 10;
const onGround = (groundedByPhysics && !wallFalseGround) || groundedByFloor;
```

**Tests.** Add unit tests for each branch:
- `blocked.down=true, inSlopeZone=false, onWall=false` → grounded.
- `blocked.down=true, inSlopeZone=true` → NOT grounded (slope handling owns this).
- `blocked.down=true, onWall=true, vy=50` → NOT grounded (wall false-ground filter).
- `blocked.down=true, onWall=true, vy=0` → grounded (filter only kicks in while sliding).
- `blocked.down=false, sprite.y >= floorY` → grounded (floor fallback).

**Risk:** None. Pure refactor — output is bit-identical.

---

## Tier 3 — Polish and structure

### #12 — Ground turn-around easing (optional)

**Problem.** Ground turnaround is instant velocity flip — feels snappy but loses the trashbag's weight. Optional polish.

**Implementation sketch.** Add a 30–50 ms transition timer; when direction changes on ground, ease vx from old → new value over the timer. This is a visual polish item and should only be done if the user wants more "weight" feel — current behavior is intentional snappiness.

**Recommendation:** Skip unless playtesting flags this. Listed for completeness.

---

### #13 — Wall slide momentum preservation

**Problem.** `momentumX = 0` while wall-sliding ([Player.ts:317-320](src/entities/Player.ts#L317-L320)) means leaving a wall produces a vertical drop with no horizontal motion. Combined with the wall-leave coyote (#4), this makes side-platforming feel dead.

**Implementation.**
Replace `this.momentumX = 0;` in the wall-slide block with:
```ts
const outwardDir = body.blocked.left ? 1 : -1;
this.momentumX = outwardDir * Math.min(80, Math.abs(this.momentumX) + 30);
```
This preserves a small outward velocity so the player has something to work with after releasing the wall.

**Tests.**
- Wall slide on left wall → `momentumX` becomes positive (away from wall), bounded ≤ 80.
- Repeated frames don't unbounded-grow `momentumX`.

**Risk:** Low. Tune the cap value via playtest.

**Depends on #4** for the full feel benefit.

---

### #14 — Lift wall-jump multiplier to a constant

**Problem.** [Player.ts:337](src/entities/Player.ts#L337) hardcodes `PLAYER_SPEED * 1.5` as the wall-jump push.

**Implementation.**
1. Add `WALL_JUMP_PUSH = 375` in `constants.ts`.
2. Replace `PLAYER_SPEED * 1.5` with `WALL_JUMP_PUSH`.

**Tests.** Existing wall-jump test continues to pass against the constant.

**Risk:** None.

---

### #15 — Dive ordering bug (same-frame jump + down)

**Problem.** Dive block runs *after* jump block. If player jumps while holding down, [Player.ts:334](src/entities/Player.ts#L334) overwrites the jump's `setVelocityY(PLAYER_JUMP_VELOCITY)` with `setVelocityY(PLAYER_DIVE_SPEED)`. Same-frame jump-while-holding-down silently does nothing.

**Implementation.**
Guard the dive branch:
```ts
const jumpedThisFrame = this._justJumped || this._justAirJumped || this._justWallJumped;
if (this.diveEnabled && !onGround && !jumpedThisFrame) {
  // ... existing dive logic ...
}
```

**Tests.**
- Player on ground holding down, presses jump → `setVelocityY` last value is `PLAYER_JUMP_VELOCITY - jumpBoost`, NOT `PLAYER_DIVE_SPEED`.
- Player airborne holding down, no jump this frame → dive still fires.

**Risk:** Low. Order of conditions matters; new flag is one of the already-tracked `_just*` ones.

---

### #16 — Split `update()` into ordered sub-methods

**Problem.** `update()` is 226+ lines. Ordering between sub-systems is implicit. #15 is one symptom; future feel tweaks risk introducing more.

**Implementation.**
```ts
update(delta: number): void {
  this.clearOneFrameFlags();
  this.updateJumpInput(delta);            // buffer decay, cut detection
  if (this.handleLadder(delta)) return;   // returns true if ladder consumed the frame
  if (!this.controlsEnabled) return;

  const ctx = this.computeGroundState();  // returns { onGround, onWall, body, floorY }
  this.applyGravityScaling(ctx);
  this.handleLanding(ctx, delta);
  this.updateHorizontal(ctx, delta);
  this.applyTerrainStick(ctx);
  this.updateDash(ctx, delta);
  this.updateJump(ctx);                   // consumes buffer
  this.updateWallJump(ctx);
  this.applyWallSlide(ctx);
  this.updateDive(ctx, delta);            // guards against same-frame jump
  this.applyWorldBounds(ctx);
  this.resetPerFrameSlopeFlags();
}
```

**Tests.** All existing Player tests must continue to pass; this is a pure refactor.

**Risk:** Medium. Touches every code path. Should be done last so other items don't conflict in review. Recommend doing this on its own follow-up branch *after* the rest of this plan lands.

---

## Suggested execution order

1. **#9** (coyote consume cleanup) — trivial, do alongside any change.
2. **#11** (`onGround` extraction) — pure refactor, sets up cleaner tests for the rest.
3. **#15** (dive ordering guard) — fixes a real bug, small change.
4. **#10** (TERRAIN_STICK_SPEED) — investigate first; possibly just a value or comment fix.
5. **#4** (wall-leave coyote) + **#13** (wall-slide momentum) — pair together; both fix wall feel.
6. **#7** (dash exit smoothing) + **#6** (dash refresh on land) — pair together; both improve dash feel.
7. **#14** (wall-jump constant) — trivial cleanup once the wall-jump path is otherwise touched.
8. **#8** (wall-jump charge system) — design discussion required before coding.
9. **#5** (corner correction) — biggest single-item; cross-system wiring.
10. **#16** (`update()` split) — final refactor after behavior is stable.
11. **#12** (ground turn-around easing) — optional; only if playtest demands it.

## What's in scope vs out of scope

**In scope.** All behavior listed in Player.ts and its directly-collaborating systems (Scenes for wiring, constants for tunables, InputManager surface).

**Out of scope.** Animation feel (PlayerAnimator), particle effects, sound polish, camera shake on landing. Those are separate.

# Player Movement Snappiness — Items #4–#16

**Branch:** `feature/player-snappiness` (continues from Tier-1 work: jump buffer, variable jump height, asymmetric gravity)

**Context:** This plan covers the remaining audit items from the Player.ts movement review. Items #1–#3 (the highest-impact "feel" upgrades) have already been implemented on this branch. The items below are roughly ordered by impact.

## Locked-in decisions (2026-05-22)

- **#6 Dash refresh:** Ground-touch only. Walls do NOT refresh the dash.
- **#8 Wall-jump charge system:** Option A — drop `wallJumpsRemaining` entirely. One wall-jump per wall contact, gated by a **2-second same-wall cooldown** so the player must leave and return before re-firing.
- **#12 Ground turn-around easing:** SKIP. Instant ground velocity flip stays.
- **#16 update() split:** Do FIRST, before any behavior changes. Behavior items land into the new structure.

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

### #5 — Corner / head-bump correction — REMOVED

**Decision (2026-05-23):** Implemented, then removed during playtest. The `blocked.up && vy < 0` gate never matched the head-bump moment because Phaser zeroes vy during collision resolution before our update reads it. Widening the gate to `vy <= 0` and adjusting the probe Y still failed to find the slab — the probe consistently returned all-false even when `blocked.up` was true, suggesting the player was hitting something not in `bandRows` (bridge or other non-HeapEdgeCollider body) at most of the test points. After several iterations the user chose to drop the feature entirely and keep the other movement improvements.

**Original problem.** Jumping into a slab corner — even by 1–4 px overlap — stops the player dead. Phaser arcade has no built-in corner forgiveness.

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

### #6 — Dash refresh on ground contact

**Decision:** Ground-only (no wall refresh).

**Problem.** Dash cooldown only ticks down with time. Cannot chain dash → land → dash within the cooldown window. Ground-touch refresh feels much better for traversal.

**Implementation.**
In the landing-reset block (where `airJumpsRemaining` is reset):
```ts
if (this.dashEnabled) {
  this.dashCooldown = 0;
}
```
No wall refresh.

**Tests.**
- Dash → set `onGround = true` → update → `dashCooldown === 0`.
- Pure cooldown decay without contact still works (no contact → cooldown ticks down only).
- `dashEnabled = false` → no refresh logic runs.
- Touch wall while airborne → dash cooldown is NOT refreshed.

**Risk:** Low. Single conditional addition.

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

### #8 — Drop wall-jump charges, gate by same-wall cooldown

**Decision:** Option A with a **2-second cooldown**.

**Problem.** Pressing jump while touching a wall takes the wall-jump branch *only if* `wallJumpsRemaining > 0`. If exhausted, the conditional `!onWallForJump && this.airJumpsRemaining > 0` blocks the air-jump fallback. Player gets nothing — and the per-landing charge system feels arbitrary.

**Implementation.**
1. Add constant `WALL_JUMP_COOLDOWN_MS = 2000` to `constants.ts`.
2. Remove `wallJumpsRemaining` field and all references to it (incl. `wallJumpsLeft`/`maxWallJumps` HUD accessors if present — audit before deleting).
3. Add `private wallJumpCooldown: number = 0` and `private lastWallJumpSide: -1 | 0 | 1 = 0`.
4. In `update()`, decay `wallJumpCooldown` each frame.
5. Wall-jump fires when:
   - `wallJumpEnabled && !onGround && jumpPressed && onWall`
   - AND (`wallJumpCooldown === 0` OR `currentWallSide !== lastWallJumpSide` — i.e. you left this wall and contacted a different one).
6. On fire: set `wallJumpCooldown = WALL_JUMP_COOLDOWN_MS`, `lastWallJumpSide = currentSide`.
7. On leaving wall contact entirely (transition `onWall true → false`), reset `lastWallJumpSide = 0` so re-touching the same wall lets you fire again immediately. (Without this, a 2s same-wall lockout becomes a 2s any-wall lockout after one jump.)

**Tests.**
- Touch left wall, jump → fires. Jump again on same contact → does NOT fire (cooldown active).
- Leave wall, return to same wall → fires again (lastWallJumpSide cleared on leave).
- Touch left wall, jump, immediately touch right wall, jump → second fires (different side).
- `wallJumpEnabled = false` → no wall-jump regardless of cooldown.

**Risk:** Medium. Removing a field touches anywhere it's accessed (e.g. HUD). Audit references before deleting.

**Order note:** Must be done AFTER #14 (so the lifted constant is in place) and AFTER #4 (wall-leave coyote needs the same `currentWallSide` tracking — share the logic).

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

### #12 — Ground turn-around easing — SKIPPED

**Decision:** Skip. Instant ground turn stays. Revisit only if playtesting flags it.

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

### #16 — Split `update()` into ordered sub-methods — DO FIRST

**Decision:** Do this BEFORE the behavior changes. Reorders the file into a structure the rest of the plan lands cleanly into.

**Problem.** `update()` is 226+ lines. Ordering between sub-systems is implicit. #15 is one symptom; future feel tweaks risk introducing more.

**Implementation.**
```ts
update(delta: number): void {
  this.clearOneFrameFlags();
  this.updateJumpInputAndCut(delta);      // buffer decay, prime, transition cut
  if (this.handleLadder(delta)) return;   // returns true if ladder consumed the frame
  if (!this.controlsEnabled) return;

  const ctx = this.computeGroundState();  // returns { onGround, onWall, body, floorY }
  this.applyGravityScaling(ctx);
  this.handleLanding(ctx, delta);
  this.updateHorizontal(ctx, delta);
  this.applyTerrainStick(ctx);
  this.updateDash(ctx, delta);
  const jumpFired = this.updateJump(ctx); // consumes buffer; returns whether a jump fired
  this.updateWallJump(ctx, jumpFired);
  this.consumeJumpBufferOnFire(ctx, jumpFired);  // cut-on-fire + cleanup
  this.applyWallSlide(ctx);
  this.updateDive(ctx, delta, jumpFired); // guards against same-frame jump
  this.applyWorldBounds(ctx);
  this.resetPerFrameSlopeFlags();
}
```

**Tests.** All 56 existing Player tests must continue to pass; this is a pure refactor.

**Risk:** Medium. Touches every code path. Mitigated by running the full Player test suite after each helper extraction. Land as a single commit so a bisect can isolate it.

---

## Locked-in execution order

1. **#16** — `update()` split (pure refactor; sets the structure)
2. **#9** — coyote consume cleanup (small, fits naturally into the new structure)
3. **#11** — `onGround` extraction (becomes the `computeGroundState()` helper)
4. **#15** — dive ordering guard (uses the new `jumpFired` plumbing from #16)
5. **#10** — investigate `TERRAIN_STICK_SPEED` (probably a one-line value restore)
6. **#4** — wall-leave coyote
7. **#13** — preserve outward momentum on wall slide
8. **#7** — smooth dash exit (carry momentum)
9. **#6** — ground-touch dash refresh
10. **#14** — lift wall-jump push constant
11. **#8** — drop wall-jump charges, add 2s same-wall cooldown (uses #14's constant)
12. **#5** — corner / head-bump correction (biggest; last) — **dropped during playtest, see #5 section**

**Skipped:** #12 (ground turn-around easing).

**Per-item discipline:** TDD with failing tests first, single commit per item, full test suite must stay green throughout. Debug `console.log`s in `Player.ts` stay in place — they'll be removed in a final cleanup commit once the feel is locked.

## What's in scope vs out of scope

**In scope.** All behavior listed in Player.ts and its directly-collaborating systems (Scenes for wiring, constants for tunables, InputManager surface).

**Out of scope.** Animation feel (PlayerAnimator), particle effects, sound polish, camera shake on landing. Those are separate.

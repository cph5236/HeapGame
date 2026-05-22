# Player Squash-and-Stretch Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `PlayerAnimator` class that drives real-time procedural squash-and-stretch scale animation and bow-string rendering on the trash bag player sprite, purely cosmetically — physics unchanged.

**Architecture:** A new `PlayerAnimator` class owns all scale/rotation manipulation and a Phaser Graphics overlay for the bow strings. `Player.ts` gains a read-only `animState` snapshot getter. Scenes construct the animator, call `animator.update(delta, player.animState)` each frame, and destroy it on shutdown.

**Tech Stack:** Phaser 3.90, TypeScript 5.9, Vite 6 (asset imports via `?url`). Run tests with `npm test`, build with `npm run build`.

---

## File Map

| File | Action |
|---|---|
| `src/sprites/player/trashbag-nostrings.png` | Already exists — just needs loading |
| `src/scenes/BootScene.ts` | Add import + `load.image` for new sprite |
| `src/entities/Player.ts` | Switch sprite key; add 7 private flags; add `animState` getter; export `PlayerAnimState` interface |
| `src/entities/PlayerAnimator.ts` | Create — full animation class |
| `src/scenes/GameScene.ts` | Wire animator: construct, update, justDied, destroy |
| `src/scenes/InfiniteGameScene.ts` | Wire animator: construct, update, justDied, destroy |

---

## Task 1: Load trashbag-nostrings in BootScene

**Files:**
- Modify: `src/scenes/BootScene.ts:2,23`

- [ ] **Step 1: Add the import**

In `src/scenes/BootScene.ts`, add this import directly after the existing `trashbagUrl` import on line 2:

```typescript
import trashbagUrl          from '../sprites/player/trashbag.png?url';
import trashbagNoStringsUrl from '../sprites/player/trashbag-nostrings.png?url';
```

- [ ] **Step 2: Load the image in preload()**

In the `preload()` method, add the new load call directly after the existing `trashbag` load:

```typescript
preload(): void {
  // Only what MenuScene actually paints: the player figure.
  this.load.image('trashbag', trashbagUrl);
  this.load.image('trashbag-nostrings', trashbagNoStringsUrl);
}
```

- [ ] **Step 3: Build to verify**

```bash
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/scenes/BootScene.ts
git commit -m "feat: load trashbag-nostrings sprite in BootScene"
```

---

## Task 2: Add PlayerAnimState interface and flags to Player.ts

**Files:**
- Modify: `src/entities/Player.ts`

- [ ] **Step 1: Export the PlayerAnimState interface**

Add this interface just above the `export class Player {` line (before line 30):

```typescript
export interface PlayerAnimState {
  vy:             number;
  onGround:       boolean;
  onWall:         boolean;
  frozen:         boolean;
  justLanded:     boolean;
  justJumped:     boolean;
  justAirJumped:  boolean;
  justWallJumped: boolean;
  justDied:       boolean;
}

export class Player {
```

- [ ] **Step 2: Add private tracking fields**

Add these fields directly after the existing `private _wasOnGround = false;` line (line 74):

```typescript
  private _wasOnGround = false;
  private _onGround    = false;
  private _onWall      = false;
  private _frozen         = false;
  private _justLanded     = false;
  private _justJumped     = false;
  private _justAirJumped  = false;
  private _justWallJumped = false;
```

- [ ] **Step 3: Switch sprite key and store onGround/onWall each frame**

In the constructor (line 86), change the sprite key:

```typescript
this.sprite = scene.physics.add.sprite(x, y, 'trashbag-nostrings');
```

In `update()`, store `_onGround` and `_onWall` and set `_justLanded`. Replace the existing 4-line block at lines 147–150:

```typescript
    // BEFORE (lines 147–150):
    if (onGround && !this._wasOnGround) {
      AudioManager.play('player-land');
    }
    this._wasOnGround = onGround;
```

with:

```typescript
    // AFTER:
    if (onGround && !this._wasOnGround) {
      AudioManager.play('player-land');
      this._justLanded = true;
    }
    this._wasOnGround = onGround;
    this._onGround    = onGround;
    this._onWall      = onWall;
```

- [ ] **Step 4: Set jump flags at each jump call site**

Ground jump (around line 249) — add `this._justJumped = true;` after `AudioManager.play('player-jump')`:

```typescript
      if (canGroundJump) {
        this.momentumX = im.jumpVx !== 0 ? im.jumpVx : body.velocity.x;
        this.sprite.setVelocityX(this.momentumX);
        this.sprite.setVelocityY(PLAYER_JUMP_VELOCITY - this.jumpBoost);
        this.coyoteTimer = 0;
        AudioManager.play('player-jump');
        this._justJumped = true;
      } else if (!onWallForJump && this.airJumpsRemaining > 0) {
        this.momentumX = im.jumpVx !== 0 ? im.jumpVx : body.velocity.x;
        this.sprite.setVelocityX(this.momentumX);
        this.sprite.setVelocityY(PLAYER_JUMP_VELOCITY - this.jumpBoost);
        this.airJumpsRemaining--;
        AudioManager.play('player-jump');
        this._justAirJumped = true;
      }
```

Wall jump (around line 267) — add `this._justWallJumped = true;` after `AudioManager.play('player-jump')`:

```typescript
    if (this.wallJumpEnabled && !onGround && jumpPressed && this.wallJumpsRemaining > 0) {
      if (onWall) {
        const dir = body.blocked.left ? 1 : -1;
        this.momentumX = dir * PLAYER_SPEED * 1.5;
        this.sprite.setVelocityX(this.momentumX);
        this.sprite.setVelocityY(PLAYER_JUMP_VELOCITY - this.jumpBoost);
        this.wallJumpsRemaining--;
        AudioManager.play('player-jump');
        this._justWallJumped = true;
      }
    }
```

- [ ] **Step 5: Clear all just* flags at the end of update() and set _frozen in freeze()**

At the very end of `update()`, just before the closing `}`, add:

```typescript
    // Clear one-frame animation flags
    this._justLanded     = false;
    this._justJumped     = false;
    this._justAirJumped  = false;
    this._justWallJumped = false;
  }
```

In `freeze()`, add `this._frozen = true;` after `this.sprite.body.setAllowGravity(false);`:

```typescript
  freeze(): void {
    if (this.onLadder) this.exitLadder();
    this.setControlsEnabled(false);
    this.sprite.setVelocity(0, 0);
    this.sprite.body.setAllowGravity(false);
    this._frozen = true;
  }
```

- [ ] **Step 6: Add the animState getter**

Add this getter after the existing `get hasActiveShield()` getter block (after line 83):

```typescript
  get animState(): PlayerAnimState {
    return {
      vy:             this.sprite.body.velocity.y,
      onGround:       this._onGround,
      onWall:         this._onWall,
      frozen:         this._frozen,
      justLanded:     this._justLanded,
      justJumped:     this._justJumped,
      justAirJumped:  this._justAirJumped,
      justWallJumped: this._justWallJumped,
      justDied:       false,
    };
  }
```

- [ ] **Step 7: Run existing tests to confirm nothing broke**

```bash
npm test
```

Expected: all existing tests pass. The physics logic is unchanged — only fields and a getter were added.

- [ ] **Step 8: Build**

```bash
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 9: Commit**

```bash
git add src/entities/Player.ts
git commit -m "feat: add PlayerAnimState snapshot and jump flags to Player"
```

---

## Task 3: Create PlayerAnimator.ts

**Files:**
- Create: `src/entities/PlayerAnimator.ts`

- [ ] **Step 1: Write the full file**

Create `src/entities/PlayerAnimator.ts` with the following complete content:

```typescript
import Phaser from 'phaser';
import { PLAYER_WIDTH, PLAYER_HEIGHT } from '../constants';
import type { PlayerAnimState } from './Player';

// ── Tuning constants ────────────────────────────────────────────────────────
const LERP_SPEED         = 12;    // lerp factor per second
const APEX_VY_THRESHOLD  = 80;    // px/s — |vy| below this → apex state
const LAUNCH_DURATION    = 600;   // ms
const AIR_JUMP_DURATION  = 500;   // ms
const LANDING_DURATION   = 400;   // ms
const IDLE_PERIOD        = 2200;  // ms — breathing sine period
const FALL_FLAP_PERIOD   = 550;   // ms — string flutter period
const APEX_WIGGLE_PERIOD = 450;   // ms — apex rotation sine period
const STRING_STROKE_W    = 2.5;   // px
const COLLAR_OFFSET_Y    = -0.44; // fraction of PLAYER_HEIGHT (red collar position)

// ── State enum ───────────────────────────────────────────────────────────────
enum AnimState {
  IDLE, LAUNCHING, AIR_JUMP, APEX, FALLING, LANDING, WALL_SLIDE,
}

// ── Keyframe type ────────────────────────────────────────────────────────────
interface Keyframe {
  t: number;
  scaleX: number; scaleY: number;
  cpLx: number; cpLy: number; endLx: number; endLy: number;
  cpRx: number; cpRy: number; endRx: number; endRy: number;
}

// ── Timed-state keyframe curves ──────────────────────────────────────────────
const LAUNCH_FRAMES: Keyframe[] = [
  { t: 0.00, scaleX: 0.72, scaleY: 1.38, cpLx: -3, cpLy: 20, endLx: -2, endLy: 40, cpRx:  3, cpRy: 20, endRx:  2, endRy: 40 },
  { t: 0.55, scaleX: 0.84, scaleY: 1.22, cpLx: -6, cpLy: 16, endLx: -8, endLy: 32, cpRx:  6, cpRy: 16, endRx:  8, endRy: 32 },
  { t: 1.00, scaleX: 1.00, scaleY: 1.00, cpLx: -9, cpLy: 16, endLx:-12, endLy: 30, cpRx:  9, cpRy: 16, endRx: 12, endRy: 30 },
];

const AIR_JUMP_FRAMES: Keyframe[] = [
  { t: 0.00, scaleX: 1.00, scaleY: 1.00, cpLx: -9, cpLy: 16, endLx:-12, endLy: 30, cpRx:  9, cpRy: 16, endRx: 12, endRy: 30 },
  { t: 0.15, scaleX: 0.80, scaleY: 1.30, cpLx: -3, cpLy: 20, endLx: -2, endLy: 40, cpRx:  3, cpRy: 20, endRx:  2, endRy: 40 },
  { t: 0.60, scaleX: 0.88, scaleY: 1.18, cpLx: -8, cpLy: 15, endLx:-10, endLy: 28, cpRx:  8, cpRy: 15, endRx: 10, endRy: 28 },
  { t: 1.00, scaleX: 1.00, scaleY: 1.00, cpLx: -9, cpLy: 16, endLx:-12, endLy: 30, cpRx:  9, cpRy: 16, endRx: 12, endRy: 30 },
];

const LANDING_FRAMES: Keyframe[] = [
  { t: 0.00, scaleX: 1.45, scaleY: 0.55, cpLx:  -5, cpLy: -10, endLx:  -6, endLy: -22, cpRx:   5, cpRy: -10, endRx:   6, endRy: -22 },
  { t: 0.28, scaleX: 0.88, scaleY: 1.15, cpLx: -24, cpLy:   8, endLx: -30, endLy:  14, cpRx:  24, cpRy:   8, endRx:  30, endRy:  14 },
  { t: 0.65, scaleX: 1.06, scaleY: 0.96, cpLx: -10, cpLy:  12, endLx: -11, endLy:  24, cpRx:  10, cpRy:  12, endRx:  11, endRy:  24 },
  { t: 1.00, scaleX: 1.00, scaleY: 1.00, cpLx:  -9, cpLy:  16, endLx: -12, endLy:  30, cpRx:   9, cpRy:  16, endRx:  12, endRy:  30 },
];

// ── PlayerAnimator ────────────────────────────────────────────────────────────
export class PlayerAnimator {
  private readonly sprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private readonly gfx:    Phaser.GameObjects.Graphics;

  private state:      AnimState = AnimState.IDLE;
  private stateTimer: number    = 0;  // ms remaining in current timed state
  private dormant:    boolean   = false;

  // Accumulators for continuous sine-driven states
  private idleTime:     number = 0;
  private fallFlapTime: number = 0;
  private apexTime:     number = 0;

  // Interpolated string control/end points (world-space offsets from attach point)
  private cpLx  = -9;  private cpLy  =  16;
  private endLx = -12; private endLy =  30;
  private cpRx  =  9;  private cpRy  =  16;
  private endRx =  12; private endRy =  30;

  constructor(
    sprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody,
    scene:  Phaser.Scene,
  ) {
    this.sprite = sprite;
    this.gfx    = scene.add.graphics().setDepth(11);
  }

  update(delta: number, state: PlayerAnimState): void {
    if (this.dormant) return;

    // ── Interrupts (checked before anything else) ──────────────────────────
    if (state.justDied) {
      this.sprite.setScale(1, 1);
      this.sprite.setAngle(0);
      this.sprite.body.setSize(PLAYER_WIDTH, PLAYER_HEIGHT);
      this.gfx.clear();
      this.dormant = true;
      return;
    }
    if (state.frozen) {
      this.dormant = true;
      return;
    }

    // ── Timed-state tick ───────────────────────────────────────────────────
    if (this.stateTimer > 0) {
      // Interrupt timed state if a higher-priority event fires
      if (state.justLanded &&
          (this.state === AnimState.LAUNCHING || this.state === AnimState.AIR_JUMP)) {
        this.enterTimed(AnimState.LANDING, LANDING_DURATION);
      } else if (state.justWallJumped &&
                 (this.state === AnimState.LAUNCHING || this.state === AnimState.AIR_JUMP)) {
        this.enterTimed(AnimState.LAUNCHING, LAUNCH_DURATION);
      } else {
        this.stateTimer -= delta;
        if (this.stateTimer > 0) {
          this.applyKeyframes();
          this.drawStrings();
          return;
        }
        this.stateTimer = 0;
        // fall through to continuous-state selection below
      }
    }

    // ── Continuous-state transitions ───────────────────────────────────────
    if (state.justLanded) {
      this.enterTimed(AnimState.LANDING, LANDING_DURATION);
      this.applyKeyframes();
      this.drawStrings();
      return;
    }
    if (state.justJumped) {
      this.enterTimed(AnimState.LAUNCHING, LAUNCH_DURATION);
      this.applyKeyframes();
      this.drawStrings();
      return;
    }
    if (state.justAirJumped) {
      this.enterTimed(AnimState.AIR_JUMP, AIR_JUMP_DURATION);
      this.applyKeyframes();
      this.drawStrings();
      return;
    }

    if (state.onWall && !state.onGround && state.vy > 0) {
      this.state = AnimState.WALL_SLIDE;
    } else if (!state.onGround && Math.abs(state.vy) < APEX_VY_THRESHOLD) {
      this.state = AnimState.APEX;
    } else if (!state.onGround && state.vy >= APEX_VY_THRESHOLD) {
      this.state = AnimState.FALLING;
    } else {
      this.state = AnimState.IDLE;
    }

    this.idleTime     += delta;
    this.fallFlapTime += delta;
    this.apexTime     += delta;

    this.applyContinuousState(delta);
    this.drawStrings();
  }

  destroy(): void {
    this.sprite.setScale(1, 1);
    this.sprite.setAngle(0);
    this.sprite.body.setSize(PLAYER_WIDTH, PLAYER_HEIGHT);
    this.gfx.destroy();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private enterTimed(newState: AnimState, duration: number): void {
    this.state      = newState;
    this.stateTimer = duration;
    this.idleTime   = 0;
  }

  private applyKeyframes(): void {
    const frames   = this.state === AnimState.LAUNCHING ? LAUNCH_FRAMES
                   : this.state === AnimState.AIR_JUMP  ? AIR_JUMP_FRAMES
                   : LANDING_FRAMES;
    const duration = this.state === AnimState.LAUNCHING ? LAUNCH_DURATION
                   : this.state === AnimState.AIR_JUMP  ? AIR_JUMP_DURATION
                   : LANDING_DURATION;

    const t  = 1 - this.stateTimer / duration;   // 0 → 1 progress
    const kf = this.sampleKeyframes(frames, t);

    this.sprite.setScale(kf.scaleX, kf.scaleY);
    this.sprite.body.setSize(PLAYER_WIDTH / kf.scaleX, PLAYER_HEIGHT / kf.scaleY);

    // Snap string points to keyframe values (no lerp needed — keyframes are already smooth)
    this.cpLx  = kf.cpLx;  this.cpLy  = kf.cpLy;
    this.endLx = kf.endLx; this.endLy = kf.endLy;
    this.cpRx  = kf.cpRx;  this.cpRy  = kf.cpRy;
    this.endRx = kf.endRx; this.endRy = kf.endRy;
  }

  private sampleKeyframes(frames: Keyframe[], t: number): Keyframe {
    let a = frames[0];
    let b = frames[frames.length - 1];
    for (let i = 0; i < frames.length - 1; i++) {
      if (t >= frames[i].t && t <= frames[i + 1].t) {
        a = frames[i];
        b = frames[i + 1];
        break;
      }
    }
    const range = b.t - a.t;
    const f     = range < 0.0001 ? 1 : (t - a.t) / range;
    return {
      t,
      scaleX: a.scaleX + (b.scaleX - a.scaleX) * f,
      scaleY: a.scaleY + (b.scaleY - a.scaleY) * f,
      cpLx:   a.cpLx  + (b.cpLx  - a.cpLx)  * f,
      cpLy:   a.cpLy  + (b.cpLy  - a.cpLy)  * f,
      endLx:  a.endLx + (b.endLx - a.endLx) * f,
      endLy:  a.endLy + (b.endLy - a.endLy) * f,
      cpRx:   a.cpRx  + (b.cpRx  - a.cpRx)  * f,
      cpRy:   a.cpRy  + (b.cpRy  - a.cpRy)  * f,
      endRx:  a.endRx + (b.endRx - a.endRx) * f,
      endRy:  a.endRy + (b.endRy - a.endRy) * f,
    };
  }

  private applyContinuousState(delta: number): void {
    let sx: number, sy: number, angle: number;
    let cpLx: number, cpLy: number, endLx: number, endLy: number;
    let cpRx: number, cpRy: number, endRx: number, endRy: number;

    switch (this.state) {
      case AnimState.IDLE: {
        const wave = Math.sin((this.idleTime / IDLE_PERIOD) * Math.PI * 2);
        sx = 1 + wave * 0.025;
        sy = 1 - wave * 0.025;
        angle = 0;
        cpLx = -9; cpLy = 16; endLx = -12; endLy = 30;
        cpRx =  9; cpRy = 16; endRx =  12; endRy = 30;
        break;
      }
      case AnimState.APEX: {
        const wave = Math.sin((this.apexTime / APEX_WIGGLE_PERIOD) * Math.PI * 2);
        sx = 1.06; sy = 0.94; angle = wave * 2;
        cpLx = -20; cpLy = 6; endLx = -30; endLy = 8;
        cpRx =  20; cpRy = 6; endRx =  30; endRy = 8;
        break;
      }
      case AnimState.FALLING: {
        // Strings flutter between straight-up and angled
        const wave = Math.sin((this.fallFlapTime / FALL_FLAP_PERIOD) * Math.PI * 2);
        sx = 0.88; sy = 1.15; angle = 0;
        cpLx = -5 + wave * -7; cpLy = -10 + wave * 6; endLx = -6; endLy = -22;
        cpRx =  5 + wave *  7; cpRy = -10 + wave * 6; endRx =  6; endRy = -22;
        break;
      }
      case AnimState.WALL_SLIDE: {
        const wave = Math.sin((this.idleTime / 900) * Math.PI * 2) * 0.01;
        sx = 1.10 + wave; sy = 0.92 - wave; angle = 0;
        cpLx = -4; cpLy = 10; endLx =  -3; endLy = 24;
        cpRx = 10; cpRy = 12; endRx =  14; endRy = 26;
        break;
      }
      default:
        sx = 1; sy = 1; angle = 0;
        cpLx = -9; cpLy = 16; endLx = -12; endLy = 30;
        cpRx =  9; cpRy = 16; endRx =  12; endRy = 30;
    }

    const lerpF    = Math.min(1, (LERP_SPEED * delta) / 1000);
    const curSX    = this.sprite.scaleX + (sx    - this.sprite.scaleX) * lerpF;
    const curSY    = this.sprite.scaleY + (sy    - this.sprite.scaleY) * lerpF;
    const curAngle = this.sprite.angle  + (angle - this.sprite.angle)  * lerpF;

    this.sprite.setScale(curSX, curSY);
    this.sprite.setAngle(curAngle);
    this.sprite.body.setSize(PLAYER_WIDTH / curSX, PLAYER_HEIGHT / curSY);

    this.cpLx  += (cpLx  - this.cpLx)  * lerpF;
    this.cpLy  += (cpLy  - this.cpLy)  * lerpF;
    this.endLx += (endLx - this.endLx) * lerpF;
    this.endLy += (endLy - this.endLy) * lerpF;
    this.cpRx  += (cpRx  - this.cpRx)  * lerpF;
    this.cpRy  += (cpRy  - this.cpRy)  * lerpF;
    this.endRx += (endRx - this.endRx) * lerpF;
    this.endRy += (endRy - this.endRy) * lerpF;
  }

  private drawStrings(): void {
    const attachX = this.sprite.x;
    const attachY = this.sprite.y + PLAYER_HEIGHT * COLLAR_OFFSET_Y * this.sprite.scaleY;

    this.gfx.clear();
    this.gfx.lineStyle(STRING_STROKE_W, 0xffffff, 1);

    // Left string
    this.gfx.beginPath();
    this.gfx.moveTo(attachX, attachY);
    this.gfx.quadraticCurveTo(
      attachX + this.cpLx, attachY + this.cpLy,
      attachX + this.endLx, attachY + this.endLy,
    );
    this.gfx.strokePath();

    // Right string
    this.gfx.beginPath();
    this.gfx.moveTo(attachX, attachY);
    this.gfx.quadraticCurveTo(
      attachX + this.cpRx, attachY + this.cpRy,
      attachX + this.endRx, attachY + this.endRy,
    );
    this.gfx.strokePath();
  }
}
```

- [ ] **Step 2: Build to verify TypeScript**

```bash
npm run build
```

Expected: no errors. If you see "Property 'setSize' does not exist", check that `this.sprite.body` is typed as `Phaser.Physics.Arcade.Body` — the sprite type `SpriteWithDynamicBody` has `.body` typed correctly.

- [ ] **Step 3: Commit**

```bash
git add src/entities/PlayerAnimator.ts
git commit -m "feat: add PlayerAnimator with 7-state squash/stretch and procedural bow strings"
```

---

## Task 4: Wire PlayerAnimator into GameScene

**Files:**
- Modify: `src/scenes/GameScene.ts`

- [ ] **Step 1: Add import and field declaration**

Add the import at the top of `src/scenes/GameScene.ts` alongside the other entity imports:

```typescript
import { PlayerAnimator } from '../entities/PlayerAnimator';
```

Add the field in the class body alongside `private player!: Player;`:

```typescript
  private player!:         Player;
  private playerAnimator!: PlayerAnimator;
```

- [ ] **Step 2: Construct animator in create()**

After `this.player = new Player(this, ...)` (around line 161), add:

```typescript
    this.player          = new Player(this, WORLD_WIDTH * 0.0625, this.spawnY, this.playerConfig);
    this.playerAnimator  = new PlayerAnimator(this.player.sprite, this);
```

- [ ] **Step 3: Call animator.update() after player.update() in the update loop**

`this.player.update(delta)` is at line 320. Add the animator call immediately after:

```typescript
    this.player.update(delta);
    this.playerAnimator.update(delta, this.player.animState);
```

- [ ] **Step 4: Signal justDied at the player death site**

The death site is in the `TrashWallManager` callback (around line 181):

```typescript
      this._playerDead = true;
      AudioManager.onPlayerDeath();
      this.player.freeze();
      this.playerAnimator.update(delta, { ...this.player.animState, justDied: true });
```

(Add the `playerAnimator.update` call immediately after `this.player.freeze()`.)

- [ ] **Step 5: Destroy animator in shutdown()**

`shutdown()` is at line 773. Add the destroy call:

```typescript
  shutdown(): void {
    this.playerAnimator.destroy();
    AudioManager.stopAll();
  }
```

- [ ] **Step 6: Build**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/scenes/GameScene.ts
git commit -m "feat: wire PlayerAnimator into GameScene"
```

---

## Task 5: Wire PlayerAnimator into InfiniteGameScene

**Files:**
- Modify: `src/scenes/InfiniteGameScene.ts`

- [ ] **Step 1: Add import and field declaration**

Add the import alongside other entity imports:

```typescript
import { PlayerAnimator } from '../entities/PlayerAnimator';
```

Add the field alongside `private player!: Player;`:

```typescript
  private player!:         Player;
  private playerAnimator!: PlayerAnimator;
```

- [ ] **Step 2: Construct in create()**

After `this.player = new Player(this, gapX, this.spawnY, this.playerConfig)` (around line 155), add:

```typescript
    this.player         = new Player(this, gapX, this.spawnY, this.playerConfig);
    this.playerAnimator = new PlayerAnimator(this.player.sprite, this);
```

- [ ] **Step 3: Call animator.update() after player.update()**

`this.player.update(delta)` is at line 310. Add immediately after:

```typescript
    this.player.update(delta);
    this.playerAnimator.update(delta, this.player.animState);
```

- [ ] **Step 4: Signal justDied in handleDeath()**

`handleDeath()` is the private method around line 401. After `this.player.freeze()`, add:

```typescript
    this.player.freeze();
    this.playerAnimator.update(0, { ...this.player.animState, justDied: true });
```

- [ ] **Step 5: Destroy in shutdown()**

`shutdown()` is around line 534. Add:

```typescript
  shutdown(): void {
    this.playerAnimator.destroy();
    AudioManager.stopAll();
  }
```

(Check whether `shutdown()` already has an `AudioManager.stopAll()` call — if so, just prepend the `destroy()` line.)

- [ ] **Step 6: Build and test**

```bash
npm run build && npm test
```

Expected: build passes, all existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/scenes/InfiniteGameScene.ts
git commit -m "feat: wire PlayerAnimator into InfiniteGameScene"
```

---

## Task 6: Visual smoke test

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

Leave this running in a terminal.

- [ ] **Step 2: Scene preview screenshot**

In a second terminal:

```bash
npm run scene-preview -- GameScene '{}' pixel7
```

Check `screenshots/preview.png` — confirm the bag uses the no-strings sprite and no visual regressions in the scene layout.

- [ ] **Step 3: Manual browser smoke test**

Open the game in a browser. Test each animation state:

| Action | Expected |
|---|---|
| Stand still | Bag breathes gently (slow sine scale) |
| Jump | Bag stretches tall on launch, damps down |
| Double-jump (if unlocked) | Clean pop stretch, strings trail down |
| Reach jump apex | Bag flattens slightly, wiggles side-to-side |
| Fall | Bag elongates, strings flutter upward |
| Land | Bag squashes wide, strings whip out then settle |
| Slide on wall | Bag pressed flat, strings pushed to free side |
| Die (hit trash wall) | Scale snaps to 1.0, strings disappear, animator dormant |

- [ ] **Step 4: Adjust string COLLAR_OFFSET_Y if attachment point is off**

The constant `COLLAR_OFFSET_Y = -0.44` in `PlayerAnimator.ts` sets where strings attach. If the strings visually attach above or below the red collar, tune this value. At the default `PLAYER_HEIGHT = 46`:

- `COLLAR_OFFSET_Y = -0.44` → attach at `y - 20.2px` above center
- Increase magnitude (e.g. `-0.46`) to move attach point higher
- Decrease magnitude (e.g. `-0.40`) to move it lower

After adjusting, re-run `npm run scene-preview` to verify.

- [ ] **Step 5: Final commit if any tuning was done**

```bash
git add src/entities/PlayerAnimator.ts
git commit -m "fix: tune string collar attachment point"
```

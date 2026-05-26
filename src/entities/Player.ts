import Phaser from 'phaser';
import {
  PLAYER_SPEED,
  PLAYER_JUMP_VELOCITY,
  PLAYER_WIDTH,
  PLAYER_HEIGHT,
  WORLD_WIDTH,
  SKY_PAD,
  SKY_INSET,
  MOCK_HEAP_HEIGHT_PX,
  PLAYER_DASH_VELOCITY,
  PLAYER_AIR_MAX_SPEED,
  DASH_COOLDOWN_MS,
  DASH_DURATION_MS,
  PLAYER_MAX_FALL_SPEED,
  PLAYER_DIVE_SPEED,
  WALL_SLIDE_SPEED,
  WALL_COYOTE_MS,
  WALL_JUMP_PUSH,
  WALL_JUMP_COOLDOWN_MS,
  AIR_TILT_FORCE,
  AIR_MOMENTUM_DECAY,
  MOMENTUM_STOP_ADV_FACTOR,
  TERRAIN_STICK_SPEED,
  PLACEMENT_MOVE_SPEED,
  WORLD_GRAVITY_Y,
  JUMP_BUFFER_MS,
  JUMP_CUT_FACTOR,
  APEX_VY_THRESHOLD,
  APEX_GRAVITY_FACTOR,
  FALL_GRAVITY_FACTOR,
} from '../constants';
import { PlayerConfig } from '../systems/SaveData';
import { InputManager } from '../systems/InputManager';
import { AudioManager } from '../systems/AudioManager';

const { KeyCodes } = Phaser.Input.Keyboard;

/** Per-frame physics context built once at the top of update() and passed through helpers. */
interface FrameCtx {
  body:     Phaser.Types.Physics.Arcade.SpriteWithDynamicBody['body'];
  floorY:   number;
  onGround: boolean;
  onWall:   boolean;
}

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
  justPlaced:     boolean;
}

export class Player {
  readonly sprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;

  private readonly leftKeys:         Phaser.Input.Keyboard.Key[];
  private readonly rightKeys:        Phaser.Input.Keyboard.Key[];
  private readonly jumpKeys:         Phaser.Input.Keyboard.Key[];
  private readonly downKeys:         Phaser.Input.Keyboard.Key[];
  private readonly dashKey:          Phaser.Input.Keyboard.Key;

  private readonly maxAirJumps:      number;
  private readonly wallJumpEnabled:  boolean;
  private readonly dashEnabled:      boolean;
  private readonly diveEnabled:      boolean;
  private readonly jumpBoost:        number;

  private airJumpsRemaining:   number = 0;
  private wallJumpCooldown:    number = 0; // ms remaining of wall-jump cooldown (same-wall gating)
  private lastWallJumpSide:    -1 | 0 | 1 = 0; // which side player last wall-jumped from: -1=left, 1=right, 0=none
  private wallCoyoteTimer:     number = 0; // ms remaining of wall-leave coyote grace
  private lastWallSide:        -1 | 0 | 1 = 0; // which side was player last touching: -1=left, 1=right, 0=none
  private _prevOnWall:         boolean = false; // previous frame's onWall state for wall-leave transition detection
  private dashCooldown:        number = 0; // ms remaining
  private dashActive:         number = 0; // ms remaining of active dash
  private diveActive:         number = 0; // ms remaining of mobile dive burst
  private coyoteTimer:        number = 0; // ms remaining of coyote-time grace
  private momentumX:          number = 0; // airborne horizontal momentum (px/s)

  // Jump feel — buffer + variable height
  private jumpBufferTimer:           number = 0; // ms remaining of buffered jump input
  private bufferedJumpVx:            number = 0; // captured im.jumpVx at press time
  private bufferedJumpFromKeyboard:  boolean = false; // true if buffer set by keyboard (cuttable); false for mobile pulses
  private jumpKeyWasHeld:            boolean = false; // for release-edge detection (sustained press → release)

  // Per-frame state captured by updateJumpInputAndCut() and read later in the same
  // update() call by consumeJumpBufferOnFire(). Only meaningful during update().
  private _frameJumpKeyHeld: boolean = false;

  /** Set by GameScene's wall-group collision callback each frame. When true the
   *  player is resting on a steep wall surface and should be ejected outward. */
  public inSlopeZone = false;
  /** Direction to eject when inSlopeZone: -1 = left (off left wall), 1 = right (off right wall). */
  public slopeEjectDir: number = 0;
  /** Set to -1 (wrapped left→right) or 1 (wrapped right→left) for one frame after a wrap. */
  public wrapDir: number = 0;

  /** Override in scenes that use a wider world (e.g. InfiniteGameScene). */
  public worldWidth: number = WORLD_WIDTH;
  /** Floor Y for the current heap — used as the ground fallback. */
  public worldHeight: number = MOCK_HEAP_HEIGHT_PX;

  private placementMode: boolean = false;
  private shieldActive: boolean = false;
  private shieldAura?: Phaser.GameObjects.Arc;
  private readonly syncAura = (): void => {
    this.shieldAura?.setPosition(this.sprite.x, this.sprite.y);
  };
  private onLadder: boolean = false;
  private controlsEnabled = true;
  private _wasOnGround = false;
  private _onGround       = false;
  private _onWall         = false;
  private _frozen         = false;
  private _justLanded     = false;
  private _justJumped     = false;
  private _justAirJumped  = false;
  private _justWallJumped = false;

  // ── HUD accessors ──────────────────────────────────────────────────────────
  get dashCooldownFraction(): number  { return this.dashCooldown / DASH_COOLDOWN_MS; }
  get airJumpsLeft():         number  { return this.airJumpsRemaining; }
  get maxAirJumpsCount():     number  { return this.maxAirJumps; }
  get canWallJump():          boolean { return this.wallJumpCooldown === 0; }
  get hasWallJump():          boolean { return this.wallJumpEnabled; }
  get hasDash():              boolean { return this.dashEnabled; }
  get hasActiveShield():      boolean { return this.shieldActive; }

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
      justPlaced:     false,
    };
  }

  constructor(scene: Phaser.Scene, x: number, y: number, config: PlayerConfig) {
    this.sprite = scene.physics.add.sprite(x, y, 'trashbag-nostrings');
    this.sprite.setDisplaySize(PLAYER_WIDTH, PLAYER_HEIGHT);
    // World bounds handled manually (X wrap + Y clamp) — do NOT setCollideWorldBounds
    this.sprite.body.setMaxVelocityY(PLAYER_MAX_FALL_SPEED);
    this.sprite.body.setSize(PLAYER_WIDTH / this.sprite.scaleX, PLAYER_HEIGHT / this.sprite.scaleY);
    this.sprite.setDepth(10);

    this.maxAirJumps        = config.maxAirJumps;
    this.wallJumpEnabled    = config.wallJump;
    this.dashEnabled        = config.dash;
    this.diveEnabled        = config.dive;
    this.jumpBoost          = config.jumpBoost;
    this.airJumpsRemaining  = this.maxAirJumps;

    const kb = scene.input.keyboard!;
    this.leftKeys  = [kb.addKey(KeyCodes.LEFT),  kb.addKey(KeyCodes.A)];
    this.rightKeys = [kb.addKey(KeyCodes.RIGHT), kb.addKey(KeyCodes.D)];
    this.jumpKeys  = [kb.addKey(KeyCodes.UP),    kb.addKey(KeyCodes.W)];
    this.downKeys  = [kb.addKey(KeyCodes.DOWN),  kb.addKey(KeyCodes.S)];
    this.dashKey   = kb.addKey(KeyCodes.SHIFT);
  }

  update(delta: number): void {
    this.clearOneFrameFlags();
    this.updateJumpInputAndCut(delta);

    if (this.handleLadder()) return;
    if (!this.controlsEnabled) return;

    const ctx = this.computeGroundContext();
    this.applyGravityScaling(ctx);
    this.updateWallTracking(ctx, delta);
    this.handleLandingResets(ctx, delta);
    this.updateHorizontal(ctx, delta);
    this.applyTerrainStick(ctx);
    this.updateDash(ctx, delta);

    const jumpFired     = this.tryGroundOrAirJump(ctx);
    const wallJumpFired = this.tryWallJump(ctx);
    this.consumeJumpBufferOnFire(jumpFired || wallJumpFired);

    this.applyWallSlide(ctx);
    this.updateDive(ctx, delta);
    this.applyWorldBoundsX();
    this.resetPerFrameSlopeFlags();
    this.applyYClamp(ctx);
  }

  // ── update() helpers ──────────────────────────────────────────────────────
  // Each helper does one slice of the per-frame work. Order in update() is the
  // source of truth; helpers are deliberately small so ordering bugs are visible.

  private clearOneFrameFlags(): void {
    this._justLanded     = false;
    this._justJumped     = false;
    this._justAirJumped  = false;
    this._justWallJumped = false;
  }

  /** Decay jump buffer, prime on new press, apply held→released transition cut.
   *  Stashes jumpKeyHeld on the player for consumeJumpBufferOnFire to read later. */
  private updateJumpInputAndCut(delta: number): void {
    const im = InputManager.getInstance();
    this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - delta);
    const jumpKeyJustDown = this.jumpKeys.some(k => Phaser.Input.Keyboard.JustDown(k));
    if (jumpKeyJustDown) {
      this.jumpBufferTimer           = JUMP_BUFFER_MS;
      this.bufferedJumpVx            = im.jumpVx;
      this.bufferedJumpFromKeyboard  = true;
    } else if (im.jumpJustPressed) {
      this.jumpBufferTimer           = JUMP_BUFFER_MS;
      this.bufferedJumpVx            = im.jumpVx;
      this.bufferedJumpFromKeyboard  = false; // mobile pulse — never cut
    }

    const jumpKeyHeld = this.jumpKeys.some(k => k.isDown);
    // [DEBUG-JUMP-CUT] temporary instrumentation — remove once feel is verified
    if (jumpKeyJustDown || (this.jumpKeyWasHeld !== jumpKeyHeld)) {
      console.log('[JUMP]', {
        justDown: jumpKeyJustDown,
        wasHeld: this.jumpKeyWasHeld,
        nowHeld: jumpKeyHeld,
        vy: Math.round(this.sprite.body.velocity.y),
        bufferMs: Math.round(this.jumpBufferTimer),
      });
    }
    if (this.jumpKeyWasHeld && !jumpKeyHeld && this.sprite.body.velocity.y < 0) {
      const before = this.sprite.body.velocity.y;
      this.sprite.setVelocityY(before * JUMP_CUT_FACTOR);
      console.log('[JUMP-CUT-TRANSITION]', { before: Math.round(before), after: Math.round(before * JUMP_CUT_FACTOR) });
    }
    this.jumpKeyWasHeld     = jumpKeyHeld;
    this._frameJumpKeyHeld  = jumpKeyHeld;
  }

  /** Returns true if the ladder consumed this frame (caller should early-return). */
  private handleLadder(): boolean {
    if (!this.onLadder) return false;
    const im = InputManager.getInstance();
    const goLeft  = this.leftKeys.some(k => k.isDown)  || im.goLeft;
    const goRight = this.rightKeys.some(k => k.isDown) || im.goRight;
    if (goLeft || goRight) {
      this.exitLadder();
      return false; // fall through to normal physics this frame
    }
    const goUp   = this.jumpKeys.some(k => k.isDown)  || im.jumpJustPressed || im.dragUp;
    const goDown = this.downKeys.some(k => k.isDown) || im.dragDown;
    this.sprite.setVelocityX(0);
    this.sprite.setVelocityY(goUp ? -PLAYER_SPEED * 0.65 : goDown ? PLAYER_SPEED * 0.65 : 0);
    // Ladder counts as grounded: keep jump charges full and coyote window fresh
    this.airJumpsRemaining  = this.maxAirJumps;
    this.wallJumpCooldown   = 0;
    this.coyoteTimer        = 120;
    // Still allow X-wrap so player doesn't get stuck at world edge on ladder
    if (this.sprite.x < -SKY_PAD * this.worldWidth)
      this.sprite.x = (1 - SKY_INSET) * this.worldWidth;
    else if (this.sprite.x > (1 + SKY_PAD) * this.worldWidth)
      this.sprite.x = SKY_INSET * this.worldWidth;
    return true;
  }

  private computeGroundContext(): FrameCtx {
    const body     = this.sprite.body;
    const floorY   = this.worldHeight - PLAYER_HEIGHT / 2;
    const onWall   = body.blocked.left || body.blocked.right;

    // Derive onGround from three predicates:
    // 1. Physics contact detection (but not in slope rejection zones)
    const groundedByPhysics = body.blocked.down && !this.inSlopeZone;
    // 2. Floor fallback (sprite touching the world floor)
    const groundedByFloor   = this.sprite.y >= floorY;
    // 3. Filter spurious ground from wall bodies: while sliding (velocity.y > 10)
    //    and touching a wall, a wall-face can register as physics ground — reject it
    const wallFalseGround   = onWall && body.velocity.y > 10;

    const onGround = (groundedByPhysics && !wallFalseGround) || groundedByFloor;

    if (onGround && !this._wasOnGround) {
      AudioManager.play('player-land');
      this._justLanded = true;
    }
    this._wasOnGround = onGround;
    this._onGround    = onGround;
    this._onWall      = onWall;

    return { body, floorY, onGround, onWall };
  }

  /** Apex hang when |vy| is small, fast-fall multiplier when descending.
   *  setGravityY is additive to world gravity. */
  private applyGravityScaling(ctx: FrameCtx): void {
    if (ctx.onGround) {
      ctx.body.setGravityY(0);
      return;
    }
    const vy = ctx.body.velocity.y;
    if (vy > 0) {
      ctx.body.setGravityY(WORLD_GRAVITY_Y * (FALL_GRAVITY_FACTOR - 1));
    } else if (Math.abs(vy) < APEX_VY_THRESHOLD) {
      ctx.body.setGravityY(WORLD_GRAVITY_Y * (APEX_GRAVITY_FACTOR - 1));
    } else {
      ctx.body.setGravityY(0);
    }
  }

  /** Manage wall-leave coyote time window and wall-jump cooldown decay.
   *  When onWall, sets wallCoyoteTimer and lastWallSide. When off wall, decays timer.
   *  Also decays wallJumpCooldown and detects wall-leave transitions to reset lastWallJumpSide. */
  /** Update wall-related timers and transition state.
   *
   * Handles three concerns:
   * (a) wall-coyote timer decay (allows wall-jump after leaving wall)
   * (b) wall-jump cooldown decay (enforces same-wall cooldown gating)
   * (c) wall-leave transition detection (resets lastWallJumpSide when leaving wall)
   */
  private updateWallTracking(ctx: FrameCtx, delta: number): void {
    if (ctx.onWall) {
      // Touching wall: refresh coyote window and record which side
      this.wallCoyoteTimer = WALL_COYOTE_MS;
      this.lastWallSide = ctx.body.blocked.left ? -1 : 1;
    } else {
      // Not touching wall: decay coyote timer
      this.wallCoyoteTimer = Math.max(0, this.wallCoyoteTimer - delta);
      // Wall-leave transition: grant small outward momentum so player has something to work with
      if (this._prevOnWall) {
        const outwardDir = this.lastWallSide === -1 ? 1 : -1;
        this.momentumX = outwardDir * 80;
      }
    }
    // Decay wall-jump cooldown every frame
    this.wallJumpCooldown = Math.max(0, this.wallJumpCooldown - delta);
    // Track wall state for next frame's wall-leave detection
    this._prevOnWall = ctx.onWall;
  }

  private handleLandingResets(ctx: FrameCtx, delta: number): void {
    if (ctx.onGround) {
      this.coyoteTimer        = 120;
      this.airJumpsRemaining  = this.maxAirJumps;
      this.wallJumpCooldown   = 0;
      // Cancel any active dive burst — diveActive only decrements inside the !onGround
      // block so it would otherwise freeze on landing, re-triggering dive on the next jump.
      if (this.diveActive > 0) {
        this.diveActive = 0;
        ctx.body.setMaxVelocityY(PLAYER_MAX_FALL_SPEED);
      }
      // Ground-touch dash refresh: allow chaining dash → land → dash within cooldown window
      if (this.dashEnabled) {
        this.dashCooldown = 0;
      }
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - delta);
    }
  }

  private updateHorizontal(ctx: FrameCtx, delta: number): void {
    const im = InputManager.getInstance();
    const keyboardLeft  = this.leftKeys.some(k => k.isDown);
    const keyboardRight = this.rightKeys.some(k => k.isDown);

    if (this.dashActive !== 0) return; // active dash protects horizontal velocity

    const moveSpeed = this.placementMode ? PLACEMENT_MOVE_SPEED : PLAYER_SPEED;

    if (this.inSlopeZone && !keyboardLeft && !keyboardRight && im.tiltFactor === 0) {
      // Eject outward along the wall surface until the player slides off the edge
      this.sprite.setVelocityX(this.slopeEjectDir * moveSpeed);
      this.momentumX = 0;
    } else if (ctx.onGround || this.inSlopeZone) {
      // Ground (or slope zone with active input): direct velocity control
      this.momentumX = 0;
      if (keyboardLeft) {
        this.sprite.setVelocityX(-moveSpeed);
        this.sprite.setFlipX(true);
      } else if (keyboardRight) {
        this.sprite.setVelocityX(moveSpeed);
        this.sprite.setFlipX(false);
      } else {
        const tiltVx = im.tiltFactor * moveSpeed;
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
        // Input can decelerate freely, but can only accelerate up to PLAYER_SPEED;
        // higher speeds (from dash or swipe-jump) must decay naturally.
        if (opposing || Math.abs(this.momentumX) < PLAYER_SPEED) {
          this.momentumX += opposing ? force * MOMENTUM_STOP_ADV_FACTOR : force;
        }
      } else {
        this.momentumX *= Math.pow(AIR_MOMENTUM_DECAY, delta);
        if (Math.abs(this.momentumX) < 0.5) this.momentumX = 0;
      }
      this.momentumX = Math.max(-PLAYER_AIR_MAX_SPEED, Math.min(PLAYER_AIR_MAX_SPEED, this.momentumX));
      this.sprite.setVelocityX(this.momentumX);
      if (this.momentumX < 0) this.sprite.setFlipX(true);
      else if (this.momentumX > 0) this.sprite.setFlipX(false);
    }
  }

  /** Keep player pressed into surface so they don't float between slab colliders on
   *  slopes (4px slab spacing, gravity alone takes ~6 frames to close the gap).
   *  Skip when already moving upward — a fresh jump's velocity must not be cancelled. */
  private applyTerrainStick(ctx: FrameCtx): void {
    const body = ctx.body;
    if (body.blocked.down && !this.inSlopeZone && body.velocity.y >= 0 && body.velocity.y < TERRAIN_STICK_SPEED) {
      this.sprite.setVelocityY(TERRAIN_STICK_SPEED);
    }
  }

  private updateDash(ctx: FrameCtx, delta: number): void {
    if (!this.dashEnabled) return;
    const im = InputManager.getInstance();
    const keyboardLeft  = this.leftKeys.some(k => k.isDown);
    const keyboardRight = this.rightKeys.some(k => k.isDown);

    const prevDashActive = this.dashActive;
    this.dashActive = Math.max(0, this.dashActive - delta);
    // Smooth dash exit: when dash just ended and player is airborne, carry the
    // current horizontal velocity into momentumX so air control resumes smoothly
    // instead of snapping to zero.
    if (prevDashActive > 0 && this.dashActive === 0 && !ctx.onGround) {
      this.momentumX = Math.max(-PLAYER_AIR_MAX_SPEED, Math.min(PLAYER_AIR_MAX_SPEED, ctx.body.velocity.x));
    }

    this.dashCooldown = Math.max(0, this.dashCooldown - delta);
    const dashTriggered = Phaser.Input.Keyboard.JustDown(this.dashKey) || im.dashJustFired;
    if (dashTriggered && this.dashCooldown === 0) {
      const dir = im.dashJustFired ? im.dashDir : (keyboardLeft ? -1 : keyboardRight ? 1 : (this.sprite.flipX ? -1 : 1));
      this.momentumX = 0;
      this.sprite.setVelocityX(dir * PLAYER_DASH_VELOCITY);
      this.dashCooldown = DASH_COOLDOWN_MS;
      this.dashActive   = DASH_DURATION_MS;
      AudioManager.play('player-dash');
    }
  }

  /** Ground-jump (via coyote) or air-jump path. Returns whether a jump fired. */
  private tryGroundOrAirJump(ctx: FrameCtx): boolean {
    const jumpPressed = !this.placementMode && this.jumpBufferTimer > 0;
    if (!jumpPressed) return false;
    const body = ctx.body;
    const onWallForJump = this.wallJumpEnabled && (body.blocked.left || body.blocked.right);
    const canGroundJump = this.coyoteTimer > 0;
    if (canGroundJump) {
      this.momentumX = this.bufferedJumpVx !== 0 ? this.bufferedJumpVx : body.velocity.x;
      this.sprite.setVelocityX(this.momentumX);
      this.sprite.setVelocityY(PLAYER_JUMP_VELOCITY - this.jumpBoost);
      // Coyote consumed in consumeJumpBufferOnFire() so every jump path clears it.
      AudioManager.play('player-jump');
      this._justJumped = true;
      return true;
    }
    if (!onWallForJump && this.airJumpsRemaining > 0) {
      this.momentumX = this.bufferedJumpVx !== 0 ? this.bufferedJumpVx : body.velocity.x;
      this.sprite.setVelocityX(this.momentumX);
      this.sprite.setVelocityY(PLAYER_JUMP_VELOCITY - this.jumpBoost);
      this.airJumpsRemaining--;
      AudioManager.play('player-jump');
      this._justAirJumped = true;
      return true;
    }
    return false;
  }

  /** Wall-jump branch: only when airborne, gated by 2-second same-wall cooldown.
   *  Can fire while touching wall OR within wallCoyoteTimer window after leaving.
   *  Cooldown gates fire: wallJumpCooldown must be 0 OR currentWallSide !== lastWallJumpSide.
   *  Returns whether a wall jump fired. */
  private tryWallJump(ctx: FrameCtx): boolean {
    const jumpPressed = !this.placementMode && this.jumpBufferTimer > 0;
    if (!this.wallJumpEnabled || ctx.onGround || !jumpPressed) return false;
    // Accept jump if touching wall OR within coyote window after leaving wall
    const canWallJump = ctx.onWall || this.wallCoyoteTimer > 0;
    if (!canWallJump) return false;
    const body = ctx.body;
    // Derive current wall side from physics contact, or use lastWallSide from coyote
    const currentWallSide = body.blocked.left ? -1 : body.blocked.right ? 1 : this.lastWallSide;
    // Check cooldown gate: can fire if cooldown expired OR touching a different wall
    const canFireOnThisWall = this.wallJumpCooldown === 0 || currentWallSide !== this.lastWallJumpSide;
    if (!canFireOnThisWall) return false;
    // Direction: use current blocked state if touching wall, otherwise use lastWallSide from coyote
    const dir = body.blocked.left ? 1 : body.blocked.right ? -1 : -this.lastWallSide;
    this.momentumX = dir * WALL_JUMP_PUSH;
    this.sprite.setVelocityX(this.momentumX);
    this.sprite.setVelocityY(PLAYER_JUMP_VELOCITY - this.jumpBoost);
    this.wallJumpCooldown = WALL_JUMP_COOLDOWN_MS;
    this.lastWallJumpSide = currentWallSide;
    this.wallCoyoteTimer = 0; // Consume coyote window on wall-jump fire
    AudioManager.play('player-jump');
    this._justWallJumped = true;
    return true;
  }

  /** Clear buffer state and apply tap-cut if the keyboard-originated jump fired
   *  while the key is not currently held (sub-frame tap, buffered tap-then-land). */
  private consumeJumpBufferOnFire(jumpFired: boolean): void {
    if (!jumpFired) return;
    this.jumpBufferTimer = 0;
    this.bufferedJumpVx  = 0;
    this.coyoteTimer     = 0; // any jump path consumes the coyote window (#9 defensive)
    if (this.bufferedJumpFromKeyboard && !this._frameJumpKeyHeld) {
      this.sprite.setVelocityY((PLAYER_JUMP_VELOCITY - this.jumpBoost) * JUMP_CUT_FACTOR);
      console.log('[JUMP-CUT-ONFIRE]', { jumpVy: PLAYER_JUMP_VELOCITY - this.jumpBoost, cutTo: (PLAYER_JUMP_VELOCITY - this.jumpBoost) * JUMP_CUT_FACTOR });
    } else {
      console.log('[JUMP-FIRE-FULL]', { fromKeyboard: this.bufferedJumpFromKeyboard, held: this._frameJumpKeyHeld });
    }
    this.bufferedJumpFromKeyboard = false;
  }

  private applyWallSlide(ctx: FrameCtx): void {
    if (!ctx.onGround && ctx.onWall && ctx.body.velocity.y > WALL_SLIDE_SPEED) {
      this.sprite.setVelocityY(WALL_SLIDE_SPEED);
      this.momentumX = 0; // No horizontal momentum while actively sliding; granted on wall-leave
    }
  }

  /** Slam downward while airborne; release to return to normal fall speed. */
  private updateDive(ctx: FrameCtx, delta: number): void {
    if (!this.diveEnabled || ctx.onGround) return;
    const im = InputManager.getInstance();
    const holdingDown = this.downKeys.some(k => k.isDown);
    this.diveActive = Math.max(0, this.diveActive - delta);

    if (im.diveJustFired && !holdingDown) {
      this.diveActive = DASH_DURATION_MS; // mobile swipe-down burst
    }

    // Guard dive against same-frame jump: do not overwrite jump velocity
    const jumpedThisFrame = this._justJumped || this._justAirJumped || this._justWallJumped;
    if (holdingDown || this.diveActive > 0) {
      if (!jumpedThisFrame) {
        ctx.body.setMaxVelocityY(PLAYER_DIVE_SPEED);
        this.sprite.setVelocityY(PLAYER_DIVE_SPEED);
      }
    } else {
      ctx.body.setMaxVelocityY(PLAYER_MAX_FALL_SPEED);
      if (ctx.body.velocity.y > PLAYER_MAX_FALL_SPEED) {
        this.sprite.setVelocityY(PLAYER_MAX_FALL_SPEED);
      }
    }
  }

  /** Extended sky pad on each side; landing inset from the far edge. */
  private applyWorldBoundsX(): void {
    this.wrapDir = 0;
    if (this.sprite.x < -SKY_PAD * this.worldWidth) {
      this.sprite.x = (1 - SKY_INSET) * this.worldWidth;
      this.wrapDir = -1;
    } else if (this.sprite.x > (1 + SKY_PAD) * this.worldWidth) {
      this.sprite.x = SKY_INSET * this.worldWidth;
      this.wrapDir = 1;
    }
  }

  /** Slope flags are set by the wall-group collision callback (which runs before
   *  update). Clear them at end of frame so a stale value doesn't leak into next frame. */
  private resetPerFrameSlopeFlags(): void {
    this.inSlopeZone    = false;
    this.slopeEjectDir  = 0;
  }

  /** Floor clamp — prevent falling through the world floor; treat floor as ground. */
  private applyYClamp(ctx: FrameCtx): void {
    if (this.sprite.y < ctx.floorY) return;
    this.sprite.y = ctx.floorY;
    if (this.sprite.body.velocity.y >= 0) {
      // Only cancel downward/stationary velocity — don't cancel a jump (velocity < 0)
      this.sprite.setVelocityY(0);
      this.airJumpsRemaining = this.maxAirJumps;
      this.wallJumpCooldown = 0;
    }
  }

  activateShield(): void {
    this.shieldActive = true;
    this.shieldAura?.destroy();
    this.shieldAura = this.sprite.scene.add.arc(
      this.sprite.x, this.sprite.y,
      Math.max(PLAYER_WIDTH, PLAYER_HEIGHT) * 0.72,
      0, 360, false, 0x44bbff, 0.35,
    ).setStrokeStyle(2, 0x88ddff, 0.9).setDepth(9);
    this.sprite.scene.events.on('prerender', this.syncAura, this);
  }

  absorbHit(): void {
    this.shieldActive = false;
    this.sprite.scene.events.off('prerender', this.syncAura, this);
    this.shieldAura?.destroy();
    this.shieldAura = undefined;
  }

  get isOnLadder(): boolean { return this.onLadder; }

  enterLadder(): void {
    if (this.onLadder) return;
    this.onLadder = true;
    this.sprite.body.setAllowGravity(false);
    this.sprite.setVelocityY(0);
  }

  exitLadder(): void {
    if (!this.onLadder) return;
    this.onLadder = false;
    this.sprite.body.setAllowGravity(true);
  }

  refundAirJump(): void {
    this.airJumpsRemaining = Math.min(this.maxAirJumps, this.airJumpsRemaining + 1);
  }

  setControlsEnabled(enabled: boolean): void {
    this.controlsEnabled = enabled;
  }

  setPlacementMode(active: boolean): void {
    this.placementMode = active;
  }

  freeze(): void {
    if (this.onLadder) this.exitLadder(); // clears onLadder flag; gravity re-enable is overridden below
    this.setControlsEnabled(false);
    this.sprite.setVelocity(0, 0);
    this.sprite.body.setAllowGravity(false);
    this._frozen = true;
  }
}

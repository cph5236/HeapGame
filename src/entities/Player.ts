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

  private airJumpsRemaining:  number = 0;
  private wallJumpsRemaining: number = 0;
  private dashCooldown:       number = 0; // ms remaining
  private dashActive:         number = 0; // ms remaining of active dash
  private diveActive:         number = 0; // ms remaining of mobile dive burst
  private coyoteTimer:        number = 0; // ms remaining of coyote-time grace
  private momentumX:          number = 0; // airborne horizontal momentum (px/s)

  // Jump feel — buffer + variable height
  private jumpBufferTimer:    number = 0; // ms remaining of buffered jump input
  private bufferedJumpVx:     number = 0; // captured im.jumpVx at press time
  private jumpKeyWasHeld:     boolean = false; // for release-edge detection

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
  get wallJumpsLeft():        number  { return this.wallJumpsRemaining; }
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
    this.wallJumpsRemaining = this.wallJumpEnabled ? 1 : 0;

    const kb = scene.input.keyboard!;
    this.leftKeys  = [kb.addKey(KeyCodes.LEFT),  kb.addKey(KeyCodes.A)];
    this.rightKeys = [kb.addKey(KeyCodes.RIGHT), kb.addKey(KeyCodes.D)];
    this.jumpKeys  = [kb.addKey(KeyCodes.UP),    kb.addKey(KeyCodes.W)];
    this.downKeys  = [kb.addKey(KeyCodes.DOWN),  kb.addKey(KeyCodes.S)];
    this.dashKey   = kb.addKey(KeyCodes.SHIFT);
  }

  update(delta: number): void {
    // Clear one-frame animation flags from the previous frame
    this._justLanded     = false;
    this._justJumped     = false;
    this._justAirJumped  = false;
    this._justWallJumped = false;

    const im = InputManager.getInstance();

    // Jump buffer — decay last frame's buffered input, then prime on new press.
    // Capturing the swipe direction here lets a buffered swipe-jump preserve its
    // jumpVx even after the one-frame pulse has cleared.
    this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - delta);
    const jumpKeyJustDown = this.jumpKeys.some(k => Phaser.Input.Keyboard.JustDown(k));
    if (jumpKeyJustDown || im.jumpJustPressed) {
      this.jumpBufferTimer = JUMP_BUFFER_MS;
      this.bufferedJumpVx  = im.jumpVx;
    }

    // Variable jump height — releasing the jump key while still rising cuts upward
    // velocity. Mobile swipe-jumps never trigger this (no keyboard key is held).
    const jumpKeyHeld = this.jumpKeys.some(k => k.isDown);
    if (this.jumpKeyWasHeld && !jumpKeyHeld && this.sprite.body.velocity.y < 0) {
      this.sprite.setVelocityY(this.sprite.body.velocity.y * JUMP_CUT_FACTOR);
    }
    this.jumpKeyWasHeld = jumpKeyHeld;

    // Ladder climbing mode — vertical movement only, gravity off, jump suppressed
    if (this.onLadder) {
      // Left/right exits the ladder
      const goLeft  = this.leftKeys.some(k => k.isDown)  || im.goLeft;
      const goRight = this.rightKeys.some(k => k.isDown) || im.goRight;
      if (goLeft || goRight) {
        this.exitLadder();
        // fall through to normal physics this frame
      } else {
        const goUp   = this.jumpKeys.some(k => k.isDown)  || im.jumpJustPressed || im.dragUp;
        const goDown = this.downKeys.some(k => k.isDown) || im.dragDown;
        this.sprite.setVelocityX(0);
        this.sprite.setVelocityY(goUp ? -PLAYER_SPEED * 0.65 : goDown ? PLAYER_SPEED * 0.65 : 0);
        // Ladder counts as grounded: keep jump charges full and coyote window fresh
        this.airJumpsRemaining  = this.maxAirJumps;
        this.wallJumpsRemaining = this.wallJumpEnabled ? 1 : 0;
        this.coyoteTimer        = 120;
        // Still allow X-wrap so player doesn't get stuck at world edge on ladder
        if (this.sprite.x < -SKY_PAD * this.worldWidth)
          this.sprite.x = (1 - SKY_INSET) * this.worldWidth;
        else if (this.sprite.x > (1 + SKY_PAD) * this.worldWidth)
          this.sprite.x = SKY_INSET * this.worldWidth;
        return; // skip all normal physics this frame
      }
    }

    if (!this.controlsEnabled) return;

    const body     = this.sprite.body;
    const floorY   = this.worldHeight - PLAYER_HEIGHT / 2;
    const onWall   = body.blocked.left || body.blocked.right;
    // Filter spurious blocked.down from wall bodies: while sliding (velocity.y > 10)
    // and touching a wall, a wall-face body can register as ground — ignore it.
    const onGround = (body.blocked.down && !this.inSlopeZone && !(onWall && body.velocity.y > 10))
                   || this.sprite.y >= floorY;

    if (onGround && !this._wasOnGround) {
      AudioManager.play('player-land');
      this._justLanded = true;
    }
    this._wasOnGround = onGround;
    this._onGround    = onGround;
    this._onWall      = onWall;

    // Gravity scaling for snappier jumps — apex hang when |vy| is small,
    // fast-fall multiplier when descending. setGravityY is additive to world gravity.
    if (onGround) {
      body.setGravityY(0);
    } else {
      const vy = body.velocity.y;
      if (vy > 0) {
        body.setGravityY(WORLD_GRAVITY_Y * (FALL_GRAVITY_FACTOR - 1));
      } else if (Math.abs(vy) < APEX_VY_THRESHOLD) {
        body.setGravityY(WORLD_GRAVITY_Y * (APEX_GRAVITY_FACTOR - 1));
      } else {
        body.setGravityY(0);
      }
    }

    // Landing resets air jump and wall jump counters, and refreshes coyote window
    if (onGround) {
      this.coyoteTimer        = 120;
      this.airJumpsRemaining  = this.maxAirJumps;
      this.wallJumpsRemaining = this.wallJumpEnabled ? 1 : 0;
      // Cancel any active dive burst — diveActive only decrements inside the !onGround
      // block so it would otherwise freeze on landing, re-triggering dive on the next jump.
      if (this.diveActive > 0) {
        this.diveActive = 0;
        body.setMaxVelocityY(PLAYER_MAX_FALL_SPEED);
      }
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - delta);
    }

    // Horizontal movement — either scheme (skipped during active dash)
    const keyboardLeft  = this.leftKeys.some(k => k.isDown);
    const keyboardRight = this.rightKeys.some(k => k.isDown);
    this.dashActive = Math.max(0, this.dashActive - delta);

    const moveSpeed = this.placementMode ? PLACEMENT_MOVE_SPEED : PLAYER_SPEED;

    if (this.dashActive === 0) {
      if (this.inSlopeZone && !keyboardLeft && !keyboardRight && im.tiltFactor === 0) {
        // Eject outward along the wall surface until the player slides off the edge
        this.sprite.setVelocityX(this.slopeEjectDir * moveSpeed);
        this.momentumX = 0;
      } else if (onGround || this.inSlopeZone) {
        // Ground (or slope zone with active input): direct velocity control (unchanged feel)
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

    // Terrain stick: keep player pressed into surface so they don't float between
    // slab colliders on slopes (4px slab spacing, gravity alone takes ~6 frames to close the gap).
    // Skip when already moving upward — snapPlayerToSurface can leave a small slab overlap
    // that keeps blocked.down=true one frame after a jump, which would cancel the jump velocity.
    if (body.blocked.down && !this.inSlopeZone && body.velocity.y >= 0 && body.velocity.y < TERRAIN_STICK_SPEED) {
      this.sprite.setVelocityY(TERRAIN_STICK_SPEED);
    }

    // Dash — horizontal burst with cooldown; direction from pressed keys or swipe
    if (this.dashEnabled) {
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

    // Jump — buffered input (set at top of update) lets presses up to JUMP_BUFFER_MS
    // before a valid jump opportunity still fire. Suppressed during item placement.
    const jumpPressed    = !this.placementMode && this.jumpBufferTimer > 0;
    const canGroundJump  = this.coyoteTimer > 0;
    let jumpFired        = false;
    if (jumpPressed) {
      const onWallForJump = this.wallJumpEnabled && (body.blocked.left || body.blocked.right);
      if (canGroundJump) {
        this.momentumX = this.bufferedJumpVx !== 0 ? this.bufferedJumpVx : body.velocity.x;
        this.sprite.setVelocityX(this.momentumX);
        this.sprite.setVelocityY(PLAYER_JUMP_VELOCITY - this.jumpBoost);
        this.coyoteTimer = 0; // consume coyote window so it can't be reused
        AudioManager.play('player-jump');
        this._justJumped = true;
        jumpFired = true;
      } else if (!onWallForJump && this.airJumpsRemaining > 0) {
        this.momentumX = this.bufferedJumpVx !== 0 ? this.bufferedJumpVx : body.velocity.x;
        this.sprite.setVelocityX(this.momentumX);
        this.sprite.setVelocityY(PLAYER_JUMP_VELOCITY - this.jumpBoost);
        this.airJumpsRemaining--;
        AudioManager.play('player-jump');
        this._justAirJumped = true;
        jumpFired = true;
      }
    }

    // Wall jump — jump off a wall surface (only when airborne, one charge per landing)
    if (this.wallJumpEnabled && !onGround && jumpPressed && this.wallJumpsRemaining > 0) {
      if (onWall) {
        const dir = body.blocked.left ? 1 : -1; // jump away from wall
        this.momentumX = dir * PLAYER_SPEED * 1.5;
        this.sprite.setVelocityX(this.momentumX);
        this.sprite.setVelocityY(PLAYER_JUMP_VELOCITY - this.jumpBoost);
        this.wallJumpsRemaining--;
        AudioManager.play('player-jump');
        this._justWallJumped = true;
        jumpFired = true;
      }
    }

    // Consume the buffer once any jump path fires this frame
    if (jumpFired) {
      this.jumpBufferTimer = 0;
      this.bufferedJumpVx  = 0;
    }

    // Wall slide — cap downward velocity when touching a wall while falling
    if (!onGround && onWall && body.velocity.y > WALL_SLIDE_SPEED) {
      this.sprite.setVelocityY(WALL_SLIDE_SPEED);
      this.momentumX = 0;
    }

    // Dive — slam downward while airborne; release to return to normal fall speed
    if (this.diveEnabled && !onGround) {
      const holdingDown = this.downKeys.some(k => k.isDown);
      this.diveActive = Math.max(0, this.diveActive - delta);

      if (im.diveJustFired && !holdingDown) {
        // Mobile: swipe-down fires a sustained burst
        this.diveActive = DASH_DURATION_MS; // reuse same ~200ms window
      }

      if (holdingDown || this.diveActive > 0) {
        body.setMaxVelocityY(PLAYER_DIVE_SPEED);
        this.sprite.setVelocityY(PLAYER_DIVE_SPEED);
      } else {
        body.setMaxVelocityY(PLAYER_MAX_FALL_SPEED);
        if (body.velocity.y > PLAYER_MAX_FALL_SPEED) {
          this.sprite.setVelocityY(PLAYER_MAX_FALL_SPEED);
        }
      }
    }

    // X wrap — extended sky pad on each side, lands inset from the far edge
    this.wrapDir = 0;
    if (this.sprite.x < -SKY_PAD * this.worldWidth) {
      this.sprite.x = (1 - SKY_INSET) * this.worldWidth;
      this.wrapDir = -1; // wrapped left→right, player exits right edge of camera
    } else if (this.sprite.x > (1 + SKY_PAD) * this.worldWidth) {
      this.sprite.x = SKY_INSET * this.worldWidth;
      this.wrapDir = 1;  // wrapped right→left, player exits left edge of camera
    }

    // Reset per-frame flags set by the wall-group collision callback (physics runs before update)
    this.inSlopeZone    = false;
    this.slopeEjectDir  = 0;

    // Y clamp — prevent falling through the world floor; treat floor as ground
    if (this.sprite.y >= floorY) {
      this.sprite.y = floorY;
      if (this.sprite.body.velocity.y >= 0) {
        // Only cancel downward/stationary velocity — don't cancel a jump (velocity < 0)
        this.sprite.setVelocityY(0);
        this.airJumpsRemaining  = this.maxAirJumps;
        this.wallJumpsRemaining = this.wallJumpEnabled ? 1 : 0;
      }
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

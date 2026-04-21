import Phaser from 'phaser';
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
} from '../constants';
import { PlayerConfig } from '../systems/SaveData';
import { InputManager } from '../systems/InputManager';

const { KeyCodes } = Phaser.Input.Keyboard;

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
  private coyoteTimer:        number = 0; // ms remaining of coyote-time grace

  /** Set by GameScene's wall-group collision callback each frame. When true the
   *  player is resting on a steep wall surface and should be ejected outward. */
  public inSlopeZone = false;
  /** Direction to eject when inSlopeZone: -1 = left (off left wall), 1 = right (off right wall). */
  public slopeEjectDir: number = 0;

  /** Override in scenes that use a wider world (e.g. InfiniteGameScene). */
  public worldWidth: number = WORLD_WIDTH;

  private shieldActive: boolean = false;
  private shieldAura?: Phaser.GameObjects.Arc;
  private readonly syncAura = (): void => {
    this.shieldAura?.setPosition(this.sprite.x, this.sprite.y);
  };
  private onLadder: boolean = false;
  private controlsEnabled = true;

  // ── HUD accessors ──────────────────────────────────────────────────────────
  get dashCooldownFraction(): number  { return this.dashCooldown / DASH_COOLDOWN_MS; }
  get airJumpsLeft():         number  { return this.airJumpsRemaining; }
  get maxAirJumpsCount():     number  { return this.maxAirJumps; }
  get wallJumpsLeft():        number  { return this.wallJumpsRemaining; }
  get hasWallJump():          boolean { return this.wallJumpEnabled; }
  get hasDash():              boolean { return this.dashEnabled; }
  get hasActiveShield():      boolean { return this.shieldActive; }

  constructor(scene: Phaser.Scene, x: number, y: number, config: PlayerConfig) {
    this.sprite = scene.physics.add.sprite(x, y, 'trashbag');
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
    // Ladder climbing mode — vertical movement only, gravity off, jump suppressed
    if (this.onLadder) {
      const im = InputManager.getInstance();
      // Left/right exits the ladder
      const goLeft  = this.leftKeys.some(k => k.isDown)  || im.goLeft;
      const goRight = this.rightKeys.some(k => k.isDown) || im.goRight;
      if (goLeft || goRight) {
        this.exitLadder();
        // fall through to normal physics this frame
      } else {
        const goUp   = this.jumpKeys.some(k => k.isDown)  || im.jumpJustPressed;
        const goDown = this.downKeys.some(k => k.isDown);
        this.sprite.setVelocityX(0);
        this.sprite.setVelocityY(goUp ? -PLAYER_SPEED * 0.65 : goDown ? PLAYER_SPEED * 0.65 : 0);
        // Ladder counts as grounded: keep jump charges full and coyote window fresh
        this.airJumpsRemaining  = this.maxAirJumps;
        this.wallJumpsRemaining = this.wallJumpEnabled ? 1 : 0;
        this.coyoteTimer        = 120;
        // Still allow X-wrap so player doesn't get stuck at world edge on ladder
        if (this.sprite.x < 0)                  this.sprite.x = this.worldWidth;
        else if (this.sprite.x > this.worldWidth) this.sprite.x = 0;
        return; // skip all normal physics this frame
      }
    }

    if (!this.controlsEnabled) return;

    const body     = this.sprite.body;
    const floorY   = MOCK_HEAP_HEIGHT_PX - PLAYER_HEIGHT / 2;
    const onWall   = body.blocked.left || body.blocked.right;
    // Filter spurious blocked.down from wall bodies: while sliding (velocity.y > 10)
    // and touching a wall, a wall-face body can register as ground — ignore it.
    const onGround = (body.blocked.down && !this.inSlopeZone && !(onWall && body.velocity.y > 10))
                   || this.sprite.y >= floorY;

    // Landing resets air jump and wall jump counters, and refreshes coyote window
    if (onGround) {
      this.coyoteTimer        = 120;
      this.airJumpsRemaining  = this.maxAirJumps;
      this.wallJumpsRemaining = this.wallJumpEnabled ? 1 : 0;
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - delta);
    }

    // Horizontal movement — either scheme (skipped during active dash)
    const im = InputManager.getInstance();
    const goLeft  = this.leftKeys.some(k => k.isDown)  || im.goLeft;
    const goRight = this.rightKeys.some(k => k.isDown) || im.goRight;
    this.dashActive = Math.max(0, this.dashActive - delta);
    if (this.dashActive === 0) {
      if (this.inSlopeZone && !goLeft && !goRight) {
        // Eject outward along the wall surface until the player slides off the edge
        this.sprite.setVelocityX(this.slopeEjectDir * PLAYER_SPEED);
      } else if (goLeft) {
        this.sprite.setVelocityX(-PLAYER_SPEED);
        this.sprite.setFlipX(true);
      } else if (goRight) {
        this.sprite.setVelocityX(PLAYER_SPEED);
        this.sprite.setFlipX(false);
      } else {
        this.sprite.setVelocityX(0);
      }
    }

    // Dash — horizontal burst with cooldown; direction from pressed keys or swipe
    if (this.dashEnabled) {
      this.dashCooldown = Math.max(0, this.dashCooldown - delta);
      const dashTriggered = Phaser.Input.Keyboard.JustDown(this.dashKey) || im.dashJustFired;
      if (dashTriggered && this.dashCooldown === 0) {
        const dir = im.dashJustFired ? im.dashDir : (goLeft ? -1 : goRight ? 1 : (this.sprite.flipX ? -1 : 1));
        this.sprite.setVelocityX(dir * PLAYER_DASH_VELOCITY);
        this.dashCooldown = DASH_COOLDOWN_MS;
        this.dashActive   = DASH_DURATION_MS;
      }
    }

    // Jump — JustDown prevents hold-spam
    const jumpPressed    = this.jumpKeys.some(k => Phaser.Input.Keyboard.JustDown(k)) || im.jumpJustPressed;
    const canGroundJump  = this.coyoteTimer > 0;
    if (jumpPressed) {
      const onWallForJump = this.wallJumpEnabled && (body.blocked.left || body.blocked.right);
      if (canGroundJump) {
        this.sprite.setVelocityY(PLAYER_JUMP_VELOCITY - this.jumpBoost);
        this.coyoteTimer = 0; // consume coyote window so it can't be reused
      } else if (!onWallForJump && this.airJumpsRemaining > 0) {
        this.sprite.setVelocityY(PLAYER_JUMP_VELOCITY - this.jumpBoost);
        this.airJumpsRemaining--;
      }
    }

    // Wall jump — jump off a wall surface (only when airborne, one charge per landing)
    if (this.wallJumpEnabled && !onGround && jumpPressed && this.wallJumpsRemaining > 0) {
      if (onWall) {
        const dir = body.blocked.left ? 1 : -1; // jump away from wall
        this.sprite.setVelocityX(dir * PLAYER_SPEED * 1.5);
        this.sprite.setVelocityY(PLAYER_JUMP_VELOCITY - this.jumpBoost);
        this.wallJumpsRemaining--;
      }
    }

    // Wall slide — cap downward velocity when touching a wall while falling
    if (!onGround && onWall && body.velocity.y > WALL_SLIDE_SPEED) {
      this.sprite.setVelocityY(WALL_SLIDE_SPEED);
    }

    // Dive — slam downward while airborne; release to return to normal fall speed
    if (this.diveEnabled && !onGround) {
      if (this.downKeys.some(k => k.isDown)) {
        body.setMaxVelocityY(PLAYER_DIVE_SPEED);
        this.sprite.setVelocityY(PLAYER_DIVE_SPEED);
      } else {
        body.setMaxVelocityY(PLAYER_MAX_FALL_SPEED);
        if (body.velocity.y > PLAYER_MAX_FALL_SPEED) {
          this.sprite.setVelocityY(PLAYER_MAX_FALL_SPEED);
        }
      }
    }

    // X wrap — seamless edge-to-edge teleport
    if (this.sprite.x < 0) {
      this.sprite.x = this.worldWidth;
    } else if (this.sprite.x > this.worldWidth) {
      this.sprite.x = 0;
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

  freeze(): void {
    if (this.onLadder) this.exitLadder(); // clears onLadder flag; gravity re-enable is overridden below
    this.setControlsEnabled(false);
    this.sprite.setVelocity(0, 0);
    this.sprite.body.setAllowGravity(false);
  }
}

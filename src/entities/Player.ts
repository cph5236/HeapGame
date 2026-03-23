import Phaser from 'phaser';
import {
  PLAYER_SPEED,
  PLAYER_JUMP_VELOCITY,
  PLAYER_HEIGHT,
  WORLD_WIDTH,
  MOCK_HEAP_HEIGHT_PX,
  PLAYER_DASH_VELOCITY,
  DASH_COOLDOWN_MS,
  DASH_DURATION_MS,
  PLAYER_MAX_FALL_SPEED,
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
  private readonly dashKey:          Phaser.Input.Keyboard.Key;

  private readonly maxAirJumps:      number;
  private readonly wallJumpEnabled:  boolean;
  private readonly dashEnabled:      boolean;

  private airJumpsRemaining:  number = 0;
  private wallJumpsRemaining: number = 0;
  private dashCooldown:       number = 0; // ms remaining
  private dashActive:         number = 0; // ms remaining of active dash

  // ── HUD accessors ──────────────────────────────────────────────────────────
  get dashCooldownFraction(): number  { return this.dashCooldown / DASH_COOLDOWN_MS; }
  get airJumpsLeft():         number  { return this.airJumpsRemaining; }
  get maxAirJumpsCount():     number  { return this.maxAirJumps; }
  get wallJumpsLeft():        number  { return this.wallJumpsRemaining; }
  get hasWallJump():          boolean { return this.wallJumpEnabled; }
  get hasDash():              boolean { return this.dashEnabled; }

  constructor(scene: Phaser.Scene, x: number, y: number, config: PlayerConfig) {
    this.sprite = scene.physics.add.sprite(x, y, 'player');
    // World bounds handled manually (X wrap + Y clamp) — do NOT setCollideWorldBounds
    this.sprite.body.setMaxVelocityY(PLAYER_MAX_FALL_SPEED);
    this.sprite.setDepth(10);

    this.maxAirJumps        = config.maxAirJumps;
    this.wallJumpEnabled    = config.wallJump;
    this.dashEnabled        = config.dash;
    this.airJumpsRemaining  = this.maxAirJumps;
    this.wallJumpsRemaining = this.wallJumpEnabled ? 1 : 0;

    const kb = scene.input.keyboard!;
    this.leftKeys  = [kb.addKey(KeyCodes.LEFT),  kb.addKey(KeyCodes.A)];
    this.rightKeys = [kb.addKey(KeyCodes.RIGHT), kb.addKey(KeyCodes.D)];
    this.jumpKeys  = [kb.addKey(KeyCodes.UP),    kb.addKey(KeyCodes.W)];
    this.dashKey   = kb.addKey(KeyCodes.SHIFT);
  }

  update(delta: number): void {
    const body     = this.sprite.body;
    const onGround = body.blocked.down;

    // Landing resets air jump and wall jump counters
    if (onGround) {
      this.airJumpsRemaining  = this.maxAirJumps;
      this.wallJumpsRemaining = this.wallJumpEnabled ? 1 : 0;
    }

    // Horizontal movement — either scheme (skipped during active dash)
    const im = InputManager.getInstance();
    const goLeft  = this.leftKeys.some(k => k.isDown)  || im.goLeft;
    const goRight = this.rightKeys.some(k => k.isDown) || im.goRight;
    this.dashActive = Math.max(0, this.dashActive - delta);
    if (this.dashActive === 0) {
      if (goLeft) {
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
    const jumpPressed = this.jumpKeys.some(k => Phaser.Input.Keyboard.JustDown(k)) || im.jumpJustPressed;
    if (jumpPressed) {
      const onWallForJump = this.wallJumpEnabled && (body.blocked.left || body.blocked.right);
      if (onGround) {
        this.sprite.setVelocityY(PLAYER_JUMP_VELOCITY);
      } else if (!onWallForJump && this.airJumpsRemaining > 0) {
        this.sprite.setVelocityY(PLAYER_JUMP_VELOCITY);
        this.airJumpsRemaining--;
      }
    }

    // Wall jump — jump off a wall surface (only when airborne, one charge per landing)
    if (this.wallJumpEnabled && !onGround && jumpPressed && this.wallJumpsRemaining > 0) {
      const onWall = body.blocked.left || body.blocked.right;
      if (onWall) {
        const dir = body.blocked.left ? 1 : -1; // jump away from wall
        this.sprite.setVelocityX(dir * PLAYER_SPEED * 1.5);
        this.sprite.setVelocityY(PLAYER_JUMP_VELOCITY);
        this.wallJumpsRemaining--;
      }
    }

    // Wall slide — cap downward velocity when touching a wall while falling
    const onWall = body.blocked.left || body.blocked.right;
    if (!onGround && onWall && body.velocity.y > WALL_SLIDE_SPEED) {
      this.sprite.setVelocityY(WALL_SLIDE_SPEED);
    }

    // X wrap — seamless edge-to-edge teleport
    if (this.sprite.x < 0) {
      this.sprite.x = WORLD_WIDTH;
    } else if (this.sprite.x > WORLD_WIDTH) {
      this.sprite.x = 0;
    }

    // Y clamp — prevent falling through the world floor; treat floor as ground
    const floorY = MOCK_HEAP_HEIGHT_PX - PLAYER_HEIGHT / 2;
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
}

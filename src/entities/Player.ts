import Phaser from 'phaser';
import {
  PLAYER_SPEED,
  PLAYER_JUMP_VELOCITY,
  PLAYER_HEIGHT,
  WORLD_WIDTH,
  MOCK_HEAP_HEIGHT_PX,
  PLAYER_DASH_VELOCITY,
  DASH_COOLDOWN_MS,
  PLAYER_MAX_FALL_SPEED,
  WALL_SLIDE_SPEED,
} from '../constants';
import { PlayerConfig } from '../systems/SaveData';

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

  private airJumpsRemaining: number = 0;
  private dashCooldown:      number = 0; // ms remaining

  constructor(scene: Phaser.Scene, x: number, y: number, config: PlayerConfig) {
    this.sprite = scene.physics.add.sprite(x, y, 'player');
    // World bounds handled manually (X wrap + Y clamp) — do NOT setCollideWorldBounds
    this.sprite.body.setMaxVelocityY(PLAYER_MAX_FALL_SPEED);
    this.sprite.setDepth(10);

    this.maxAirJumps     = config.maxAirJumps;
    this.wallJumpEnabled = config.wallJump;
    this.dashEnabled     = config.dash;
    this.airJumpsRemaining = this.maxAirJumps;

    const kb = scene.input.keyboard!;
    this.leftKeys  = [kb.addKey(KeyCodes.LEFT),  kb.addKey(KeyCodes.A)];
    this.rightKeys = [kb.addKey(KeyCodes.RIGHT), kb.addKey(KeyCodes.D)];
    this.jumpKeys  = [kb.addKey(KeyCodes.UP),    kb.addKey(KeyCodes.W)];
    this.dashKey   = kb.addKey(KeyCodes.SHIFT);
  }

  update(delta: number): void {
    const body     = this.sprite.body;
    const onGround = body.blocked.down;

    // Landing resets the air jump counter
    if (onGround) this.airJumpsRemaining = this.maxAirJumps;

    // Horizontal movement — either scheme
    const goLeft  = this.leftKeys.some(k => k.isDown);
    const goRight = this.rightKeys.some(k => k.isDown);
    if (goLeft) {
      this.sprite.setVelocityX(-PLAYER_SPEED);
      this.sprite.setFlipX(true);
    } else if (goRight) {
      this.sprite.setVelocityX(PLAYER_SPEED);
      this.sprite.setFlipX(false);
    } else {
      this.sprite.setVelocityX(0);
    }

    // Dash — horizontal burst with cooldown
    if (this.dashEnabled) {
      this.dashCooldown = Math.max(0, this.dashCooldown - delta);
      if (Phaser.Input.Keyboard.JustDown(this.dashKey) && this.dashCooldown === 0) {
        const dir = this.sprite.flipX ? -1 : 1;
        this.sprite.setVelocityX(dir * PLAYER_DASH_VELOCITY);
        this.dashCooldown = DASH_COOLDOWN_MS;
      }
    }

    // Jump — JustDown prevents hold-spam
    const jumpPressed = this.jumpKeys.some(k => Phaser.Input.Keyboard.JustDown(k));
    if (jumpPressed) {
      if (onGround) {
        this.sprite.setVelocityY(PLAYER_JUMP_VELOCITY);
      } else if (this.airJumpsRemaining > 0) {
        this.sprite.setVelocityY(PLAYER_JUMP_VELOCITY);
        this.airJumpsRemaining--;
      }
    }

    // Wall jump — jump off a wall surface (only when airborne)
    if (this.wallJumpEnabled && !onGround && jumpPressed) {
      const onWall = body.blocked.left || body.blocked.right;
      if (onWall) {
        const dir = body.blocked.left ? 1 : -1; // jump away from wall
        this.sprite.setVelocityX(dir * PLAYER_SPEED * 1.5);
        this.sprite.setVelocityY(PLAYER_JUMP_VELOCITY);
        this.airJumpsRemaining = this.maxAirJumps; // wall jump resets air jumps
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
        this.airJumpsRemaining = this.maxAirJumps;
      }
    }
  }
}

// src/systems/TrashWallManager.ts
import type { TrashWallDef } from '../data/trashWallDef';
import { OBJECT_DEF_LIST } from '../data/heapObjectDefs';
import { WORLD_WIDTH, MOCK_HEAP_HEIGHT_PX } from '../constants';
import Phaser from 'phaser';

// ── Pure math — exported for unit testing ─────────────────────────────────────

/**
 * Interpolates wall speed between speedMin (at world floor) and speedMax (at yForMaxSpeed).
 * As wallY decreases (wall climbs higher), speed increases toward speedMax.
 */
export function computeWallSpeed(
  wallY: number,
  speedMin: number,
  speedMax: number,
  yForMaxSpeed: number,
  worldHeight: number,
): number {
  const t = Math.min(1, Math.max(0, (wallY - yForMaxSpeed) / (worldHeight - yForMaxSpeed)));
  return speedMax - t * (speedMax - speedMin);
}

/**
 * Clamps wallY so it can never lag more than maxLaggingDistance below playerY.
 * In Phaser coords Y increases downward, so "below" = larger Y.
 */
export function clampWallY(wallY: number, playerY: number, maxLaggingDistance: number): number {
  return Math.min(wallY, playerY + maxLaggingDistance);
}

/**
 * Returns true when the player has entered the lethal band at the wall's top edge.
 */
export function isKillZoneReached(playerY: number, wallY: number, killZoneHeight: number): boolean {
  return playerY >= wallY - killZoneHeight;
}

// ── Runtime types ─────────────────────────────────────────────────────────────

/** Phaser Image with undulation state attached. */
interface UndulateImage extends Phaser.GameObjects.Image {
  _phase:  number; // random phase offset (radians)
  _scalar: number; // random amplitude multiplier [0.5, 1.0]
}

const SPRITE_KEYS = OBJECT_DEF_LIST.map(d => d.textureKey);

// ── TrashWallManager ──────────────────────────────────────────────────────────

export class TrashWallManager {
  /** True when wall is within def.warningDistance of the player. Read by GameScene (future audio). */
  isWarning = false;

  private wallY    = 0;
  private spawned  = false;
  private killed   = false;

  private readonly body:        Phaser.GameObjects.Graphics;
  private readonly trashSprites: UndulateImage[] = [];

  constructor(
    private readonly scene:   Phaser.Scene,
    private readonly def:     TrashWallDef,
    private readonly onKill:  () => void,
  ) {
    this.body = scene.add.graphics();
    this.body.setDepth(5);
  }

  /**
   * Call once from GameScene.create(), after the player's final position is resolved
   * (including checkpoint repositioning). Spawns wall below the player and builds the sprite pool.
   */
  spawn(playerY: number): void {
    this.wallY  = playerY + this.def.spawnBelowPlayerDistance;
    this.spawned = true;
    this._buildSpritePool();
    this._redraw(0);
  }

  /**
   * Call every frame from GameScene.update() with the player's current world Y and the frame delta (ms).
   * Moves the wall upward, enforces the max-lag clamp, checks kill zone, redraws.
   */
  update(playerY: number, delta: number): void {
    if (!this.spawned || this.killed) return;

    const speed = computeWallSpeed(
      this.wallY, this.def.speedMin, this.def.speedMax,
      this.def.yForMaxSpeed, MOCK_HEAP_HEIGHT_PX,
    );
    this.wallY -= speed * (delta / 1000); // move up (Y decreases)
    this.wallY  = clampWallY(this.wallY, playerY, this.def.maxLaggingDistance);

    this.isWarning = playerY > this.wallY - this.def.warningDistance;

    if (isKillZoneReached(playerY, this.wallY, this.def.killZoneHeight)) {
      this.killed = true;
      this.onKill();
      return; // skip redraw after kill
    }

    const time = this.scene.time.now / 1000; // seconds
    this._redraw(time);
  }

  destroy(): void {
    this.body.destroy();
    this.trashSprites.forEach(s => s.destroy());
    this.trashSprites.length = 0;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /** Creates a fixed pool of Image objects spread evenly along the wall's top edge. */
  private _buildSpritePool(): void {
    const count = this.def.undulateCount;
    const slotW = WORLD_WIDTH / count;
    for (let i = 0; i < count; i++) {
      const key = SPRITE_KEYS[i % SPRITE_KEYS.length];
      const img  = this.scene.add.image(
        slotW * i + slotW / 2,
        this.wallY,
        key,
      ) as UndulateImage;
      img.setDepth(6);
      img.setDisplaySize(52, 52);
      img._phase  = Math.random() * Math.PI * 2;
      img._scalar = 0.5 + Math.random() * 0.5;
      this.trashSprites.push(img);
    }
  }

  /**
   * Redraws the solid wall body and repositions undulating trash sprites.
   * @param time - scene time in seconds (used for sine oscillation)
   */
  private _redraw(time: number): void {
    // Body: dark brown rectangle from wallY downward, spanning full world width
    this.body.clear();
    this.body.fillStyle(0x3B1F0A, 1);
    this.body.fillRect(0, this.wallY, WORLD_WIDTH, MOCK_HEAP_HEIGHT_PX);

    // Trash sprites undulate above the wall surface
    for (const img of this.trashSprites) {
      img.y = this.wallY
        - this.def.undulateAmplitude
        * img._scalar
        * Math.sin(time * this.def.undulateSpeed * Math.PI * 2 + img._phase);
    }
  }
}

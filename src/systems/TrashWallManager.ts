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

/** Phaser Image with per-sprite oscillation state. */
interface OscImage extends Phaser.GameObjects.Image {
  _phase:  number; // current oscillation phase [0, 2π)
  _speed:  number; // rad/s phase advance rate (varies per sprite for async timing)
  _scalar: number; // amplitude multiplier [0.5, 1.0]
}

const SPRITE_KEYS = OBJECT_DEF_LIST.map(d => d.textureKey);

/**
 * px above wallY over which item alpha fades from 0 → 1 as it emerges.
 * Should be smaller than undulateAmplitude so items reach full opacity mid-rise.
 */
const EMERGE_FADE_PX = 10;

// ── TrashWallManager ──────────────────────────────────────────────────────────

export class TrashWallManager {
  /** True when wall is within def.warningDistance of the player. Read by GameScene (future audio). */
  isWarning = false;

  private wallY    = 0;
  private spawned  = false;
  private killed   = false;

  private readonly body:            Phaser.GameObjects.Graphics;
  private readonly gradientOverlay: Phaser.GameObjects.Graphics;
  private readonly trashSprites:    OscImage[] = [];

  constructor(
    private readonly scene:      Phaser.Scene,
    private readonly def:        TrashWallDef,
    private readonly onKill:     () => void,
    private readonly worldWidth: number = WORLD_WIDTH,
    private readonly worldHeight: number = MOCK_HEAP_HEIGHT_PX,
  ) {
    this.body = scene.add.graphics();
    this.body.setDepth(5);
    // Depth 7 — in front of items (2), heap tiles (3-4), and wall body (5)
    // Covers only the narrow emergence zone above wallY
    this.gradientOverlay = scene.add.graphics();
    this.gradientOverlay.setDepth(7);
  }

  /**
   * Call once from GameScene.create(), after the player's final position is resolved
   * (including checkpoint repositioning). Spawns wall below the player and builds the sprite pool.
   */
  spawn(playerY: number): void {
    if (this.spawned) return;
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
      this.def.yForMaxSpeed, this.worldHeight,
    );
    this.wallY -= speed * (delta / 1000); // move up (Y decreases)
    this.wallY  = clampWallY(this.wallY, playerY, this.def.maxLaggingDistance);

    this.isWarning = playerY > this.wallY - this.def.warningDistance;

    if (isKillZoneReached(playerY, this.wallY, this.def.killZoneHeight)) {
      this.killed = true;
      this.onKill();
      return; // skip redraw after kill
    }

    this._redraw(delta);
  }

  destroy(): void {
    this.body.destroy();
    this.gradientOverlay.destroy();
    this.trashSprites.forEach(s => s.destroy());
    this.trashSprites.length = 0;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /**
   * Creates a fixed pool of OscImages with randomised phases so items don't
   * all emerge from the wall at the same time.
   */
  private _buildSpritePool(): void {
    const count = this.def.undulateCount;
    const slotW = this.worldWidth / count;
    for (let i = 0; i < count; i++) {
      const key = SPRITE_KEYS[Math.floor(Math.random() * SPRITE_KEYS.length)];
      const img = this.scene.add.image(
        slotW * i + slotW / 2 + (Math.random() - 0.5) * slotW * 0.5,
        this.wallY,
        key,
      ) as OscImage;
      // Depth 2: behind heap tiles (3-4) and wall body (5)
      // Items above wallY are naturally visible in open sky; items below wallY are
      // hidden by the wall body which renders on top at depth 5.
      img.setDepth(2);
      img.setDisplaySize(52, 52);
      img._phase  = Math.random() * Math.PI * 2; // random start so items are desynchronised
      // Speed variation ±30% so cycles don't align across sprites
      img._speed  = this.def.undulateSpeed * Math.PI * 2 * (0.7 + Math.random() * 0.6);
      img._scalar = 0.5 + Math.random() * 0.5;
      this.trashSprites.push(img);
    }
  }

  /**
   * Redraws the wall body + gradient overlay, and advances each sprite's oscillation.
   * @param delta - frame time in ms (0 on initial spawn draw)
   */
  private _redraw(delta: number): void {
    // Body: solid dark-brown fill from wallY downward — covers items (depth 2) below the surface
    this.body.clear();
    this.body.fillStyle(0x3B1F0A, 1);
    this.body.fillRect(0, this.wallY, this.worldWidth, this.worldHeight - this.wallY);

    for (const img of this.trashSprites) {
      // Advance phase; swap texture at the start of each new cycle
      img._phase += img._speed * (delta / 1000);
      if (img._phase >= Math.PI * 2) {
        img._phase -= Math.PI * 2;
        img.setTexture(SPRITE_KEYS[Math.floor(Math.random() * SPRITE_KEYS.length)]);
      }

      // Sine oscillation: positive half-cycle → above wallY (emerging); negative → inside wall
      const amplitude = this.def.undulateAmplitude * img._scalar;
      img.y = this.wallY - amplitude * Math.sin(img._phase);

      // Alpha fade: 0 at the surface (wallY), ramps to 1 over EMERGE_FADE_PX
      // Items below wallY get alpha 0 but are already hidden by the wall body anyway
      const distAbove = this.wallY - img.y;
      img.setAlpha(Math.min(1, Math.max(0, distAbove / EMERGE_FADE_PX)));
    }

    // Gradient overlay at depth 7: brownish stepped fade above wallY masks the exact
    // emergence point so items don't hard-pop into view at the wall's top edge.
    const gradH = 40;
    const steps = 10;
    const stepH = gradH / steps;
    this.gradientOverlay.clear();
    for (let i = 0; i < steps; i++) {
      const t     = (steps - i) / steps; // 1 at bottom (wallY), ~0 at top
      const alpha = t * t * t;            // cubic — fully opaque at surface, rapid falloff above
      this.gradientOverlay.fillStyle(0x3B1F0A, alpha); 
      this.gradientOverlay.fillRect(0, this.wallY - (i + 1) * stepH, this.worldWidth, stepH + 1);
    }
  }
}

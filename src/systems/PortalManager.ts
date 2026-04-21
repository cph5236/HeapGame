import Phaser from 'phaser';
import type { Player } from '../entities/Player';
import type { PortalDef } from '../data/portalDefs';
import type { ScanlineRow } from './HeapPolygon';
import { RECYCLE_ITEM_COUNT } from '../constants';

/**
 * Scans `rows` (ordered top→bottom, ascending Y) to find the topmost row
 * containing `x`, then verifies `clearanceRequired` px of clear air above it.
 * Returns the surface Y, or null if no surface or clearance is blocked.
 */
export function findPortalSurface(
  rows: ScanlineRow[],
  x: number,
  clearanceRequired: number,
): number | null {
  const surfaceRow = rows.find(r => x >= r.leftX && x <= r.rightX);
  if (!surfaceRow) return null;
  const clearTop = surfaceRow.y - clearanceRequired;
  const hasObstruction = rows.some(
    r => r.y > clearTop && r.y < surfaceRow.y && x >= r.leftX && x <= r.rightX,
  );
  return hasObstruction ? null : surfaceRow.y;
}

/** Returns a random number in [range[0], range[1]]. Injectable rng for testing. */
export function randBetween(range: [number, number], rng: () => number = Math.random): number {
  return range[0] + rng() * (range[1] - range[0]);
}

interface PortalPair {
  aX: number; aY: number;
  bX: number; bY: number;
  aSprite:  Phaser.GameObjects.Image;
  bSprite:  Phaser.GameObjects.Image;
  aEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  bEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
}

export class PortalManager {
  private readonly pairs: PortalPair[] = [];
  private nextPortalY: number;
  private teleportCooldownUntil = 0;
  private readonly textureKeys: string[];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly player: Player,
    private readonly colBounds: [number, number][],
    private readonly def: PortalDef,
    private readonly onTeleport: (invincibilityMs: number) => void,
    private readonly findEligibleSurface: (colIdx: number, x: number, nearY: number) => number | null,
  ) {
    this.nextPortalY  = player.sprite.y - randBetween(def.spawnPortalEveryY);
    this.textureKeys  = Array.from({ length: RECYCLE_ITEM_COUNT }, (_, i) => `recycle-item-${i}`);
  }

  update(): void {
    const camBottom   = this.scene.cameras.main.worldView.bottom;
    const screenHeight = this.scene.scale.height;

    // Cull pairs where even the exit portal (smaller Y = higher up) is off-screen
    for (let i = this.pairs.length - 1; i >= 0; i--) {
      const p = this.pairs[i];
      // exit is always above entrance so min(aY,bY) = bY; cull when both are below camera
      if (Math.min(p.aY, p.bY) > camBottom + screenHeight) {
        p.aSprite.destroy(); p.bSprite.destroy();
        p.aEmitter.destroy(); p.bEmitter.destroy();
        this.pairs.splice(i, 1);
      }
    }

    // Spawn trigger — fires once per Y interval as player climbs
    if (this.player.sprite.y <= this.nextPortalY) {
      this.attemptSpawnPair(this.nextPortalY);
      this.nextPortalY -= randBetween(this.def.spawnPortalEveryY);
    }

    // Teleport overlap check
    if (this.scene.time.now < this.teleportCooldownUntil) return;

    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    const hw = this.def.width  / 2;
    const hh = this.def.height / 2;

    for (const pair of this.pairs) {
      if (Math.abs(px - pair.aX) < hw && Math.abs(py - pair.aY) < hh) {
        this.teleport(pair.bX, pair.bY);
        return;
      }
      if (Math.abs(px - pair.bX) < hw && Math.abs(py - pair.bY) < hh) {
        this.teleport(pair.aX, pair.aY);
        return;
      }
    }
  }

  private teleport(toX: number, toY: number): void {
    this.player.sprite.setPosition(toX, toY - 30);
    (this.player.sprite.body as Phaser.Physics.Arcade.Body).reset(toX, toY - 30);
    this.onTeleport(this.def.invincibilityMs);
    this.teleportCooldownUntil = this.scene.time.now + 1_000;
  }

  private attemptSpawnPair(entranceY: number): void {
    // Entrance — random column + X
    const aColIdx   = Math.floor(Math.random() * this.colBounds.length);
    const [aMin, aMax] = this.colBounds[aColIdx];
    const aX        = aMin + Math.random() * (aMax - aMin);
    const aSurfaceY = this.findEligibleSurface(aColIdx, aX, entranceY);
    if (aSurfaceY === null) return;

    // Exit — random column + X, portalRange px above entrance surface
    const exitNearY = aSurfaceY - randBetween(this.def.portalRange);
    const bColIdx   = Math.floor(Math.random() * this.colBounds.length);
    const [bMin, bMax] = this.colBounds[bColIdx];
    const bX        = bMin + Math.random() * (bMax - bMin);
    const bSurfaceY = this.findEligibleSurface(bColIdx, bX, exitNearY);
    if (bSurfaceY === null) return;

    this.createPair(aX, aSurfaceY, bX, bSurfaceY);
  }

  private createPair(aX: number, aY: number, bX: number, bY: number): void {
    const aSprite  = this.createPortalSprite(aX, aY);
    const bSprite  = this.createPortalSprite(bX, bY);
    const aEmitter = this.createSuctionEmitter(aX, aY);
    const bEmitter = this.createEjectionEmitter(bX, bY);
    this.pairs.push({ aX, aY, bX, bY, aSprite, bSprite, aEmitter, bEmitter });
  }

  private createPortalSprite(x: number, y: number): Phaser.GameObjects.Image {
    return this.scene.add.image(x, y, this.def.spriteKey)
      .setDisplaySize(this.def.width, this.def.height)
      .setAngle(45)
      .setOrigin(0.5, 1.0)
      .setDepth(10);
  }

  // Entrance: particles spawn in radius and move toward portal center (suction)
  private createSuctionEmitter(x: number, y: number): Phaser.GameObjects.Particles.ParticleEmitter {
    return this.scene.add.particles(x, y, this.textureKeys, {
      x:       { min: -60, max: 60 },
      y:       { min: -60, max: 60 },
      moveToX: x,
      moveToY: y,
      scale:   { start: 0.25, end: 0 },
      lifespan: 1200,
      quantity: 1,
      frequency: 200,
    }).setDepth(11);
  }

  // Exit: particles shoot outward at 315° (up-right, matching 45° trashcan rotation)
  private createEjectionEmitter(x: number, y: number): Phaser.GameObjects.Particles.ParticleEmitter {
    return this.scene.add.particles(x, y, this.textureKeys, {
      speed:    { min: 80, max: 160 },
      angle:    { min: 295, max: 335 },
      scale:    { start: 0.25, end: 0 },
      alpha:    { start: 1,    end: 0 },
      lifespan: 800,
      gravityY: 200,
      quantity: 3,
      frequency: 500,
    }).setDepth(11);
  }
}

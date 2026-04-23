import Phaser from 'phaser';
import type { Player } from '../entities/Player';
import type { PortalDef } from '../data/portalDefs';
import type { ScanlineRow, Vertex } from './HeapPolygon';
import { RECYCLE_ITEM_COUNT, CHUNK_BAND_HEIGHT } from '../constants';
import { isPointInsidePolygon } from './EnemyManager';

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

/**
 * Finds the topmost surface at `x` using polygon edges (non-clip edges only),
 * then verifies `clearanceRequired` px of clear air above it.
 * Clip edges at bandTopY and bandTopY+CHUNK_BAND_HEIGHT are skipped.
 * Returns surface Y, or null if no edge spans x or clearance is blocked.
 */
export function findPortalSurfaceFromPolygon(
  vertices: Vertex[],
  bandTopY: number,
  x: number,
  clearanceRequired: number,
): number | null {
  const bandBottomY = bandTopY + CHUNK_BAND_HEIGHT;
  const EPS = 0.5;

  const isClip = (v1: Vertex, v2: Vertex) =>
    (Math.abs(v1.y - bandTopY)    < EPS && Math.abs(v2.y - bandTopY)    < EPS) ||
    (Math.abs(v1.y - bandBottomY) < EPS && Math.abs(v2.y - bandBottomY) < EPS);

  const yAtX = (v1: Vertex, v2: Vertex): number | null => {
    if (x < Math.min(v1.x, v2.x) || x > Math.max(v1.x, v2.x)) return null;
    const dx = v2.x - v1.x;
    return Math.abs(dx) < 0.001 ? Math.min(v1.y, v2.y) : v1.y + (x - v1.x) / dx * (v2.y - v1.y);
  };

  let surfaceY: number | null = null;
  for (let i = 0; i < vertices.length; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % vertices.length];
    if (isClip(v1, v2)) continue;
    const ey = yAtX(v1, v2);
    if (ey !== null && (surfaceY === null || ey < surfaceY)) surfaceY = ey;
  }
  if (surfaceY === null) return null;

  const clearTop = surfaceY - clearanceRequired;
  for (let i = 0; i < vertices.length; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % vertices.length];
    if (isClip(v1, v2)) continue;
    const minY = Math.min(v1.y, v2.y);
    const maxY = Math.max(v1.y, v2.y);
    if (maxY <= clearTop || minY >= surfaceY) continue;
    const ey = yAtX(v1, v2);
    if (ey !== null && ey < surfaceY) return null;
  }

  return surfaceY;
}

interface PortalPair {
  aX: number; aY: number;
  bX: number; bY: number;
  aSprite:  Phaser.GameObjects.Image;
  bSprite:  Phaser.GameObjects.Image;
  aEmitters: Phaser.GameObjects.Particles.ParticleEmitter[];
  bEmitters: Phaser.GameObjects.Particles.ParticleEmitter[];
  aOpenX: number; aOpenY: number;
  bOpenX: number; bOpenY: number;
}

export class PortalManager {
  debug = false;

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
    private readonly getBandPolygon: (colIdx: number, bandTopY: number) => Vertex[] | undefined,
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
        p.aEmitters.forEach(e => e.destroy()); p.bEmitters.forEach(e => e.destroy());
        this.pairs.splice(i, 1);
      }
    }

    // Spawn trigger — fires once per Y interval as player climbs
    if (this.player.sprite.y <= this.nextPortalY) {
      if (this.debug) console.log(`[Portal] spawn trigger at playerY=${Math.round(this.player.sprite.y)} nextPortalY=${Math.round(this.nextPortalY)}`);
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
      if (Math.abs(px - pair.aOpenX) < hw && Math.abs(py - pair.aOpenY) < hh) {
        this.teleport(pair.bX, pair.bY);
        return;
      }
      if (Math.abs(px - pair.bOpenX) < hw && Math.abs(py - pair.bOpenY) < hh) {
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
    const aColIdx      = Math.floor(Math.random() * this.colBounds.length);
    const [aMin, aMax] = this.colBounds[aColIdx];
    const aX           = aMin + Math.random() * (aMax - aMin);
    const aAngle       = aX < (aMin + aMax) / 2 ? -45 : 45;
    const aSurfaceY    = this.findEligibleSurface(aColIdx, aX, entranceY);
    if (this.debug) console.log(`[Portal] entrance col=${aColIdx} x=${Math.round(aX)} nearY=${Math.round(entranceY)} → surfaceY=${aSurfaceY !== null ? Math.round(aSurfaceY) : 'null'}`);
    if (aSurfaceY === null) return;
    // Reject interior surfaces — point above surface must be outside the heap polygon
    const aBandTop = Math.floor(aSurfaceY / CHUNK_BAND_HEIGHT) * CHUNK_BAND_HEIGHT;
    const aPolygon = this.getBandPolygon(aColIdx, aBandTop);
    if (aPolygon && aPolygon.length > 0 && isPointInsidePolygon(aX, aSurfaceY - 1, aPolygon)) return;

    // Exit — random column + X, portalRange px above entrance surface
    const exitNearY    = aSurfaceY - randBetween(this.def.portalRange);
    const bColIdx      = Math.floor(Math.random() * this.colBounds.length);
    const [bMin, bMax] = this.colBounds[bColIdx];
    const bX           = bMin + Math.random() * (bMax - bMin);
    const bAngle       = bX < (bMin + bMax) / 2 ? -45 : 45;
    const bSurfaceY    = this.findEligibleSurface(bColIdx, bX, exitNearY);
    if (this.debug) console.log(`[Portal] exit    col=${bColIdx} x=${Math.round(bX)} nearY=${Math.round(exitNearY)} → surfaceY=${bSurfaceY !== null ? Math.round(bSurfaceY) : 'null'}`);
    if (bSurfaceY === null) return;
    // Reject interior surfaces — point above surface must be outside the heap polygon
    const bBandTop = Math.floor(bSurfaceY / CHUNK_BAND_HEIGHT) * CHUNK_BAND_HEIGHT;
    const bPolygon = this.getBandPolygon(bColIdx, bBandTop);
    if (bPolygon && bPolygon.length > 0 && isPointInsidePolygon(bX, bSurfaceY - 1, bPolygon)) return;

    if (this.debug) console.log(`[Portal] spawning pair entrance=(${Math.round(aX)},${Math.round(aSurfaceY)}) exit=(${Math.round(bX)},${Math.round(bSurfaceY)})`);
    this.createPair(aX, aSurfaceY, aAngle, bX, bSurfaceY, bAngle);
  }

  // Returns world position of the sprite's opening (top end after rotation).
  private openingPos(x: number, y: number, angleDeg: number): [number, number] {
    const rad = (angleDeg * Math.PI) / 180;
    const h   = this.def.height;
    return [x + h * Math.sin(rad), y - h * Math.cos(rad)];
  }

  private createPair(aX: number, aY: number, aAngle: number, bX: number, bY: number, bAngle: number): void {
    const [aoX, aoY] = this.openingPos(aX, aY, aAngle);
    const [boX, boY] = this.openingPos(bX, bY, bAngle);
    const aSprite    = this.createPortalSprite(aX, aY, 0x00ff88, aAngle);
    const bSprite    = this.createPortalSprite(bX, bY, 0xff4444, bAngle);

    // Create 5 emitters with different textures for variety
    const aEmitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
    const bEmitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
    for (let i = 0; i < 5; i++) {
      const tex = this.textureKeys[i % this.textureKeys.length];
      aEmitters.push(this.createSuctionEmitter(aoX, aoY, aAngle, tex));
      bEmitters.push(this.createEjectionEmitter(boX, boY, bAngle, tex));
    }

    this.pairs.push({ aX, aY, bX, bY, aSprite, bSprite, aEmitters, bEmitters, aOpenX: aoX, aOpenY: aoY, bOpenX: boX, bOpenY: boY });
  }

  private createPortalSprite(x: number, y: number, tint: number, angleDeg: number): Phaser.GameObjects.Image {
    return this.scene.add.image(x, y, this.def.spriteKey)
      .setDisplaySize(this.def.width, this.def.height)
      .setAngle(angleDeg)
      .setOrigin(0.5, 1.0)
      .setTint(tint)
      .setDepth(10);
  }

  // Entrance: particles spawn in radius around the opening and drift inward.
  // moveToX/Y are relative to the emitter — (0,0) = drift toward emitter center.
  private createSuctionEmitter(ox: number, oy: number, angleDeg: number, textureKey: string): Phaser.GameObjects.Particles.ParticleEmitter {
    const suckAreaX = angleDeg > 0
      ? { min: 30, max: 150 }   // down-left (+45° portal)
      : { min: -150, max: -30 };  // down-right  (-45° portal)
      const suckAreaY = angleDeg > 0
      ? { min: 15, max: 50 }   // down-left (+45° portal)
      : { min: 15, max: 50 };  // down-right  (-45° portal)
    return this.scene.add.particles(ox, oy, textureKey, {
      x:    suckAreaX,                   // px from emitter: where particles start horizontally
      y:    suckAreaY,       // px from emitter: where particles start vertically
      gravityY: 0,                        // px/s²: slight upward drift to counteract fall
      moveToX:  0,                      // relative target: 0,0 = emitter center
      moveToY:  0,
      scale:    { start: 0.4, end: 0 }, // start size (0=invisible, 1=full sprite size)
      lifespan: 2000,                   // ms to reach center: longer = slower drift
      quantity:  2,                     // particles per burst
      frequency: 500,                   // ms between bursts: bigger = fewer particles
    }).setDepth(11);
  }

  // Exit: particles shoot outward from the opening; direction mirrors the sprite angle.
  private createEjectionEmitter(ox: number, oy: number, angleDeg: number, textureKey: string): Phaser.GameObjects.Particles.ParticleEmitter {
    const ejectAngle = angleDeg > 0
      ? { min: 295, max: 335 }   // up-right (+45° portal)
      : { min: 205, max: 245 };  // up-left  (-45° portal)
    return this.scene.add.particles(ox, oy, textureKey, {
      speed:    { min: 30, max: 80 }, // px/s: how fast particles fly out
      angle:    ejectAngle,           // direction in degrees (0=right, 270=up, clockwise)
      scale:    { start: 0.4, end: 0 },
      alpha:    { start: 1,   end: 0 },
      lifespan: 1400,                 // ms: longer = particles travel farther before fading
      gravityY: 120,                  // px/s²: pulls particles back down
      quantity:  2,                   // particles per burst
      frequency: 500,                 // ms between bursts
    }).setDepth(11);
  }
}

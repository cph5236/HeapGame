// src/systems/EnemyManager.ts
import Phaser from 'phaser';
import { Enemy } from '../entities/Enemy';
import { ENEMY_DEFS, EnemyDef } from '../data/enemyDefs';
import { CHUNK_BAND_HEIGHT, ENEMY_CULL_DISTANCE, WORLD_WIDTH } from '../constants';
import type { Vertex } from './HeapPolygon';
import type { HeapEntry } from '../data/heapTypes';
import { OBJECT_DEFS } from '../data/heapObjectDefs';

const SURFACE_ANGLE_THRESHOLD = 30; // degrees — below this is a surface, above is a wall
const RAT_IDLE_MS = 1000;

/**
 * Ray-casting point-in-polygon test.
 * Returns true if (x, y) is strictly inside the polygon.
 * Points exactly on the boundary may return either value — avoid testing boundary points.
 */
export function isPointInsidePolygon(x: number, y: number, polygon: Vertex[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const crosses = (yi > y) !== (yj > y) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Returns degrees from horizontal for edge v1→v2 (0 = flat, 90 = vertical). */
export function computeSurfaceAngle(v1: Vertex, v2: Vertex): number {
  const dx = Math.abs(v2.x - v1.x);
  const dy = Math.abs(v2.y - v1.y);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/**
 * Returns spawn probability for the given def at world Y.
 * Returns null if Y is outside the enemy's spawn zone.
 */
export function spawnChance(def: EnemyDef, y: number): number | null {
  if (y > def.spawnStartY) return null;
  if (def.spawnEndY !== -1 && y < def.spawnEndY) return null;

  if (def.spawnRampEndY === -1) return def.spawnChanceMin;

  const t = Math.min(1, Math.max(0,
    (def.spawnStartY - y) / (def.spawnStartY - def.spawnRampEndY)
  ));
  return def.spawnChanceMin + t * (def.spawnChanceMax - def.spawnChanceMin);
}

/** Scales a spawn chance by a multiplier, clamping to [0, 1]. */
export function scaleSpawnChance(chance: number, mult: number): number {
  return Math.max(0, Math.min(1, chance * mult));
}

/**
 * Returns the new velocity X for a ghost based on world X bounds.
 * Extracted for unit testing.
 */
export function computeGhostFlip(
  x: number,
  velocityX: number,
  speed: number,
  xMin: number,
  xMax: number,
): number {
  if (x <= xMin && velocityX < 0) return speed;
  if (x >= xMax && velocityX > 0) return -speed;
  return velocityX;
}

export class EnemyManager {
  /** Arcade group — use this for overlap registration in GameScene */
  readonly group: Phaser.Physics.Arcade.Group;

  private readonly scene: Phaser.Scene;
  private heapPolygon: Vertex[] = [];
  private _spawnRateMult: number;
  private readonly _xMin: number;
  private readonly _xMax: number;

  constructor(scene: Phaser.Scene, spawnRateMult: number = 1.0, xMin: number = 0, xMax: number = WORLD_WIDTH) {
    this.scene = scene;
    this.group = scene.physics.add.group();
    this._spawnRateMult = spawnRateMult;
    this._xMin = xMin;
    this._xMax = xMax;
  }

  setSpawnRateMult(mult: number): void {
    this._spawnRateMult = mult;
  }

  /** Update the heap polygon used for interior-spawn rejection. Call after every polygon load. */
  setPolygon(polygon: Vertex[]): void {
    this.heapPolygon = polygon;
  }

  /**
   * Call this from the HeapGenerator.onPlatformSpawned callback.
   * entry is passed so we can derive platform width for rat patrol bounds.
   * blockPlaced guards against spawning enemies on the player's own summit block.
   */
  onPlatformSpawned(x: number, platformTopY: number, blockPlaced: boolean, entry?: HeapEntry): void {
    if (blockPlaced) return;
    let minX: number | undefined;
    let maxX: number | undefined;
    if (entry) {
      const def = OBJECT_DEFS[entry.keyid];
      if (def) {
        minX = entry.x - def.width / 2;
        maxX = entry.x + def.width / 2;
      }
    }
    for (const def of Object.values(ENEMY_DEFS)) {
      this.trySpawn(def, x, platformTopY, 0, minX, maxX, platformTopY, platformTopY);
    }
  }

  /**
   * Call this when a band polygon is applied from the server path.
   * Iterates polygon edges to find spawnable surfaces.
   */
  onBandLoaded(bandTopY: number, vertices: Vertex[]): void {
    if (vertices.length < 2) return;
    const bandBottomY = bandTopY + CHUNK_BAND_HEIGHT;
    const EPS = 0.5;
    for (let i = 0; i < vertices.length; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % vertices.length];
      // Skip artificial horizontal edges inserted at band-clip boundaries — these
      // cross the interior of the heap body and are not real spawnable surfaces.
      const atTopCut    = Math.abs(v1.y - bandTopY)    < EPS && Math.abs(v2.y - bandTopY)    < EPS;
      const atBottomCut = Math.abs(v1.y - bandBottomY) < EPS && Math.abs(v2.y - bandBottomY) < EPS;
      if (atTopCut || atBottomCut) continue;
      const angle = computeSurfaceAngle(v1, v2);
      const spawnX = (v1.x + v2.x) / 2;
      const spawnY = Math.min(v1.y, v2.y);
      // Use the edge extents as patrol bounds for rats
      const leftV  = v1.x <= v2.x ? v1 : v2;
      const rightV = v1.x <= v2.x ? v2 : v1;
      const minX = leftV.x;
      const maxX = rightV.x;
      const minY = leftV.y;
      const maxY = rightV.y;
      for (const def of Object.values(ENEMY_DEFS)) {
        this.trySpawn(def, spawnX, spawnY, angle, minX, maxX, minY, maxY);
      }
    }
  }

  /** Call every frame with current camera bounds. */
  update(_camTop: number, camBottom: number): void {
    const now = this.scene.time.now;
    const children = this.group.getChildren();
    const cullY = camBottom + ENEMY_CULL_DISTANCE;

    for (let i = children.length - 1; i >= 0; i--) {
      const s = children[i] as Phaser.Physics.Arcade.Sprite;
      if (s.y > cullY) { s.destroy(); continue; }

      const kind: string = s.getData('kind');

      if (kind === 'percher') {
        const body  = s.body as Phaser.Physics.Arcade.Body;
        const speed: number = s.getData('speed');
        const minX: number  = s.getData('minX') ?? s.x;
        const maxX: number  = s.getData('maxX') ?? s.x;
        const minY: number  = s.getData('minY') ?? s.y;
        const maxY: number  = s.getData('maxY') ?? s.y;
        const state: string = s.getData('ratState') ?? 'walk-right';

        // Follow the slope: interpolate Y based on current X position
        if (maxX > minX) {
          const t = (s.x - minX) / (maxX - minX);
          const targetY = minY + t * (maxY - minY);
          s.y = targetY;
          body.position.y = targetY - body.halfHeight;
        }

        switch (state) {
          case 'walk-right':
            if (s.x >= maxX) {
              body.setVelocityX(0);
              s.setData('ratState', 'idle-right');
              s.setData('idleUntil', now + RAT_IDLE_MS);
              s.play('rat-idle');
            }
            break;
          case 'idle-right':
            if (now >= (s.getData('idleUntil') as number)) {
              body.setVelocityX(-speed);
              s.setData('ratState', 'walk-left');
              s.play('rat-walk-left');
            }
            break;
          case 'walk-left':
            if (s.x <= minX) {
              body.setVelocityX(0);
              s.setData('ratState', 'idle-left');
              s.setData('idleUntil', now + RAT_IDLE_MS);
              s.play('rat-idle');
            }
            break;
          case 'idle-left':
            if (now >= (s.getData('idleUntil') as number)) {
              body.setVelocityX(speed);
              s.setData('ratState', 'walk-right');
              s.play('rat-walk-right');
            }
            break;
        }
      }

      if (kind === 'ghost') {
        const body = s.body as Phaser.Physics.Arcade.Body;
        const speed: number = s.getData('speed');

        // Manually flip at column edges — avoids the oscillation that setBounce causes
        const newVx = computeGhostFlip(s.x, body.velocity.x, speed, this._xMin, this._xMax);
        if (newVx !== body.velocity.x) body.setVelocityX(newVx);

        const wantAnim = body.velocity.x < 0 ? 'vulture-fly-left' : 'vulture-fly-right';
        if (s.anims.currentAnim?.key !== wantAnim) s.play(wantAnim);
      }
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private trySpawn(
    def: EnemyDef,
    x: number,
    y: number,
    surfaceAngle: number,
    minX?: number,
    maxX?: number,
    minY?: number,
    maxY?: number,
  ): void {
    const isSurface = surfaceAngle < SURFACE_ANGLE_THRESHOLD;
    const isWall    = surfaceAngle >= SURFACE_ANGLE_THRESHOLD;

    if (def.spawnOnHeapSurface && !isSurface) return;
    if (def.spawnOnHeapWall    && !isWall)    return;
    if (!def.spawnOnHeapSurface && !def.spawnOnHeapWall) return;

    // Reject interior edges: the space just above an exterior surface is open air
    // (outside the polygon). Interior ledges and walls still have heap above them.
    if (this.heapPolygon.length > 0 && isPointInsidePolygon(x, y - 1, this.heapPolygon)) return;

    const rawChance = spawnChance(def, y);
    if (rawChance === null) return;
    const chance = scaleSpawnChance(rawChance, this._spawnRateMult);
    if (Math.random() >= chance) return;

    const spawnY = y - def.height / 2;
    const enemy = new Enemy(this.scene, this.group, x, spawnY, def);

    if (def.kind === 'percher' && minX !== undefined && maxX !== undefined) {
      enemy.sprite.setData('minX', minX);
      enemy.sprite.setData('maxX', maxX);
      const halfH = def.height / 2;
      enemy.sprite.setData('minY', (minY ?? spawnY + halfH) - halfH);
      enemy.sprite.setData('maxY', (maxY ?? spawnY + halfH) - halfH);
      enemy.sprite.setData('ratState', 'walk-right');
      enemy.sprite.setData('idleUntil', 0);
    }
  }
}

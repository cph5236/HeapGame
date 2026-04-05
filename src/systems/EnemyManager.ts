// src/systems/EnemyManager.ts
import Phaser from 'phaser';
import { Enemy } from '../entities/Enemy';
import { ENEMY_DEFS, EnemyDef } from '../data/enemyDefs';
import { CHUNK_BAND_HEIGHT, ENEMY_CULL_DISTANCE } from '../constants';
import type { Vertex } from './HeapPolygon';

const SURFACE_ANGLE_THRESHOLD = 30; // degrees — below this is a surface, above is a wall

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

export class EnemyManager {
  /** Arcade group — use this for overlap registration in GameScene */
  readonly group: Phaser.Physics.Arcade.Group;

  private readonly scene: Phaser.Scene;
  private heapPolygon: Vertex[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.group = scene.physics.add.group();
  }

  /** Update the heap polygon used for interior-spawn rejection. Call after every polygon load. */
  setPolygon(polygon: Vertex[]): void {
    this.heapPolygon = polygon;
  }

  /**
   * Call this from the HeapGenerator.onPlatformSpawned callback.
   * blockPlaced guards against spawning enemies on the player's own summit block.
   */
  onPlatformSpawned(x: number, platformTopY: number, blockPlaced: boolean): void {
    if (blockPlaced) return;
    for (const def of Object.values(ENEMY_DEFS)) {
      this.trySpawn(def, x, platformTopY, 0);
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
      for (const def of Object.values(ENEMY_DEFS)) {
        this.trySpawn(def, spawnX, spawnY, angle);
      }
    }
  }

  /** Call every frame with current camera bounds. */
  update(_camTop: number, camBottom: number): void {
    const children = this.group.getChildren();
    const cullY = camBottom + ENEMY_CULL_DISTANCE;
    for (let i = children.length - 1; i >= 0; i--) {
      const s = children[i] as Phaser.Physics.Arcade.Sprite;
      if (s.y > cullY) s.destroy();
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private trySpawn(def: EnemyDef, x: number, y: number, surfaceAngle: number): void {
    const isSurface = surfaceAngle < SURFACE_ANGLE_THRESHOLD;
    const isWall    = surfaceAngle >= SURFACE_ANGLE_THRESHOLD;

    if (def.spawnOnHeapSurface && !isSurface) return;
    if (def.spawnOnHeapWall    && !isWall)    return;
    if (!def.spawnOnHeapSurface && !def.spawnOnHeapWall) return;

    // Reject interior edges: the space just above an exterior surface is open air
    // (outside the polygon). Interior ledges and walls still have heap above them.
    if (this.heapPolygon.length > 0 && isPointInsidePolygon(x, y - 1, this.heapPolygon)) return;

    const chance = spawnChance(def, y);
    if (chance === null) return;
    if (Math.random() >= chance) return;

    const spawnY = y - def.height / 2;
    new Enemy(this.scene, this.group, x, spawnY, def);
  }
}

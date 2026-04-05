// src/systems/EnemyManager.ts
import Phaser from 'phaser';
import { Enemy } from '../entities/Enemy';
import { ENEMY_DEFS, EnemyDef } from '../data/enemyDefs';
import { ENEMY_CULL_DISTANCE } from '../constants';
import type { Vertex } from './HeapPolygon';

const SURFACE_ANGLE_THRESHOLD = 30; // degrees — below this is a surface, above is a wall

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

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.group = scene.physics.add.group();
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
  onBandLoaded(_bandTopY: number, vertices: Vertex[]): void {
    if (vertices.length < 2) return;
    for (let i = 0; i < vertices.length; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % vertices.length];
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

    const chance = spawnChance(def, y);
    if (chance === null) return;
    if (Math.random() >= chance) return;

    const spawnY = y - def.height / 2;
    new Enemy(this.scene, this.group, x, spawnY, def);
  }
}

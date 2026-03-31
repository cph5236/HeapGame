import Phaser from 'phaser';
import { Enemy } from '../entities/Enemy';
import { HeapEntry } from '../data/heapTypes';
import { OBJECT_DEFS } from '../data/heapObjectDefs';
import {
  ENEMY_PERCHER_HEIGHT,
  ENEMY_PERCHER_CLEARANCE,
  ENEMY_PERCHER_SPAWN_CHANCE,
  ENEMY_GHOST_SIZE,
  ENEMY_GHOST_SPAWN_CHANCE,
  ENEMY_CULL_DISTANCE,
} from '../constants';

export class EnemyManager {
  /** Arcade group — use this for overlap registration in GameScene */
  readonly group: Phaser.Physics.Arcade.Group;

  private readonly scene: Phaser.Scene;
  private readonly getEntries: () => readonly HeapEntry[];

  constructor(
    scene: Phaser.Scene,
    getEntries: () => readonly HeapEntry[],
  ) {
    this.scene = scene;
    this.getEntries = getEntries;
    this.group = scene.physics.add.group();
  }

  /**
   * Call this from the HeapGenerator.onPlatformSpawned callback.
   * blockPlaced guards against spawning enemies on the player's own summit block.
   */
  onPlatformSpawned(entry: HeapEntry, platformTopY: number, blockPlaced: boolean): void {
    if (!blockPlaced) {
      this.trySpawnPercher(entry, platformTopY);
      this.trySpawnGhost(entry, platformTopY);
    }
  }

  /** Call every frame with current camera bounds. */
  update(_camTop: number, camBottom: number): void {
    // Cull enemies that have scrolled far below the camera
    const children = this.group.getChildren();
    const cullY = camBottom + ENEMY_CULL_DISTANCE;
    for (let i = children.length - 1; i >= 0; i--) {
      const s = children[i] as Phaser.Physics.Arcade.Sprite;
      if (s.y > cullY) s.destroy();
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private trySpawnPercher(entry: HeapEntry, platformTopY: number): void {
    const def = OBJECT_DEFS[entry.keyid] ?? OBJECT_DEFS[0];
    if (this.findClearanceAbove(entry.x, def.width, platformTopY) < ENEMY_PERCHER_CLEARANCE) return;
    if (Math.random() >= ENEMY_PERCHER_SPAWN_CHANCE) return;
    const y = platformTopY - ENEMY_PERCHER_HEIGHT / 2;
    new Enemy(this.scene, this.group, entry.x, y, 'percher');
  }

  private trySpawnGhost(entry: HeapEntry, platformTopY: number): void {
    if (Math.random() >= ENEMY_GHOST_SPAWN_CHANCE) return;
    const y = platformTopY - ENEMY_GHOST_SIZE / 2;
    new Enemy(this.scene, this.group, entry.x, y, 'ghost');
  }

  private findClearanceAbove(cx: number, width: number, platformTopY: number): number {
    const left  = cx - width / 2;
    const right = cx + width / 2;
    let nearestCeilingBottom = platformTopY - 500; // default: open sky
    for (const e of this.getEntries()) {
      const def2    = OBJECT_DEFS[e.keyid] ?? OBJECT_DEFS[0];
      const eLeft   = e.x - def2.width  / 2;
      const eRight  = e.x + def2.width  / 2;
      const eBottom = e.y + def2.height / 2;
      if (eRight > left && eLeft < right && eBottom <= platformTopY) {
        if (eBottom > nearestCeilingBottom) nearestCeilingBottom = eBottom;
      }
    }
    return platformTopY - nearestCeilingBottom;
  }
}

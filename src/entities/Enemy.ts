// src/entities/Enemy.ts
import Phaser from 'phaser';
import type { EnemyDef } from '../data/enemyDefs';

export type EnemyKind = 'percher' | 'ghost';

export class Enemy {
  readonly sprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  readonly kind: EnemyKind;

  constructor(
    scene: Phaser.Scene,
    group: Phaser.Physics.Arcade.Group,
    x: number,
    y: number,
    def: EnemyDef,
  ) {
    this.kind = def.kind;
    const key = scene.textures.exists(def.textureKey) ? def.textureKey : 'enemy-fallback';
    this.sprite = scene.physics.add.sprite(x, y, key) as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
    this.sprite.setDisplaySize(def.width, def.height);
    this.sprite.setData('kind', def.kind);
    this.sprite.setDepth(7);

    group.add(this.sprite);

    // Must be set after group.add — adding to a group can reset body flags
    this.sprite.body.setAllowGravity(false);
    this.sprite.body.setSize(def.width, def.height);

    if (def.kind === 'percher') {
      this.sprite.setImmovable(true);
      this.sprite.setData('speed', def.speed);
      this.sprite.setVelocityX(def.speed); // start walking right; state machine takes over
      this.sprite.play('rat-walk-right');
    } else {
      // Patrol left→right — direction is flipped manually in EnemyManager.update()
      this.sprite.setVelocityX(-def.speed); // start moving left
      this.sprite.setData('speed', def.speed);
      this.sprite.play('vulture-fly-left');
    }
  }

  destroy(): void {
    this.sprite.destroy();
  }
}

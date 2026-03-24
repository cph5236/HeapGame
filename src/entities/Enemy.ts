import Phaser from 'phaser';
import { ENEMY_GHOST_SPEED } from '../constants';

export type EnemyKind = 'percher' | 'ghost';

export class Enemy {
  readonly sprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  readonly kind: EnemyKind;

  constructor(
    scene: Phaser.Scene,
    group: Phaser.Physics.Arcade.Group,
    x: number,
    y: number,
    kind: EnemyKind,
  ) {
    this.kind = kind;
    const key = kind === 'percher' ? 'enemy-percher' : 'enemy-ghost';
    this.sprite = scene.physics.add.sprite(x, y, key) as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
    this.sprite.setData('kind', kind);
    this.sprite.setDepth(7);

    group.add(this.sprite);

    // Must be set after group.add — adding to a group can reset body flags
    this.sprite.body.setAllowGravity(false);

    if (kind === 'percher') {
      this.sprite.setImmovable(true);
    } else {
      // Patrol left→right across the full world width, bouncing off world bounds
      this.sprite.setCollideWorldBounds(true);
      this.sprite.setBounce(1, 0);
      this.sprite.setVelocityX(-ENEMY_GHOST_SPEED); // start moving left
    }
  }

  destroy(): void {
    this.sprite.destroy();
  }
}

// src/entities/Enemy.ts
import Phaser from 'phaser';
import type { BodyBox, EnemyDef, EnemyKind } from '../data/enemyDefs';

export type { EnemyKind };

/** Apply a per-state body box (texture-pixel coords) to an Arcade body. */
export function applyBodyBox(
  body: Phaser.Physics.Arcade.Body,
  box: BodyBox,
): void {
  body.setSize(box.width, box.height);
  body.setOffset(box.offsetX, box.offsetY);
}

/** Mirror a body box horizontally within a frame, for setFlipX(true) sprites. */
export function mirrorBodyBox(box: BodyBox, frameWidth: number): BodyBox {
  return {
    width:   box.width,
    height:  box.height,
    offsetX: frameWidth - box.offsetX - box.width,
    offsetY: box.offsetY,
  };
}

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
    // Default body fills the display rect; per-state boxes (e.g. rat walking
    // vs idle) are applied below or driven by the EnemyManager state machine.
    this.sprite.body.setSize(def.width, def.height);

    if (def.kind === 'percher') {
      // Rat starts walking-right (see velocity below) — apply that body box.
      if (def.bodyWalking) applyBodyBox(this.sprite.body, def.bodyWalking);
      this.sprite.setImmovable(true);
      this.sprite.setData('speed', def.speed);
      this.sprite.setVelocityX(def.speed); // start walking right; state machine takes over
      this.sprite.play('rat-walk-right');
    } else if (def.kind === 'jumper') {
      // Wall-mounted, stationary. EnemyManager.trySpawn sets flip + state.
      if (def.bodyIdle) applyBodyBox(this.sprite.body, def.bodyIdle);
      this.sprite.setImmovable(true);
      this.sprite.setData('speed', 0);
      this.sprite.setData('vulnerable', true); // retracted = defeatable
      this.sprite.play('jumper-idle-1');
    } else {
      // Ghost (vulture): patrol left→right — direction flipped in EnemyManager.update()
      this.sprite.setVelocityX(-def.speed); // start moving left
      this.sprite.setData('speed', def.speed);
      this.sprite.play('vulture-fly-left');
    }
  }

  destroy(): void {
    this.sprite.destroy();
  }
}

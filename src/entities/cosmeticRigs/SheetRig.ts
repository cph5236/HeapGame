// src/entities/cosmeticRigs/SheetRig.ts

import Phaser from 'phaser';
import { StaticRig, type StaticRigSpec } from './StaticRig';

/** Flipbook attachment: StaticRig transform + a looping spritesheet anim.
 *  If the anim was never registered (art missing frames), stays on frame 0. */
export class SheetRig extends StaticRig {
  constructor(scene: Phaser.Scene, spec: StaticRigSpec, animKey: string) {
    super(scene, spec);
    if (scene.anims.exists(animKey)) this.img.play(animKey);
  }
}

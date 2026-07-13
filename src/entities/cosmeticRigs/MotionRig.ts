// src/entities/cosmeticRigs/MotionRig.ts

import Phaser from 'phaser';
import type { AttachmentAnim } from '../../data/cosmeticDefs';
import { motionOffsets } from '../../systems/cosmeticMotion';
import { StaticRig, type StaticRigSpec } from './StaticRig';
import type { AttachmentAnchor, MotionSnapshot } from './types';

/** Static transform plus a data-described parametric layer (spin/bob/pulse). */
export class MotionRig extends StaticRig {
  private readonly anim: Exclude<AttachmentAnim, { type: 'sheet' }>;
  private tMs = 0;

  constructor(scene: Phaser.Scene, spec: StaticRigSpec,
              anim: Exclude<AttachmentAnim, { type: 'sheet' }>) {
    super(scene, spec);
    this.anim = anim;
  }

  update(dtMs: number, a: AttachmentAnchor, m: MotionSnapshot): void {
    super.update(dtMs, a, m);
    this.tMs += dtMs;
    const o = motionOffsets(this.anim, this.tMs);
    this.img.setPosition(this.img.x + o.dx * a.fx, this.img.y + o.dy * a.fy);
    this.img.setAngle(this.img.angle + o.dAngle);
    this.img.setScale(this.img.scaleX * o.scaleMul, this.img.scaleY * o.scaleMul);
    this.img.setAlpha(o.alphaMul);
  }
}

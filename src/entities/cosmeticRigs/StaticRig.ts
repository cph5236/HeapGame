// src/entities/cosmeticRigs/StaticRig.ts

import Phaser from 'phaser';
import type { AttachmentAnchor, AttachmentRig, MotionSnapshot } from './types';

export interface StaticRigSpec {
  textureKey: string;
  offsetX: number; offsetY: number;  // logical px from the attachment origin
  baseAngle: number;                 // designer worn angle (hats); 0 for faces
  scale: number;                     // resolved size multiplier (hats); 1 for faces
  defScale?: number;                 // hat def's unadjusted scale — enables bottom-edge anchoring
  artScale: number;                  // logical px per art px (ART_SCALE)
  depth: number;
}

export class StaticRig implements AttachmentRig {
  protected readonly img: Phaser.GameObjects.Sprite;
  protected readonly spec: StaticRigSpec;
  private readonly offsetY: number;   // spec offset + hat bottom-edge anchor shift
  readonly objects: Phaser.GameObjects.GameObject[];

  constructor(scene: Phaser.Scene, spec: StaticRigSpec) {
    this.spec = spec;
    this.img = scene.add.sprite(0, 0, spec.textureKey)
      .setScale(spec.artScale * spec.scale).setDepth(spec.depth);
    // Keep the hat's bottom edge (contact point) anchored as dScale grows or
    // shrinks it from the def's baseline, instead of scaling from center.
    const bottomAnchor = spec.defScale !== undefined
      ? (this.img.height / 2) * spec.artScale * (spec.defScale - spec.scale)
      : 0;
    this.offsetY = spec.offsetY + bottomAnchor;
    this.objects = [this.img];
  }

  update(_dtMs: number, a: AttachmentAnchor, _m: MotionSnapshot): void {
    const s = this.spec;
    this.img.setPosition(a.x + s.offsetX * a.fx, a.y + this.offsetY * a.fy);
    this.img.setScale(s.artScale * s.scale * a.fx, s.artScale * s.scale * a.fy);
    this.img.setAngle(a.angle + s.baseAngle);
  }

  setVisible(visible: boolean): void { this.img.setVisible(visible); }
  destroy(): void { this.img.destroy(); }
}

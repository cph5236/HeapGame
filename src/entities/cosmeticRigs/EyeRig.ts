// src/entities/cosmeticRigs/EyeRig.ts
//
// Physics-driven eye family: per eye, a fixed white disc + a pupil whose
// position is simulated by eyePhysics from player acceleration. Rest poses
// from the def give each item (googly / lazy / crazy / cross) its character.

import Phaser from 'phaser';
import type { EyesRender } from '../../data/cosmeticDefs';
import { stepPupil, DEFAULT_EYE_PHYSICS, type PupilState, type PupilParams } from '../../systems/eyePhysics';
import type { AttachmentAnchor, AttachmentRig, MotionSnapshot } from './types';

export class EyeRig implements AttachmentRig {
  private readonly spec: EyesRender;
  private readonly artScale: number;
  private readonly whites: Phaser.GameObjects.Image[] = [];
  private readonly pupils: Phaser.GameObjects.Image[] = [];
  private readonly states: PupilState[] = [];
  private readonly params: PupilParams[];
  readonly objects: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene, spec: EyesRender,
              artScale: number, depth: number,
              whiteKey: string, pupilKey: string) {
    this.spec = spec;
    this.artScale = artScale;
    const phys = { ...DEFAULT_EYE_PHYSICS, ...spec.physics };
    this.params = spec.eyes.map(eye => ({
      restX: eye.restX, restY: eye.restY, radius: eye.radius, ...phys,
    }));
    for (const eye of spec.eyes) {
      const white = scene.add.image(0, 0, whiteKey)
        .setScale(artScale * eye.whiteScale).setDepth(depth);
      const pupil = scene.add.image(0, 0, pupilKey)
        .setScale(artScale * eye.pupilScale).setDepth(depth + 0.1);
      this.whites.push(white);
      this.pupils.push(pupil);
      this.states.push({ x: eye.restX, y: eye.restY, vx: 0, vy: 0 });
      this.objects.push(white, pupil);
    }
  }

  update(dtMs: number, a: AttachmentAnchor, m: MotionSnapshot): void {
    this.spec.eyes.forEach((eye, i) => {
      this.states[i] = stepPupil(this.states[i], this.params[i], m.ax, m.ay, dtMs);
      const cx = a.x + (this.spec.offsetX + eye.x) * a.fx;
      const cy = a.y + (this.spec.offsetY + eye.y) * a.fy;
      this.whites[i].setPosition(cx, cy)
        .setScale(this.artScale * eye.whiteScale * a.fx, this.artScale * eye.whiteScale * a.fy)
        .setAngle(a.angle);
      this.pupils[i].setPosition(cx + this.states[i].x * a.fx, cy + this.states[i].y * a.fy)
        .setScale(this.artScale * eye.pupilScale * a.fx, this.artScale * eye.pupilScale * a.fy)
        .setAngle(a.angle);
    });
  }

  setVisible(visible: boolean): void {
    for (const o of [...this.whites, ...this.pupils]) o.setVisible(visible);
  }

  destroy(): void {
    for (const o of [...this.whites, ...this.pupils]) o.destroy();
  }
}

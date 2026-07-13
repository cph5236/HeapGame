// src/entities/cosmeticRigs/createAttachmentRig.ts
//
// Resolved render spec → rig. Returns null when required art is missing
// entirely (item renders nothing — same as today's textures.exists guards).

import Phaser from 'phaser';
import type { FaceRender, EyesRender } from '../../data/cosmeticDefs';
import type { ResolvedHatRender } from '../../systems/cosmeticsLogic';
import type { AttachmentRig } from './types';
import { StaticRig } from './StaticRig';

/** Bag PNG is 174px wide displayed at 40 logical px — attachment art authored
 *  at the same ratio renders at matching scale. */
export const ART_SCALE = 40 / 174;
export const ATTACHMENT_DEPTH = 12;

export function createAttachmentRig(
  scene: Phaser.Scene,
  spec: ResolvedHatRender | FaceRender | EyesRender,
): AttachmentRig | null {
  if (!scene.textures.exists(spec.textureKey)) return null;
  switch (spec.kind) {
    case 'hat':
      return new StaticRig(scene, {
        textureKey: spec.textureKey, offsetX: spec.offsetX, offsetY: spec.offsetY,
        baseAngle: spec.angle, scale: spec.scale, defScale: spec.defScale,
        artScale: ART_SCALE, depth: ATTACHMENT_DEPTH,
      });
    case 'face':
    case 'eyes':   // EyeRig lands in Task 7; until then eyes render their flat PNG
      return new StaticRig(scene, {
        textureKey: spec.textureKey, offsetX: spec.offsetX, offsetY: spec.offsetY,
        baseAngle: 0, scale: 1, artScale: ART_SCALE, depth: ATTACHMENT_DEPTH,
      });
  }
}

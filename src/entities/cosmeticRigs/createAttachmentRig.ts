// src/entities/cosmeticRigs/createAttachmentRig.ts
//
// Resolved render spec → rig. Returns null when required art is missing
// entirely (item renders nothing — same as today's textures.exists guards).

import Phaser from 'phaser';
import type { FaceRender, EyesRender } from '../../data/cosmeticDefs';
import type { ResolvedHatRender } from '../../systems/cosmeticsLogic';
import type { AttachmentRig } from './types';
import { StaticRig } from './StaticRig';
import { MotionRig } from './MotionRig';
import { SheetRig } from './SheetRig';
import { PART_EYE_WHITE, PART_PUPIL } from '../../data/cosmeticArt';
import { EyeRig } from './EyeRig';

/** Bag PNG is 174px wide displayed at 40 logical px — attachment art authored
 *  at the same ratio renders at matching scale. */
export const ART_SCALE = 40 / 174;
export const ATTACHMENT_DEPTH = 12;

export function createAttachmentRig(
  scene: Phaser.Scene,
  spec: ResolvedHatRender | FaceRender | EyesRender,
): AttachmentRig | null {
  switch (spec.kind) {
    case 'hat': {
      if (!scene.textures.exists(spec.textureKey)) return null;
      const rigSpec = {
        textureKey: spec.textureKey, offsetX: spec.offsetX, offsetY: spec.offsetY,
        baseAngle: spec.angle, scale: spec.scale, defScale: spec.defScale,
        artScale: ART_SCALE, depth: ATTACHMENT_DEPTH,
      };
      if (spec.anim?.type === 'sheet') return new SheetRig(scene, rigSpec, `anim-${spec.textureKey}`);
      if (spec.anim)                   return new MotionRig(scene, rigSpec, spec.anim);
      return new StaticRig(scene, rigSpec);
    }
    case 'face': {
      if (!scene.textures.exists(spec.textureKey)) return null;
      const rigSpec = {
        textureKey: spec.textureKey, offsetX: spec.offsetX, offsetY: spec.offsetY,
        baseAngle: 0, scale: 1, artScale: ART_SCALE, depth: ATTACHMENT_DEPTH,
      };
      if (spec.anim?.type === 'sheet') return new SheetRig(scene, rigSpec, `anim-${spec.textureKey}`);
      if (spec.anim)                   return new MotionRig(scene, rigSpec, spec.anim);
      return new StaticRig(scene, rigSpec);
    }
    case 'eyes': {
      if (scene.textures.exists(PART_EYE_WHITE) && scene.textures.exists(PART_PUPIL)) {
        return new EyeRig(scene, spec, ART_SCALE, ATTACHMENT_DEPTH, PART_EYE_WHITE, PART_PUPIL);
      }
      // Parts art not landed yet — flat store PNG, exactly the old behavior.
      if (!scene.textures.exists(spec.textureKey)) return null;
      return new StaticRig(scene, {
        textureKey: spec.textureKey, offsetX: spec.offsetX, offsetY: spec.offsetY,
        baseAngle: 0, scale: 1, artScale: ART_SCALE, depth: ATTACHMENT_DEPTH,
      });
    }
  }
}

// src/systems/cosmeticMotion.ts
//
// Pure parametric animation math for MotionRig. No Phaser imports.

import type { AttachmentAnim } from '../data/cosmeticDefs';

export interface MotionOffsets {
  dAngle: number;     // degrees added to the attachment's angle
  dx: number; dy: number;   // logical px added to the offset (pre squash-factor)
  scaleMul: number;   // multiplier on the attachment's scale
  alphaMul: number;   // multiplier on alpha (1 = opaque)
}

export const IDENTITY_OFFSETS: MotionOffsets =
  { dAngle: 0, dx: 0, dy: 0, scaleMul: 1, alphaMul: 1 };

export function motionOffsets(anim: AttachmentAnim, tMs: number): MotionOffsets {
  switch (anim.type) {
    case 'spin':
      return { ...IDENTITY_OFFSETS, dAngle: ((tMs / 60000) * anim.rpm * 360) % 360 };
    case 'bob':
      return { ...IDENTITY_OFFSETS, dy: Math.sin((tMs / anim.periodMs) * Math.PI * 2) * anim.amplitudePx };
    case 'pulse': {
      const s = Math.sin((tMs / anim.periodMs) * Math.PI * 2);
      return {
        ...IDENTITY_OFFSETS,
        scaleMul: 1 + s * anim.scaleAmp,
        alphaMul: 1 - (anim.alphaAmp ?? 0) * (0.5 + 0.5 * s),
      };
    }
    case 'sheet':
      return IDENTITY_OFFSETS;
  }
}

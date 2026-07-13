// src/entities/cosmeticRigs/types.ts
//
// The attachment-rig contract: PlayerCosmetics (in-game) and animatedAvatar
// (editor preview) compute one anchor + motion snapshot per frame and forward
// it to every rig. Rigs own their GameObjects; `objects` exists so container
// hosts (the preview) can reparent them.

import Phaser from 'phaser';

export interface AttachmentAnchor {
  x: number; y: number;   // attachment origin (player sprite center; 0,0 in a container)
  fx: number; fy: number; // squash/stretch factors vs base scale (preview: the avatar scale)
  angle: number;          // sprite angle, degrees
}

export interface MotionSnapshot {
  vx: number; vy: number; // player velocity, px/s
  ax: number; ay: number; // player acceleration, px/s²
  grounded: boolean;
}

export interface AttachmentRig {
  readonly objects: Phaser.GameObjects.GameObject[];
  update(dtMs: number, anchor: AttachmentAnchor, motion: MotionSnapshot): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

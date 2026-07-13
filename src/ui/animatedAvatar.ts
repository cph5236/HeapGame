// src/ui/animatedAvatar.ts
//
// Live mini-player for the character editor: same composition as
// composeAvatar, but hat/face go through the attachment-rig factory and tick
// on the scene UPDATE event. The mannequin doesn't move, so a small random
// acceleration impulse fires every couple of seconds to show off
// motion-reactive rigs (googly eyes); spin/bob/sheet rigs animate regardless.

import Phaser from 'phaser';
import type { EquippedLoadout } from '../../shared/cosmeticCatalog';
import { resolveCosmetics, type HatAdjustments } from '../systems/cosmeticsLogic';
import { createAttachmentRig } from '../entities/cosmeticRigs/createAttachmentRig';
import type { AttachmentRig, AttachmentAnchor } from '../entities/cosmeticRigs/types';
import { composeAvatarBase } from './avatar';

const PULSE_MIN_GAP_MS = 2000;
const PULSE_RAND_MS    = 1200;
const PULSE_LEN_MS     = 130;
const PULSE_AX         = 5000;   // px/s² — enough to slosh even tight eye items
const PULSE_AY         = 3500;

export interface AnimatedAvatarHandle {
  container: Phaser.GameObjects.Container;
  destroy(): void;
}

export function createAnimatedAvatar(
  scene:   Phaser.Scene,
  loadout: EquippedLoadout,
  opts:    { x: number; y: number; scale: number },
  adjustments: HatAdjustments = {},
): AnimatedAvatarHandle {
  const r = resolveCosmetics(loadout, adjustments);
  const s = opts.scale;
  const container = scene.add.container(opts.x, opts.y);
  composeAvatarBase(scene, container, r, s);

  const rigs: AttachmentRig[] = [];
  for (const spec of [r.hat, r.face]) {
    if (!spec) continue;
    const rig = createAttachmentRig(scene, spec);
    if (rig) { rigs.push(rig); container.add(rig.objects); }
  }

  // Rig objects are container children: origin is (0,0) local, and the
  // container transform (breathing/hop tweens) carries them. fx/fy = s
  // reproduces composeAvatar's `offset*s` / `ART_SCALE*s` math exactly.
  const anchor: AttachmentAnchor = { x: 0, y: 0, fx: s, fy: s, angle: 0 };

  let pulseAx = 0, pulseAy = 0, pulseLeftMs = 0;
  let nextPulseMs = PULSE_MIN_GAP_MS / 2;
  const onUpdate = (_time: number, delta: number): void => {
    nextPulseMs -= delta;
    if (nextPulseMs <= 0) {
      pulseAx = (Math.random() * 2 - 1) * PULSE_AX;
      pulseAy = (Math.random() * 2 - 1) * PULSE_AY;
      pulseLeftMs = PULSE_LEN_MS;
      nextPulseMs = PULSE_MIN_GAP_MS + Math.random() * PULSE_RAND_MS;
    }
    const active = pulseLeftMs > 0;
    if (active) pulseLeftMs -= delta;
    const motion = { vx: 0, vy: 0, ax: active ? pulseAx : 0, ay: active ? pulseAy : 0, grounded: true };
    for (const rig of rigs) rig.update(delta, anchor, motion);
  };
  scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);

  return {
    container,
    destroy(): void {
      scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
      for (const rig of rigs) rig.destroy();
      container.destroy();
    },
  };
}

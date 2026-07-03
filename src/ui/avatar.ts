// src/ui/avatar.ts
//
// Static mini-player compositor: bag + skin tint + tie strings (idle pose) +
// hat/face attachments in one Container. Used by the character editor preview,
// the menu avatar button, and leaderboard top-5 rows. No trail, no animation.

import Phaser from 'phaser';
import type { EquippedLoadout } from '../../shared/cosmeticCatalog';
import { resolveCosmetics } from '../systems/cosmeticsLogic';
import { PLAYER_WIDTH, PLAYER_HEIGHT } from '../constants';

/** Same ratio the in-game bag renders at (174px art → 40 logical px). */
const ART_SCALE = PLAYER_WIDTH / 174;
/** Collar attach point for the strings, matching PlayerAnimator's offset. */
const COLLAR_Y = PLAYER_HEIGHT * -1.2 * (PLAYER_HEIGHT / 197);
/** Idle-pose string control points from PlayerAnimator's IDLE state. */
const IDLE_STRINGS = { cpLx: -9, cpLy: 16, endLx: -12, endLy: 30, cpRx: 9, cpRy: 16, endRx: 12, endRy: 30 };

export function composeAvatar(
  scene:   Phaser.Scene,
  loadout: EquippedLoadout,
  opts:    { x: number; y: number; scale: number },
): Phaser.GameObjects.Container {
  const r = resolveCosmetics(loadout);
  const s = opts.scale;
  const container = scene.add.container(opts.x, opts.y);

  // Tie strings behind the bag top but above nothing else — draw first.
  const strings = scene.add.graphics();
  strings.lineStyle(2.5 * s, r.tieColor, 1);
  drawBezier(strings, 0, COLLAR_Y * s, IDLE_STRINGS.cpLx * s, IDLE_STRINGS.cpLy * s, IDLE_STRINGS.endLx * s, IDLE_STRINGS.endLy * s);
  drawBezier(strings, 0, COLLAR_Y * s, IDLE_STRINGS.cpRx * s, IDLE_STRINGS.cpRy * s, IDLE_STRINGS.endRx * s, IDLE_STRINGS.endRy * s);
  container.add(strings);

  const bag = scene.add.image(0, 0, 'trashbag-nostrings')
    .setDisplaySize(PLAYER_WIDTH * s, PLAYER_HEIGHT * s);
  if (r.skinTint !== null) bag.setTint(r.skinTint);
  container.add(bag);

  if (r.hat && scene.textures.exists(r.hat.textureKey)) {
    container.add(scene.add.image(r.hat.offsetX * s, r.hat.offsetY * s, r.hat.textureKey)
      .setScale(ART_SCALE * s));
  }
  if (r.face && scene.textures.exists(r.face.textureKey)) {
    container.add(scene.add.image(r.face.offsetX * s, r.face.offsetY * s, r.face.textureKey)
      .setScale(ART_SCALE * s));
  }

  return container;
}

function drawBezier(g: Phaser.GameObjects.Graphics, x0: number, y0: number, cpx: number, cpy: number, x1: number, y1: number): void {
  const segments = 12;
  g.beginPath();
  g.moveTo(x0, y0);
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const mt = 1 - t;
    g.lineTo(
      mt * mt * x0 + 2 * mt * t * (x0 + cpx) + t * t * (x0 + x1),
      mt * mt * y0 + 2 * mt * t * (y0 + cpy) + t * t * (y0 + y1),
    );
  }
  g.strokePath();
}

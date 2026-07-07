// src/ui/avatar.ts
//
// Static mini-player compositor: bag + skin tint + tie strings (idle pose) +
// hat/face attachments in one Container. Used by the character editor preview,
// the menu avatar button, and leaderboard top-5 rows. No trail, no animation.

import Phaser from 'phaser';
import type { EquippedLoadout } from '../../shared/cosmeticCatalog';
import { resolveCosmetics, type HatAdjustments } from '../systems/cosmeticsLogic';
import { drawTieBand } from './tieBand';
import { PLAYER_WIDTH, PLAYER_HEIGHT } from '../constants';

/** Same ratio the in-game bag renders at (174px art → 40 logical px). */
const ART_SCALE = PLAYER_WIDTH / 174;
/** Collar attach point for the strings, matching PlayerAnimator's offset. */
const COLLAR_Y = PLAYER_HEIGHT * -1.2 * (PLAYER_HEIGHT / 197);
/** Shortened idle-pose strings — the portrait reads better with a gentler
 *  drape than the in-game animator's full-length dangle. Anchored at the
 *  band edges (±4) so the two tails don't cross at the neck. */
const IDLE_STRINGS = { x0: 4, cpX: 8, cpY: 7, endX: 12, endY: 14 };
const STRING_W = 1.35;

export function composeAvatar(
  scene:   Phaser.Scene,
  loadout: EquippedLoadout,
  opts:    { x: number; y: number; scale: number },
  adjustments: HatAdjustments = {},   // own avatar: pass SaveData's tweaks
): Phaser.GameObjects.Container {
  const r = resolveCosmetics(loadout, adjustments);
  const s = opts.scale;
  const container = scene.add.container(opts.x, opts.y);

  const bag = scene.add.image(0, 0, 'trashbag-nostrings')
    .setDisplaySize(PLAYER_WIDTH * s, PLAYER_HEIGHT * s);
  if (r.skinTint !== null) bag.setTint(r.skinTint);
  container.add(bag);
  if (r.skinTint !== null) {
    // Flat-color glaze — multiply tint alone is invisible on near-black art.
    const glaze = scene.add.image(0, 0, 'trashbag-nostrings')
      .setDisplaySize(PLAYER_WIDTH * s, PLAYER_HEIGHT * s)
      .setTintFill(r.skinTint).setAlpha(0.26);
    container.add(glaze);
  }

  // Tie: paint the collar band over the baked-in red one, then hang the
  // strings in front of the bag (same as the in-game animator's gfx layer).
  const strings = scene.add.graphics();
  drawTieBand(strings, r.tieColor, 0, COLLAR_Y * s, s);
  strings.lineStyle(STRING_W * s, r.tieColor, 1);
  const st = IDLE_STRINGS;
  drawBezier(strings, -st.x0 * s, COLLAR_Y * s, -st.cpX * s, st.cpY * s, -st.endX * s, st.endY * s);
  drawBezier(strings,  st.x0 * s, COLLAR_Y * s,  st.cpX * s, st.cpY * s,  st.endX * s, st.endY * s);
  container.add(strings);

  if (r.hat && scene.textures.exists(r.hat.textureKey)) {
    const hatImg = scene.add.image(0, 0, r.hat.textureKey);
    // Scaling pivots on the image center by default, which would slide the
    // hat's bottom edge (its contact point) up or down. Shift the position by
    // half the height delta so the bottom edge stays put and it grows upward.
    const bottomAnchor = (hatImg.height / 2) * ART_SCALE * (r.hat.defScale - r.hat.scale);
    hatImg.setPosition(r.hat.offsetX * s, (r.hat.offsetY + bottomAnchor) * s)
      .setScale(ART_SCALE * s * r.hat.scale).setAngle(r.hat.angle);
    container.add(hatImg);
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

// src/ui/tieBand.ts
//
// The trashbag art has a red collar band baked into the texture, so recoloring
// the tie means painting over it. Both the in-game animator (every frame) and
// the static avatar compositor draw the same two-tone band via this helper.

import Phaser from 'phaser';

// Band footprint in logical player px, measured from the texture's baked band
// (bbox x 70-101, y 34-49 of 174×197 → centre (-0.34, -13.31) at 40×46 display,
// collar point sits at -12.89). Slightly oversized to fully cover the red.
const BAND_W = 8.8;
const BAND_H = 4.5;
const BAND_X = -0.35;
const BAND_Y = -0.6; // band centre sits just above the collar point

export function drawTieBand(
  g: Phaser.GameObjects.Graphics,
  color: number,
  cx: number,
  cy: number,
  s: number,
): void {
  const bx = cx + BAND_X * s;
  const by = cy + BAND_Y * s;
  g.fillStyle(color, 1);
  g.fillEllipse(bx, by, BAND_W * s, BAND_H * s);
  // Lower ring shading, mirroring the two-ring look of the original art.
  g.fillStyle(darken(color, 0.62), 1);
  g.fillEllipse(bx, by + 1.3 * s, (BAND_W - 0.8) * s, 1.4 * s);
}

function darken(color: number, f: number): number {
  const r = Math.round(((color >> 16) & 0xff) * f);
  const gCh = Math.round(((color >> 8) & 0xff) * f);
  const b = Math.round((color & 0xff) * f);
  return (r << 16) | (gCh << 8) | b;
}

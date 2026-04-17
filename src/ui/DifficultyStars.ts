import Phaser from 'phaser';

const STAR_FILLED = '\u2605';  // ★
const STAR_HALF   = '\u2BE8';  // U+2BE8, closest available half-star-like glyph
const STAR_EMPTY  = '\u2606';  // ☆

export function formatDifficulty(d: number): string {
  const full = Math.floor(d);
  const half = (d - full) >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return STAR_FILLED.repeat(full) + (half ? STAR_HALF : '') + STAR_EMPTY.repeat(empty);
}

export function drawDifficulty(
  scene: Phaser.Scene,
  x: number,
  y: number,
  d: number,
  fontSize = 18,
): Phaser.GameObjects.Text {
  return scene.add.text(x, y, formatDifficulty(d), {
    fontSize: `${fontSize}px`,
    color: '#ff9922',
    stroke: '#000000',
    strokeThickness: 2,
  }).setOrigin(0, 0.5);
}

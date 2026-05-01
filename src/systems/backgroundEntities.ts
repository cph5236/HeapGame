import Phaser from 'phaser';

export const CLOUD_TEXTURE_KEY = 'cloud-shape';
// Texture canvas size and the offset at which the shape is drawn inside it.
// The shape extends roughly x ∈ [-4, 122], y ∈ [-12, 54] from its native origin,
// so we draw at (CLOUD_TEX_OFFSET_X, CLOUD_TEX_OFFSET_Y) to keep all puffs in-bounds.
export const CLOUD_TEX_W = 140;
export const CLOUD_TEX_H = 72;
export const CLOUD_TEX_OFFSET_X = 10;
export const CLOUD_TEX_OFFSET_Y = 14;

/**
 * Draws a cloud shape onto a Graphics object. The shape's native origin is at
 * local (0, 0); puffs extend a few px left/up of that. Pass `offsetX`/`offsetY`
 * to translate the whole shape (used when baking into a texture canvas).
 */
export function drawCloudShape(
  gfx: Phaser.GameObjects.Graphics,
  offsetX = 0,
  offsetY = 0,
): void {
  gfx.clear();

  const ox = offsetX;
  const oy = offsetY;

  // Main body
  gfx.fillStyle(0xeef4ff, 0.88);
  gfx.fillEllipse(ox + 60, oy + 40, 120, 28); // wide flat base
  gfx.fillEllipse(ox + 24, oy + 28,  56, 40); // left puff
  gfx.fillEllipse(ox + 60, oy + 18,  64, 48); // center dome (tallest)
  gfx.fillEllipse(ox + 96, oy + 26,  52, 36); // right puff
  gfx.fillEllipse(ox + 40, oy + 12,  32, 24); // small top-left detail

  // Bright highlight on top
  gfx.fillStyle(0xffffff, 0.55);
  gfx.fillEllipse(ox + 60, oy + 10, 40, 18);
}

/**
 * Bakes the cloud shape to a cached texture once per game (keyed on the
 * Phaser TextureManager, which is shared across scenes). Subsequent calls are
 * no-ops. Use `CLOUD_TEXTURE_KEY` to add Image instances using the cached art.
 */
export function ensureCloudTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(CLOUD_TEXTURE_KEY)) return;
  const gfx = scene.make.graphics({ x: 0, y: 0 }, false);
  drawCloudShape(gfx, CLOUD_TEX_OFFSET_X, CLOUD_TEX_OFFSET_Y);
  gfx.generateTexture(CLOUD_TEXTURE_KEY, CLOUD_TEX_W, CLOUD_TEX_H);
  gfx.destroy();
}

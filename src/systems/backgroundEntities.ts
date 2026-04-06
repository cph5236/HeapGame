import Phaser from 'phaser';

/**
 * Draws a cloud shape onto a Graphics object at local origin (0, 0).
 * The shape spans approximately 120×50 px before scaling.
 * Position and scale the graphics object after calling this.
 */
export function drawCloudShape(gfx: Phaser.GameObjects.Graphics): void {
  gfx.clear();

  // Main body
  gfx.fillStyle(0xeef4ff, 0.88);
  gfx.fillEllipse(60, 40, 120, 28); // wide flat base
  gfx.fillEllipse(24, 28,  56, 40); // left puff
  gfx.fillEllipse(60, 18,  64, 48); // center dome (tallest)
  gfx.fillEllipse(96, 26,  52, 36); // right puff
  gfx.fillEllipse(40, 12,  32, 24); // small top-left detail

  // Bright highlight on top
  gfx.fillStyle(0xffffff, 0.55);
  gfx.fillEllipse(60, 10, 40, 18);
}

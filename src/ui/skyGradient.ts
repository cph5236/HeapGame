// src/ui/skyGradient.ts
//
// The game's night-sky → sunset backdrop, shared by the boot loader and the
// update-required gate so every pre-menu screen reads as one system. Stops were
// sampled from MenuScene.createSkyGradient (which keeps its own richer version
// with clouds and parallax).

import Phaser from 'phaser';

/** Gradient stops as [position 0..1, 0xRRGGBB], top of sky → bottom. */
export const SKY_STOPS: [number, number][] = [
  [0.00, 0x0a0818], [0.16, 0x161c3a], [0.33, 0x222d55], [0.50, 0x37415e],
  [0.60, 0x5c4840], [0.70, 0x7d5228], [0.78, 0x8a5520], [0.86, 0x7a4a1a],
  [0.93, 0x5e3a14], [1.00, 0x3e280e],
];

/** Linear blend of two 0xRRGGBB colours; k=0 → a, k=1 → b. */
export function mix(a: number, b: number, k: number): number {
  const t = Math.max(0, Math.min(1, k));
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  return (Math.round(ar + (br - ar) * t) << 16)
       | (Math.round(ag + (bg - ag) * t) << 8)
       |  Math.round(ab + (bb - ab) * t);
}

/** Colour of the sky gradient at normalized vertical position p (0=top, 1=bottom). */
export function skyColorAt(p: number): number {
  const t = Math.max(0, Math.min(1, p));
  for (let i = 1; i < SKY_STOPS.length; i++) {
    const [p0, c0] = SKY_STOPS[i - 1];
    const [p1, c1] = SKY_STOPS[i];
    if (t <= p1) return mix(c0, c1, (t - p0) / (p1 - p0));
  }
  return SKY_STOPS[SKY_STOPS.length - 1][1];
}

/** Paint the gradient as banded rects filling w×h, plus faint stars up top. */
export function paintSkyGradient(scene: Phaser.Scene, w: number, h: number, stars = 40): void {
  const bg = scene.add.graphics();
  const steps = 48;
  for (let i = 0; i < steps; i++) {
    bg.fillStyle(skyColorAt(i / (steps - 1)), 1);
    bg.fillRect(0, Math.floor((h * i) / steps), w, Math.ceil(h / steps) + 1);
  }

  const starG = scene.add.graphics();
  for (let i = 0; i < stars; i++) {
    const roll = Phaser.Math.Between(0, 9);
    starG.fillStyle(0xffffff, roll < 6 ? 0.8 : roll < 9 ? 0.45 : 0.2);
    starG.fillCircle(
      Phaser.Math.Between(0, w),
      Phaser.Math.Between(0, h * 0.5),
      roll < 6 ? 0.7 : roll < 9 ? 1.2 : 1.8,
    );
  }
}

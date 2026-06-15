import Phaser from 'phaser';
import { getDprCap } from '../systems/displayMetrics';

/** Clean Arcade palette. Numbers are 0xRRGGBB; strings are for Text styles. */
export const HUD = {
  panelFill:   0x0a0c1a, panelAlpha: 0.45,
  border:      0xffffff, borderAlpha: 0.12,
  accent:      0xff9922,           // orange (primary action)
  accentDark:  0xb3650f,
  dash:        0x44aaff, dashGlow: 0x5cc8ff, dashDim: 0x225588,
  dashStroke:  0xff7755,           // dash button ring/stroke
  cloud:       0xdce8ff,
  textWhite:   '#ffffff',
  textAccent:  '#ffce8a',
} as const;

/** Bake (once) a rounded translucent panel texture at DPR scale, then return an
 *  Image using it. Avoids per-frame fillRoundedRect. Keyed by w×h×radius. */
export function makePanel(
  scene: Phaser.Scene, cx: number, cy: number, w: number, h: number, radius = 14,
): Phaser.GameObjects.Image {
  const key = `hud-panel-${w}x${h}-${radius}`;
  if (!scene.textures.exists(key)) {
    const dpr = getDprCap();
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(HUD.panelFill, HUD.panelAlpha);
    g.fillRoundedRect(0, 0, w * dpr, h * dpr, radius * dpr);
    g.lineStyle(1 * dpr, HUD.border, HUD.borderAlpha);
    g.strokeRoundedRect(0, 0, w * dpr, h * dpr, radius * dpr);
    g.generateTexture(key, Math.ceil(w * dpr), Math.ceil(h * dpr));
    g.destroy();
  }
  return scene.add.image(cx, cy, key).setScrollFactor(0).setDisplaySize(w, h);
}

/** Bake a 1×H vertical alpha-fade strip (top→bottom) and stretch it to the screen
 *  width. Used for the top/bottom legibility scrims. */
export function makeScrim(
  scene: Phaser.Scene, x: number, y: number, w: number, h: number,
  topAlpha: number, botAlpha: number,
): Phaser.GameObjects.Image {
  const key = `hud-scrim-${h}-${topAlpha}-${botAlpha}`;
  if (!scene.textures.exists(key)) {
    const dpr = getDprCap();
    const ph = Math.ceil(h * dpr);
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    for (let i = 0; i < ph; i++) {
      const t = i / (ph - 1);
      const a = topAlpha + (botAlpha - topAlpha) * t;
      g.fillStyle(0x080814, a);
      g.fillRect(0, i, dpr, 1);
    }
    g.generateTexture(key, dpr, ph);
    g.destroy();
  }
  return scene.add.image(x, y, key).setOrigin(0, 0).setDisplaySize(w, h).setScrollFactor(0);
}

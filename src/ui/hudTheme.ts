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
  dashChevron: 0xff5a33,           // orange-red dash-indicator chevrons
  cloud:       0xdce8ff,
  textWhite:   '#ffffff',
  textAccent:  '#ffce8a',
} as const;

/** Bake (once) a rounded translucent panel texture at DPR scale, then return an
 *  Image using it. Avoids per-frame fillRoundedRect. Keyed by w×h×radius×alpha.
 *  `fillAlpha` overrides the default panel opacity (used for chips that need to
 *  stay readable over the brighter sky, e.g. the score chip). */
export function makePanel(
  scene: Phaser.Scene, cx: number, cy: number, w: number, h: number, radius = 14,
  fillAlpha: number = HUD.panelAlpha,
): Phaser.GameObjects.Image {
  const key = `hud-panel-${w}x${h}-${radius}-${fillAlpha}`;
  if (!scene.textures.exists(key)) {
    const dpr = getDprCap();
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(HUD.panelFill, fillAlpha);
    g.fillRoundedRect(0, 0, w * dpr, h * dpr, radius * dpr);
    g.lineStyle(1 * dpr, HUD.border, HUD.borderAlpha);
    g.strokeRoundedRect(0, 0, w * dpr, h * dpr, radius * dpr);
    g.generateTexture(key, Math.ceil(w * dpr), Math.ceil(h * dpr));
    g.destroy();
  }
  return scene.add.image(cx, cy, key).setScrollFactor(0).setDisplaySize(w, h);
}

/** Bake (once) a clean puffy cloud glyph for the air-jump indicator, then return
 *  an Image centred at (cx, cy). Drawn in a 32×20 logical box at DPR scale. */
export function makeCloudIcon(
  scene: Phaser.Scene, cx: number, cy: number,
): Phaser.GameObjects.Image {
  const key = 'hud-cloud-icon';
  const W = 32, H = 20;
  if (!scene.textures.exists(key)) {
    const dpr = getDprCap();
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(HUD.cloud, 1);
    // Flat-ish rounded base, then overlapping puffs for the billowy top.
    g.fillRoundedRect(3 * dpr, 10 * dpr, 26 * dpr, 8 * dpr, 4 * dpr);
    g.fillCircle(11 * dpr, 10 * dpr, 7 * dpr);
    g.fillCircle(21 * dpr, 9  * dpr, 8 * dpr);
    g.fillCircle(27 * dpr, 12 * dpr, 5 * dpr);
    g.fillCircle(6  * dpr, 12 * dpr, 5 * dpr);
    g.generateTexture(key, Math.ceil(W * dpr), Math.ceil(H * dpr));
    g.destroy();
  }
  return scene.add.image(cx, cy, key).setScrollFactor(0).setDisplaySize(W, H);
}

/** Bake (once) the wall-jump glyph (A1 "bounce arrow"): a short wall bar with an
 *  arrow that rises from the lower-right, ricochets off the wall, and launches up
 *  and to the right. Drawn in a 64×64 design space at DPR scale; round caps/joins
 *  are faked with small fill dots at each vertex so it stays clean at any renderer.
 *  Returned as an Image displayed at 26×26 logical px. */
export function makeWallJumpIcon(
  scene: Phaser.Scene, cx: number, cy: number,
): Phaser.GameObjects.Image {
  const key = 'hud-walljump-icon';
  const SIZE = 26;
  if (!scene.textures.exists(key)) {
    const dpr = getDprCap();
    const u = (n: number) => n * dpr;        // design units → texture px
    const lw = 4;                            // stroke width in design units
    const g = scene.make.graphics({ x: 0, y: 0 }, false);

    // Wall bar.
    g.fillStyle(HUD.cloud, 1);
    g.fillRoundedRect(u(8), u(8), u(6), u(48), u(2));

    // Bounce arrow (tail → wall vertex → launch) + arrowhead, stroked.
    g.lineStyle(u(lw), HUD.cloud, 1);
    g.beginPath();
    g.moveTo(u(46), u(54)); g.lineTo(u(17), u(34)); g.lineTo(u(48), u(16));
    g.strokePath();
    g.beginPath();
    g.moveTo(u(36), u(15)); g.lineTo(u(48), u(16)); g.lineTo(u(43), u(27));
    g.strokePath();

    // Round every vertex/endpoint with a dot of radius lw/2.
    const r = u(lw / 2);
    for (const [x, y] of [[46, 54], [17, 34], [48, 16], [36, 15], [43, 27]]) {
      g.fillCircle(u(x), u(y), r);
    }

    g.generateTexture(key, Math.ceil(u(64)), Math.ceil(u(64)));
    g.destroy();
  }
  return scene.add.image(cx, cy, key).setScrollFactor(0).setDisplaySize(SIZE, SIZE);
}

/** Bake (once) the dash-indicator chevrons (design "D"): three orange-red `»`
 *  chevrons that grow and fade in like speed lines, meant to layer over the slim
 *  cooldown bar. Drawn in a 56×24 design space at DPR scale, round caps faked with
 *  fill dots. Returned as an Image with origin (0, 0.5) so its left edge can be
 *  pinned to the bar's left and it stays vertically centred. */
export function makeDashChevrons(
  scene: Phaser.Scene, x: number, y: number,
): Phaser.GameObjects.Image {
  const key = 'hud-dash-chevrons';
  const W = 26, H = 14;
  if (!scene.textures.exists(key)) {
    const dpr = getDprCap();
    const u = (n: number) => n * dpr;
    const sw = 6;                            // stroke width in design units
    const chevs: Array<{ a: number; pts: Array<[number, number]> }> = [
      { a: 0.5,  pts: [[0, 4],  [14, 12], [0, 20]] },
      { a: 0.78, pts: [[18, 2], [34, 12], [18, 22]] },
      { a: 1.0,  pts: [[38, 0], [56, 12], [38, 24]] },
    ];
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    for (const { a, pts } of chevs) {
      g.lineStyle(u(sw), HUD.dashChevron, a);
      g.beginPath();
      g.moveTo(u(pts[0][0]), u(pts[0][1]));
      g.lineTo(u(pts[1][0]), u(pts[1][1]));
      g.lineTo(u(pts[2][0]), u(pts[2][1]));
      g.strokePath();
      g.fillStyle(HUD.dashChevron, a);
      for (const [px, py] of pts) g.fillCircle(u(px), u(py), u(sw / 2));
    }
    g.generateTexture(key, Math.ceil(u(56)), Math.ceil(u(24)));
    g.destroy();
  }
  return scene.add.image(x, y, key).setScrollFactor(0).setOrigin(0, 0.5).setDisplaySize(W, H);
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

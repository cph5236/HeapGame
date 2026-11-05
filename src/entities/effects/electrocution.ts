import Phaser from 'phaser';
import { isReducedMotion, MIN_FLICKER_INTERVAL_MS } from '../../systems/accessibility';

const ARC_COLOR = 0xffe23a;
const REDRAW_MS = 60; // how often to re-randomize the arcs
/** Arc jitter under "Reduce flashing & motion": slow enough to read as a static
 *  crackle rather than a strobe. */
const REDUCED_REDRAW_MS = 250;

/**
 * Procedural electrocution overlay: a few randomized zap polylines around the
 * target plus a white/yellow tint flicker, for durationMs. Self-cleaning.
 *
 * Photosensitivity (WCAG 2.3.1): the thin arcs may re-randomize quickly, but the
 * whole-sprite tint swap is a brightness flash, so it never toggles faster than
 * MIN_FLICKER_INTERVAL_MS (≤ 2.5 flashes/s). With reduced motion on, the tint
 * holds steady and the arcs redraw slowly.
 */
export function playElectrocutionEffect(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.Sprite,
  durationMs: number,
): void {
  const g = scene.add.graphics().setDepth((target.depth ?? 0) + 1);

  const draw = (): void => {
    g.clear();
    const cx = target.x;
    const cy = target.y;
    const r = Math.max(target.displayWidth, target.displayHeight) * 0.6;
    g.lineStyle(2, ARC_COLOR, 0.9);
    for (let a = 0; a < 4; a++) {
      const baseAngle = (a / 4) * Math.PI * 2 + Math.random() * 0.6;
      g.beginPath();
      let px = cx;
      let py = cy;
      g.moveTo(px, py);
      const segs = 4;
      for (let s = 1; s <= segs; s++) {
        const t = s / segs;
        const jitter = (Math.random() - 0.5) * r * 0.5;
        px = cx + Math.cos(baseAngle) * r * t + Math.cos(baseAngle + Math.PI / 2) * jitter;
        py = cy + Math.sin(baseAngle) * r * t + Math.sin(baseAngle + Math.PI / 2) * jitter;
        g.lineTo(px, py);
      }
      g.strokePath();
    }
  };

  const reduced = isReducedMotion();
  draw();
  target.setTint(ARC_COLOR);

  const redraw = scene.time.addEvent({
    delay: reduced ? REDUCED_REDRAW_MS : REDRAW_MS,
    loop: true,
    callback: draw,
  });

  let flip = false;
  const flicker = reduced ? null : scene.time.addEvent({
    delay: MIN_FLICKER_INTERVAL_MS,
    loop: true,
    callback: () => {
      flip = !flip;
      target.setTint(flip ? 0xffffff : ARC_COLOR);
    },
  });

  scene.time.delayedCall(durationMs, () => {
    redraw.remove();
    flicker?.remove();
    g.destroy();
    target.clearTint();
  });
}

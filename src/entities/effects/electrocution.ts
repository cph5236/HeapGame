import Phaser from 'phaser';

const ARC_COLOR = 0xffe23a;
const REDRAW_MS = 60; // how often to re-randomize the arcs

/**
 * Procedural electrocution overlay: a few randomized zap polylines around the
 * target plus a white/yellow tint flicker, for durationMs. Self-cleaning.
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

  draw();
  let flip = false;
  const redraw = scene.time.addEvent({
    delay: REDRAW_MS,
    loop: true,
    callback: () => {
      draw();
      flip = !flip;
      if (flip) target.setTint(0xffffff);
      else target.setTint(ARC_COLOR);
    },
  });

  scene.time.delayedCall(durationMs, () => {
    redraw.remove();
    g.destroy();
    target.clearTint();
  });
}

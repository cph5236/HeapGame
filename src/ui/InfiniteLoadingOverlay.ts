import Phaser from 'phaser';
import { addToGameplayUi } from '../systems/GameplayUiCamera';
import { logicalWidth, logicalHeight } from '../systems/displayMetrics';

// Full-screen progress overlay shown while InfiniteGameScene pre-builds the
// opening stretch of heap (see INFINITE_PREGEN_BANDS). Authored in logical
// (CSS-pixel) coordinates and registered on the gameplay UI camera, so it fills
// the physical canvas and sits above the world + HUD.

const BACKDROP_COLOR = 0x0d0a07;
const BAR_BG_COLOR   = 0x2a2018;
const BAR_FILL_COLOR = 0xc9a24b;

/** Above the HUD/radar (depths 19–30); the backdrop hides the frozen world. */
const DEPTH = 100;

const BAR_WIDTH_FRAC = 0.62; // of logical viewport width
const BAR_HEIGHT     = 14;

export class InfiniteLoadingOverlay {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  /** Fill bar drawn at full width, revealed left→right via scaleX (0→1). */
  private readonly fill: Phaser.GameObjects.Rectangle;
  private readonly percent: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    const w  = logicalWidth(scene);
    const h  = logicalHeight(scene);
    const cx = w / 2;
    const cy = h / 2;

    const backdrop = scene.add.rectangle(cx, cy, w, h, BACKDROP_COLOR, 1)
      .setScrollFactor(0).setDepth(DEPTH);

    const title = scene.add.text(cx, cy - 48, 'Building the heap…', {
      fontFamily: 'sans-serif', fontSize: '20px', color: '#f0e2c8',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH + 1);

    const barW = Math.round(w * BAR_WIDTH_FRAC);
    const barX = cx - barW / 2;

    const barBg = scene.add.rectangle(cx, cy, barW, BAR_HEIGHT, BAR_BG_COLOR, 1)
      .setScrollFactor(0).setDepth(DEPTH + 1);

    this.fill = scene.add.rectangle(barX, cy, barW, BAR_HEIGHT, BAR_FILL_COLOR, 1)
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH + 2).setScale(0, 1);

    this.percent = scene.add.text(cx, cy + 30, '0%', {
      fontFamily: 'sans-serif', fontSize: '14px', color: '#c9a24b',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH + 1);

    this.objects.push(backdrop, title, barBg, this.fill, this.percent);
    addToGameplayUi(scene, this.objects);
  }

  /** Update the bar + label. `frac` is clamped to [0, 1]. */
  setProgress(frac: number): void {
    const f = Math.max(0, Math.min(1, frac));
    this.fill.scaleX = f;
    this.percent.setText(`${Math.round(f * 100)}%`);
  }

  destroy(): void {
    for (const o of this.objects) o.destroy();
    this.objects.length = 0;
  }
}

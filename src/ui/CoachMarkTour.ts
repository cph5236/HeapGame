import Phaser from 'phaser';
import { logicalWidth, logicalHeight } from '../systems/displayMetrics';
import { panelBand } from './menuTourLogic';

export interface CoachMarkTarget {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CoachMarkStep {
  /** Computed lazily at render time, not captured up front — the menu's
   *  layout can shift under the tour (e.g. layoutShift on short screens). */
  rect: () => CoachMarkTarget;
  caption: string;
}

const PAD = 10;
const DEPTH = 500; // above every MenuScene element (max existing depth is 20)

/**
 * A spotlight-style coach-mark tour: dims the screen except a cutout around
 * the current step's target, explains it, and blocks the real menu behind it
 * until the player advances or skips. One instance runs one pass through
 * `steps`, then calls `onDone` and tears itself down.
 */
export class CoachMarkTour {
  private readonly scene: Phaser.Scene;
  private readonly steps: CoachMarkStep[];
  private readonly onDone: () => void;
  private index = 0;

  private dim!: Phaser.GameObjects.Graphics;
  private panelBg!: Phaser.GameObjects.Graphics;
  private captionText!: Phaser.GameObjects.Text;
  private stepLabel!: Phaser.GameObjects.Text;
  private nextBtn!: Phaser.GameObjects.Text;
  private skipBtn!: Phaser.GameObjects.Text;
  private objects: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene, steps: CoachMarkStep[], opts: { onDone: () => void }) {
    this.scene = scene;
    this.steps = steps;
    this.onDone = opts.onDone;
  }

  start(): void {
    if (this.steps.length === 0) { this.onDone(); return; }

    // Block the real menu's keyboard shortcuts (Space/U/S/H/L/W) for the
    // duration of the tour. Pointer input is blocked separately below by the
    // dim itself being interactive and sitting above everything else — that
    // way this tour's own buttons keep working without touching
    // this.input.enabled scene-wide.
    const kb = this.scene.input.keyboard;
    if (kb) kb.enabled = false;
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.restoreKeyboard, this);

    const W = logicalWidth(this.scene);
    const H = logicalHeight(this.scene);

    this.dim = this.scene.add.graphics().setDepth(DEPTH)
      .setInteractive(new Phaser.Geom.Rectangle(0, 0, W, H), Phaser.Geom.Rectangle.Contains);
    this.dim.on('pointerup', () => this.advance());

    this.panelBg = this.scene.add.graphics().setDepth(DEPTH + 1);

    this.captionText = this.scene.add.text(W / 2, 0, '', {
      fontSize: '16px', color: '#ffffff', align: 'center',
      wordWrap: { width: Math.min(300, W - 64) },
    }).setOrigin(0.5, 0).setDepth(DEPTH + 2);

    this.stepLabel = this.scene.add.text(W / 2, 0, '', {
      fontSize: '12px', color: '#ffce6a',
    }).setOrigin(0.5, 0).setDepth(DEPTH + 2);

    this.nextBtn = this.scene.add.text(W / 2, 0, '', {
      fontSize: '17px', color: '#ffce6a', fontStyle: 'bold',
    }).setOrigin(0.5, 0).setDepth(DEPTH + 2).setInteractive({ useHandCursor: true });
    this.nextBtn.on('pointerup', () => this.advance());

    // Top-left, not top-right: the Settings step's target sits in the top-right
    // corner, and a top-right Skip button would visually collide with its cutout.
    this.skipBtn = this.scene.add.text(12, 12, 'Skip ✕', {
      fontSize: '13px', color: '#cccccc', backgroundColor: '#00000088', padding: { x: 8, y: 4 },
    }).setOrigin(0, 0).setDepth(DEPTH + 2).setInteractive({ useHandCursor: true });
    this.skipBtn.on('pointerup', () => this.finish());

    this.objects = [this.dim, this.panelBg, this.captionText, this.stepLabel, this.nextBtn, this.skipBtn];

    this.render();
  }

  private render(): void {
    const step = this.steps[this.index];
    const r = step.rect();
    const W = logicalWidth(this.scene);
    const H = logicalHeight(this.scene);

    const holeX = Math.max(0, r.x - PAD);
    const holeY = Math.max(0, r.y - PAD);
    const holeW = Math.min(W - holeX, r.w + PAD * 2);
    const holeH = Math.min(H - holeY, r.h + PAD * 2);

    this.dim.clear();
    this.dim.fillStyle(0x000000, 0.72);
    this.dim.fillRect(0, 0, W, holeY);                                   // top strip
    this.dim.fillRect(0, holeY + holeH, W, H - (holeY + holeH));          // bottom strip
    this.dim.fillRect(0, holeY, holeX, holeH);                           // left strip
    this.dim.fillRect(holeX + holeW, holeY, W - (holeX + holeW), holeH); // right strip
    this.dim.lineStyle(2, 0xffce6a, 0.95);
    this.dim.strokeRoundedRect(holeX, holeY, holeW, holeH, 10);

    // Panel band: always the half the target ISN'T in, so it never covers
    // the highlighted element.
    const band = panelBand(r.y + r.h / 2, H);
    const panelW = Math.min(320, W - 32);
    const panelH = 108;
    const panelX = W / 2 - panelW / 2;
    const panelY = band === 'bottom' ? H - panelH - 28 : 28;

    this.panelBg.clear();
    this.panelBg.fillStyle(0x140f0a, 0.96);
    this.panelBg.fillRoundedRect(panelX, panelY, panelW, panelH, 12);
    this.panelBg.lineStyle(2, 0xff9012, 0.9);
    this.panelBg.strokeRoundedRect(panelX, panelY, panelW, panelH, 12);

    this.captionText.setText(step.caption).setPosition(W / 2, panelY + 14);
    const isLast = this.index === this.steps.length - 1;
    this.stepLabel.setText(`${this.index + 1} / ${this.steps.length}`).setPosition(W / 2, panelY + panelH - 30);
    this.nextBtn.setText(isLast ? 'GOT IT ▸' : 'NEXT ▸').setPosition(W / 2, panelY + panelH - 30);
    // Step counter sits opposite the button within the same row so neither overlaps.
    this.stepLabel.setX(panelX + 16).setOrigin(0, 0);
    this.nextBtn.setOrigin(1, 0).setX(panelX + panelW - 16);
  }

  private advance(): void {
    this.index++;
    if (this.index >= this.steps.length) { this.finish(); return; }
    this.render();
  }

  private finish(): void {
    this.destroy();
    this.onDone();
  }

  private restoreKeyboard(): void {
    const kb = this.scene.input.keyboard;
    if (kb) kb.enabled = true;
  }

  destroy(): void {
    this.restoreKeyboard();
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.restoreKeyboard, this);
    this.objects.forEach(o => o.destroy());
    this.objects = [];
  }
}

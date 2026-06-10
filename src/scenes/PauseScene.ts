import Phaser from 'phaser';
import { buildControlsOverlay, type ControlsOverlay } from '../ui/buildControlsOverlay';
import { buildVolumePanel, type VolumePanel } from '../ui/buildVolumePanel';

export interface PauseSceneData {
  /** Scene key of the paused game scene to resume/stop. */
  gameSceneKey: string;
  /** Whether the device is mobile (drives controls-help copy). */
  isMobile: boolean;
}

type View = 'menu' | 'controls' | 'volume' | 'confirm';

const PANEL_W = 300;
const BTN_W   = 240;
const BTN_H   = 48;
const BTN_GAP = 14;

export class PauseScene extends Phaser.Scene {
  private gameSceneKey!: string;
  private isMobile = false;
  private menuParts: Phaser.GameObjects.GameObject[] = [];
  private controls?: ControlsOverlay;
  private volume?: VolumePanel;
  private backBtn?: Phaser.GameObjects.GameObject[];

  constructor() { super({ key: 'PauseScene' }); }

  init(data: PauseSceneData): void {
    this.gameSceneKey = data.gameSceneKey;
    this.isMobile     = data.isMobile;
    this.menuParts    = [];
  }

  create(): void {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;

    const bg = this.add.rectangle(cx, cy, this.scale.width, this.scale.height, 0x000000, 0.72)
      .setScrollFactor(0).setDepth(40).setInteractive();

    const titleY = cy - (BTN_H * 4 + BTN_GAP * 3) / 2 - 48;
    const title = this.add.text(cx, titleY, 'PAUSED', {
      fontSize: '28px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(42);

    const panelH = BTN_H * 4 + BTN_GAP * 3 + 40;
    const panel = this.add.rectangle(cx, cy, Math.min(PANEL_W, this.scale.width - 32), panelH, 0x0d0d20)
      .setScrollFactor(0).setDepth(41).setStrokeStyle(2, 0x4455aa).setInteractive();

    this.menuParts = [bg, title, panel];

    const labels: Array<[string, () => void]> = [
      ['Resume',           () => this.resumeGame()],
      ['Controls',         () => this.showView('controls')],
      ['Volume',           () => this.showView('volume')],
      ['Exit to Main Menu', () => this.showView('confirm')],
    ];
    const top = cy - (BTN_H * 4 + BTN_GAP * 3) / 2 + BTN_H / 2;
    labels.forEach(([text, onTap], i) => {
      const by = top + i * (BTN_H + BTN_GAP);
      const btn = this.add.rectangle(cx, by, BTN_W, BTN_H, 0x1a3a5c)
        .setScrollFactor(0).setDepth(42).setStrokeStyle(2, 0x4488ff).setInteractive({ useHandCursor: true });
      const lbl = this.add.text(cx, by, text, {
        fontSize: '19px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(43);
      btn.on('pointerup', onTap);
      this.menuParts.push(btn, lbl);
    });

    // Esc / P resume the game (toggle off).
    this.input.keyboard?.on('keydown-ESC', () => this.resumeGame());
    this.input.keyboard?.on('keydown-P',   () => this.resumeGame());

    // Sub-views (hidden until selected). Tapping their dim bg returns to the menu.
    this.controls = buildControlsOverlay(this, {
      isMobile: this.isMobile, depth: 44, onBackgroundTap: () => this.showView('menu'),
    });
    this.volume = buildVolumePanel(this, {
      depth: 44, onBackgroundTap: () => this.showView('menu'),
    });

    // Shared "← Back" button shown on any sub-view.
    const backY = this.scale.height - 48;
    const backBg = this.add.rectangle(this.scale.width / 2, backY, 160, 40, 0x222244)
      .setScrollFactor(0).setDepth(47).setStrokeStyle(2, 0x8899bb).setInteractive({ useHandCursor: true })
      .setVisible(false);
    const backLbl = this.add.text(this.scale.width / 2, backY, '← Back', {
      fontSize: '17px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(48).setVisible(false);
    backBg.on('pointerup', () => this.showView('menu'));
    this.backBtn = [backBg, backLbl];
  }

  private showView(view: View): void {
    const onMenu = view === 'menu';
    this.menuParts.forEach(o => (o as any).setVisible(onMenu));
    this.controls?.setOpen(view === 'controls');
    this.volume?.setOpen(view === 'volume');
    const showBack = view === 'controls' || view === 'volume';
    this.backBtn?.forEach(o => (o as any).setVisible(showBack));
    // 'confirm' view is handled in Task 5.
  }

  private resumeGame(): void {
    this.scene.resume(this.gameSceneKey);
    this.scene.stop();
  }
}

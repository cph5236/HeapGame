import Phaser from 'phaser';
import { setupUiCamera, logicalWidth, logicalHeight } from '../systems/displayMetrics';
import { InputManager } from '../systems/InputManager';
import { pauseSettingsData, type ControlHost } from './pauseSettings';
import { markRunEnded } from '../systems/dailyRunGate';

export interface PauseSceneData {
  /** Scene key of the paused game scene to resume/stop. */
  gameSceneKey: string;
}

type View = 'menu' | 'confirm';

const PANEL_W = 300;
const BTN_W   = 240;
const BTN_H   = 48;
const BTN_GAP = 14;

export class PauseScene extends Phaser.Scene {
  private gameSceneKey!: string;
  private menuParts: Phaser.GameObjects.GameObject[] = [];
  private confirmParts: Phaser.GameObjects.GameObject[] = [];

  constructor() { super({ key: 'PauseScene' }); }

  init(data: PauseSceneData): void {
    this.gameSceneKey = data.gameSceneKey;
    this.menuParts    = [];
  }

  create(): void {
    setupUiCamera(this);
    const cx = logicalWidth(this) / 2;
    const cy = logicalHeight(this) / 2;

    const bg = this.add.rectangle(cx, cy, logicalWidth(this), logicalHeight(this), 0x000000, 0.72)
      .setScrollFactor(0).setDepth(40).setInteractive();

    // Declared before the geometry below, which is derived from its length —
    // adding or removing a button re-lays-out the panel with no constant to update.
    const labels: Array<[string, () => void]> = [
      ['Resume',           () => this.resumeGame()],
      ['Settings',         () => this.openSettings()],
      ['Exit to Main Menu', () => this.showView('confirm')],
    ];
    const btnCount = labels.length;
    const stackH   = BTN_H * btnCount + BTN_GAP * (btnCount - 1);

    const titleY = cy - stackH / 2 - 48;
    const title = this.add.text(cx, titleY, 'PAUSED', {
      fontSize: '28px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(42);

    const panelH = stackH + 40;
    const panel = this.add.rectangle(cx, cy, Math.min(PANEL_W, logicalWidth(this) - 32), panelH, 0x0d0d20)
      .setScrollFactor(0).setDepth(41).setStrokeStyle(2, 0x4455aa).setInteractive();

    this.menuParts = [bg, title, panel];

    const top = cy - stackH / 2 + BTN_H / 2;
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

    // ── Exit-confirm sub-view (hidden until 'confirm') ─────────────────────────
    const ccx = logicalWidth(this) / 2;
    const ccy = logicalHeight(this) / 2;
    const cbg = this.add.rectangle(ccx, ccy, logicalWidth(this), logicalHeight(this), 0x000000, 0.8)
      .setScrollFactor(0).setDepth(49).setVisible(false).setInteractive();
    const cpanel = this.add.rectangle(ccx, ccy, Math.min(320, logicalWidth(this) - 32), 200, 0x0d0d20)
      .setScrollFactor(0).setDepth(50).setStrokeStyle(2, 0xff4444).setVisible(false);
    const cmsg = this.add.text(ccx, ccy - 50, 'Quit run?\nThis run\'s progress is lost.', {
      fontSize: '17px', color: '#ffdddd', align: 'center', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(51).setVisible(false);
    const cancelBtn = this.add.rectangle(ccx - 70, ccy + 40, 120, 44, 0x223344)
      .setScrollFactor(0).setDepth(51).setStrokeStyle(2, 0x8899bb).setVisible(false).setInteractive({ useHandCursor: true });
    const cancelLbl = this.add.text(ccx - 70, ccy + 40, 'Cancel', {
      fontSize: '17px', color: '#ffffff',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(52).setVisible(false);
    const quitBtn = this.add.rectangle(ccx + 70, ccy + 40, 120, 44, 0x881111)
      .setScrollFactor(0).setDepth(51).setStrokeStyle(2, 0xff4444).setVisible(false).setInteractive({ useHandCursor: true });
    const quitLbl = this.add.text(ccx + 70, ccy + 40, 'Quit', {
      fontSize: '17px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(52).setVisible(false);
    cancelBtn.on('pointerup', () => this.showView('menu'));
    quitBtn.on('pointerup',   () => this.exitToMenu());
    this.confirmParts = [cbg, cpanel, cmsg, cancelBtn, cancelLbl, quitBtn, quitLbl];

    // Swallow taps over the whole overlay so dismissing the pause menu (Resume,
    // Exit, or a sub-view tap) never leaks a jump/dash into the resumed game.
    // The suppression is decided at touchstart, so it must be registered while the
    // overlay is up; resumeGame()/exitToMenu() clear it.
    InputManager.getInstance().setSuppressionRect('pause', {
      x: 0, y: 0, w: logicalWidth(this), h: logicalHeight(this),
    });
  }

  private showView(view: View): void {
    this.menuParts.forEach(o => (o as any).setVisible(view === 'menu'));
    this.confirmParts.forEach(o => (o as any).setVisible(view === 'confirm'));
  }

  /** Open the shared Settings modal over the pause menu. SettingsScene pauses
   *  this scene and resumes it on close, so the pause buttons underneath stay
   *  inert; the game scene below remains paused throughout. */
  private openSettings(): void {
    if (this.scene.isActive('SettingsScene')) return; // guard against double-open
    // The host is resolved per tap, not captured here: it may be stopped while
    // Settings is open (Exit to Main Menu), and re-mounting a dead scene throws.
    this.scene.launch('SettingsScene', pauseSettingsData(
      this.scene.key,
      () => this.scene.get(this.gameSceneKey) as ControlHost | undefined,
    ));
  }

  private resumeGame(): void {
    const im = InputManager.getInstance();
    im.setSuppressionRect('pause', null);
    im.clearBufferedActions(); // drop the dismiss tap so it can't fire a jump on resume
    this.scene.resume(this.gameSceneKey);
    this.scene.stop();
  }

  private exitToMenu(): void {
    InputManager.getInstance().setSuppressionRect('pause', null);
    markRunEnded();
    this.scene.stop(this.gameSceneKey);
    this.scene.stop();
    this.scene.start('MenuScene');
  }
}

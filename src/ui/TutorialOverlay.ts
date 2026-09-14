import Phaser from 'phaser';
import { addToGameplayUi } from '../systems/GameplayUiCamera';
import { logicalWidth, logicalHeight } from '../systems/displayMetrics';

/** Info-panel geometry. Width is fixed (it reads well at phone widths); height
 *  is derived from the message, since steps range from one line to several
 *  paragraphs. */
const PANEL_W = 300;
const PANEL_PAD = 18;
/** Gap between the message and the NEXT button. */
const PANEL_GAP = 14;
/** Smallest the message may shrink to before we stop trying to fit it. */
const MIN_FONT_PX = 11;
const BASE_FONT_PX = 16;

export class TutorialOverlay {
  private dim: Phaser.GameObjects.Rectangle;
  private panel: Phaser.GameObjects.Graphics;
  private text: Phaser.GameObjects.Text;
  private nextBtn: Phaser.GameObjects.Text;
  private hintBanner: Phaser.GameObjects.Text;
  private skipBtn: Phaser.GameObjects.Text;
  private readonly W: number;
  private readonly H: number;

  constructor(
    scene: Phaser.Scene,
    opts: { onNext: () => void; onSkip: () => void },
  ) {
    const W = logicalWidth(scene);
    const H = logicalHeight(scene);
    this.W = W;
    this.H = H;

    this.dim = scene.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.55)
      .setScrollFactor(0).setDepth(60).setVisible(false);

    // Drawn per message in layoutInfoPanel(), not here: the panel has to fit
    // whatever copy the step carries. It was a fixed 300x140 box sized for a
    // one-line greeting, so the multi-paragraph stamina explainer spilled out
    // of it and the NEXT button landed on top of the text.
    this.panel = scene.add.graphics().setScrollFactor(0).setDepth(61).setVisible(false);

    this.text = scene.add.text(W / 2, H / 2, '', {
      fontSize: '16px', color: '#ffffff', align: 'center',
      wordWrap: { width: PANEL_W - PANEL_PAD * 2 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(62).setVisible(false);

    this.nextBtn = scene.add.text(W / 2, H / 2 + 44, 'NEXT ▸', {
      fontSize: '18px', color: '#ffce6a', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(62).setVisible(false)
      .setInteractive({ useHandCursor: true });
    this.nextBtn.on('pointerup', () => opts.onNext());

    this.hintBanner = scene.add.text(W / 2, 64, '', {
      fontSize: '15px', color: '#ffffff', align: 'center', backgroundColor: '#000000aa',
      padding: { x: 12, y: 8 }, wordWrap: { width: W - 60 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(60).setVisible(false);

    this.skipBtn = scene.add.text(W - 12, 12, 'Skip ✕', {
      fontSize: '13px', color: '#cccccc', backgroundColor: '#00000088', padding: { x: 8, y: 4 },
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(63)
      .setInteractive({ useHandCursor: true });
    this.skipBtn.on('pointerup', () => opts.onSkip());

    addToGameplayUi(scene, [this.dim, this.panel, this.text, this.nextBtn, this.hintBanner, this.skipBtn]);
  }

  showInfo(message: string): void {
    this.hintBanner.setVisible(false);
    this.text.setText(message);
    this.layoutInfoPanel();
    this.dim.setVisible(true);
    this.panel.setVisible(true);
    this.text.setVisible(true);
    this.nextBtn.setVisible(true);
  }

  /** Size the panel to the message and stack text above the NEXT button.
   *  Called on every showInfo because step copy varies from one line to several
   *  paragraphs. */
  private layoutInfoPanel(): void {
    const { W, H } = this;
    const btnH = this.nextBtn.height;
    const chrome = PANEL_PAD * 2 + PANEL_GAP + btnH;
    // Never taller than the viewport; shrink the copy a step at a time if the
    // message cannot fit at the base size (small landscape phones).
    const maxPanelH = H - 40;
    const maxTextH = Math.max(0, maxPanelH - chrome);

    let fontPx = BASE_FONT_PX;
    this.text.setFontSize(fontPx);
    while (this.text.height > maxTextH && fontPx > MIN_FONT_PX) {
      fontPx -= 1;
      this.text.setFontSize(fontPx);
    }

    const textH = this.text.height;
    const panelH = Math.min(maxPanelH, chrome + textH);
    const left = W / 2 - PANEL_W / 2;
    const top = H / 2 - panelH / 2;

    this.panel.clear();
    this.panel.fillStyle(0x140f0a, 0.96).fillRoundedRect(left, top, PANEL_W, panelH, 12);
    this.panel.lineStyle(2, 0xff9012, 0.9).strokeRoundedRect(left, top, PANEL_W, panelH, 12);

    this.text.setPosition(W / 2, top + PANEL_PAD + textH / 2);
    this.nextBtn.setPosition(W / 2, top + panelH - PANEL_PAD - btnH / 2);
  }

  showHint(message: string): void {
    this.dim.setVisible(false);
    this.panel.setVisible(false);
    this.text.setVisible(false);
    this.nextBtn.setVisible(false);
    this.hintBanner.setText(message).setVisible(true);
  }

  hide(): void {
    this.dim.setVisible(false);
    this.panel.setVisible(false);
    this.text.setVisible(false);
    this.nextBtn.setVisible(false);
    this.hintBanner.setVisible(false);
  }

  destroy(): void {
    [this.dim, this.panel, this.text, this.nextBtn, this.hintBanner, this.skipBtn].forEach(o => o.destroy());
  }
}

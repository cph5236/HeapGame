import Phaser from 'phaser';
import { addToGameplayUi } from '../systems/GameplayUiCamera';
import { logicalWidth, logicalHeight } from '../systems/displayMetrics';

export class TutorialOverlay {
  private dim: Phaser.GameObjects.Rectangle;
  private panel: Phaser.GameObjects.Graphics;
  private text: Phaser.GameObjects.Text;
  private nextBtn: Phaser.GameObjects.Text;
  private hintBanner: Phaser.GameObjects.Text;
  private skipBtn: Phaser.GameObjects.Text;

  constructor(
    scene: Phaser.Scene,
    opts: { onNext: () => void; onSkip: () => void },
  ) {
    const W = logicalWidth(scene);
    const H = logicalHeight(scene);

    this.dim = scene.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.55)
      .setScrollFactor(0).setDepth(60).setVisible(false);

    this.panel = scene.add.graphics().setScrollFactor(0).setDepth(61).setVisible(false);
    this.panel.fillStyle(0x140f0a, 0.96).fillRoundedRect(W / 2 - 150, H / 2 - 70, 300, 140, 12);
    this.panel.lineStyle(2, 0xff9012, 0.9).strokeRoundedRect(W / 2 - 150, H / 2 - 70, 300, 140, 12);

    this.text = scene.add.text(W / 2, H / 2 - 20, '', {
      fontSize: '16px', color: '#ffffff', align: 'center', wordWrap: { width: 270 },
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
    this.dim.setVisible(true);
    this.panel.setVisible(true);
    this.text.setVisible(true);
    this.nextBtn.setVisible(true);
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

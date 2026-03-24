import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../constants';
import { getBalance, resetAllData } from '../systems/SaveData';
import { clearHeapAdditions } from '../systems/HeapPersistence';
import { InputManager } from '../systems/InputManager';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MenuScene' });
  }

  create(): void {
    const im = InputManager.getInstance();

    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 120, 'HEAP', {
      fontSize: '72px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 6,
    }).setOrigin(0.5);

    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 20, `Balance: ${getBalance()} coins`, {
      fontSize: '18px',
      color: '#aaddff',
    }).setOrigin(0.5);

    const startLabel = im.isMobile ? 'TAP \u2014 Start run' : 'SPACE \u2014 Start run';
    const startText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 40, startLabel, {
      fontSize: '22px',
      color: '#ffffff',
    }).setOrigin(0.5);

    const upgradeLabel = im.isMobile ? 'TAP \u2014 Upgrades' : 'U \u2014 Upgrades';
    const upgradeText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 85, upgradeLabel, {
      fontSize: '22px',
      color: '#ffdd44',
    }).setOrigin(0.5);

    // iOS tilt permission button
    if (im.isMobile && !im.tiltPermissionGranted) {
      const tiltBtn = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 140,
        'Enable Tilt Controls', {
          fontSize: '18px',
          color: '#88aaff',
          stroke: '#000000',
          strokeThickness: 2,
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      tiltBtn.on('pointerup', () => {
        im.requestTiltPermission().then(() => tiltBtn.setVisible(false));
      });
    }

    this.createSettingsButton();

    // Wait one frame before listening so the input that launched this scene
    // doesn't immediately trigger anything
    this.time.delayedCall(100, () => {
      this.input.keyboard!.once('keydown-SPACE', () => this.scene.start('GameScene'));
      this.input.keyboard!.once('keydown-U',     () => this.scene.start('UpgradeScene'));

      if (im.isMobile) {
        startText.setInteractive(
          new Phaser.Geom.Rectangle(-200, -35, 400, 70),
          Phaser.Geom.Rectangle.Contains
        );
        startText.once('pointerup', () => this.scene.start('GameScene'));

        upgradeText.setInteractive(
          new Phaser.Geom.Rectangle(-200, -35, 400, 70),
          Phaser.Geom.Rectangle.Contains
        );
        upgradeText.once('pointerup', () => this.scene.start('UpgradeScene'));
      }
    });
  }

  private createSettingsButton(): void {
    const bx = GAME_WIDTH - 22;
    const by = GAME_HEIGHT - 22;

    // Circle background
    const btnGfx = this.add.graphics();
    btnGfx.fillStyle(0x000000, 0.65);
    btnGfx.fillCircle(bx, by, 14);
    btnGfx.lineStyle(2, 0x8899bb, 1);
    btnGfx.strokeCircle(bx, by, 14);

    // Gear icon
    this.add.text(bx, by, '\u2699', {
      fontSize: '16px', color: '#ddddff',
    }).setOrigin(0.5);

    // Hit zone
    const hitZone = this.add.zone(bx, by, 36, 36);
    hitZone.setInteractive({ useHandCursor: true });

    // Overlay (hidden by default)
    const overlayBg = this.add.rectangle(
      GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.72,
    ).setDepth(10).setVisible(false).setInteractive();

    const panel = this.add.rectangle(
      GAME_WIDTH / 2, GAME_HEIGHT / 2, 340, 240, 0x0d0d20,
    ).setDepth(11).setVisible(false).setStrokeStyle(2, 0x4455aa);

    const title = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 90, 'SETTINGS', {
      fontSize: '28px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(12).setVisible(false);

    // Reset button
    const resetBg = this.add.rectangle(
      GAME_WIDTH / 2, GAME_HEIGHT / 2, 240, 50, 0x881111,
    ).setDepth(12).setVisible(false).setStrokeStyle(2, 0xff4444)
      .setInteractive({ useHandCursor: true });

    const resetLabel = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'Reset All Data', {
      fontSize: '20px', color: '#ffffff', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(13).setVisible(false);

    const resetWarning = this.add.text(
      GAME_WIDTH / 2, GAME_HEIGHT / 2 + 50,
      'Clears all coins, upgrades\nand placed blocks.',
      {
        fontSize: '14px', color: '#aa8888', align: 'center',
      },
    ).setOrigin(0.5).setDepth(12).setVisible(false);

    const overlayParts = [overlayBg, panel, title, resetBg, resetLabel, resetWarning];

    const open  = () => overlayParts.forEach(p => p.setVisible(true));
    const close = () => overlayParts.forEach(p => p.setVisible(false));

    hitZone.on('pointerup', open);
    overlayBg.on('pointerup', close);

    resetBg.on('pointerup', () => {
      resetAllData();
      clearHeapAdditions();
      this.scene.restart();
    });
  }
}

import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../constants';
import { getBalance } from '../systems/SaveData';
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

    // Wait one frame before listening so the input that launched this scene
    // doesn't immediately start the game
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
}

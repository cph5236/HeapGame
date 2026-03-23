import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../constants';
import { getBalance } from '../systems/SaveData';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MenuScene' });
  }

  create(): void {
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

    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 40, 'SPACE \u2014 Start run', {
      fontSize: '22px',
      color: '#ffffff',
    }).setOrigin(0.5);

    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 85, 'U \u2014 Upgrades', {
      fontSize: '22px',
      color: '#ffdd44',
    }).setOrigin(0.5);

    // Wait one frame before listening so the keydown that launched this scene
    // doesn't immediately start the game
    this.time.delayedCall(100, () => {
      this.input.keyboard!.once('keydown-SPACE', () => this.scene.start('GameScene'));
      this.input.keyboard!.once('keydown-U',     () => this.scene.start('UpgradeScene'));
    });
  }
}

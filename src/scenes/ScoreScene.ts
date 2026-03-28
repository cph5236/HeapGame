import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, SCORE_TO_COINS_DIVISOR } from '../constants';
import { addBalance, getBalance, getPlayerConfig } from '../systems/SaveData';
import { InputManager } from '../systems/InputManager';

export class ScoreScene extends Phaser.Scene {
  private score:   number  = 0;
  private isPeak:  boolean = false;

  constructor() {
    super({ key: 'ScoreScene' });
  }

  init(data: { score: number; isPeak?: boolean }): void {
    this.score  = data.score  ?? 0;
    this.isPeak = data.isPeak ?? false;
  }

  create(): void {
    const cfg       = getPlayerConfig();
    const mult      = cfg.moneyMultiplier;
    const peakMult  = cfg.peakMultiplier;
    const baseCoins = Math.floor(this.score / SCORE_TO_COINS_DIVISOR * mult);
    const coins     = this.isPeak ? Math.floor(baseCoins * peakMult) : baseCoins;
    addBalance(coins);
    const balance = getBalance();

    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.6);

    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 150, 'RUN COMPLETE', {
      fontSize: '40px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5);

    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, `Score: ${this.score}`, {
      fontSize: '48px',
      color: '#ffdd44',
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5);

    const multLabel = mult !== 1 ? `  (${mult.toFixed(1)}\u00d7)` : '';
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 20, `+${coins} coins${multLabel}`, {
      fontSize: '26px',
      color: '#44ff88',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5);

    if (this.isPeak) {
      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 55, `PEAK BONUS \u00d7${peakMult.toFixed(2)}!`, {
        fontSize: '20px',
        color: '#ffdd44',
        stroke: '#000000',
        strokeThickness: 3,
      }).setOrigin(0.5);
    }

    const balanceY = this.isPeak ? GAME_HEIGHT / 2 + 90 : GAME_HEIGHT / 2 + 65;
    this.add.text(GAME_WIDTH / 2, balanceY, `Balance: ${balance} coins`, {
      fontSize: '20px',
      color: '#aaddff',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5);

    const im = InputManager.getInstance();
    const continueLabel = im.isMobile ? 'Tap for menu' : 'Press any key for menu';
    const continueText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 130, continueLabel, {
      fontSize: '20px',
      color: '#aaaaaa',
    }).setOrigin(0.5);

    this.time.delayedCall(300, () => {
      const goMenu = () => { this.scene.stop('GameScene'); this.scene.start('MenuScene'); };
      this.input.keyboard!.once('keydown', goMenu);
      if (im.isMobile) {
        continueText.setInteractive({ useHandCursor: true });
        continueText.once('pointerup', goMenu);
      }
    });
  }
}

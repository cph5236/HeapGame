import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  create(): void {
    this.createPlayerTexture();
    this.createPlatformTexture();
    this.scene.start('MenuScene');
  }

  private createPlayerTexture(): void {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0x00ff88, 1);
    g.fillRect(0, 0, 32, 48);
    g.generateTexture('player', 32, 48);
    g.destroy();
  }

  private createPlatformTexture(): void {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0x8b5e3c, 1);
    g.fillRect(0, 0, 200, 64);
    g.lineStyle(2, 0xd4a96a, 0.8);
    g.strokeRect(0, 0, 200, 64);
    g.generateTexture('platform', 200, 64);
    g.destroy();
  }
}

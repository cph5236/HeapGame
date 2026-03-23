import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  create(): void {
    this.createPlayerTexture();
    this.createPlatformTexture();
    this.createCloudTexture();
    this.createWallJumpTexture();
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

  private createCloudTexture(): void {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(10, 14, 8);
    g.fillCircle(18, 10, 10);
    g.fillCircle(26, 14, 8);
    g.fillRect(2, 14, 28, 8);
    g.generateTexture('cloud', 32, 22);
    g.destroy();
  }

  private createWallJumpTexture(): void {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    // Wall (left side)
    g.fillStyle(0xaaaaaa, 1);
    g.fillRect(0, 0, 6, 32);
    // Arrow pointing right (away from wall)
    g.fillStyle(0xffffff, 1);
    g.fillTriangle(8, 6, 8, 26, 22, 16);
    g.generateTexture('wall-jump', 24, 32);
    g.destroy();
  }
}

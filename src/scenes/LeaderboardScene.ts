import Phaser from 'phaser';

export interface LeaderboardSceneData {
  heapId:   string;
  heapName: string;
  playerId: string;
}

export class LeaderboardScene extends Phaser.Scene {
  private heapName!: string;

  constructor() { super({ key: 'LeaderboardScene' }); }

  init(data: LeaderboardSceneData): void {
    this.heapName = data.heapName;
  }

  create(): void {
    const W = this.scale.width;
    const H = this.scale.height;

    // Backdrop — blocks input to scene below
    this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.7)
      .setInteractive();

    // Panel
    const panelW = Math.floor(W * 0.92);
    const panelH = Math.floor(H * 0.86);
    const panelX = Math.floor((W - panelW) / 2);
    const panelY = Math.floor((H - panelH) / 2);
    this.add.rectangle(W / 2, H / 2, panelW, panelH, 0x10131f)
      .setStrokeStyle(2, 0x334466);

    // Header
    this.add.text(panelX + 16, panelY + 20, this.heapName, {
      fontSize: '18px', fontStyle: 'bold', color: '#ffcc88',
      stroke: '#000000', strokeThickness: 3,
    });

    const close = this.add.text(panelX + panelW - 20, panelY + 20, '✕', {
      fontSize: '20px', color: '#667799',
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    close.on('pointerover', () => close.setColor('#ffffff'));
    close.on('pointerout',  () => close.setColor('#667799'));
    close.on('pointerup',   () => this.closeModal());

    // Header underline
    this.add.rectangle(W / 2, panelY + 56, panelW - 32, 1, 0x334466);

    // Placeholder body — replaced in Task 10
    this.add.text(W / 2, H / 2, 'Loading…', {
      fontSize: '16px', color: '#8899aa',
    }).setOrigin(0.5);

    this.input.keyboard?.on('keydown-ESC', () => this.closeModal());
  }

  private closeModal(): void {
    this.scene.resume('HeapSelectScene');
    this.scene.stop();
  }
}

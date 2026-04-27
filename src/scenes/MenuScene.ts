import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../constants';
import { getBalance, getPlaced, resetAllData, getPlayerName, setPlayerName } from '../systems/SaveData';
import { InputManager } from '../systems/InputManager';
import { drawCloudShape } from '../systems/backgroundEntities';
import { type HeapParams, DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';
import { formatDifficulty } from '../ui/DifficultyStars';

export class MenuScene extends Phaser.Scene {
  private farSilhouette!: Phaser.GameObjects.Graphics;
  private nearSilhouette!: Phaser.GameObjects.Graphics;
  private horizonGlow!: Phaser.GameObjects.Graphics;
  private playerFigure!: Phaser.GameObjects.Image;
  private titleShadow!: Phaser.GameObjects.Text;
  private titleText!: Phaser.GameObjects.Text;
  private taglineText!: Phaser.GameObjects.Text;
  private balanceText!: Phaser.GameObjects.Text;
  private startBg!: Phaser.GameObjects.Graphics;
  private upgradeBg!: Phaser.GameObjects.Graphics;
  private storeBg!: Phaser.GameObjects.Graphics;
  private startText!: Phaser.GameObjects.Text;
  private upgradeText!: Phaser.GameObjects.Text;
  private storeText!: Phaser.GameObjects.Text;
  private twinkleStars: Phaser.GameObjects.Graphics[] = [];
  private resetConfirmed = false;
  private playerNameText!: Phaser.GameObjects.Text;
  private heapPickerBg!:    Phaser.GameObjects.Graphics;
  private heapPickerText!:  Phaser.GameObjects.Text;
  private heapPickerStars!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'MenuScene' });
  }

  create(): void {
    this.twinkleStars = [];
    this.resetConfirmed = false;

    const im = InputManager.getInstance();

    this.createSkyGradient();
    this.createStarField();
    this.createFarSilhouette();
    this.createHorizonGlow();
    this.createNearSilhouette();
    this.createPlayerFigure();
    this.createTitle();
    this.createTagline();
    this.createFloatingClouds();
    this.createBalanceText();
    this.createPlayerName();
    this.createPrompts(im);
    this.createHeapPicker();
    this.createSettingsButton();
    this.createInfoButton();
    if (!im.isMobile) this.createHotkeyLegend();
    this.runEntranceSequence();
    this.registerInput();
  }

  // ── Sky ──────────────────────────────────────────────────────────────────────

  private createSkyGradient(): void {
    const bands: [number, number, number][] = [
      [0,   47,  0x0a0818],
      [47,  47,  0x0e0d24],
      [94,  47,  0x121530],
      [141, 47,  0x161c3a],
      [188, 47,  0x1a2244],
      [235, 47,  0x1e284e],
      [282, 47,  0x222d55],
      [329, 47,  0x2a3460],
      [376, 47,  0x2e3860],
      [423, 47,  0x37415e],
      [470, 47,  0x4a4455],
      [517, 47,  0x5c4840],
      [564, 47,  0x6e4e30],
      [611, 47,  0x7d5228],
      [658, 47,  0x8a5520],
      [705, 47,  0x7a4a1a],
      [752, 47,  0x5e3a14],
      [799, 55,  0x3e280e],
    ];
    const g = this.add.graphics().setDepth(0);
    for (const [y, h, color] of bands) {
      g.fillStyle(color, 1);
      g.fillRect(0, y, GAME_WIDTH, h);
    }
  }

  // ── Stars ────────────────────────────────────────────────────────────────────

  private createStarField(): void {
    const staticG = this.add.graphics().setDepth(1);

    for (let i = 0; i < 68; i++) {
      const x = Phaser.Math.Between(0, GAME_WIDTH);
      const y = Phaser.Math.Between(0, 514);
      const roll = Phaser.Math.Between(0, 9);
      const r = roll < 6 ? 0.7 : roll < 9 ? 1.2 : 2.0;
      const a = roll < 6 ? 0.9 : roll < 9 ? 0.55 : 0.25;
      staticG.fillStyle(0xffffff, a);
      staticG.fillCircle(x, y, r);
    }

    for (let i = 0; i < 12; i++) {
      const g = this.add.graphics().setDepth(1);
      const x = Phaser.Math.Between(0, GAME_WIDTH);
      const y = Phaser.Math.Between(0, 514);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(x, y, 1.2);
      this.twinkleStars.push(g);
    }
  }

  // ── Heap silhouettes ─────────────────────────────────────────────────────────

  private createFarSilhouette(): void {
    const points = [
      { x: -20, y: 854 }, { x: -20, y: 700 }, { x: 10,  y: 660 }, { x: 40,  y: 680 },
      { x: 60,  y: 620 }, { x: 90,  y: 590 }, { x: 115, y: 610 }, { x: 140, y: 570 },
      { x: 170, y: 540 }, { x: 195, y: 560 }, { x: 220, y: 510 }, { x: 240, y: 440 },
      { x: 265, y: 480 }, { x: 290, y: 455 }, { x: 320, y: 490 }, { x: 345, y: 520 },
      { x: 370, y: 500 }, { x: 395, y: 540 }, { x: 420, y: 580 }, { x: 440, y: 555 },
      { x: 460, y: 610 }, { x: 490, y: 640 }, { x: 500, y: 700 }, { x: 500, y: 854 },
    ];
    this.farSilhouette = this.add.graphics().setDepth(2).setAlpha(0);
    this.farSilhouette.fillStyle(0x1a1225, 1);
    this.farSilhouette.fillPoints(points, true);
  }

  private createNearSilhouette(): void {
    const points = [
      { x: 0,   y: 854 }, { x: 0,   y: 720 }, { x: 18,  y: 695 }, { x: 35,  y: 710 },
      { x: 50,  y: 670 }, { x: 68,  y: 640 }, { x: 82,  y: 655 }, { x: 100, y: 615 },
      { x: 118, y: 595 }, { x: 130, y: 610 }, { x: 148, y: 575 }, { x: 162, y: 548 },
      { x: 175, y: 565 }, { x: 192, y: 530 }, { x: 208, y: 505 }, { x: 220, y: 520 },
      { x: 235, y: 490 }, { x: 248, y: 465 }, { x: 255, y: 478 }, { x: 262, y: 450 },
      { x: 268, y: 420 }, { x: 272, y: 395 }, { x: 278, y: 410 }, { x: 284, y: 388 },
      { x: 290, y: 400 }, { x: 296, y: 415 }, { x: 304, y: 435 }, { x: 316, y: 455 },
      { x: 328, y: 440 }, { x: 340, y: 465 }, { x: 355, y: 490 }, { x: 368, y: 475 },
      { x: 382, y: 505 }, { x: 395, y: 530 }, { x: 408, y: 515 }, { x: 422, y: 545 },
      { x: 438, y: 570 }, { x: 450, y: 555 }, { x: 462, y: 590 }, { x: 472, y: 625 },
      { x: 480, y: 660 }, { x: 480, y: 854 },
    ];
    this.nearSilhouette = this.add.graphics().setDepth(4).setAlpha(0);
    this.nearSilhouette.fillStyle(0x0d0910, 1);
    this.nearSilhouette.fillPoints(points, true);
  }

  // ── Horizon glow ─────────────────────────────────────────────────────────────

  private createHorizonGlow(): void {
    this.horizonGlow = this.add.graphics().setDepth(3).setAlpha(0);
    this.horizonGlow.fillStyle(0xff8833, 0.12);
    this.horizonGlow.fillEllipse(GAME_WIDTH / 2, 450, 460, 60);
    this.horizonGlow.fillStyle(0xff6611, 0.07);
    this.horizonGlow.fillEllipse(GAME_WIDTH / 2, 445, 360, 40);
    this.horizonGlow.fillStyle(0xffaa44, 0.05);
    this.horizonGlow.fillEllipse(GAME_WIDTH / 2, 455, 300, 25);
  }

  // ── Player figure ────────────────────────────────────────────────────────────

  private createPlayerFigure(): void {
    this.playerFigure = this.add.image(284, 388, 'trashbag')
      .setOrigin(0.5, 1.0)
      .setScale(0.9)
      .setDepth(5)
      .setAlpha(0);
  }

  // ── Title ────────────────────────────────────────────────────────────────────

  private createTitle(): void {
    this.titleShadow = this.add.text(244, 306, 'HEAP', {
      fontSize: '96px',
      fontStyle: 'bold',
      color: '#000000',
      stroke: '#000000',
      strokeThickness: 12,
    }).setOrigin(0.5).setAlpha(0).setDepth(6);

    this.titleText = this.add.text(240, 300, 'HEAP', {
      fontSize: '96px',
      fontStyle: 'bold',
      color: '#ff9922',
      stroke: '#1a0800',
      strokeThickness: 8,
    }).setOrigin(0.5).setAlpha(0).setDepth(6);
  }

  // ── Tagline ──────────────────────────────────────────────────────────────────

  private createTagline(): void {
    this.taglineText = this.add.text(GAME_WIDTH / 2, 368, 'How high can you climb?', {
      fontSize: '18px',
      fontStyle: 'italic',
      color: '#cc9966',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5).setAlpha(0).setDepth(7);
  }

  // ── Floating clouds ──────────────────────────────────────────────────────────

  private createFloatingClouds(): void {
    const data: [number, number, number, boolean, number][] = [
      [480,  80,  2.2, true,  18000],
      [300,  155, 1.4, true,  22000],
      [100,  220, 3.0, true,  28000],
      [-32,  310, 1.8, false, 20000],
      [200,  420, 1.2, true,  16000],
    ];
    const alphas = [0.55, 0.65, 0.5, 0.6, 0.7];
    data.forEach(([x, y, scale, goLeft, duration], i) => {
      this.spawnCloud(x, y, scale, goLeft, duration, alphas[i]);
    });
  }

  private spawnCloud(x: number, y: number, scaleVal: number, goLeft: boolean, duration: number, alpha: number): void {
    const gfx = this.add.graphics()
      .setAlpha(alpha)
      .setDepth(3)
      .setScrollFactor(0);

    drawCloudShape(gfx);
    gfx.setScale(scaleVal);
    gfx.setPosition(x, y);

    // Cloud shape spans ~120px wide — ensure it fully clears the screen edge
    const offscreen = 130 * scaleVal;
    const targetX = goLeft ? -offscreen : GAME_WIDTH + offscreen;
    const startX  = goLeft ? GAME_WIDTH + offscreen : -offscreen;

    this.tweens.add({
      targets: gfx,
      x: targetX,
      duration,
      ease: 'Linear',
      repeat: -1,
      onRepeat: () => { gfx.setX(startX); },
    });
  }

  // ── Balance ──────────────────────────────────────────────────────────────────

  private createBalanceText(): void {
    this.balanceText = this.add.text(GAME_WIDTH / 2, 720, `${getBalance()} coins`, {
      fontSize: '16px',
      color: '#ffdd77',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5).setAlpha(0).setDepth(8);
  }

  private createPlayerName(): void {
    const name = getPlayerName();
    this.playerNameText = this.add.text(
      GAME_WIDTH / 2, 748,
      `${name}  [edit]`,
      {
        fontSize:        '13px',
        fontFamily:      'monospace',
        color:           '#8899aa',
        stroke:          '#000000',
        strokeThickness: 1,
      },
    ).setOrigin(0.5).setAlpha(0).setDepth(8)
     .setInteractive({ useHandCursor: true });

    this.playerNameText.on('pointerover', () => this.playerNameText.setColor('#aabbcc'));
    this.playerNameText.on('pointerout',  () => this.playerNameText.setColor('#8899aa'));
    this.playerNameText.on('pointerup',   () => this.promptNameChange());
  }

  private promptNameChange(): void {
    const current = getPlayerName();
    const input   = window.prompt('Enter your player name (max 20 chars):', current);
    if (input === null) return;  // cancelled
    setPlayerName(input);
    this.playerNameText.setText(`${getPlayerName()}  [edit]`);
  }

  // ── Start / Upgrade prompts ──────────────────────────────────────────────────

  private createPrompts(im: InputManager): void {
    // Start button
    this.startBg = this.add.graphics().setDepth(8).setAlpha(0);
    this.startBg.fillStyle(0x000000, 0.5);
    this.startBg.fillRoundedRect(GAME_WIDTH / 2 - 160, 540, 320, 56, 12);
    this.startBg.lineStyle(2, 0x8899bb, 0.8);
    this.startBg.strokeRoundedRect(GAME_WIDTH / 2 - 160, 540, 320, 56, 12);

    this.startText = this.add.text(GAME_WIDTH / 2, 570, 'START RUN', {
      fontSize: '24px',
      fontStyle: 'bold',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5).setAlpha(0).setDepth(9);

    // Upgrades + Store — side by side, same total width as Start Run (320px)
    // Each button: (320 - 8 gap) / 2 = 156px
    const subBtnW  = 156;
    const subBtnH  = 56;
    const subBtnGap = 8;
    const subLeft  = GAME_WIDTH / 2 - 160;        // same left edge as Start Run
    const subY     = 612;
    const subCY    = subY + subBtnH / 2;           // = 640

    this.upgradeBg = this.add.graphics().setDepth(8).setAlpha(0);
    this.upgradeBg.fillStyle(0x000000, 0.5);
    this.upgradeBg.fillRoundedRect(subLeft, subY, subBtnW, subBtnH, 12);
    this.upgradeBg.lineStyle(2, 0x8899bb, 0.6);
    this.upgradeBg.strokeRoundedRect(subLeft, subY, subBtnW, subBtnH, 12);

    this.upgradeText = this.add.text(subLeft + subBtnW / 2, subCY, 'UPGRADES', {
      fontSize: '20px',
      color: '#ffdd44',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5).setAlpha(0).setDepth(9);

    this.storeBg = this.add.graphics().setDepth(8).setAlpha(0);
    this.storeBg.fillStyle(0x000000, 0.5);
    this.storeBg.fillRoundedRect(subLeft + subBtnW + subBtnGap, subY, subBtnW, subBtnH, 12);
    this.storeBg.lineStyle(2, 0x8899bb, 0.6);
    this.storeBg.strokeRoundedRect(subLeft + subBtnW + subBtnGap, subY, subBtnW, subBtnH, 12);

    this.storeText = this.add.text(subLeft + subBtnW + subBtnGap + subBtnW / 2, subCY, 'STORE', {
      fontSize: '20px',
      color: '#44ffaa',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5).setAlpha(0).setDepth(9);

    if (im.isMobile && !im.tiltPermissionGranted) {
      const tiltBtn = this.add.text(GAME_WIDTH / 2, 760, 'Enable Tilt Controls', {
        fontSize: '17px',
        color: '#88aaff',
        stroke: '#000000',
        strokeThickness: 2,
      }).setOrigin(0.5).setAlpha(0).setDepth(9).setInteractive({ useHandCursor: true });

      tiltBtn.on('pointerup', () => {
        im.requestTiltPermission().then(() => tiltBtn.setVisible(false));
      });

      this.tweens.add({ targets: tiltBtn, alpha: 1, duration: 300, delay: 2000 });
    }
  }

  // ── Heap picker ──────────────────────────────────────────────────────────

  private createHeapPicker(): void {
    const params = (this.game.registry.get('heapParams') as HeapParams | undefined) ?? DEFAULT_HEAP_PARAMS;

    this.heapPickerBg = this.add.graphics().setDepth(8).setAlpha(0);
    this.heapPickerBg.fillStyle(0x000000, 0.5);
    this.heapPickerBg.fillRoundedRect(GAME_WIDTH / 2 - 160, 480, 320, 48, 10);
    this.heapPickerBg.lineStyle(1, 0x8899bb, 0.6);
    this.heapPickerBg.strokeRoundedRect(GAME_WIDTH / 2 - 160, 480, 320, 48, 10);

    const nameLabel  = `\u25BE ${params.name}  `;
    const starsLabel = formatDifficulty(params.difficulty);

    this.heapPickerText = this.add.text(0, 504, nameLabel, {
      fontSize: '16px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0, 0.5).setAlpha(0).setDepth(9);

    this.heapPickerStars = this.add.text(0, 504, starsLabel, {
      fontSize: '16px', color: '#ff9922',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0, 0.5).setAlpha(0).setDepth(9);

    // Center both texts together on the button
    const totalW = this.heapPickerText.width + this.heapPickerStars.width;
    const startX = GAME_WIDTH / 2 - totalW / 2;
    this.heapPickerText.setX(startX);
    this.heapPickerStars.setX(startX + this.heapPickerText.width);

    this.heapPickerText.setInteractive(
      new Phaser.Geom.Rectangle(-160, -24, 320, 48),
      Phaser.Geom.Rectangle.Contains,
    );
    this.heapPickerText.on('pointerup', () => this.scene.start('HeapSelectScene'));
  }

  // ── Settings button ──────────────────────────────────────────────────────────

  private createHotkeyLegend(): void {
    const keys = [
      { key: 'Space', label: 'Start Run' },
      { key: 'U',     label: 'Upgrades'  },
      { key: 'S',     label: 'Store'     },
      { key: 'H',     label: 'Heap'      },
    ];
    const parts = keys.map(k => `${k.key}: ${k.label}`).join('   ');
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 52, parts, {
      fontSize:      '11px',
      fontFamily:    'monospace',
      color:         '#667799',
      letterSpacing: 1,
    }).setOrigin(0.5, 0.5).setDepth(9);
  }

  private createSettingsButton(): void {
    const bx = GAME_WIDTH - 22;
    const by = GAME_HEIGHT - 22;

    const btnGfx = this.add.graphics().setDepth(20);
    btnGfx.fillStyle(0x000000, 0.65);
    btnGfx.fillCircle(bx, by, 14);
    btnGfx.lineStyle(2, 0x8899bb, 1);
    btnGfx.strokeCircle(bx, by, 14);

    this.add.text(bx, by, '\u2699', {
      fontSize: '16px', color: '#ddddff',
    }).setOrigin(0.5).setDepth(20);

    const hitZone = this.add.zone(bx, by, 36, 36).setDepth(20);
    hitZone.setInteractive({ useHandCursor: true });

    // Overlay
    const overlayBg = this.add.rectangle(
      GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.72,
    ).setDepth(30).setVisible(false).setInteractive();

    const panel = this.add.rectangle(
      GAME_WIDTH / 2, GAME_HEIGHT / 2, 360, 280, 0x0d0d20,
    ).setDepth(31).setVisible(false).setStrokeStyle(2, 0x4455aa);

    const title = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 105, 'SETTINGS', {
      fontSize: '28px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(32).setVisible(false);

    // Close button
    const closeBtn = this.add.text(GAME_WIDTH / 2 + 155, GAME_HEIGHT / 2 - 120, '\u2715', {
      fontSize: '20px', color: '#aaaaaa',
    }).setOrigin(0.5).setDepth(32).setVisible(false).setInteractive({ useHandCursor: true });

    // Reset button
    const resetBg = this.add.rectangle(
      GAME_WIDTH / 2, GAME_HEIGHT / 2, 260, 52, 0x881111,
    ).setDepth(32).setVisible(false).setStrokeStyle(2, 0xff4444)
      .setInteractive({ useHandCursor: true });

    const resetLabel = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'Reset All Data', {
      fontSize: '20px', color: '#ffffff', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(33).setVisible(false);

    const resetWarning = this.add.text(
      GAME_WIDTH / 2, GAME_HEIGHT / 2 + 56,
      'Clears all coins, upgrades\nand placed blocks.',
      { fontSize: '14px', color: '#aa8888', align: 'center' },
    ).setOrigin(0.5).setDepth(32).setVisible(false);

    const overlayParts = [overlayBg, panel, title, closeBtn, resetBg, resetLabel, resetWarning];
    const open  = () => overlayParts.forEach(p => p.setVisible(true));
    const close = () => {
      overlayParts.forEach(p => p.setVisible(false));
      // Reset confirmation state when closing
      this.resetConfirmed = false;
      resetLabel.setText('Reset All Data');
      resetBg.setFillStyle(0x881111);
      resetWarning.setText('Clears all coins, upgrades\nand placed blocks.').setColor('#aa8888');
    };

    hitZone.on('pointerup', open);
    overlayBg.on('pointerup', close);
    closeBtn.on('pointerup', close);

    resetBg.on('pointerup', () => {
      if (!this.resetConfirmed) {
        this.resetConfirmed = true;
        resetLabel.setText('Confirm? Tap again');
        resetBg.setFillStyle(0xcc2200);
        resetWarning.setText('This cannot be undone!').setColor('#ff6666');
        this.time.delayedCall(4000, () => {
          if (this.resetConfirmed) {
            this.resetConfirmed = false;
            resetLabel.setText('Reset All Data');
            resetBg.setFillStyle(0x881111);
            resetWarning.setText('Clears all coins, upgrades\nand placed blocks.').setColor('#aa8888');
          }
        });
      } else {
        resetAllData();
        this.scene.restart();
      }
    });
  }

  private createInfoButton(): void {
    const im = InputManager.getInstance();
    const bx = GAME_WIDTH - 22;
    const by = 22;

    // Circle background
    const btnGfx = this.add.graphics().setScrollFactor(0).setDepth(12);
    btnGfx.fillStyle(0x000000, 0.65);
    btnGfx.fillCircle(bx, by, 14);
    btnGfx.lineStyle(2, 0x8899bb, 1);
    btnGfx.strokeCircle(bx, by, 14);

    // '?' label
    this.add.text(bx, by, '?', {
      fontSize: '16px', color: '#ffffff', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(13);

    // Invisible hit zone
    const hitZone = this.add.zone(bx, by, 36, 36).setScrollFactor(0).setDepth(13);
    hitZone.setInteractive({ useHandCursor: true });

    // Overlay background
    const overlayBg = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.72)
      .setScrollFactor(0).setDepth(14).setVisible(false).setInteractive();

    // Panel
    const panel = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 380, 320, 0x0d0d20)
      .setScrollFactor(0).setDepth(15).setVisible(false).setStrokeStyle(2, 0x4455aa);

    // Controls text — show mobile or desktop lines based on platform
    const mobileLines = [
      'CONTROLS',
      '',
      'Move     Tilt phone left / right',
      'Jump     Tap or swipe up',
      'Dash     Swipe left / right',
      'Dive     Swipe down',
      'Place    PLACE BLOCK button',
      'Ladder   Drag up / down',
      '',
      'TIP',
      '',
      'Left & right edges wrap around!',
    ];
    const desktopLines = [
      'CONTROLS',
      '',
      'Move     ← →  /  A  D',
      'Jump     ↑  /  W',
      'Dash     SHIFT',
      'Dive     ↓  /  S  (airborne)',
      'Place    SPACE',
      '',
      'TIP',
      '',
      'Left & right edges wrap around!',
    ];

    const overlayText = this.add.text(
      GAME_WIDTH / 2 - 160, GAME_HEIGHT / 2 - 130,
      (im.isMobile ? mobileLines : desktopLines).join('\n'),
      {
        fontSize: '17px', color: '#ccccdd',
        stroke: '#000000', strokeThickness: 1,
        lineSpacing: 5,
      },
    ).setScrollFactor(0).setDepth(16).setVisible(false);

    const parts = [overlayBg, panel, overlayText];
    let open = false;

    const toggle = () => {
      open = !open;
      for (const p of parts) p.setVisible(open);
    };

    hitZone.on('pointerup', toggle);
    overlayBg.on('pointerup', toggle);
  }

  // ── Entrance animation ───────────────────────────────────────────────────────

  private runEntranceSequence(): void {
    this.tweens.add({ targets: this.farSilhouette,  alpha: 1,    duration: 600, delay: 0    });
    this.tweens.add({ targets: this.nearSilhouette, alpha: 1,    duration: 600, delay: 300  });
    this.tweens.add({ targets: this.horizonGlow,    alpha: 1,    duration: 400, delay: 600  });
    this.tweens.add({ targets: this.playerFigure,   alpha: 0.85, duration: 500, delay: 700  });
    this.tweens.add({ targets: this.titleShadow,    alpha: 0.65, duration: 400, delay: 900  });
    this.tweens.add({ targets: this.titleText,      alpha: 1,    duration: 500, delay: 1000 });
    this.tweens.add({ targets: this.taglineText,    alpha: 1,    duration: 400, delay: 1300 });
    this.tweens.add({ targets: [this.balanceText, this.playerNameText], alpha: 1, duration: 300, delay: 1500 });
    this.tweens.add({ targets: [this.heapPickerBg, this.heapPickerText, this.heapPickerStars], alpha: 1, duration: 300, delay: 1600 });
    this.tweens.add({ targets: this.startBg,   alpha: 1, duration: 400, delay: 1700 });
    this.tweens.add({
      targets: this.startText,
      alpha: 1,
      duration: 400,
      delay: 1700,
      onComplete: () => this.startPulse(),
    });
    this.tweens.add({ targets: this.upgradeBg,   alpha: 1, duration: 300, delay: 1900 });
    this.tweens.add({ targets: this.upgradeText, alpha: 1, duration: 300, delay: 1900 });
    this.tweens.add({ targets: this.storeBg,   alpha: 1, duration: 300, delay: 2000 });
    this.tweens.add({ targets: this.storeText, alpha: 1, duration: 300, delay: 2000 });

    this.time.delayedCall(2100, () => this.startTwinkle());

    // Player idle bob (start immediately — subtle at 0 alpha, becomes visible with fade)
    this.tweens.add({
      targets: this.playerFigure,
      y: 388 - 4,
      duration: 1800,
      yoyo: true,
      loop: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private startPulse(): void {
    this.tweens.add({
      targets: this.startText,
      alpha: { from: 1.0, to: 0.35 },
      duration: 900,
      yoyo: true,
      loop: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private startTwinkle(): void {
    for (const star of this.twinkleStars) {
      this.tweens.add({
        targets: star,
        alpha: { from: 0.9, to: 0.15 },
        duration: Phaser.Math.Between(1200, 2800),
        yoyo: true,
        loop: -1,
        delay: Phaser.Math.Between(0, 2000),
      });
    }
  }

  // ── Input ────────────────────────────────────────────────────────────────────

  private registerInput(): void {
    this.time.delayedCall(100, () => {
      const startGame = (): void => {
        const activeHeapId  = (this.game.registry.get('activeHeapId') as string) ?? '';
        const activeParams  = (this.game.registry.get('heapParams') as HeapParams | undefined) ?? DEFAULT_HEAP_PARAMS;
        if (activeParams.isInfinite) {
          this.scene.start('InfiniteGameScene');
          return;
        }
        const hasCheckpoint = getPlaced(activeHeapId).some(
          p => p.id === 'checkpoint' && (p.meta?.spawnsLeft ?? 0) > 0,
        );
        this.scene.start('GameScene', hasCheckpoint ? { useCheckpoint: true } : undefined);
      };

      this.input.keyboard!.once('keydown-SPACE', startGame);
      this.input.keyboard!.once('keydown-U',     () => this.scene.start('UpgradeScene'));
      this.input.keyboard!.once('keydown-F2',    () => this.scene.start('TexturePreviewScene'));

      this.startText.setInteractive(
        new Phaser.Geom.Rectangle(-200, -40, 400, 80),
        Phaser.Geom.Rectangle.Contains,
      );
      this.startText.once('pointerup', startGame);

      this.upgradeText.setInteractive(
        new Phaser.Geom.Rectangle(-78, -28, 156, 56),
        Phaser.Geom.Rectangle.Contains,
      );
      this.upgradeText.once('pointerup', () => this.scene.start('UpgradeScene'));

      this.storeText.setInteractive(
        new Phaser.Geom.Rectangle(-78, -28, 156, 56),
        Phaser.Geom.Rectangle.Contains,
      );
      this.storeText.once('pointerup', () => this.scene.start('StoreScene'));

      this.input.keyboard!.once('keydown-S', () => this.scene.start('StoreScene'));
      this.input.keyboard!.once('keydown-H', () => this.scene.start('HeapSelectScene'));
    });
  }
}

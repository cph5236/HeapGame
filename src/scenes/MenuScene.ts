import Phaser from 'phaser';


import { AudioManager } from '../systems/AudioManager';
import type { SoundCategory } from '../data/soundDefs';
import { getBalance, getPlaced, resetAllData, getPlayerName, setPlayerName, addBalance, getPlayerGuid, getGpgsPlayerId, getVerboseLogging, setVerboseLogging } from '../systems/SaveData';
import { InputManager } from '../systems/InputManager';
import { drawCloudShape } from '../systems/backgroundEntities';
import { type HeapParams, DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';
import { formatDifficulty } from '../ui/DifficultyStars';
import { loadGameAssets } from './loadGameAssets';
import { getLogger } from '../logging';
import { PlayGamesClient } from '../systems/PlayGamesClient';

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
  private leaderboardBg!:   Phaser.GameObjects.Graphics;
  private leaderboardIcon!: Phaser.GameObjects.Text;

  private _forceSettingsOpen = false;
  private _forceInfoOpen     = false;

  constructor() {
    super({ key: 'MenuScene' });
  }

  init(data: { forceSettingsOpen?: boolean; forceInfoOpen?: boolean } = {}): void {
    this._forceSettingsOpen = data.forceSettingsOpen ?? false;
    this._forceInfoOpen     = data.forceInfoOpen     ?? false;
  }

  // On short screens, shift the button group up so coins/name/settings fit below
  private get layoutShift(): number {
    return Math.min(Math.max(0, 780 - this.scale.height), 60);
  }

  create(): void {
    this.twinkleStars = [];
    this.resetConfirmed = false;

    const im = InputManager.getInstance();

    // Log user:created once per playerGuid via localStorage flag
    const guid = getPlayerGuid();
    const flagKey = `heap_user_created_logged:${guid}`;
    if (!localStorage.getItem(flagKey)) {
      getLogger().event({ type: 'user:created' });
      localStorage.setItem(flagKey, '1');
    }

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
    this.game.events.once('gpgs:signed-in', (displayName: string) => {
      if (!this.playerNameText?.active) return;
      this.playerNameText.setText(`${displayName}  ▶ Play Games`);
      this.playerNameText.off('pointerup');
      this.playerNameText.on('pointerup', () => PlayGamesClient.showPlayerProfile());
    }, this);
    this.game.events.once('gpgs:save-merged', () => {
      if (!this.balanceText?.active) return;
      this.balanceText.setText(`${getBalance()} coins`);
    }, this);
    this.createPrompts(im);
    this.createHeapPicker();
    this.createSettingsButton();
    this.createInfoButton();
    this.createVersionLabel();
    if (!im.isMobile) this.createHotkeyLegend();
    this.runEntranceSequence();
    this.registerInput();
    loadGameAssets(this);
    if (this.registry.get('gameAssetsReady')) {
      AudioManager.play('music-menu');
    } else {
      this.load.once(Phaser.Loader.Events.COMPLETE, () => AudioManager.play('music-menu'));
    }
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
      g.fillRect(0, y, this.scale.width, h);
    }
    g.fillStyle(0x3e280e, 1);
    g.fillRect(0, 854, this.scale.width, Math.max(0, this.scale.height - 854));
  }

  // ── Stars ────────────────────────────────────────────────────────────────────

  private createStarField(): void {
    const staticG = this.add.graphics().setDepth(1);

    for (let i = 0; i < 68; i++) {
      const x = Phaser.Math.Between(0, this.scale.width);
      const y = Phaser.Math.Between(0, 514);
      const roll = Phaser.Math.Between(0, 9);
      const r = roll < 6 ? 0.7 : roll < 9 ? 1.2 : 2.0;
      const a = roll < 6 ? 0.9 : roll < 9 ? 0.55 : 0.25;
      staticG.fillStyle(0xffffff, a);
      staticG.fillCircle(x, y, r);
    }

    for (let i = 0; i < 12; i++) {
      const g = this.add.graphics().setDepth(1);
      const x = Phaser.Math.Between(0, this.scale.width);
      const y = Phaser.Math.Between(0, 514);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(x, y, 1.2);
      this.twinkleStars.push(g);
    }
  }

  // ── Heap silhouettes ─────────────────────────────────────────────────────────

  private createFarSilhouette(): void {
    const sx = this.scale.width / 480;
    const points = [
      { x: -20 * sx, y: this.scale.height }, { x: -20 * sx, y: 700 }, { x: 10  * sx, y: 660 }, { x: 40  * sx, y: 680 },
      { x: 60  * sx, y: 620 }, { x: 90  * sx, y: 590 }, { x: 115 * sx, y: 610 }, { x: 140 * sx, y: 570 },
      { x: 170 * sx, y: 540 }, { x: 195 * sx, y: 560 }, { x: 220 * sx, y: 510 }, { x: 240 * sx, y: 440 },
      { x: 265 * sx, y: 480 }, { x: 290 * sx, y: 455 }, { x: 320 * sx, y: 490 }, { x: 345 * sx, y: 520 },
      { x: 370 * sx, y: 500 }, { x: 395 * sx, y: 540 }, { x: 420 * sx, y: 580 }, { x: 440 * sx, y: 555 },
      { x: 460 * sx, y: 610 }, { x: 490 * sx, y: 640 }, { x: 500 * sx, y: 700 }, { x: 500 * sx, y: this.scale.height },
    ];
    this.farSilhouette = this.add.graphics().setDepth(2).setAlpha(0);
    this.farSilhouette.fillStyle(0x1a1225, 1);
    this.farSilhouette.fillPoints(points, true);
  }

  private createNearSilhouette(): void {
    const sx = this.scale.width / 480;
    const points = [
      { x: 0,         y: this.scale.height }, { x: 0,         y: 720 }, { x: 18  * sx, y: 695 }, { x: 35  * sx, y: 710 },
      { x: 50  * sx,  y: 670 }, { x: 68  * sx, y: 640 }, { x: 82  * sx, y: 655 }, { x: 100 * sx, y: 615 },
      { x: 118 * sx,  y: 595 }, { x: 130 * sx, y: 610 }, { x: 148 * sx, y: 575 }, { x: 162 * sx, y: 548 },
      { x: 175 * sx,  y: 565 }, { x: 192 * sx, y: 530 }, { x: 208 * sx, y: 505 }, { x: 220 * sx, y: 520 },
      { x: 235 * sx,  y: 490 }, { x: 248 * sx, y: 465 }, { x: 255 * sx, y: 478 }, { x: 262 * sx, y: 450 },
      { x: 268 * sx,  y: 420 }, { x: 272 * sx, y: 395 }, { x: 278 * sx, y: 410 }, { x: 284 * sx, y: 388 },
      { x: 290 * sx,  y: 400 }, { x: 296 * sx, y: 415 }, { x: 304 * sx, y: 435 }, { x: 316 * sx, y: 455 },
      { x: 328 * sx,  y: 440 }, { x: 340 * sx, y: 465 }, { x: 355 * sx, y: 490 }, { x: 368 * sx, y: 475 },
      { x: 382 * sx,  y: 505 }, { x: 395 * sx, y: 530 }, { x: 408 * sx, y: 515 }, { x: 422 * sx, y: 545 },
      { x: 438 * sx,  y: 570 }, { x: 450 * sx, y: 555 }, { x: 462 * sx, y: 590 }, { x: 472 * sx, y: 625 },
      { x: 480 * sx,  y: 660 }, { x: 480 * sx, y: this.scale.height },
    ];
    this.nearSilhouette = this.add.graphics().setDepth(4).setAlpha(0);
    this.nearSilhouette.fillStyle(0x0d0910, 1);
    this.nearSilhouette.fillPoints(points, true);
  }

  // ── Horizon glow ─────────────────────────────────────────────────────────────

  private createHorizonGlow(): void {
    this.horizonGlow = this.add.graphics().setDepth(3).setAlpha(0);
    this.horizonGlow.fillStyle(0xff8833, 0.12);
    this.horizonGlow.fillEllipse(this.scale.width / 2, 450, 460, 60);
    this.horizonGlow.fillStyle(0xff6611, 0.07);
    this.horizonGlow.fillEllipse(this.scale.width / 2, 445, 360, 40);
    this.horizonGlow.fillStyle(0xffaa44, 0.05);
    this.horizonGlow.fillEllipse(this.scale.width / 2, 455, 300, 25);
  }

  // ── Player figure ────────────────────────────────────────────────────────────

  private createPlayerFigure(): void {
    this.playerFigure = this.add.image(this.scale.width / 2, 388, 'trashbag')
      .setOrigin(0.5, 1.0)
      .setScale(0.9)
      .setDepth(5)
      .setAlpha(0);
  }

  // ── Title ────────────────────────────────────────────────────────────────────

  private createTitle(): void {
    this.titleShadow = this.add.text(this.scale.width / 2 + 4, 306, 'HEAP', {
      fontSize: '96px',
      fontStyle: 'bold',
      color: '#000000',
      stroke: '#000000',
      strokeThickness: 12,
    }).setOrigin(0.5).setAlpha(0).setDepth(6);

    this.titleText = this.add.text(this.scale.width / 2, 300, 'HEAP', {
      fontSize: '96px',
      fontStyle: 'bold',
      color: '#ff9922',
      stroke: '#1a0800',
      strokeThickness: 8,
    }).setOrigin(0.5).setAlpha(0).setDepth(6);
  }

  // ── Tagline ──────────────────────────────────────────────────────────────────

  private createTagline(): void {
    this.taglineText = this.add.text(this.scale.width / 2, 368, 'How high can you climb?', {
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
      [this.scale.width, 80,  2.2, true,  18000],
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
    const targetX = goLeft ? -offscreen : this.scale.width + offscreen;
    const startX  = goLeft ? this.scale.width + offscreen : -offscreen;

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
    const shift = this.layoutShift;
    const y = Math.max(688 - shift, Math.min(this.scale.height - 134, 756));
    this.balanceText = this.add.text(this.scale.width / 2, y, `${getBalance()} coins`, {
      fontSize: '16px',
      color: '#ffdd77',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5).setAlpha(0).setDepth(8);
  }

  private createPlayerName(): void {
    const name  = getPlayerName();
    const shift = this.layoutShift;
    const nameY = Math.max(710 - shift, Math.min(this.scale.height - 106, 778));

    const isGpgs   = getGpgsPlayerId() !== null;
    const label    = isGpgs ? `${name}  ▶ Play Games` : `${name}  [edit]`;
    const onTap    = isGpgs
      ? () => PlayGamesClient.showPlayerProfile()
      : () => this.openNameDialog();

    this.playerNameText = this.add.text(
      this.scale.width / 2, nameY,
      label,
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
    this.playerNameText.on('pointerup',   onTap);
  }

  private openNameDialog(): void {
    const current = getPlayerName();

    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.75)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'z-index:9999', 'font-family:monospace',
    ].join(';');

    const panel = document.createElement('div');
    panel.style.cssText = [
      'background:#0d0d20', 'border:2px solid #ff9922', 'border-radius:12px',
      'padding:28px 22px 22px', 'text-align:center', 'width:300px',
      'box-shadow:0 0 32px rgba(255,153,34,0.18)', 'box-sizing:border-box',
    ].join(';');

    const heap = document.createElement('div');
    heap.style.cssText = 'color:#ff9922;font-size:13px;font-weight:bold;letter-spacing:3px;margin-bottom:6px';
    heap.textContent = 'HEAP';

    const subtitle = document.createElement('div');
    subtitle.style.cssText = 'color:#cc9966;font-size:14px;font-style:italic;margin-bottom:22px';
    subtitle.textContent = 'What do they call you?';

    const input = document.createElement('input');
    input.maxLength = 20;
    input.value = current;
    input.style.cssText = [
      'width:100%', 'box-sizing:border-box', 'background:transparent', 'border:none',
      'border-bottom:2px solid #ff9922', 'color:#ffffff', 'font-size:20px',
      'text-align:center', 'padding:6px 0 8px', 'font-family:monospace',
      'outline:none', 'margin-bottom:6px',
    ].join(';');

    const counterRow = document.createElement('div');
    counterRow.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:24px';
    const counter = document.createElement('span');
    counter.style.cssText = 'color:#556677;font-size:10px';
    counter.textContent = `${current.length} / 20`;
    counterRow.appendChild(counter);

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'CONFIRM';
    confirmBtn.style.cssText = [
      'width:100%', 'padding:13px', 'background:#ff9922', 'border:none',
      'border-radius:8px', 'color:#0a0818', 'font-size:15px', 'font-weight:bold',
      'font-family:monospace', 'letter-spacing:1px', 'cursor:pointer', 'margin-bottom:10px',
    ].join(';');

    const cancelEl = document.createElement('div');
    cancelEl.textContent = 'cancel';
    cancelEl.style.cssText = 'color:#556677;font-size:12px;cursor:pointer;letter-spacing:1px';

    panel.append(heap, subtitle, input, counterRow, confirmBtn, cancelEl);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    this.input.enabled = false;

    const close = (): void => {
      this.input.enabled = true;
      document.body.removeChild(overlay);
    };

    const confirm = (): void => {
      setPlayerName(input.value);
      this.playerNameText.setText(`${getPlayerName()}  [edit]`);
      close();
    };

    input.addEventListener('input', () => {
      const len = input.value.length;
      counter.textContent = `${len} / 20`;
      counter.style.color = len >= 19 ? '#ff4444' : '#556677';
    });

    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter')  confirm();
      if (e.key === 'Escape') close();
    });

    confirmBtn.addEventListener('click', confirm);
    cancelEl.addEventListener('click', close);
    overlay.addEventListener('click', (e: MouseEvent) => {
      if (e.target === overlay) close();
    });

    requestAnimationFrame(() => input.focus());
  }

  // ── Start / Upgrade prompts ──────────────────────────────────────────────────

  private createPrompts(im: InputManager): void {
    const shift = this.layoutShift;

    // Start button
    this.startBg = this.add.graphics().setDepth(8).setAlpha(0);
    this.startBg.fillStyle(0x000000, 0.5);
    this.startBg.fillRoundedRect(this.scale.width / 2 - 160, 540 - shift, 320, 56, 12);
    this.startBg.lineStyle(2, 0x8899bb, 0.8);
    this.startBg.strokeRoundedRect(this.scale.width / 2 - 160, 540 - shift, 320, 56, 12);

    this.startText = this.add.text(this.scale.width / 2, 570 - shift, 'START RUN', {
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
    const subLeft  = this.scale.width / 2 - 160;        // same left edge as Start Run
    const subY     = 612 - shift;
    const subCY    = subY + subBtnH / 2;

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
      const tiltBtn = this.add.text(this.scale.width / 2, this.scale.height - 94, 'Enable Tilt Controls', {
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
    const shift = this.layoutShift;
    const rowY  = 504 - shift;
    const left  = this.scale.width / 2 - 160;

    // Heap-picker bar \u2014 left ~85% of the 320px row (264px), 8px gap, 48px trophy.
    this.heapPickerBg = this.add.graphics().setDepth(8).setAlpha(0);
    this.heapPickerBg.fillStyle(0x000000, 0.5);
    this.heapPickerBg.fillRoundedRect(left, 480 - shift, 264, 48, 10);
    this.heapPickerBg.lineStyle(1, 0x8899bb, 0.6);
    this.heapPickerBg.strokeRoundedRect(left, 480 - shift, 264, 48, 10);

    this.heapPickerText = this.add.text(0, rowY, '', {
      fontSize: '16px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0, 0.5).setAlpha(0).setDepth(9);

    this.heapPickerStars = this.add.text(0, rowY, '', {
      fontSize: '16px', color: '#ff9922',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0, 0.5).setAlpha(0).setDepth(9);

    // Leaderboard trophy button \u2014 right 48px square of the row.
    const trophyLeft = left + 264 + 8;   // = width/2 + 112
    const trophyCx   = trophyLeft + 24;  // = width/2 + 136
    this.leaderboardBg = this.add.graphics().setDepth(8).setAlpha(0);
    const drawTrophyBg = (enabled: boolean): void => {
      this.leaderboardBg.clear();
      this.leaderboardBg.fillStyle(0x000000, 0.5);
      this.leaderboardBg.fillRoundedRect(trophyLeft, 480 - shift, 48, 48, 10);
      this.leaderboardBg.lineStyle(1, 0x8899bb, enabled ? 0.6 : 0.25);
      this.leaderboardBg.strokeRoundedRect(trophyLeft, 480 - shift, 48, 48, 10);
    };
    drawTrophyBg(false);
    this.leaderboardIcon = this.add.text(trophyCx, rowY, '\uD83C\uDFC6', {
      fontSize: '22px',
    }).setOrigin(0.5).setAlpha(0).setDepth(9);

    // Centre of the picker bar (text centres within the 264px bar, not the row).
    const barCx = left + 132;            // = width/2 - 28

    // Refresh from current registry \u2014 runs once now (placeholder if catalog is
    // still loading) and again when `heapCatalogReady` fires from BootScene.
    const refresh = (): void => {
      const ready  = this.game.registry.get('heapCatalogReady') === true;
      const params = (this.game.registry.get('heapParams') as HeapParams | undefined) ?? DEFAULT_HEAP_PARAMS;

      const nameLabel  = ready ? `\u25BE ${params.name}  ` : 'Heaps loading\u2026';
      const starsLabel = ready ? formatDifficulty(params.difficulty) : '';

      this.heapPickerText.setText(nameLabel);
      this.heapPickerStars.setText(starsLabel);
      this.heapPickerText.setColor(ready ? '#ffffff' : '#778899');

      // Re-center both texts together each refresh \u2014 widths change with text.
      const totalW = this.heapPickerText.width + this.heapPickerStars.width;
      const startX = barCx - totalW / 2;
      this.heapPickerText.setX(startX);
      this.heapPickerStars.setX(startX + this.heapPickerText.width);

      drawTrophyBg(ready);
    };

    refresh();
    this.game.events.once('heapCatalogReady', refresh);

    // Picker tap zone \u2014 left 264px of the row \u2192 heap selector.
    this.add.zone(barCx, rowY, 264, 48)
      .setDepth(9).setInteractive({ useHandCursor: true })
      .on('pointerup', () => {
        if (this.game.registry.get('heapCatalogReady') !== true) return;
        this.scene.start('HeapSelectScene');
      });

    // Trophy tap zone \u2192 leaderboard for the active heap.
    this.add.zone(trophyCx, rowY, 48, 48)
      .setDepth(9).setInteractive({ useHandCursor: true })
      .on('pointerup', () => this.openLeaderboard());
  }

  /** Launch the leaderboard modal for the active heap, over a paused menu. */
  private openLeaderboard(): void {
    if (this.game.registry.get('heapCatalogReady') !== true) return;
    const heapId = (this.game.registry.get('activeHeapId') as string) ?? '';
    const params = (this.game.registry.get('heapParams') as HeapParams | undefined) ?? DEFAULT_HEAP_PARAMS;
    this.scene.launch('LeaderboardScene', {
      heapId,
      heapName: params.name,
      playerId: getPlayerGuid(),
      returnScene: 'MenuScene',
    });
    this.scene.pause();
  }

  // ── Settings button ──────────────────────────────────────────────────────────

  private createHotkeyLegend(): void {
    const keys = [
      { key: 'Space', label: 'Start Run' },
      { key: 'U',     label: 'Upgrades'  },
      { key: 'S',     label: 'Store'     },
      { key: 'H',     label: 'Heap'      },
      { key: 'L',     label: 'Leaderboard' },
    ];
    const parts = keys.map(k => `${k.key}: ${k.label}`).join('   ');
    this.add.text(this.scale.width / 2, this.scale.height - 52, parts, {
      fontSize:      '11px',
      fontFamily:    'monospace',
      color:         '#667799',
      letterSpacing: 1,
    }).setOrigin(0.5, 0.5).setDepth(9);
  }

  private createVolumeSlider(
    x: number, y: number, labelText: string,
    cat: SoundCategory | 'master', initialValue: number, depth: number,
  ): Phaser.GameObjects.GameObject[] {
    const TRACK_W = 220;
    const TRACK_H = 6;
    const THUMB_R = 9;

    const label = this.add.text(x - TRACK_W / 2, y - 14, labelText, {
      fontSize: '13px', color: '#aaaacc',
    }).setOrigin(0, 0.5).setDepth(depth);

    const track = this.add.rectangle(x, y, TRACK_W, TRACK_H, 0x334466)
      .setDepth(depth);

    const fill = this.add.rectangle(
      x - TRACK_W / 2 + (TRACK_W * initialValue) / 2, y, TRACK_W * initialValue, TRACK_H, 0x4466cc,
    ).setDepth(depth);

    const thumb = this.add.circle(x - TRACK_W / 2 + TRACK_W * initialValue, y, THUMB_R, 0x6688ff)
      .setDepth(depth + 1).setInteractive({ draggable: true, useHandCursor: true });

    const updateThumb = (newValue: number) => {
      const clamped = Math.max(0, Math.min(1, newValue));
      const thumbX  = x - TRACK_W / 2 + TRACK_W * clamped;
      thumb.setPosition(thumbX, y);
      fill.setPosition(x - TRACK_W / 2 + (TRACK_W * clamped) / 2, y);
      fill.setSize(TRACK_W * clamped, TRACK_H);
      AudioManager.setCategoryVolume(cat, clamped);
    };

    this.input.setDraggable(thumb);
    thumb.on('drag', (_ptr: Phaser.Input.Pointer, dragX: number) => {
      const newValue = (dragX - (x - TRACK_W / 2)) / TRACK_W;
      updateThumb(newValue);
    });

    // Tapping anywhere on the track jumps the volume to that position. The track
    // sits above the (now-interactive) panel, so it receives the click directly.
    // Use a taller hit area than the 6px visual track for a comfortable tap target.
    track.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(0, -(28 - TRACK_H) / 2, TRACK_W, 28),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    });
    track.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      updateThumb((ptr.x - (x - TRACK_W / 2)) / TRACK_W);
    });

    [label, track, fill, thumb].forEach(o => o.setVisible(false));
    return [label, track, fill, thumb];
  }

  private createSettingsButton(): void {
    const bx = this.scale.width - 22;
    const by = this.scale.height - 22;
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;

    // ── Gear button ──────────────────────────────────────────────────────────
    const btnGfx = this.add.graphics().setDepth(20);
    btnGfx.fillStyle(0x000000, 0.65);
    btnGfx.fillCircle(bx, by, 14);
    btnGfx.lineStyle(2, 0x8899bb, 1);
    btnGfx.strokeCircle(bx, by, 14);
    this.add.text(bx, by, '⚙', { fontSize: '16px', color: '#ddddff' }).setOrigin(0.5).setDepth(20);
    const hitZone = this.add.zone(bx, by, 36, 36).setDepth(20).setInteractive({ useHandCursor: true });

    // ── Overlay + panel ───────────────────────────────────────────────────────
    const overlayBg = this.add.rectangle(cx, cy, this.scale.width, this.scale.height, 0x000000, 0.72)
      .setDepth(30).setVisible(false).setInteractive();
    const PANEL_W = 360;
    const PANEL_H = 420;
    // Panel is interactive so clicks that land on it (e.g. on a slider track or
    // empty panel space) are absorbed here rather than falling through to the
    // full-screen overlayBg, whose pointerup closes the menu. Only clicks on the
    // true backdrop (outside the panel) should close it.
    const panel = this.add.rectangle(cx, cy, PANEL_W, PANEL_H, 0x0d0d20)
      .setDepth(31).setVisible(false).setStrokeStyle(2, 0x4455aa).setInteractive();

    const title = this.add.text(cx, cy - PANEL_H / 2 + 22, 'SETTINGS', {
      fontSize: '22px', color: '#ffffff', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(32).setVisible(false);

    const closeBtn = this.add.text(cx + PANEL_W / 2 - 20, cy - PANEL_H / 2 + 14, '✕', {
      fontSize: '20px', color: '#aaaaaa',
    }).setOrigin(0.5).setDepth(32).setVisible(false).setInteractive({ useHandCursor: true });

    // ── Tab bar ───────────────────────────────────────────────────────────────
    const TAB_Y = cy - PANEL_H / 2 + 52;
    const TAB_W = 140;
    const TAB_H = 32;

    const soundsTabBg   = this.add.rectangle(cx - TAB_W / 2 - 4, TAB_Y, TAB_W, TAB_H, 0x2244aa).setDepth(32).setVisible(false);
    const soundsTabText = this.add.text(cx - TAB_W / 2 - 4, TAB_Y, 'Sounds', { fontSize: '14px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(33).setVisible(false);
    const devTabBg      = this.add.rectangle(cx + TAB_W / 2 + 4, TAB_Y, TAB_W, TAB_H, 0x1a1a2e).setDepth(32).setVisible(false);
    const devTabText    = this.add.text(cx + TAB_W / 2 + 4, TAB_Y, 'Dev', { fontSize: '14px', color: '#888888' }).setOrigin(0.5).setDepth(33).setVisible(false);

    // ── Tab containers ────────────────────────────────────────────────────────
    const CONTENT_TOP = TAB_Y + TAB_H / 2 + 12;

    // Dev tab content (existing items, repositioned relative to CONTENT_TOP)
    const coinBg = this.add.rectangle(cx, CONTENT_TOP + 24, 260, 44, 0x1a5c1a)
      .setDepth(32).setVisible(false).setStrokeStyle(2, 0x44ff44).setInteractive({ useHandCursor: true });
    const coinLabel = this.add.text(cx, CONTENT_TOP + 24, '+ 500 Coins', {
      fontSize: '18px', color: '#aaffaa', fontStyle: 'bold', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(33).setVisible(false);

    const resetBg = this.add.rectangle(cx, CONTENT_TOP + 88, 260, 52, 0x881111)
      .setDepth(32).setVisible(false).setStrokeStyle(2, 0xff4444).setInteractive({ useHandCursor: true });
    const resetLabel = this.add.text(cx, CONTENT_TOP + 88, 'Reset All Data', {
      fontSize: '20px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(33).setVisible(false);
    const resetWarning = this.add.text(cx, CONTENT_TOP + 144, 'Clears all coins, upgrades\nand placed blocks.', {
      fontSize: '14px', color: '#aa8888', align: 'center',
    }).setOrigin(0.5).setDepth(32).setVisible(false);

    let analyticsEnabled = getVerboseLogging();
    const analyticsBg = this.add.rectangle(cx, CONTENT_TOP + 202, 260, 48, 0x1a3a1a)
      .setDepth(32).setVisible(false).setStrokeStyle(2, 0x44aa44).setInteractive({ useHandCursor: true });
    const analyticsCheckbox = this.add.text(cx - 110, CONTENT_TOP + 202, analyticsEnabled ? '☑' : '☐', {
      fontSize: '20px', color: '#44ff44', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(33).setVisible(false);
    const analyticsLabel = this.add.text(cx - 35, CONTENT_TOP + 194, 'Send anonymous\ngameplay analytics', {
      fontSize: '13px', color: '#aaffaa',
    }).setOrigin(0, 0.5).setDepth(33).setVisible(false);
    const analyticsHint = this.add.text(cx - 35, CONTENT_TOP + 211, 'Errors are always reported.', {
      fontSize: '11px', color: '#88aa88',
    }).setOrigin(0, 0.5).setDepth(33).setVisible(false);

    // Sounds tab content — 5 volume sliders
    const vols = AudioManager.getVolumes();
    const SLIDER_DEPTH = 33;
    const SLIDER_X = cx;
    const DIVIDER_Y = CONTENT_TOP + 66;

    const masterSliderParts = this.createVolumeSlider(SLIDER_X, CONTENT_TOP + 24, 'MASTER', 'master', vols.master, SLIDER_DEPTH);
    const divider = this.add.rectangle(cx, DIVIDER_Y, 280, 1, 0x334466).setDepth(SLIDER_DEPTH).setVisible(false);
    const musicSliderParts   = this.createVolumeSlider(SLIDER_X, CONTENT_TOP + 96,  'Music',        'music',     vols.music,     SLIDER_DEPTH);
    const playerSliderParts  = this.createVolumeSlider(SLIDER_X, CONTENT_TOP + 150, 'Player SFX',   'playerSfx', vols.playerSfx, SLIDER_DEPTH);
    const enemySliderParts   = this.createVolumeSlider(SLIDER_X, CONTENT_TOP + 204, 'Enemy SFX',    'enemySfx',  vols.enemySfx,  SLIDER_DEPTH);
    const envSliderParts     = this.createVolumeSlider(SLIDER_X, CONTENT_TOP + 258, 'Environment',  'envSfx',    vols.envSfx,    SLIDER_DEPTH);

    const soundsItems: Phaser.GameObjects.GameObject[] = [
      divider,
      ...masterSliderParts, ...musicSliderParts, ...playerSliderParts,
      ...enemySliderParts, ...envSliderParts,
    ];

    // ── Tab switching ─────────────────────────────────────────────────────────
    const devItems    = [coinBg, coinLabel, resetBg, resetLabel, resetWarning, analyticsBg, analyticsCheckbox, analyticsLabel, analyticsHint];

    const showSoundsTab = () => {
      soundsTabBg.setFillStyle(0x2244aa);   soundsTabText.setColor('#ffffff').setFontStyle('bold');
      devTabBg.setFillStyle(0x1a1a2e);      devTabText.setColor('#888888').setFontStyle('normal');
      devItems.forEach(o => o.setVisible(false));
      soundsItems.forEach(o => (o as any).setVisible(true));
    };
    const showDevTab = () => {
      devTabBg.setFillStyle(0x2244aa);      devTabText.setColor('#ffffff').setFontStyle('bold');
      soundsTabBg.setFillStyle(0x1a1a2e);  soundsTabText.setColor('#888888').setFontStyle('normal');
      soundsItems.forEach(o => (o as any).setVisible(false));
      devItems.forEach(o => o.setVisible(true));
    };

    soundsTabBg.setInteractive({ useHandCursor: true }).on('pointerup', showSoundsTab);
    soundsTabText.setInteractive({ useHandCursor: true }).on('pointerup', showSoundsTab);
    devTabBg.setInteractive({ useHandCursor: true }).on('pointerup', showDevTab);
    devTabText.setInteractive({ useHandCursor: true }).on('pointerup', showDevTab);

    // ── Wire existing Dev tab buttons ─────────────────────────────────────────
    coinBg.on('pointerup', () => {
      addBalance(500);
      this.balanceText.setText(`${getBalance()} coins`);
    });

    analyticsBg.on('pointerup', () => {
      analyticsEnabled = !analyticsEnabled;
      setVerboseLogging(analyticsEnabled);
      getLogger().setVerbose(analyticsEnabled);
      analyticsCheckbox.setText(analyticsEnabled ? '☑' : '☐');
    });

    // ── Open / close ──────────────────────────────────────────────────────────
    const alwaysVisible = [overlayBg, panel, title, closeBtn, soundsTabBg, soundsTabText, devTabBg, devTabText];

    const open = () => {
      alwaysVisible.forEach(o => o.setVisible(true));
      showSoundsTab(); // default to Sounds tab on open
    };
    const close = () => {
      alwaysVisible.forEach(o => o.setVisible(false));
      devItems.forEach(o => o.setVisible(false));
      soundsItems.forEach(o => (o as any).setVisible(false));
      this.resetConfirmed = false;
      resetLabel.setText('Reset All Data');
      resetBg.setFillStyle(0x881111);
      resetWarning.setText('Clears all coins, upgrades\nand placed blocks.').setColor('#aa8888');
    };

    hitZone.on('pointerup', open);
    overlayBg.on('pointerup', close);
    closeBtn.on('pointerup', close);

    if (this._forceSettingsOpen) this.time.delayedCall(2200, open);

    resetBg.on('pointerup', () => {
      if (!this.resetConfirmed) {
        this.resetConfirmed = true;
        resetLabel.setText('Tap again to confirm');
        resetBg.setFillStyle(0xcc2222);
        resetWarning.setText('This cannot be undone.').setColor('#ff6666');
      } else {
        resetAllData();
        close();
        this.scene.restart();
      }
    });
  }

  private createInfoButton(): void {
    const im = InputManager.getInstance();
    const bx = this.scale.width - 22;
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
    const overlayBg = this.add.rectangle(this.scale.width / 2, this.scale.height / 2, this.scale.width, this.scale.height, 0x000000, 0.72)
      .setScrollFactor(0).setDepth(14).setVisible(false).setInteractive();

    // Panel
    const panel = this.add.rectangle(this.scale.width / 2, this.scale.height / 2, 380, 320, 0x0d0d20)
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
      this.scale.width / 2 - 160, this.scale.height / 2 - 130,
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

    if (this._forceInfoOpen) this.time.delayedCall(2200, toggle);
  }

  // ── Version label ────────────────────────────────────────────────────────────

  private createVersionLabel(): void {
    const version = import.meta.env.VITE_APP_VERSION ?? '0.0.0';
    // Release builds show just the version; dev builds append a git hash + build
    // time so it's obvious at a glance which build is on the device.
    const label = import.meta.env.DEV
      ? `V${version} · ${import.meta.env.VITE_BUILD_ID ?? 'dev'}`
      : `V${version}`;
    this.add.text(8, this.scale.height - 6, label, {
      fontSize:   '11px',
      fontFamily: 'monospace',
      color:      '#556677',
      stroke:     '#000000',
      strokeThickness: 2,
    }).setOrigin(0, 1).setDepth(20).setScrollFactor(0);
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
    this.tweens.add({ targets: [this.heapPickerBg, this.heapPickerText, this.heapPickerStars, this.leaderboardBg, this.leaderboardIcon], alpha: 1, duration: 300, delay: 1600 });
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
        if (this.game.registry.get('gameAssetsReady') !== true) return;
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

      const refreshStartLabel = (): void => {
        const ready = this.game.registry.get('gameAssetsReady') === true;
        this.startText.setText(ready ? 'START RUN' : 'LOADING…');
        this.startText.setColor(ready ? '#ffffff' : '#778899');
      };

      refreshStartLabel();
      this.game.events.once('gameAssetsReady', refreshStartLabel);

      // .on (not .once) for SPACE — startGame early-returns while gameAssetsReady
      // is false, and .once would burn the binding on any pre-ready press,
      // leaving the player unable to start with the keyboard until they
      // navigated away and back. Same logic as the pointerup handler below.
      this.input.keyboard!.on('keydown-SPACE', startGame);
      this.input.keyboard!.once('keydown-U',     () => this.scene.start('UpgradeScene'));
      this.input.keyboard!.once('keydown-F2',    () => this.scene.start('TexturePreviewScene'));

      this.startText.setInteractive(
        new Phaser.Geom.Rectangle(-200, -40, 400, 80),
        Phaser.Geom.Rectangle.Contains,
      );
      this.startText.on('pointerup', startGame);  // .on, not .once — START stays armed across the LOADING→READY transition

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
      this.input.keyboard!.once('keydown-L', () => this.openLeaderboard());
    });
  }
}

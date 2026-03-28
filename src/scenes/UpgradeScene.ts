import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../constants';
import { UPGRADE_DEFS } from '../data/upgradeDefs';
import { getBalance, getUpgradeLevel, purchaseUpgrade } from '../systems/SaveData';
import { InputManager } from '../systems/InputManager';

const ROW_START_Y = 130;
const ROW_SPACING = 98;
const COL_LEFT    = 28;
const COL_RIGHT   = GAME_WIDTH - 16;

const ACCENT_COLORS: Record<string, number> = {
  air_jump:    0x4488ff,
  wall_jump:   0x4488ff,
  dash:        0x44bbff,
  money_mult:  0xffaa22,
  jump_boost:  0x22ccff,
  stomp_gold:  0xff8844,
  peak_hunter: 0xcc44ff,
};

export class UpgradeScene extends Phaser.Scene {
  private selectedIndex: number = 0;
  private balanceText!:  Phaser.GameObjects.Text;
  private titleShadow!:  Phaser.GameObjects.Text;
  private titleText!:    Phaser.GameObjects.Text;
  private rows:          UpgradeRow[] = [];
  private twinkleStars:  Phaser.GameObjects.Graphics[] = [];

  constructor() {
    super({ key: 'UpgradeScene' });
  }

  create(): void {
    this.twinkleStars = [];
    this.selectedIndex = 0;

    this.createSkyGradient();
    this.createStarField();
    this.createFloatingClouds();
    this.createHeader();
    this.createRows();
    this.createFooter();
    this.registerInput();
    this.runEntranceSequence();
  }

  // ── Background ───────────────────────────────────────────────────────────────

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

  private createStarField(): void {
    const staticG = this.add.graphics().setDepth(1);
    for (let i = 0; i < 68; i++) {
      const x    = Phaser.Math.Between(0, GAME_WIDTH);
      const y    = Phaser.Math.Between(0, 514);
      const roll = Phaser.Math.Between(0, 9);
      const r    = roll < 6 ? 0.7 : roll < 9 ? 1.2 : 2.0;
      const a    = roll < 6 ? 0.9 : roll < 9 ? 0.55 : 0.25;
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

  private createFloatingClouds(): void {
    const clouds: [number, number, number, boolean, number, number][] = [
      [ 60,  100, 2.0, true,  22000, 0.38],
      [380,  170, 1.5, false, 28000, 0.35],
      [160,  260, 1.2, true,  18000, 0.42],
    ];
    for (const [x, y, scale, goLeft, duration, alpha] of clouds) {
      this.spawnCloud(x, y, scale, goLeft, duration, alpha);
    }
  }

  private spawnCloud(x: number, y: number, scaleVal: number, goLeft: boolean, duration: number, alpha: number): void {
    const cloud = this.add.image(x, y, 'cloud')
      .setScale(scaleVal).setAlpha(alpha).setDepth(3).setScrollFactor(0);
    const offscreen = 32 * scaleVal + 10;
    const targetX   = goLeft ? -offscreen : GAME_WIDTH + offscreen;
    const startX    = goLeft ? GAME_WIDTH + offscreen : -offscreen;
    const doTween   = () => {
      this.tweens.add({
        targets: cloud, x: targetX, duration, ease: 'Linear',
        onComplete: () => { cloud.setX(startX); doTween(); },
      });
    };
    doTween();
  }

  // ── Header ───────────────────────────────────────────────────────────────────

  private createHeader(): void {
    this.titleShadow = this.add.text(242, 52, 'UPGRADES', {
      fontSize: '38px', fontStyle: 'bold',
      color: '#000000', stroke: '#000000', strokeThickness: 10,
    }).setOrigin(0.5).setAlpha(0).setDepth(5);

    this.titleText = this.add.text(240, 50, 'UPGRADES', {
      fontSize: '38px', fontStyle: 'bold',
      color: '#ff9922', stroke: '#1a0800', strokeThickness: 6,
    }).setOrigin(0.5).setAlpha(0).setDepth(5);

    this.balanceText = this.add.text(GAME_WIDTH / 2, 96, '', {
      fontSize: '18px', color: '#ffdd77',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setAlpha(0).setDepth(5);
  }

  // ── Rows ─────────────────────────────────────────────────────────────────────

  private createRows(): void {
    this.rows = UPGRADE_DEFS.map((def, i) => {
      const y           = ROW_START_Y + i * ROW_SPACING;
      const accentColor = ACCENT_COLORS[def.id] ?? 0x888888;
      return new UpgradeRow(this, def.name, y, accentColor);
    });

    // All rows get interactive — hover selects, click buys (desktop + mobile)
    this.rows.forEach((row, i) => {
      row.enableInteractive(
        () => { this.selectedIndex = i; this.refreshAll(); },
        () => { this.selectedIndex = i; this.buy(); },
      );
    });

    this.refreshAll();
  }

  // ── Footer ───────────────────────────────────────────────────────────────────

  private createFooter(): void {
    const im = InputManager.getInstance();

    if (im.isMobile) {
      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 54, 'Tap row to buy', {
        fontSize: '14px', color: '#888888',
      }).setOrigin(0.5).setDepth(8);

      const backBtnBg = this.add.rectangle(
        GAME_WIDTH / 2, GAME_HEIGHT - 24, 200, 36, 0x1a0800,
      ).setStrokeStyle(1, 0xff9922).setInteractive({ useHandCursor: true }).setDepth(8);

      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 24, '\u2190 Back to Menu', {
        fontSize: '15px', color: '#ff9922',
        stroke: '#000000', strokeThickness: 1,
      }).setOrigin(0.5).setDepth(9);

      backBtnBg.on('pointerup', () => this.scene.start('MenuScene'));
    } else {
      this.add.text(
        GAME_WIDTH / 2, GAME_HEIGHT - 30,
        '\u2191\u2193 navigate   ENTER / click to buy   ESC menu',
        { fontSize: '14px', color: '#888888' },
      ).setOrigin(0.5).setDepth(8);
    }
  }

  // ── Input ────────────────────────────────────────────────────────────────────

  private registerInput(): void {
    const kb = this.input.keyboard!;
    kb.on('keydown-UP',    () => this.move(-1));
    kb.on('keydown-DOWN',  () => this.move(1));
    kb.on('keydown-ENTER', () => this.buy());
    kb.on('keydown-SPACE', () => this.buy());
    kb.on('keydown-ESC',   () => this.scene.start('MenuScene'));
  }

  // ── Entrance animation ───────────────────────────────────────────────────────

  private runEntranceSequence(): void {
    this.tweens.add({
      targets: [this.titleShadow, this.titleText, this.balanceText],
      alpha: 1, duration: 400, delay: 0,
    });

    const lastDelay = 200 + (this.rows.length - 1) * 70;
    this.rows.forEach((row, i) => {
      this.tweens.add({
        targets: row.getAllObjects(),
        alpha: 1, duration: 300, delay: 200 + i * 70,
      });
    });

    // After all rows are visible, apply proper dim states for unaffordable rows
    this.time.delayedCall(lastDelay + 310, () => this.refreshAll());

    // Twinkle after everything appears
    this.time.delayedCall(lastDelay + 400, () => this.startTwinkle());
  }

  private startTwinkle(): void {
    for (const star of this.twinkleStars) {
      this.tweens.add({
        targets: star,
        alpha: { from: 0.9, to: 0.15 },
        duration: Phaser.Math.Between(1200, 2800),
        yoyo: true, loop: -1,
        delay: Phaser.Math.Between(0, 2000),
      });
    }
  }

  // ── Logic ────────────────────────────────────────────────────────────────────

  private move(dir: number): void {
    this.selectedIndex = (this.selectedIndex + dir + UPGRADE_DEFS.length) % UPGRADE_DEFS.length;
    this.refreshAll();
  }

  private buy(): void {
    const id      = UPGRADE_DEFS[this.selectedIndex].id;
    const success = purchaseUpgrade(id);
    if (success) {
      // Flash the row green, then refresh after the animation
      this.rows[this.selectedIndex].flashSuccess();
      this.time.delayedCall(450, () => this.refreshAll());
    } else {
      this.refreshAll();
    }
  }

  private refreshAll(): void {
    this.balanceText.setText(`Balance: ${getBalance()} coins`);
    const balance = getBalance();
    this.rows.forEach((row, i) => {
      const def       = UPGRADE_DEFS[i];
      const level     = getUpgradeLevel(def.id);
      const maxed     = level >= def.maxLevel;
      const nextCost  = maxed ? 0 : def.cost(level + 1);
      const canAfford = !maxed && balance >= nextCost;
      row.refresh(
        level, def.maxLevel, nextCost, def.description(level),
        i === this.selectedIndex, maxed, canAfford,
      );
    });
  }
}

// ── Helper class: one upgrade row ──────────────────────────────────────────

class UpgradeRow {
  private readonly scene:     Phaser.Scene;
  private bg:        Phaser.GameObjects.Rectangle;
  private accentBar: Phaser.GameObjects.Rectangle;
  private nameText:  Phaser.GameObjects.Text;
  private levelText: Phaser.GameObjects.Text;
  private costText:  Phaser.GameObjects.Text;
  private descText:  Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, name: string, y: number, accentColor: number) {
    this.scene = scene;

    this.bg = scene.add.rectangle(GAME_WIDTH / 2, y + 39, GAME_WIDTH - 20, 78, 0x0a0818)
      .setFillStyle(0x0a0818, 0.92)
      .setStrokeStyle(1, 0x2a2240)
      .setDepth(6)
      .setAlpha(0);

    this.accentBar = scene.add.rectangle(14, y + 39, 4, 74, accentColor)
      .setDepth(7)
      .setAlpha(0);

    this.nameText = scene.add.text(COL_LEFT, y + 6, name, {
      fontSize: '20px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 2,
    }).setDepth(7).setAlpha(0);

    this.levelText = scene.add.text(COL_RIGHT, y + 6, '', {
      fontSize: '16px', color: '#ffdd77',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(1, 0).setDepth(7).setAlpha(0);

    this.costText = scene.add.text(COL_LEFT, y + 30, '', {
      fontSize: '15px', color: '#ff9922',
      stroke: '#000000', strokeThickness: 1,
    }).setDepth(7).setAlpha(0);

    this.descText = scene.add.text(COL_LEFT, y + 52, '', {
      fontSize: '13px', color: '#cc9966',
      stroke: '#000000', strokeThickness: 1,
    }).setDepth(7).setAlpha(0);
  }

  getAllObjects(): Phaser.GameObjects.GameObject[] {
    return [this.bg, this.accentBar, this.nameText, this.levelText, this.costText, this.descText];
  }

  enableInteractive(onHover: () => void, onBuy: () => void): void {
    this.bg.setInteractive({ useHandCursor: true });
    this.bg.on('pointerover', onHover);
    this.bg.on('pointerup',   onBuy);
  }

  flashSuccess(): void {
    this.bg.setFillStyle(0x0a3018).setStrokeStyle(2, 0x44ff88);
    // Restore to selected-state colors after flash (purchase always hits selected row)
    this.scene.time.delayedCall(400, () => {
      this.bg.setFillStyle(0x1a0800, 0.95).setStrokeStyle(2, 0xff9922);
    });
  }

  refresh(
    level:     number,
    maxLevel:  number,
    nextCost:  number,
    desc:      string,
    selected:  boolean,
    maxed:     boolean,
    canAfford: boolean,
  ): void {
    // Background state
    if (maxed) {
      this.bg.setFillStyle(0x061806, 0.92)
        .setStrokeStyle(selected ? 2 : 1, selected ? 0x44ff88 : 0x22aa44);
    } else if (selected) {
      this.bg.setFillStyle(0x1a0800, 0.95).setStrokeStyle(2, 0xff9922);
    } else {
      this.bg.setFillStyle(0x0a0818, 0.92).setStrokeStyle(1, 0x2a2240);
    }

    // Level indicator
    this.levelText.setText(`Lv ${level} / ${maxLevel}`)
      .setColor(maxed ? '#44ff88' : '#ffdd77');

    // Cost / status
    if (maxed) {
      this.costText.setText('MAXED').setColor('#44ff88');
    } else {
      this.costText.setText(`${nextCost} coins`)
        .setColor(canAfford ? '#ff9922' : '#996644');
    }

    // Description
    this.descText.setText(desc).setColor(maxed ? '#44ff88' : '#cc9966');

    // Dim text + accent when unaffordable, not selected, not maxed
    const dimmed = !maxed && !canAfford && !selected;
    const alpha  = dimmed ? 0.65 : 1;
    this.nameText.setAlpha(alpha);
    this.levelText.setAlpha(alpha);
    this.costText.setAlpha(alpha);
    this.descText.setAlpha(alpha);
    this.accentBar.setAlpha(dimmed ? 0.45 : 1);
  }
}

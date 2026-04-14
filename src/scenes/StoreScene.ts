// src/scenes/StoreScene.ts
import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../constants';
import { ITEM_DEFS, ItemCategory } from '../data/itemDefs';
import { getBalance, getItemQuantity, purchaseItem } from '../systems/SaveData';
import { InputManager } from '../systems/InputManager';

const ROW_START_Y   = 160;
const ROW_SPACING   = 88;
const ROW_HEIGHT    = 76;
const COL_LEFT      = 28;
const COL_RIGHT     = GAME_WIDTH - 16;
const FOOTER_HEIGHT = 50;
const HEADER_BOTTOM = 145;
void HEADER_BOTTOM;

const TAB_LABELS: Array<{ label: string; value: ItemCategory | 'all' }> = [
  { label: 'All',       value: 'all' },
  { label: 'Placeable', value: 'placeable' },
  { label: 'Buff',      value: 'buff' },
];

const ACCENT_COLORS: Record<string, number> = {
  ladder:     0x44cc88,
  ibeam:      0x4488ff,
  checkpoint: 0xffaa22,
  shield:     0xcc44ff,
};

export class StoreScene extends Phaser.Scene {
  private selectedIndex: number = 0;
  private activeFilter: ItemCategory | 'all' = 'all';
  private balanceText!: Phaser.GameObjects.Text;
  private titleText!:   Phaser.GameObjects.Text;
  private titleShadow!: Phaser.GameObjects.Text;
  private rows: StoreRow[] = [];
  private tabTexts: Phaser.GameObjects.Text[] = [];
  private tabBgs:   Phaser.GameObjects.Rectangle[] = [];
  private twinkleStars: Phaser.GameObjects.Graphics[] = [];
  private maxScroll: number = 0;

  constructor() {
    super({ key: 'StoreScene' });
  }

  create(): void {
    this.twinkleStars = [];
    this.selectedIndex = 0;
    this.activeFilter = 'all';

    this.createSkyGradient();
    this.createStarField();
    this.createFloatingClouds();
    this.createHeader();
    this.createFilterTabs();
    this.createRows();
    this.createFooter();
    this.setupScroll();
    this.registerInput();
    this.runEntranceSequence();
  }

  // ── Background ────────────────────────────────────────────────────────────────

  private createSkyGradient(): void {
    const bands: [number, number, number][] = [
      [0,   47, 0x0a0818], [47,  47, 0x0e0d24], [94,  47, 0x121530],
      [141, 47, 0x161c3a], [188, 47, 0x1a2244], [235, 47, 0x1e284e],
      [282, 47, 0x222d55], [329, 47, 0x2a3460], [376, 47, 0x2e3860],
      [423, 47, 0x37415e], [470, 47, 0x4a4455], [517, 47, 0x5c4840],
      [564, 47, 0x6e4e30], [611, 47, 0x7d5228], [658, 47, 0x8a5520],
      [705, 47, 0x7a4a1a], [752, 47, 0x5e3a14], [799, 55, 0x3e280e],
    ];
    const g = this.add.graphics().setDepth(0).setScrollFactor(0);
    for (const [y, h, color] of bands) {
      g.fillStyle(color, 1);
      g.fillRect(0, y, GAME_WIDTH, h);
    }
  }

  private createStarField(): void {
    const staticG = this.add.graphics().setDepth(1).setScrollFactor(0);
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
      const g = this.add.graphics().setDepth(1).setScrollFactor(0);
      const x = Phaser.Math.Between(0, GAME_WIDTH);
      const y = Phaser.Math.Between(0, 514);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(x, y, 1.2);
      this.twinkleStars.push(g);
    }
  }

  private createFloatingClouds(): void {
    const clouds: [number, number, number, boolean, number, number][] = [
      [60,  100, 2.0, true,  22000, 0.38],
      [380, 170, 1.5, false, 28000, 0.35],
      [160, 260, 1.2, true,  18000, 0.42],
    ];
    for (const [x, y, scale, goLeft, duration, alpha] of clouds) {
      this.spawnCloud(x, y, scale, goLeft, duration, alpha);
    }
  }

  private spawnCloud(x: number, y: number, scaleVal: number, goLeft: boolean, duration: number, alpha: number): void {
    const cloud = this.add.image(x, y, 'cloud')
      .setScale(scaleVal).setAlpha(alpha).setDepth(3).setScrollFactor(0);
    const offscreen = 32 * scaleVal + 10;
    const targetX = goLeft ? -offscreen : GAME_WIDTH + offscreen;
    const startX  = goLeft ? GAME_WIDTH + offscreen : -offscreen;
    const doTween = () => {
      this.tweens.add({
        targets: cloud, x: targetX, duration, ease: 'Linear',
        onComplete: () => { cloud.setX(startX); doTween(); },
      });
    };
    doTween();
  }

  // ── Header ────────────────────────────────────────────────────────────────────

  private createHeader(): void {
    const headerCover = this.add.graphics().setDepth(9).setScrollFactor(0);
    const bands: [number, number, number][] = [
      [0,  47, 0x0a0818], [47, 47, 0x0e0d24], [94, 21, 0x121530],
    ];
    for (const [y, h, color] of bands) {
      headerCover.fillStyle(color, 1);
      headerCover.fillRect(0, y, GAME_WIDTH, h);
    }

    const backHit = this.add.rectangle(30, 50, 52, 52, 0x000000, 0)
      .setInteractive({ useHandCursor: true }).setDepth(11).setScrollFactor(0);
    this.add.text(12, 34, '\u2190', {
      fontSize: '48px', color: '#ff9922',
      stroke: '#000000', strokeThickness: 3,
    }).setDepth(11).setScrollFactor(0);
    backHit.on('pointerup', () => this.scene.start('MenuScene'));

    this.titleShadow = this.add.text(242, 52, 'STORE', {
      fontSize: '38px', fontStyle: 'bold',
      color: '#000000', stroke: '#000000', strokeThickness: 10,
    }).setOrigin(0.5).setAlpha(0).setDepth(10).setScrollFactor(0);

    this.titleText = this.add.text(240, 50, 'STORE', {
      fontSize: '38px', fontStyle: 'bold',
      color: '#ff9922', stroke: '#1a0800', strokeThickness: 6,
    }).setOrigin(0.5).setAlpha(0).setDepth(10).setScrollFactor(0);

    this.balanceText = this.add.text(GAME_WIDTH / 2, 96, '', {
      fontSize: '18px', color: '#ffdd77',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setAlpha(0).setDepth(10).setScrollFactor(0);
  }

  // ── Filter Tabs ───────────────────────────────────────────────────────────────

  private createFilterTabs(): void {
    const tabW = 110;
    const tabH = 28;
    const tabY = 125;
    const startX = GAME_WIDTH / 2 - ((TAB_LABELS.length * tabW + (TAB_LABELS.length - 1) * 8) / 2);

    TAB_LABELS.forEach(({ label, value }, i) => {
      const active = this.activeFilter === value;
      const tx = startX + i * (tabW + 8) + tabW / 2;
      const bg = this.add.rectangle(tx, tabY, tabW, tabH, active ? 0x3a1800 : 0x1a0800)
        .setStrokeStyle(active ? 2 : 1, active ? 0xffaa33 : 0xff9922)
        .setInteractive({ useHandCursor: true })
        .setDepth(10).setScrollFactor(0).setAlpha(0);
      const txt = this.add.text(tx, tabY, label, {
        fontSize: '14px', color: active ? '#ffaa33' : '#ff9922',
        stroke: '#000000', strokeThickness: 1,
      }).setOrigin(0.5).setDepth(11).setScrollFactor(0).setAlpha(0);

      bg.on('pointerup', () => this.setFilter(value));
      this.tabBgs.push(bg);
      this.tabTexts.push(txt);
    });
  }

  private setFilter(filter: ItemCategory | 'all'): void {
    this.activeFilter = filter;
    this.selectedIndex = 0;
    this.rows.forEach((row, i) => {
      const def = ITEM_DEFS[i];
      const visible = filter === 'all' || def.category === filter;
      row.setVisible(visible);
    });
    this.recalcScroll();
    this.refreshTabVisuals();
    this.refreshAll();
  }

  private refreshTabVisuals(): void {
    TAB_LABELS.forEach(({ value }, i) => {
      const active = this.activeFilter === value;
      this.tabBgs[i]?.setFillStyle(active ? 0x3a1800 : 0x1a0800)
                     .setStrokeStyle(active ? 2 : 1, active ? 0xffaa33 : 0xff9922);
      this.tabTexts[i]?.setColor(active ? '#ffaa33' : '#ff9922');
    });
  }

  // ── Rows ──────────────────────────────────────────────────────────────────────

  private createRows(): void {
    this.rows = ITEM_DEFS.map((def, i) => {
      const y = ROW_START_Y + i * ROW_SPACING;
      const accentColor = ACCENT_COLORS[def.id] ?? 0x888888;
      return new StoreRow(this, def.name, y, accentColor);
    });

    this.rows.forEach((row, i) => {
      row.enableInteractive(
        () => { this.selectedIndex = i; this.refreshAll(); },
        () => { this.selectedIndex = i; this.buy(); },
      );
    });

    this.recalcScroll();
    this.refreshAll();
  }

  private recalcScroll(): void {
    const visibleCount = ITEM_DEFS.filter((def, i) => {
      void i;
      return this.activeFilter === 'all' || def.category === this.activeFilter;
    }).length;
    const contentH = ROW_START_Y + visibleCount * ROW_SPACING;
    this.maxScroll = Math.max(0, contentH - (GAME_HEIGHT - FOOTER_HEIGHT));
  }

  // ── Footer ────────────────────────────────────────────────────────────────────

  private createFooter(): void {
    const im = InputManager.getInstance();

    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT - FOOTER_HEIGHT / 2, GAME_WIDTH, FOOTER_HEIGHT, 0x111118, 0.88)
      .setDepth(9).setScrollFactor(0);

    const fadeG = this.add.graphics().setDepth(9).setScrollFactor(0);
    fadeG.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, 0, 0.65, 0.65);
    fadeG.fillRect(0, GAME_HEIGHT - FOOTER_HEIGHT - 28, GAME_WIDTH, 28);

    if (im.isMobile) {
      const backBtnBg = this.add.rectangle(
        GAME_WIDTH / 2, GAME_HEIGHT - 24, 200, 36, 0x1a0800,
      ).setStrokeStyle(1, 0xff9922).setInteractive({ useHandCursor: true })
       .setDepth(10).setScrollFactor(0);
      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 24, '\u2190 Back to Menu', {
        fontSize: '15px', color: '#ff9922', stroke: '#000000', strokeThickness: 1,
      }).setOrigin(0.5).setDepth(11).setScrollFactor(0);
      backBtnBg.on('pointerup', () => this.scene.start('MenuScene'));
    } else {
      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 28,
        '\u2191\u2193 navigate   ENTER / click BUY   ESC menu',
        { fontSize: '16px', color: '#b1abab' },
      ).setOrigin(0.5).setDepth(10).setScrollFactor(0);
    }
  }

  // ── Scroll ────────────────────────────────────────────────────────────────────

  private setupScroll(): void {
    this.input.on('wheel', (_p: unknown, _g: unknown, _dx: unknown, dy: number) => {
      this.scrollBy(dy * 0.6);
    });
    let lastPointerY = 0;
    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => { lastPointerY = ptr.y; });
    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      if (!ptr.isDown) return;
      this.scrollBy(lastPointerY - ptr.y);
      lastPointerY = ptr.y;
    });
  }

  private scrollBy(delta: number): void {
    const cam = this.cameras.main;
    cam.scrollY = Phaser.Math.Clamp(cam.scrollY + delta, 0, this.maxScroll);
  }

  // ── Input ─────────────────────────────────────────────────────────────────────

  private registerInput(): void {
    const kb = this.input.keyboard!;
    kb.on('keydown-UP',    () => this.move(-1));
    kb.on('keydown-DOWN',  () => this.move(1));
    kb.on('keydown-ENTER', () => this.buy());
    kb.on('keydown-SPACE', () => this.buy());
    kb.on('keydown-ESC',   () => this.scene.start('MenuScene'));
  }

  // ── Entrance ──────────────────────────────────────────────────────────────────

  private runEntranceSequence(): void {
    this.tweens.add({
      targets: [this.titleShadow, this.titleText, this.balanceText],
      alpha: 1, duration: 400,
    });
    this.tabBgs.forEach((bg, i) => {
      this.tweens.add({ targets: bg, alpha: 1, duration: 300, delay: 150 + i * 60 });
    });
    this.tabTexts.forEach((txt, i) => {
      this.tweens.add({ targets: txt, alpha: 1, duration: 300, delay: 150 + i * 60 });
    });
    const lastDelay = 250 + (this.rows.length - 1) * 60;
    this.rows.forEach((row, i) => {
      this.tweens.add({
        targets: row.getAllObjects(),
        alpha: 1, duration: 300, delay: 250 + i * 60,
      });
    });
    this.time.delayedCall(lastDelay + 310, () => this.refreshAll());
    this.time.delayedCall(lastDelay + 400, () => {
      for (const star of this.twinkleStars) {
        this.tweens.add({
          targets: star,
          alpha: { from: 0.9, to: 0.15 },
          duration: Phaser.Math.Between(1200, 2800),
          yoyo: true, loop: -1,
          delay: Phaser.Math.Between(0, 2000),
        });
      }
    });
  }

  // ── Logic ─────────────────────────────────────────────────────────────────────

  private move(dir: number): void {
    this.selectedIndex = (this.selectedIndex + dir + ITEM_DEFS.length) % ITEM_DEFS.length;
    this.refreshAll();
  }

  private buy(): void {
    const id = ITEM_DEFS[this.selectedIndex].id;
    const success = purchaseItem(id);
    if (success) {
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
      const def       = ITEM_DEFS[i];
      const qty       = getItemQuantity(def.id);
      const canAfford = balance >= def.cost;
      row.refresh(qty, def.cost, def.description, i === this.selectedIndex, canAfford);
    });
  }
}

// ── StoreRow ──────────────────────────────────────────────────────────────────

class StoreRow {
  private readonly scene: Phaser.Scene;
  private bg:         Phaser.GameObjects.Rectangle;
  private accentBar:  Phaser.GameObjects.Rectangle;
  private nameText:   Phaser.GameObjects.Text;
  private ownText:    Phaser.GameObjects.Text;
  private costText:   Phaser.GameObjects.Text;
  private descText:   Phaser.GameObjects.Text;
  private buyBtnBg:   Phaser.GameObjects.Rectangle;
  private buyBtnTxt:  Phaser.GameObjects.Text;
  private _visible:   boolean = true;

  constructor(scene: Phaser.Scene, name: string, y: number, accentColor: number) {
    this.scene = scene;

    this.bg = scene.add.rectangle(GAME_WIDTH / 2, y + ROW_HEIGHT / 2, GAME_WIDTH - 20, ROW_HEIGHT, 0x0a0818)
      .setFillStyle(0x0a0818, 0.92).setStrokeStyle(1, 0x2a2240).setDepth(6).setAlpha(0);

    this.accentBar = scene.add.rectangle(14, y + ROW_HEIGHT / 2, 4, ROW_HEIGHT - 4, accentColor)
      .setDepth(7).setAlpha(0);

    this.nameText = scene.add.text(COL_LEFT, y + 6, name, {
      fontSize: '20px', color: '#ffffff', stroke: '#000000', strokeThickness: 2,
    }).setDepth(7).setAlpha(0);

    this.ownText = scene.add.text(COL_RIGHT, y + 6, '', {
      fontSize: '16px', color: '#ffdd77', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(1, 0).setDepth(7).setAlpha(0);

    this.costText = scene.add.text(COL_LEFT, y + 28, '', {
      fontSize: '15px', color: '#ff9922', stroke: '#000000', strokeThickness: 1,
    }).setDepth(7).setAlpha(0);

    this.descText = scene.add.text(COL_LEFT, y + 46, '', {
      fontSize: '13px', color: '#cc9966', stroke: '#000000', strokeThickness: 1,
    }).setDepth(7).setAlpha(0);

    const btnX = GAME_WIDTH - 52;
    const btnY = y + 56;
    this.buyBtnBg = scene.add.rectangle(btnX, btnY, 72, 22, 0x1a0800)
      .setStrokeStyle(1, 0xff9922).setInteractive({ useHandCursor: true })
      .setDepth(7).setAlpha(0);

    this.buyBtnTxt = scene.add.text(btnX, btnY, 'BUY', {
      fontSize: '13px', color: '#ff9922', stroke: '#000000', strokeThickness: 1,
    }).setOrigin(0.5).setDepth(8).setAlpha(0);
  }

  getAllObjects(): Phaser.GameObjects.GameObject[] {
    return [this.bg, this.accentBar, this.nameText, this.ownText, this.costText, this.descText, this.buyBtnBg, this.buyBtnTxt];
  }

  setVisible(visible: boolean): void {
    this._visible = visible;
    this.getAllObjects().forEach(o => (o as Phaser.GameObjects.GameObject & { setVisible: (v: boolean) => void }).setVisible(visible));
  }

  enableInteractive(onHover: () => void, onBuy: () => void): void {
    this.bg.setInteractive({ useHandCursor: true });
    this.bg.on('pointerover', onHover);
    this.buyBtnBg.on('pointerover', onHover);
    this.buyBtnBg.on('pointerup', onBuy);
  }

  flashSuccess(): void {
    this.bg.setFillStyle(0x0a3018).setStrokeStyle(2, 0x44ff88);
    this.buyBtnBg.setFillStyle(0x0a3018).setStrokeStyle(2, 0x44ff88);
    this.scene.time.delayedCall(400, () => {
      this.bg.setFillStyle(0x0a0818, 0.92).setStrokeStyle(1, 0x2a2240);
      this.buyBtnBg.setFillStyle(0x1a0800).setStrokeStyle(1, 0xff9922);
    });
  }

  refresh(qty: number, cost: number, desc: string, selected: boolean, canAfford: boolean): void {
    if (!this._visible) return;

    if (selected) {
      this.bg.setFillStyle(0x1a0800, 0.95).setStrokeStyle(2, 0xff9922);
    } else {
      this.bg.setFillStyle(0x0a0818, 0.92).setStrokeStyle(1, 0x2a2240);
    }

    this.ownText.setText(`Own: ${qty}`).setColor('#ffdd77');
    this.costText.setText(`${cost} coins`).setColor(canAfford ? '#ff9922' : '#996644');
    this.descText.setText(desc);

    const dimmed = !canAfford && !selected;
    const alpha  = dimmed ? 0.65 : 1;
    this.nameText.setAlpha(alpha);
    this.ownText.setAlpha(alpha);
    this.costText.setAlpha(alpha);
    this.descText.setAlpha(alpha);
    this.accentBar.setAlpha(dimmed ? 0.45 : 1);

    if (canAfford) {
      this.buyBtnBg.setFillStyle(0x1a0800).setStrokeStyle(selected ? 2 : 1, 0xff9922);
      this.buyBtnTxt.setColor('#ff9922');
    } else {
      this.buyBtnBg.setFillStyle(0x100808).setStrokeStyle(1, 0x664433);
      this.buyBtnTxt.setColor('#664433');
    }
    this.buyBtnBg.setAlpha(dimmed ? 0.65 : 1);
    this.buyBtnTxt.setAlpha(dimmed ? 0.65 : 1);
  }
}

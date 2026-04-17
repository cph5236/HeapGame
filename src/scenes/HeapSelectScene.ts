import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../constants';
import type { HeapSummary } from '../../shared/heapTypes';
import { setSelectedHeapId, finalizeLegacyPlaced } from '../systems/SaveData';
import { HeapClient } from '../systems/HeapClient';
import { drawDifficulty } from '../ui/DifficultyStars';
import { InputManager } from '../systems/InputManager';

const ROW_H = 88;
const ROW_PAD_X = 16;

export class HeapSelectScene extends Phaser.Scene {
  private sorted: HeapSummary[] = [];
  private rowBgs: Phaser.GameObjects.Rectangle[] = [];
  private selectedIndex: number = 0;
  private activeId: string = '';

  constructor() { super({ key: 'HeapSelectScene' }); }

  create(): void {
    const bg = this.add.graphics();
    const bands: [number, number, number][] = [
      [0,   47,  0x0a0818], [47,  47,  0x0e0d24], [94,  47,  0x121530],
      [141, 47,  0x161c3a], [188, 47,  0x1a2244], [235, 47,  0x1e284e],
      [282, 47,  0x222d55], [329, 47,  0x2a3460], [376, 47,  0x2e3860],
      [423, 47,  0x37415e], [470, 47,  0x4a4455], [517, 47,  0x5c4840],
      [564, 47,  0x6e4e30], [611, 47,  0x7d5228], [658, 47,  0x8a5520],
      [705, 47,  0x7a4a1a], [752, 47,  0x5e3a14], [799, 55,  0x3e280e],
    ];
    for (const [y, h, color] of bands) {
      bg.fillStyle(color, 1);
      bg.fillRect(0, y, GAME_WIDTH, h);
    }

    this.add.text(GAME_WIDTH / 2, 34, 'SELECT A HEAP', {
      fontSize: '20px', fontStyle: 'bold', color: '#ffffff',
      stroke: '#000000', strokeThickness: 3,
      letterSpacing: 2,
    }).setOrigin(0.5);

    // Header underline
    this.add.rectangle(GAME_WIDTH / 2, 58, GAME_WIDTH - 2 * ROW_PAD_X, 1, 0x334466);

    const close = this.add.text(GAME_WIDTH - 20, 34, '\u2715', {
      fontSize: '20px', color: '#667799',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    close.on('pointerover', () => close.setColor('#ffffff'));
    close.on('pointerout',  () => close.setColor('#667799'));
    close.once('pointerup', () => this.scene.start('MenuScene'));

    const catalog = (this.game.registry.get('heapCatalog') as HeapSummary[] | undefined) ?? [];

    if (catalog.length === 0) {
      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2,
        'No heaps available — check connection', {
        fontSize: '16px', color: '#8899aa',
        stroke: '#000000', strokeThickness: 2,
        align: 'center', wordWrap: { width: GAME_WIDTH - 40 },
      }).setOrigin(0.5);
      return;
    }

    this.sorted = [...catalog].sort((a, b) =>
      a.params.difficulty - b.params.difficulty
      || a.createdAt.localeCompare(b.createdAt));

    this.activeId = this.game.registry.get('activeHeapId') as string;

    // Start cursor on the currently active heap
    const activeIdx = this.sorted.findIndex(h => h.id === this.activeId);
    this.selectedIndex = activeIdx >= 0 ? activeIdx : 0;

    const listTop = 68;
    this.rowBgs = [];

    this.sorted.forEach((heap, i) => {
      const y = listTop + i * ROW_H;
      const rowBg = this.drawRow(heap, y, heap.id === this.activeId, i);
      this.rowBgs.push(rowBg);
    });

    this.createFooter();
    this.registerInput();
    this.refreshHighlight();
  }

  private drawRow(heap: HeapSummary, y: number, active: boolean, rowIndex: number): Phaser.GameObjects.Rectangle {
    const bgColor = active ? 0x1a2040 : (rowIndex % 2 === 0 ? 0x141629 : 0x0f1020);
    const rowBg = this.add.rectangle(
      GAME_WIDTH / 2, y + ROW_H / 2,
      GAME_WIDTH - 2 * ROW_PAD_X, ROW_H - 6,
      bgColor,
    ).setStrokeStyle(active ? 2 : 1, active ? 0xff9922 : 0x1e2a44)
     .setInteractive({ useHandCursor: true });

    // Left: name + stars
    const lx = ROW_PAD_X + 14;
    this.add.text(lx, y + 18, heap.params.name, {
      fontSize: '17px', fontStyle: 'bold', color: active ? '#ffcc88' : '#ffffff',
      stroke: '#000000', strokeThickness: 2,
    });
    drawDifficulty(this, lx, y + 58, heap.params.difficulty, 20);

    // Right: three stats stacked — label right-aligned, value right-aligned
    const rx       = GAME_WIDTH - ROW_PAD_X - 14;  // right edge = 450
    const valX     = rx;                             // value right edge
    const lblX     = rx - 50;                        // label right edge (gap before value)
    const divX     = rx - 118;                       // divider x
    const midY     = y + ROW_H / 2;
    const STAT_STEP = 22;

    // Divider
    this.add.rectangle(divX, midY, 1, ROW_H - 20, 0x2a3a5a);

    // Spawn row — rat icon left of labels
    const spawnY = midY - STAT_STEP;
    this.add.image(divX + 14, spawnY, 'rat', 0).setOrigin(0.5, 0.5).setScale(0.6);
    this.add.text(lblX, spawnY, 'SPAWN', {
      fontSize: '10px', color: '#7799bb',
    }).setOrigin(1, 0.5);
    this.add.text(valX, spawnY, `${heap.params.spawnRateMult}\u00D7`, {
      fontSize: '14px', fontStyle: 'bold', color: '#ffcc88',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(1, 0.5);

    // Coin row
    this.add.text(lblX, midY, 'COIN', {
      fontSize: '10px', color: '#7799bb',
    }).setOrigin(1, 0.5);
    this.add.text(valX, midY, `${heap.params.coinMult}\u00D7`, {
      fontSize: '14px', fontStyle: 'bold', color: '#ffdd77',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(1, 0.5);

    // Score row
    this.add.text(lblX, midY + STAT_STEP, 'SCORE', {
      fontSize: '10px', color: '#7799bb',
    }).setOrigin(1, 0.5);
    this.add.text(valX, midY + STAT_STEP, `${heap.params.scoreMult}\u00D7`, {
      fontSize: '14px', fontStyle: 'bold', color: '#88ddff',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(1, 0.5);

    rowBg.on('pointerover', () => {
      const i = this.rowBgs.indexOf(rowBg);
      if (i >= 0) { this.selectedIndex = i; this.refreshHighlight(); }
    });
    rowBg.once('pointerup', () => this.select(this.sorted[this.rowBgs.indexOf(rowBg)]));

    return rowBg;
  }

  private createFooter(): void {
    const im = InputManager.getInstance();
    if (im.isMobile) return;

    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT - 25, GAME_WIDTH, 50, 0x111118, 0.88)
      .setDepth(9);
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 25,
      '\u2191\u2193 navigate   ENTER select   ESC back',
      { fontSize: '16px', color: '#b1abab' },
    ).setOrigin(0.5).setDepth(10);
  }

  private registerInput(): void {
    const kb = this.input.keyboard!;
    kb.on('keydown-UP',    () => this.move(-1));
    kb.on('keydown-DOWN',  () => this.move(1));
    kb.on('keydown-ENTER', () => this.confirmSelection());
    kb.on('keydown-ESC',   () => this.scene.start('MenuScene'));
  }

  private move(dir: number): void {
    if (this.sorted.length === 0) return;
    this.selectedIndex = (this.selectedIndex + dir + this.sorted.length) % this.sorted.length;
    this.refreshHighlight();
  }

  private refreshHighlight(): void {
    this.rowBgs.forEach((rowBg, i) => {
      const isActive   = this.sorted[i]?.id === this.activeId;
      const isCursor   = i === this.selectedIndex;
      const strokeW    = (isActive || isCursor) ? 2 : 1;
      const strokeColor = isCursor
        ? (isActive ? 0xff9922 : 0x99ccff)
        : (isActive ? 0xff9922 : 0x1e2a44);
      rowBg.setStrokeStyle(strokeW, strokeColor);
    });
  }

  private confirmSelection(): void {
    if (this.sorted.length === 0) return;
    this.select(this.sorted[this.selectedIndex]);
  }

  private select(heap: HeapSummary): void {
    setSelectedHeapId(heap.id);
    this.game.registry.set('activeHeapId', heap.id);
    this.game.registry.set('heapParams',   heap.params);

    HeapClient.load(heap.id).then((polygon) => {
      this.game.registry.set('heapPolygon', polygon);
    }).finally(() => {
      finalizeLegacyPlaced(heap.id);
      this.scene.start('MenuScene');
    });
  }
}

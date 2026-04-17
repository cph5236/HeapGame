import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../constants';
import type { HeapSummary } from '../../shared/heapTypes';
import { setSelectedHeapId, finalizeLegacyPlaced } from '../systems/SaveData';
import { HeapClient } from '../systems/HeapClient';
import { drawDifficulty } from '../ui/DifficultyStars';

const ROW_H = 88;
const ROW_PAD_X = 16;

export class HeapSelectScene extends Phaser.Scene {
  constructor() { super({ key: 'HeapSelectScene' }); }

  create(): void {
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0b0c1a);

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

    const sorted = [...catalog].sort((a, b) =>
      a.params.difficulty - b.params.difficulty
      || a.createdAt.localeCompare(b.createdAt));

    const activeId = this.game.registry.get('activeHeapId') as string;
    const listTop = 68;

    sorted.forEach((heap, i) => {
      const y = listTop + i * ROW_H;
      this.drawRow(heap, y, heap.id === activeId, i);
    });
  }

  private drawRow(heap: HeapSummary, y: number, active: boolean, rowIndex: number): void {
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

    // Right: three stats stacked, right-aligned
    const rx = GAME_WIDTH - ROW_PAD_X - 14;
    const midY = y + ROW_H / 2;
    const STAT_STEP = 22;

    // Divider
    this.add.rectangle(rx - 88, midY, 1, ROW_H - 20, 0x2a3a5a);

    // Spawn row — rat icon + value
    const spawnY = midY - STAT_STEP;
    this.add.image(rx - 68, spawnY, 'rat', 0).setOrigin(0.5, 0.5).setScale(0.6);
    this.add.text(rx - 52, spawnY, 'SPAWN', {
      fontSize: '10px', color: '#7799bb',
    }).setOrigin(0, 0.5);
    this.add.text(rx, spawnY, `${heap.params.spawnRateMult}\u00D7`, {
      fontSize: '14px', fontStyle: 'bold', color: '#ffcc88',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(1, 0.5);

    // Coin row
    this.add.text(rx - 52, midY, 'COIN', {
      fontSize: '10px', color: '#7799bb',
    }).setOrigin(0, 0.5);
    this.add.text(rx, midY, `${heap.params.coinMult}\u00D7`, {
      fontSize: '14px', fontStyle: 'bold', color: '#ffdd77',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(1, 0.5);

    // Score row
    this.add.text(rx - 52, midY + STAT_STEP, 'SCORE', {
      fontSize: '10px', color: '#7799bb',
    }).setOrigin(0, 0.5);
    this.add.text(rx, midY + STAT_STEP, `${heap.params.scoreMult}\u00D7`, {
      fontSize: '14px', fontStyle: 'bold', color: '#88ddff',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(1, 0.5);

    rowBg.once('pointerup', () => this.select(heap));
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

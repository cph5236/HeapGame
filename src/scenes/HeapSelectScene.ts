import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../constants';
import type { HeapSummary } from '../../shared/heapTypes';
import { setSelectedHeapId, finalizeLegacyPlaced } from '../systems/SaveData';
import { HeapClient } from '../systems/HeapClient';
import { drawDifficulty } from '../ui/DifficultyStars';

const ROW_H = 72;
const ROW_PAD_X = 16;

export class HeapSelectScene extends Phaser.Scene {
  constructor() { super({ key: 'HeapSelectScene' }); }

  create(): void {
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0b0c1a);

    this.add.text(GAME_WIDTH / 2, 36, 'SELECT A HEAP', {
      fontSize: '22px', fontStyle: 'bold', color: '#ffffff',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5);

    const close = this.add.text(GAME_WIDTH - 24, 36, '\u2715', {
      fontSize: '22px', color: '#aaaaaa',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
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
    const listTop = 80;

    sorted.forEach((heap, i) => {
      const y = listTop + i * ROW_H;
      this.drawRow(heap, y, heap.id === activeId, i);
    });
  }

  private drawRow(heap: HeapSummary, y: number, active: boolean, rowIndex: number): void {
    const stripe = rowIndex % 2 === 0 ? 0x141629 : 0x0f1020;
    const rowBg = this.add.rectangle(GAME_WIDTH / 2, y + ROW_H / 2, GAME_WIDTH - 2 * ROW_PAD_X, ROW_H - 4, stripe)
      .setStrokeStyle(active ? 2 : 0, 0xff9922)
      .setInteractive({ useHandCursor: true });

    this.add.text(ROW_PAD_X + 8, y + 18, heap.params.name, {
      fontSize: '18px', fontStyle: 'bold', color: '#ffffff',
      stroke: '#000000', strokeThickness: 2,
    });

    drawDifficulty(this, ROW_PAD_X + 8, y + 48, heap.params.difficulty, 16);

    // Right column: spawn (rat icon + ×N), coin, score
    const rightX = GAME_WIDTH - ROW_PAD_X - 8;

    this.add.image(rightX - 80, y + 26, 'rat', 0)
      .setOrigin(1, 0.5)
      .setScale(0.8);
    this.add.text(rightX - 72, y + 20, `${heap.params.spawnRateMult}\u00D7`, {
      fontSize: '13px', color: '#ffcc88', stroke: '#000000', strokeThickness: 2,
    });

    this.add.text(rightX, y + 40, `COIN ${heap.params.coinMult}\u00D7`, {
      fontSize: '13px', color: '#ffdd77', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(1, 0.5);

    this.add.text(rightX, y + 58, `SCORE ${heap.params.scoreMult}\u00D7`, {
      fontSize: '13px', color: '#88ddff', stroke: '#000000', strokeThickness: 2,
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

import Phaser from 'phaser';
import type { HeapSummary } from '../../shared/heapTypes';
import { setSelectedHeapId, finalizeLegacyPlaced, getPlayerGuid } from '../systems/SaveData';
import { HeapClient } from '../systems/HeapClient';
import { drawDifficulty } from '../ui/DifficultyStars';
import { InputManager } from '../systems/InputManager';
import { ScoreClient } from '../systems/ScoreClient';
import { heightFt } from '../util/format';
import type { PlayerScoreEntry } from '../../shared/scoreTypes';

const ROW_H = 88;
const ROW_PAD_X = 16;

export class HeapSelectScene extends Phaser.Scene {
  private sorted: HeapSummary[] = [];
  private rowBgs: Phaser.GameObjects.Rectangle[] = [];
  private selectedIndex: number = 0;
  private activeId: string = '';
  private playerScores: Map<string, PlayerScoreEntry> = new Map();
  private rankTextByRow: Map<number, Phaser.GameObjects.Text> = new Map();

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
      bg.fillRect(0, y, this.scale.width, h);
    }
    bg.fillStyle(0x3e280e, 1);
    bg.fillRect(0, 854, this.scale.width, Math.max(0, this.scale.height - 854));

    this.add.text(this.scale.width / 2, 34, 'SELECT A HEAP', {
      fontSize: '20px', fontStyle: 'bold', color: '#ffffff',
      stroke: '#000000', strokeThickness: 3,
      letterSpacing: 2,
    }).setOrigin(0.5);

    // Header underline
    this.add.rectangle(this.scale.width / 2, 58, this.scale.width - 2 * ROW_PAD_X, 1, 0x334466);

    // Back arrow \u2014 top-left, matches StoreScene/UpgradeScene
    const backHit = this.add.rectangle(30, 34, 52, 52, 0x000000, 0)
      .setInteractive({ useHandCursor: true })
      .setDepth(11);
    this.add.text(12, 18, '\u2190', {
      fontSize: '32px', color: '#ff9922',
      stroke: '#000000', strokeThickness: 3,
    }).setDepth(11);
    backHit.on('pointerup', () => this.scene.start('MenuScene'));

    const catalog = (this.game.registry.get('heapCatalog') as HeapSummary[] | undefined) ?? [];

    if (catalog.length === 0) {
      this.add.text(this.scale.width / 2, this.scale.height / 2,
        'No heaps available — check connection', {
        fontSize: '16px', color: '#8899aa',
        stroke: '#000000', strokeThickness: 2,
        align: 'center', wordWrap: { width: this.scale.width - 40 },
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
    void this.fetchPlayerScores();
  }

  private drawRow(heap: HeapSummary, y: number, active: boolean, rowIndex: number): Phaser.GameObjects.Rectangle {
    const bgColor = active ? 0x1a2040 : (rowIndex % 2 === 0 ? 0x141629 : 0x0f1020);
    const rowBg = this.add.rectangle(
      this.scale.width / 2, y + ROW_H / 2,
      this.scale.width - 2 * ROW_PAD_X, ROW_H - 6,
      bgColor,
    ).setStrokeStyle(active ? 2 : 1, active ? 0xff9922 : 0x1e2a44)
     .setInteractive({ useHandCursor: true });

    // Right: three stats stacked — label right-aligned, value right-aligned
    const rx       = this.scale.width - ROW_PAD_X - 14;
    const valX     = rx;                             // value right edge
    const lblX     = rx - 50;                        // label right edge (gap before value)
    const divX     = rx - 118;                       // divider x
    const midY     = y + ROW_H / 2;
    const STAT_STEP = 22;

    // Trophy/rank button — spans both rows, sits left of the stat divider
    const tBtnW = 78;
    const tBtnH = ROW_H - 20;
    const tBtnRightX  = divX - 10;
    const tBtnLeftX   = tBtnRightX - tBtnW;
    const tBtnCenterX = (tBtnLeftX + tBtnRightX) / 2;

    // Left column, two lines:
    //   row 1: heap name (wraps so it can't overlap the trophy button)
    //   row 2: hero height (⛰ accent) + difficulty stars on the same baseline
    const lx = ROW_PAD_X + 14;
    const nameMaxW = tBtnLeftX - lx - 8;
    this.add.text(lx, y + 18, heap.params.name, {
      fontSize: '17px', fontStyle: 'bold', color: active ? '#ffcc88' : '#ffffff',
      stroke: '#000000', strokeThickness: 2,
      wordWrap: { width: nameMaxW },
    });

    const heightLabel = `⛰ ${heightFt(heap.params.worldHeight, heap.topY, heap.params.isInfinite)}`;
    const heightText = this.add.text(lx, y + 58, heightLabel, {
      fontSize: '16px', fontStyle: 'bold', color: '#ff9922',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0, 0.5);
    drawDifficulty(this, lx + heightText.width + 12, y + 58, heap.params.difficulty, 18);

    const tBtnBg = this.add.rectangle(tBtnCenterX, midY, tBtnW, tBtnH, 0x10131f)
      .setStrokeStyle(1, 0x334466)
      .setInteractive({ useHandCursor: true });
    this.add.text(tBtnCenterX, midY - 12, '🏆', {
      fontSize: '22px',
    }).setOrigin(0.5);
    const rankText = this.add.text(tBtnCenterX, midY + 18, 'Rank: —', {
      fontSize: '12px', color: '#7799bb',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5);
    this.rankTextByRow.set(rowIndex, rankText);
    tBtnBg.on('pointerover', () => tBtnBg.setStrokeStyle(1, 0xff9922));
    tBtnBg.on('pointerout',  () => tBtnBg.setStrokeStyle(1, 0x334466));
    tBtnBg.on('pointerup', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      this.openLeaderboard(heap);
    });

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

    this.add.rectangle(this.scale.width / 2, this.scale.height - 25, this.scale.width, 50, 0x111118, 0.88)
      .setDepth(9);

    if (im.isMobile) {
      const backBtnBg = this.add.rectangle(
        this.scale.width / 2, this.scale.height - 25, 200, 36, 0x1a0800,
      ).setStrokeStyle(1, 0xff9922).setInteractive({ useHandCursor: true })
       .setDepth(10);
      this.add.text(this.scale.width / 2, this.scale.height - 25, '\u2190 Back to Menu', {
        fontSize: '15px', color: '#ff9922',
        stroke: '#000000', strokeThickness: 1,
      }).setOrigin(0.5).setDepth(11);
      backBtnBg.on('pointerup', () => this.scene.start('MenuScene'));
    } else {
      this.add.text(this.scale.width / 2, this.scale.height - 25,
        '\u2191\u2193 navigate   ENTER select   R scores   ESC back',
        { fontSize: '16px', color: '#b1abab' },
      ).setOrigin(0.5).setDepth(10);
    }
  }

  private registerInput(): void {
    const kb = this.input.keyboard!;
    kb.on('keydown-UP',    () => this.move(-1));
    kb.on('keydown-DOWN',  () => this.move(1));
    kb.on('keydown-ENTER', () => this.confirmSelection());
    kb.on('keydown-R',     () => this.openHighlightedLeaderboard());
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

    if (heap.params.isInfinite) {
      this.game.registry.set('heapPolygon', []);
      finalizeLegacyPlaced(heap.id);
      this.scene.start('MenuScene');
      return;
    }

    HeapClient.load(heap.id).then((polygon) => {
      this.game.registry.set('heapPolygon', polygon);
    }).finally(() => {
      finalizeLegacyPlaced(heap.id);
      this.scene.start('MenuScene');
    });
  }

  private async fetchPlayerScores(): Promise<void> {
    const playerId = getPlayerGuid();
    const map = await ScoreClient.getPlayerScores(playerId);
    if (!map) return;  // network failure — leave placeholders
    this.playerScores = map;
    this.refreshYouStats();
  }

  private refreshYouStats(): void {
    this.sorted.forEach((heap, i) => {
      const txt = this.rankTextByRow.get(i);
      if (!txt) return;
      const entry = this.playerScores.get(heap.id);
      if (!entry) {
        txt.setText('Rank: —').setColor('#7799bb');
        return;
      }
      txt.setText(`Rank: #${entry.rank}`).setColor('#ffcc88');
    });
  }

  private openHighlightedLeaderboard(): void {
    if (this.sorted.length === 0) return;
    this.openLeaderboard(this.sorted[this.selectedIndex]);
  }

  private openLeaderboard(heap: HeapSummary): void {
    this.scene.launch('LeaderboardScene', {
      heapId:   heap.id,
      heapName: heap.params.name,
      playerId: getPlayerGuid(),
    });
    this.scene.pause();
  }
}

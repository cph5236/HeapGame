import Phaser from 'phaser';
import type { HeapSummary } from '../../shared/heapTypes';
import { setupUiCamera, logicalWidth, logicalHeight } from '../systems/displayMetrics';
import { setSelectedHeapId, finalizeLegacyPlaced, getPlayerGuid } from '../systems/SaveData';
import { HeapClient } from '../systems/HeapClient';
import { drawDifficulty } from '../ui/DifficultyStars';
import { InputManager } from '../systems/InputManager';
import { ScoreClient } from '../systems/ScoreClient';
import { heightFt } from '../util/format';
import type { PlayerScoreEntry } from '../../shared/scoreTypes';
import { getLogger } from '../logging';
import { applyYouStats } from './heapSelectStats';

const ROW_H = 102;
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
    setupUiCamera(this);
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
      bg.fillRect(0, y, logicalWidth(this), h);
    }
    bg.fillStyle(0x3e280e, 1);
    bg.fillRect(0, 854, logicalWidth(this), Math.max(0, logicalHeight(this) - 854));

    this.add.text(logicalWidth(this) / 2, 34, 'SELECT A HEAP', {
      fontSize: '20px', fontStyle: 'bold', color: '#ffffff',
      stroke: '#000000', strokeThickness: 3,
      letterSpacing: 2,
    }).setOrigin(0.5);

    // Header underline
    this.add.rectangle(logicalWidth(this) / 2, 58, logicalWidth(this) - 2 * ROW_PAD_X, 1, 0x334466);

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
      this.add.text(logicalWidth(this) / 2, logicalHeight(this) / 2,
        'No heaps available — check connection', {
        fontSize: '16px', color: '#8899aa',
        stroke: '#000000', strokeThickness: 2,
        align: 'center', wordWrap: { width: logicalWidth(this) - 40 },
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
      logicalWidth(this) / 2, y + ROW_H / 2,
      logicalWidth(this) - 2 * ROW_PAD_X, ROW_H - 6,
      bgColor,
    ).setStrokeStyle(active ? 2 : 1, active ? 0xff9922 : 0x1e2a44)
     .setInteractive({ useHandCursor: true });

    // Right: three stats stacked — label right-aligned, value right-aligned
    const rx       = logicalWidth(this) - ROW_PAD_X - 14;
    const valX     = rx;                             // value right edge
    const lblX     = rx - 50;                        // label right edge (gap before value)
    const divX     = rx - 118;                       // divider x
    const midY     = y + ROW_H / 2;
    const STAT_STEP = 22;

    // Trophy/rank button — sits beside the FT + stars rows only (not the name row),
    // so the heap name can use the full width above it.
    const tBtnW = 60;
    const tBtnH = 48;                         // spans FT row (y+56) + stars row (y+82)
    const tBtnRightX  = divX - 10;
    const tBtnLeftX   = tBtnRightX - tBtnW;
    const tBtnCenterX = (tBtnLeftX + tBtnRightX) / 2;
    const tBtnCenterY = y + 69;               // midpoint between FT row (56) and stars row (82)

    // Left column, three lines:
    //   row 1: heap name — single-line, runs full width above the trophy
    //   row 2: hero height (⛰ accent + FT) beside the trophy
    //   row 3: difficulty stars beside the trophy
    const lx = ROW_PAD_X + 14;
    // Generous cap so a pathological name can't push into the stats column,
    // but normal names like "Recycling Center" render on a single line.
    const nameMaxW = divX - lx - 8;
    this.add.text(lx, y + 16, heap.params.name, {
      fontSize: '17px', fontStyle: 'bold', color: active ? '#ffcc88' : '#ffffff',
      stroke: '#000000', strokeThickness: 2,
      wordWrap: { width: nameMaxW },
    });

    // Glyph + label split so the mountain emoji can render bigger than the
    // text without scaling up the digits (emoji render small at body sizes).
    const heightGlyph = this.add.text(lx, y + 56, '⛰', {
      fontSize: '20px',
    }).setOrigin(0, 0.5);
    this.add.text(lx + heightGlyph.width + 4, y + 56,
      heightFt(heap.params.worldHeight, heap.topY, heap.params.isInfinite), {
      fontSize: '16px', fontStyle: 'bold', color: '#ff9922',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0, 0.5);
    drawDifficulty(this, lx, y + 82, heap.params.difficulty, 16);

    const tBtnBg = this.add.rectangle(tBtnCenterX, tBtnCenterY, tBtnW, tBtnH, 0x10131f)
      .setStrokeStyle(1, 0x334466)
      .setInteractive({ useHandCursor: true });
    this.add.text(tBtnCenterX, tBtnCenterY - 8, '🏆', {
      fontSize: '20px',
    }).setOrigin(0.5);
    const rankText = this.add.text(tBtnCenterX, tBtnCenterY + 14, 'Rank: —', {
      fontSize: '11px', color: '#7799bb',
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

    this.add.rectangle(logicalWidth(this) / 2, logicalHeight(this) - 25, logicalWidth(this), 50, 0x111118, 0.88)
      .setDepth(9);

    if (im.isMobile) {
      const backBtnBg = this.add.rectangle(
        logicalWidth(this) / 2, logicalHeight(this) - 25, 200, 36, 0x1a0800,
      ).setStrokeStyle(1, 0xff9922).setInteractive({ useHandCursor: true })
       .setDepth(10);
      this.add.text(logicalWidth(this) / 2, logicalHeight(this) - 25, '\u2190 Back to Menu', {
        fontSize: '15px', color: '#ff9922',
        stroke: '#000000', strokeThickness: 1,
      }).setOrigin(0.5).setDepth(11);
      backBtnBg.on('pointerup', () => this.scene.start('MenuScene'));
    } else {
      this.add.text(logicalWidth(this) / 2, logicalHeight(this) - 25,
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
    getLogger().event({ type: 'heap:selected', heapId: heap.id });
    this.game.registry.set('activeHeapId', heap.id);
    this.game.registry.set('heapParams',   heap.params);

    if (heap.params.isInfinite) {
      this.game.registry.set('heapPolygon', []);
      HeapClient.primeEnemyParams(heap.id).finally(() => {
        finalizeLegacyPlaced(heap.id);
        this.scene.start('MenuScene');
      });
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
    // Guard against the fire-and-forget score fetch resolving after the scene
    // was torn down — mutating destroyed Text objects crashes (Crash_Reports P2).
    applyYouStats(
      this.scene.isActive(),
      this.sorted,
      this.playerScores,
      (i) => this.rankTextByRow.get(i),
    );
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

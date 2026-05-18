import Phaser from 'phaser';
import { SCORE_TO_COINS_DIVISOR, LEADERBOARD_TOP_N } from '../constants';
import {
  addBalance,
  getBalance,
  getPlayerConfig,
  getLocalHighScore,
  setLocalHighScore,
  getPlayerGuid,
  getGpgsPlayerId,
  getPlayerName,
  getPlaced,
  getRawSaveForCloudSync,
} from '../systems/SaveData';
import { buildCoinBreakdown, BreakdownRow } from '../systems/coinBreakdown';
import { buildRunScore, RunScoreRow } from '../systems/buildRunScore';
import type { EnemyKind } from '../entities/Enemy';
import { ENEMY_DEFS } from '../data/enemyDefs';
import { InputManager } from '../systems/InputManager';
import { ScoreClient } from '../systems/ScoreClient';
import type { LeaderboardContext } from '../../shared/scoreTypes';
import type { HeapParams } from '../../shared/heapTypes';
import { DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';
import { getLogger } from '../logging';
import { PlayGamesClient } from '../systems/PlayGamesClient';
import { getPlayConsoleId, LEADERBOARD_HIGH_SCORE_ID } from '../data/achievementDefs';


export class ScoreScene extends Phaser.Scene {
  private score:               number  = 0;
  private isPeak:              boolean = false;
  private checkpointAvailable: boolean = false;
  private isFailure:           boolean = false;
  private _coinsAwarded:       boolean = false;
  private heapId:              string  = '';
  private isNewHighScore:      boolean = false;

  private _baseHeightPx: number                             = 0;
  private _kills:        Partial<Record<EnemyKind, number>> = {};
  private _elapsedMs:    number                             = 0;
  private _scoreRows:    RunScoreRow[]                      = [];
  private _heapParams:   HeapParams                         = DEFAULT_HEAP_PARAMS;

  private _mockLeaderboard:    LeaderboardContext | null = null;
  private _forceBreakdownOpen: boolean                  = false;
  private _mockPlayerConfig:   Partial<{ moneyMultiplier: number; peakMultiplier: number }> = {};

  private _breakdownOpen    = false;
  private _breakdownObjects: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super({ key: 'ScoreScene' });
  }

  init(data: {
    score:                number;
    heapId?:              string;
    isPeak?:              boolean;
    checkpointAvailable?: boolean;
    isFailure?:           boolean;
    baseHeightPx?:        number;
    kills?:               Partial<Record<EnemyKind, number>>;
    elapsedMs?:           number;
    heapParams?:          HeapParams;
    mockLeaderboard?:     LeaderboardContext;
    forceBreakdownOpen?:  boolean;
    mockPlayerConfig?:    Partial<{ moneyMultiplier: number; peakMultiplier: number }>;
  }): void {
    this.score               = data.score               ?? 0;
    this.heapId              = data.heapId              ?? '';
    this.isPeak              = data.isPeak              ?? false;
    this.checkpointAvailable = data.checkpointAvailable ?? false;
    this.isFailure           = data.isFailure           ?? false;
    this._baseHeightPx       = data.baseHeightPx        ?? 0;
    this._kills              = data.kills               ?? {};
    this._elapsedMs          = data.elapsedMs           ?? 0;
    this._scoreRows          = [];
    this._heapParams         = data.heapParams          ?? DEFAULT_HEAP_PARAMS;
    this._mockLeaderboard    = data.mockLeaderboard     ?? null;
    this._forceBreakdownOpen = data.forceBreakdownOpen  ?? false;
    this._mockPlayerConfig   = data.mockPlayerConfig    ?? {};

    // Achievements that trigger on any completed run (fire-and-forget)
    const firstClimbId = getPlayConsoleId('first_climb');
    if (firstClimbId) PlayGamesClient.unlockAchievement(firstClimbId);

    // first_placement: fires if the player has ever placed any item on this heap
    const heapId = data.heapId ?? '';
    if (heapId) {
      const placed = getPlaced(heapId);
      if (placed.length > 0) {
        const placementId = getPlayConsoleId('first_placement');
        if (placementId) PlayGamesClient.unlockAchievement(placementId);
      }
    }
  }

  create(): void {
    // Check and update local high score before rendering anything
    if (this.heapId && this.score > 0) {
      const prev = getLocalHighScore(this.heapId);
      if (this.score > prev) {
        setLocalHighScore(this.heapId, this.score);
        this.isNewHighScore = true;
      }
    }

    if (this._baseHeightPx > 0) {
      const runResult = buildRunScore(
        { baseHeightPx: this._baseHeightPx, kills: this._kills, elapsedMs: this._elapsedMs },
        ENEMY_DEFS,
        this.isFailure,
      );
      this._scoreRows = runResult.rows;
    }

    const cfg    = { ...getPlayerConfig(), ...this._mockPlayerConfig };
    const result = buildCoinBreakdown({
      score:           this.score,
      scoreToCoins:    SCORE_TO_COINS_DIVISOR,
      moneyMultiplier: cfg.moneyMultiplier,
      heapCoinMult:    this._heapParams.coinMult,
      isPeak:          this.isPeak,
      peakMultiplier:  cfg.peakMultiplier,
      isFailure:       this.isFailure,
    });

    if (!this._coinsAwarded) {
      this._coinsAwarded = true;
      addBalance(result.finalCoins);
    }
    const balance = getBalance();

    this.createBackground();
    this.createStarField();
    if (!this.isFailure) this.createConfetti();
    if (this.isFailure)  this.createFailureGlow();

    this.createTitle();
    this.createScoreDisplay();
    if (this.isNewHighScore) this.createHighScoreBadge();
    const coinsPanelBottom = this.createCoinsPanel(result.rows, result.finalCoins, balance);
    this.createLeaderboardPanel(coinsPanelBottom);
    this.createCheckpointButton();
    this.createMenuPrompt();

    if (this._forceBreakdownOpen && this._scoreRows.length > 0) {
      this.time.delayedCall(1600, () => this.openScoreBreakdown());
    }
  }

  // ── Background ────────────────────────────────────────────────────────────────

  private createBackground(): void {
    const g = this.add.graphics();
    const bands: [number, number, number][] = [
      [0,   47, 0x0a0818],
      [47,  47, 0x0c081c],
      [94,  47, 0x0e0920],
      [141, 47, 0x100925],
      [188, 47, 0x130a2a],
      [235, 47, 0x150b2f],
      [282, 47, 0x170b34],
      [329, 47, 0x190c3a],
      [376, 47, 0x1b0c3f],
      [423, 47, 0x1d0d44],
      [470, 47, 0x1f0d49],
      [517, 47, 0x210e4e],
      [564, 47, 0x230e53],
      [611, 47, 0x250f58],
      [658, 47, 0x271060],
      [705, 47, 0x271060],
      [752, 47, 0x291060],
      [799, 55, 0x2a1060],
    ];
    for (const [y, h, color] of bands) {
      g.fillStyle(color, 1);
      g.fillRect(0, y, this.scale.width, h);
    }
    g.fillStyle(0x2a1060, 1);
    g.fillRect(0, 854, this.scale.width, Math.max(0, this.scale.height - 854));
  }

  private createStarField(): void {
    const stars: [number, number, number, number][] = [
      [0.10, 0.04, 2, 0.7], [0.70, 0.07, 1, 0.9], [0.45, 0.14, 2, 0.5],
      [0.88, 0.03, 1, 0.7], [0.25, 0.20, 2, 0.8], [0.55, 0.10, 1, 0.6],
      [0.15, 0.28, 1, 0.5], [0.78, 0.18, 2, 0.9], [0.38, 0.08, 1, 0.8],
      [0.62, 0.24, 2, 0.6], [0.05, 0.35, 1, 0.7], [0.92, 0.28, 2, 0.5],
      [0.48, 0.32, 1, 0.9], [0.82, 0.12, 1, 0.6],
    ];
    const g = this.add.graphics();
    for (const [xf, yf, r, a] of stars) {
      g.fillStyle(0xaaddff, a);
      g.fillCircle(xf * this.scale.width, yf * this.scale.height, r);
    }
  }

  private createFailureGlow(): void {
    const g = this.add.graphics();
    // Counter-gradient: ominous crimson bleed from top, fading ~55% down
    const bands: [number, number, number, number][] = [
      [0,   47, 0x3a0000, 0.45],
      [47,  47, 0x3a0000, 0.38],
      [94,  47, 0x300000, 0.30],
      [141, 47, 0x280000, 0.22],
      [188, 47, 0x200000, 0.15],
      [235, 47, 0x180000, 0.10],
      [282, 47, 0x100000, 0.06],
      [329, 47, 0x080000, 0.03],
      [376, 47, 0x040000, 0.01],
    ];
    for (const [y, h, color, alpha] of bands) {
      g.fillStyle(color, alpha);
      g.fillRect(0, y, this.scale.width, h);
    }
  }

  private createConfetti(): void {
    const colors = [0xffdd44, 0x44ff88, 0xff88cc, 0x44ddff, 0xcc44ff, 0xff8844];
    for (let i = 0; i < 20; i++) {
      const x     = this.scale.width / 2 + Phaser.Math.Between(-60, 60);
      const y     = this.scale.height * 0.22;
      const color = colors[i % colors.length];
      const size  = Phaser.Math.Between(3, 6);
      const g = this.add.graphics();
      g.fillStyle(color, 1);
      if (i % 3 === 0) g.fillRect(-size / 2, -size / 2, size, size);
      else             g.fillCircle(0, 0, size / 2);
      g.setPosition(x, y);
      const angle = Phaser.Math.Between(-150, -30); // degrees, upward
      const rad   = Phaser.Math.DegToRad(angle);
      const speed = Phaser.Math.Between(80, 180);
      this.tweens.add({
        targets:  g,
        x:        x + Math.cos(rad) * speed,
        y:        y + Math.sin(rad) * speed,
        alpha:    0,
        duration: 1200,
        ease:     'Cubic.Out',
        onComplete: () => g.destroy(),
      });
    }
  }

  // ── Title & Score ─────────────────────────────────────────────────────────────

  private createTitle(): void {
    const text         = this.isFailure ? 'HEAP FAILURE' : 'HEAP SUCCESSFUL';
    const color        = this.isFailure ? '#ff5555' : '#44ffaa';
    const fontSize     = this.scale.width < 420 ? '30px' : '36px';
    const letterSpacing = this.scale.width < 420 ? 2 : 4;
    this.add.text(this.scale.width / 2, this.scale.height * 0.13, text, {
      fontSize,
      fontFamily:      'monospace',
      color,
      letterSpacing,
    }).setOrigin(0.5).setShadow(0, 0, color, 8, true, true);
  }

  private createScoreDisplay(): void {
    const scoreText = this.add.text(this.scale.width / 2, this.scale.height * 0.22, '0', {
      fontSize:   '52px',
      fontFamily: 'monospace',
      color:      '#ffdd44',
      fontStyle:  'bold',
    }).setOrigin(0.5)
      .setShadow(0, 2, '#aa6600', 0, true, true);

    if (this.isFailure) scoreText.setAlpha(0.85);

    // Glow ellipse behind score
    const glow = this.add.graphics();
    glow.fillStyle(0xffdd44, 0.08);
    glow.fillEllipse(this.scale.width / 2, this.scale.height * 0.22, 160, 60);
    this.children.moveBelow(glow as Phaser.GameObjects.GameObject, scoreText as Phaser.GameObjects.GameObject);

    this.add.text(this.scale.width / 2, this.scale.height * 0.22 + 34, 'SCORE', {
      fontSize:      '9px',
      fontFamily:    'monospace',
      color:         '#ffdd44',
      letterSpacing: 2,
    }).setOrigin(0.5);

    // Count-up tween
    const counter = { value: 0 };
    this.tweens.add({
      targets:  counter,
      value:    this.score,
      duration: 800,
      ease:     'Cubic.Out',
      onUpdate: () => { scoreText.setText(String(Math.floor(counter.value))); },
      onComplete: () => { scoreText.setText(String(this.score)); },
    });

    if (this._scoreRows.length > 0) {
      scoreText.setInteractive({ useHandCursor: true });
      scoreText.on('pointerover', () => scoreText.setColor('#ffff88'));
      scoreText.on('pointerout',  () => scoreText.setColor('#ffdd44'));
      scoreText.on('pointerup',   () => this.toggleScoreBreakdown());
    }
  }

  private createHighScoreBadge(): void {
    const color = '#ffdd44';
    this.add.text(this.scale.width / 2, this.scale.height * 0.30, 'NEW HIGH SCORE!', {
      fontSize:      '18px',
      fontFamily:    'monospace',
      color,
      letterSpacing: 3,
      fontStyle:     'bold',
    }).setOrigin(0.5).setShadow(0, 0, color, 10, true, true);
  }

  // ── Score Breakdown Panel ─────────────────────────────────────────────────────

  private toggleScoreBreakdown(): void {
    if (this._breakdownOpen) {
      this.closeScoreBreakdown();
    } else {
      this.openScoreBreakdown();
    }
  }

  private openScoreBreakdown(): void {
    if (this._breakdownOpen) return;
    this._breakdownOpen = true;

    const PANEL_W   = this.scale.width * 0.88;
    const PANEL_X   = this.scale.width / 2;
    const PANEL_TOP = this.scale.height * 0.32;
    const ROW_H     = 24;
    const PAD_X     = 14;
    const left      = PANEL_X - PANEL_W / 2 + PAD_X;
    const right     = PANEL_X + PANEL_W / 2 - PAD_X;

    const rows      = this._scoreRows;
    let extraRows   = 1; // for the total row
    if (this._heapParams.scoreMult !== 1.0) extraRows++;
    const panelH    = (rows.length + extraRows) * ROW_H + 32;

    // Panel background
    const bg = this.add.graphics().setDepth(60);
    bg.fillStyle(0x0a0820, 1);
    bg.lineStyle(1, 0xffdd44, 0.25);
    bg.fillRoundedRect(PANEL_X - PANEL_W / 2, PANEL_TOP, PANEL_W, panelH, 8);
    bg.strokeRoundedRect(PANEL_X - PANEL_W / 2, PANEL_TOP, PANEL_W, panelH, 8);
    this._breakdownObjects.push(bg);

    let y = PANEL_TOP + 10;

    for (const row of rows) {
      const mid = y + ROW_H / 2;

      if (row.type === 'height') {
        const lbl = this.add.text(left, mid, row.label, {
          fontSize: '11px', fontFamily: 'monospace', color: '#aaaacc',
        }).setOrigin(0, 0.5).setDepth(61);
        const det = this.add.text(left + 110, mid, row.detail, {
          fontSize: '11px', fontFamily: 'monospace', color: '#aaaacc',
        }).setOrigin(0, 0.5).setDepth(61);
        const val = this.add.text(right, mid, String(row.value), {
          fontSize: '11px', fontFamily: 'monospace', color: '#ffffff',
        }).setOrigin(1, 0.5).setDepth(61);
        this._breakdownObjects.push(lbl, det, val);

      } else if (row.type === 'kill') {
        const lbl = this.add.text(left, mid, row.label, {
          fontSize: '11px', fontFamily: 'monospace', color: '#ff9944',
        }).setOrigin(0, 0.5).setDepth(61);
        const val = this.add.text(right, mid, `+${row.value}`, {
          fontSize: '11px', fontFamily: 'monospace', color: '#ff9944', fontStyle: 'bold',
        }).setOrigin(1, 0.5).setDepth(61);
        this._breakdownObjects.push(lbl, val);

      } else if (row.type === 'pace') {
        const lbl = this.add.text(left, mid, row.label, {
          fontSize: '11px', fontFamily: 'monospace', color: '#44ddff',
        }).setOrigin(0, 0.5).setDepth(61);
        const det = this.add.text(left + 50, mid, row.detail, {
          fontSize: '10px', fontFamily: 'monospace', color: '#44aacc',
        }).setOrigin(0, 0.5).setDepth(61);
        const val = this.add.text(right, mid, `+${row.value}`, {
          fontSize: '11px', fontFamily: 'monospace', color: '#44ddff', fontStyle: 'bold',
        }).setOrigin(1, 0.5).setDepth(61);
        this._breakdownObjects.push(lbl, det, val);
      }

      y += ROW_H;
    }

    // Heap score multiplier row
    if (this._heapParams.scoreMult !== 1.0) {
      const mid = y + ROW_H / 2;
      const lbl = this.add.text(left, mid, 'SCORE MULT', {
        fontSize: '11px', fontFamily: 'monospace', color: '#dd88ff',
      }).setOrigin(0, 0.5).setDepth(61);
      const val = this.add.text(right, mid, `×${this._heapParams.scoreMult.toFixed(2)}`, {
        fontSize: '11px', fontFamily: 'monospace', color: '#dd88ff', fontStyle: 'bold',
      }).setOrigin(1, 0.5).setDepth(61);
      this._breakdownObjects.push(lbl, val);
      y += ROW_H;
    }

    // Divider
    const divG = this.add.graphics().setDepth(61);
    divG.lineStyle(1, 0xffdd44, 0.2);
    divG.lineBetween(PANEL_X - PANEL_W / 2 + 10, y + 2, PANEL_X + PANEL_W / 2 - 10, y + 2);
    this._breakdownObjects.push(divG);
    y += 8;

    // Total row
    const totalMid = y + ROW_H / 2;
    const totLbl = this.add.text(left, totalMid, 'TOTAL', {
      fontSize: '12px', fontFamily: 'monospace', color: '#ffdd44', fontStyle: 'bold',
    }).setOrigin(0, 0.5).setDepth(61);
    const totVal = this.add.text(right, totalMid, String(this.score), {
      fontSize: '12px', fontFamily: 'monospace', color: '#ffdd44', fontStyle: 'bold',
    }).setOrigin(1, 0.5).setDepth(61);
    this._breakdownObjects.push(totLbl, totVal);

    // Tap-outside-to-close transparent overlay (behind panel)
    const blocker = this.add.rectangle(PANEL_X, this.scale.height / 2, this.scale.width, this.scale.height, 0x000000, 0)
      .setDepth(59)
      .setInteractive();
    blocker.once('pointerup', () => this.closeScoreBreakdown());
    this._breakdownObjects.push(blocker);

    // Slide-in animation — start offset by +20 then tween back
    for (const o of this._breakdownObjects) {
      const go = o as Phaser.GameObjects.GameObject & { alpha: number; y: number };
      go.alpha = 0;
      go.y += 20;
    }
    this.tweens.add({
      targets:  this._breakdownObjects,
      alpha:    1,
      y:        '-=20',
      duration: 250,
      ease:     'Cubic.Out',
    });
  }

  private closeScoreBreakdown(): void {
    if (!this._breakdownOpen) return;
    this._breakdownOpen = false;
    this.tweens.add({
      targets:  this._breakdownObjects,
      alpha:    0,
      duration: 150,
      ease:     'Linear',
      onComplete: () => {
        this._breakdownObjects.forEach(o => o.destroy());
        this._breakdownObjects = [];
      },
    });
  }

  // ── Coins Panel ───────────────────────────────────────────────────────────────

  private createCoinsPanel(rows: BreakdownRow[], finalCoins: number, balance: number): number {
    const PANEL_X    = this.scale.width / 2;
    const PANEL_TOP  = this.scale.height * 0.37;
    const PANEL_W    = this.scale.width * 0.88;
    const ROW_H      = 26;
    const PAD_X      = 16;

    // Color map keyed by row type
    const ROW_COLORS: Record<string, { accent: number; accentHex: string; labelHex: string }> = {
      money_mult:    { accent: 0xffaa22, accentHex: '#ffaa22', labelHex: '#ffcc66' },
      heap_coin_mult: { accent: 0x44dd88, accentHex: '#44dd88', labelHex: '#88ddaa' },
      peak_hunter:   { accent: 0xcc44ff, accentHex: '#cc44ff', labelHex: '#dd88ff' },
      death_penalty: { accent: 0xff4444, accentHex: '#ff4444', labelHex: '#ff8877' },
    };

    // Collapse threshold
    const COLLAPSE_AT    = 4;
    const multRows       = rows.filter(r => r.type !== 'base');
    const shouldCollapse = multRows.length >= COLLAPSE_AT;

    // Measure panel height dynamically
    const visibleRowCount = (collapsed: boolean) =>
      1 + (collapsed ? Math.min(3, multRows.length) : multRows.length); // base + mult rows

    // Extra height for balance divider + row + bottom padding
    const BALANCE_EXTRA = ROW_H + 30;

    const panelHeight = (collapsed: boolean) => {
      const headerH = 52;
      const toggleH = shouldCollapse ? 24 : 0;
      return headerH + visibleRowCount(collapsed) * ROW_H + toggleH + BALANCE_EXTRA;
    };

    const coinColor = this.isFailure ? '#ff8866' : '#44ff88';

    // Panel background
    const bg = this.add.graphics();
    const drawBg = (collapsed: boolean) => {
      bg.clear();
      const h = panelHeight(collapsed);
      if (this.isFailure) {
        bg.fillStyle(0xff5050, 0.06);
        bg.lineStyle(1, 0xff5555, 0.2);
      } else {
        bg.fillStyle(0x00ff64, 0.08);
        bg.lineStyle(1, 0x44ff88, 0.2);
      }
      bg.fillRoundedRect(PANEL_X - PANEL_W / 2, PANEL_TOP, PANEL_W, h, 8);
      bg.strokeRoundedRect(PANEL_X - PANEL_W / 2, PANEL_TOP, PANEL_W, h, 8);
    };
    drawBg(shouldCollapse);

    // Header: "+N coins earned"
    const headerText = this.add.text(
      PANEL_X, PANEL_TOP + 14,
      `+${finalCoins} coins earned`,
      { fontSize: '22px', fontFamily: 'monospace', color: coinColor, fontStyle: 'bold' },
    ).setOrigin(0.5, 0);

    // Divider
    const divG = this.add.graphics();
    divG.lineStyle(1, this.isFailure ? 0xff5555 : 0x44ff88, 0.15);
    divG.lineBetween(PANEL_X - PANEL_W / 2 + 10, PANEL_TOP + 42, PANEL_X + PANEL_W / 2 - 10, PANEL_TOP + 42);

    // Row rendering helper
    const rowObjects: Phaser.GameObjects.GameObject[] = [];

    const renderRows = (collapsed: boolean) => {
      rowObjects.forEach(o => o.destroy());
      rowObjects.length = 0;

      let rowY = PANEL_TOP + 48;
      const left  = PANEL_X - PANEL_W / 2 + PAD_X;
      const right = PANEL_X + PANEL_W / 2 - PAD_X;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        if (row.type === 'base') {
          const mid = rowY + ROW_H / 2;
          const lbl = this.add.text(left, mid, 'Base (score \u00f7 100)', {
            fontSize: '11px', fontFamily: 'monospace', color: '#ffffff',
          }).setOrigin(0, 0.5).setAlpha(0.33);
          const val = this.add.text(right, mid, String(row.value), {
            fontSize: '11px', fontFamily: 'monospace', color: '#ffffff',
          }).setOrigin(1, 0.5).setAlpha(0.47);
          rowObjects.push(lbl, val);
          rowY += ROW_H;
          continue;
        }

        // Multiplier rows — skip if collapsed and past visible limit
        const multIndex = i - 1; // offset by base row
        if (collapsed && multIndex >= 3) break;

        const c = ROW_COLORS[row.type];
        const mid = rowY + ROW_H / 2;

        // Tinted row background
        const rowBg = this.add.graphics();
        rowBg.fillStyle(c.accent, 0.10);
        rowBg.fillRect(PANEL_X - PANEL_W / 2 + 1, rowY, PANEL_W - 2, ROW_H - 2);
        // Left accent bar
        rowBg.fillStyle(c.accent, 1);
        rowBg.fillRect(PANEL_X - PANEL_W / 2 + 1, rowY, 2, ROW_H - 2);
        rowObjects.push(rowBg);

        const label    = `\u00d7\u00a0${row.multiplier.toFixed(1)}\u2002${this.rowLabel(row.type)}`;
        const labelTxt = this.add.text(left + 8, mid, label, {
          fontSize: '11px', fontFamily: 'monospace', color: c.labelHex,
        }).setOrigin(0, 0.5);
        const valTxt = this.add.text(right, mid, String(row.runningTotal), {
          fontSize: '11px', fontFamily: 'monospace', color: c.accentHex, fontStyle: 'bold',
        }).setOrigin(1, 0.5);
        rowObjects.push(labelTxt, valTxt);
        rowY += ROW_H;
      }

      return rowY; // bottom of last row
    };

    let collapsed     = shouldCollapse;
    let lastRowBottom = renderRows(collapsed);

    // Collapse toggle
    let toggleText: Phaser.GameObjects.Text | null = null;
    if (shouldCollapse) {
      const toggleX = PANEL_X + PANEL_W / 2 - PAD_X;
      toggleText = this.add.text(
        toggleX, lastRowBottom + 4,
        collapsed ? '\u25bc show' : '\u25b2 hide',
        {
          fontSize:        '10px',
          fontFamily:      'monospace',
          color:           coinColor,
          backgroundColor: this.isFailure ? '#ff222211' : '#00ff4411',
          padding:         { x: 6, y: 2 },
        },
      ).setOrigin(1, 0).setInteractive({ useHandCursor: true });

      toggleText.on('pointerup', () => {
        collapsed     = !collapsed;
        lastRowBottom = renderRows(collapsed);
        drawBg(collapsed);
        toggleText!.setText(collapsed ? '\u25bc show' : '\u25b2 hide');
        toggleText!.setY(lastRowBottom + 4);
        repositionBalance();
      });
    }

    // Balance row \u2014 always visible at the bottom of the panel, below the toggle
    const toggleSlot = shouldCollapse ? 28 : 0;
    const balLeft    = PANEL_X - PANEL_W / 2 + PAD_X;
    const balRight   = PANEL_X + PANEL_W / 2 - PAD_X;
    const balDivG    = this.add.graphics();
    const balLbl     = this.add.text(balLeft, 0, 'NEW BALANCE', {
      fontSize: '11px', fontFamily: 'monospace', color: coinColor,
    }).setOrigin(0, 0.5).setAlpha(0.75);
    const balVal     = this.add.text(balRight, 0, `${balance} coins`, {
      fontSize: '12px', fontFamily: 'monospace', color: coinColor, fontStyle: 'bold',
    }).setOrigin(1, 0.5);

    const repositionBalance = () => {
      const divY   = lastRowBottom + toggleSlot + 10;
      const rowMid = divY + 8 + ROW_H / 2;
      balDivG.clear();
      balDivG.lineStyle(1, this.isFailure ? 0xff5555 : 0x44ff88, 0.12);
      balDivG.lineBetween(balLeft, divY, balRight, divY);
      balLbl.setY(rowMid);
      balVal.setY(rowMid);
    };
    repositionBalance();

    // Panel fade-in + slide-up after 800ms score count-up + 300ms delay
    const fadeTargets: Phaser.GameObjects.GameObject[] = [
      bg, headerText, divG, ...rowObjects, balDivG, balLbl, balVal,
    ];
    if (toggleText) fadeTargets.push(toggleText);
    fadeTargets.forEach(o => (o as unknown as Phaser.GameObjects.Components.Alpha).setAlpha(0));

    this.time.delayedCall(1100, () => {
      this.tweens.add({
        targets:  fadeTargets,
        alpha:    1,
        y:        '+=20',
        duration: 400,
        ease:     'Cubic.Out',
      });
    });

    return PANEL_TOP + panelHeight(collapsed) + 40; // +20 matches the slide-down intro tween
  }

  private rowLabel(type: 'money_mult' | 'heap_coin_mult' | 'peak_hunter' | 'death_penalty' | 'off_peak_bonus'): string {
    const labels: Record<string, string> = {
      money_mult:     'Coin Multiplier',
      heap_coin_mult: 'Heap Coin Bonus',
      peak_hunter:    'Peak Bonus \u2736',
      death_penalty:  'Death Penalty \ud83d\udc80',
      off_peak_bonus: 'Off-Peak Bonus',
    };
    return labels[type] ?? type;
  }

  // ── Leaderboard Panel ─────────────────────────────────────────────────────────

  private createLeaderboardPanel(topY: number): void {
    if (!this.heapId && !this._mockLeaderboard) return;

    const PANEL_TOP = topY;
    const PANEL_W   = this.scale.width * 0.88;
    const PANEL_X   = this.scale.width / 2;
    const ROW_H     = 20;

    // Mock data path — renders immediately, no API call.
    if (this._mockLeaderboard) {
      this.time.delayedCall(1100, () => {
        this.renderLeaderboardEntries(this._mockLeaderboard!, PANEL_TOP, PANEL_W, ROW_H);
      });
      return;
    }

    // Loading placeholder
    const loading = this.add.text(PANEL_X, PANEL_TOP + 8, 'Loading leaderboard...', {
      fontSize:   '11px',
      fontFamily: 'monospace',
      color:      '#557799',
    }).setOrigin(0.5, 0).setAlpha(0);

    // Fade placeholder in after score count-up (800ms) + 300ms
    this.time.delayedCall(1100, () => {
      this.tweens.add({ targets: loading, alpha: 1, duration: 300, ease: 'Linear' });
    });

    // Kick off server call
    const playerId   = getGpgsPlayerId() ?? getPlayerGuid();
    const playerName = getPlayerName();
    const call       = this.isNewHighScore
      ? ScoreClient.submitScore({
          heapId: this.heapId, playerId, playerName,
          inputs: {
            baseHeightPx: this._baseHeightPx,
            kills: {
              percher: this._kills.percher ?? 0,
              ghost:   this._kills.ghost   ?? 0,
            },
            elapsedMs: Math.floor(this._elapsedMs),
            isFailure: this.isFailure,
          },
          limit: LEADERBOARD_TOP_N,
        })
      : ScoreClient.getContext({ heapId: this.heapId, playerId, limit: LEADERBOARD_TOP_N });

    call.then((ctx) => {
      loading.destroy();
      // Fire event for ALL submissions, not just high scores
      const accepted = ctx !== null;
      getLogger().event({
        type: 'score:submitted',
        heapId: this.heapId,
        score: this.score,
        accepted,
        rejectionReason: accepted ? undefined : 'offline or rejected',
      });
      if (!ctx) return; // offline — silently show nothing

      if (this.isNewHighScore) {
        PlayGamesClient.submitScore(LEADERBOARD_HIGH_SCORE_ID, this.score);
      }

      // Save snapshot to cloud after each run.
      const cloudData = JSON.stringify(getRawSaveForCloudSync());
      PlayGamesClient.saveSnapshot(cloudData);

      this.renderLeaderboardEntries(ctx, PANEL_TOP, PANEL_W, ROW_H);
    });
  }

  private renderLeaderboardEntries(
    ctx:      LeaderboardContext,
    panelTop: number,
    panelW:   number,
    rowH:     number,
  ): void {
    const PAD_X  = 14;
    const left   = this.scale.width / 2 - panelW / 2 + PAD_X;
    const right  = this.scale.width / 2 + panelW / 2 - PAD_X;

    // "HIGH SCORES" label above the panel — styled like SCORE label but smaller, left-aligned
    this.add.text(left, panelTop +4, 'HIGH SCORES', {
      fontSize: '14px', fontFamily: 'monospace', color: '#ffdd44', letterSpacing: 2,
    }).setOrigin(0, 1);

    // Panel background
    const totalRows = ctx.top.length + (ctx.player && !this.playerInTop(ctx) ? 2 : 0); // +1 for gap, +1 for player
    const panelH    = totalRows * rowH + 8;
    const bg = this.add.graphics();
    bg.fillStyle(0x002244, 0.5);
    bg.lineStyle(1, 0x336699, 0.3);
    bg.fillRoundedRect(this.scale.width / 2 - panelW / 2, panelTop, panelW, panelH, 6);
    bg.strokeRoundedRect(this.scale.width / 2 - panelW / 2, panelTop, panelW, panelH, 6);

    let y = panelTop + 4;

    // Top N rows
    for (let i = 0; i < ctx.top.length; i++) {
      const entry    = ctx.top[i];
      const isPlayer = entry.playerId === (ctx.player?.playerId ?? '');
      const nameCol  = isPlayer && this.isNewHighScore ? '#ffdd44' : '#aaccee';
      const rankCol  = isPlayer && this.isNewHighScore ? '#ffdd44' : '#668899';
      const mid      = y + rowH / 2;

      // Alternating row stripe
      const stripe = this.add.graphics();
      stripe.fillStyle(i % 2 === 0 ? 0x0d3155 : 0x071d33, 0.5);
      stripe.fillRect(this.scale.width / 2 - panelW / 2, y, panelW, rowH);

      this.add.text(left, mid, `#${entry.rank}`, {
        fontSize: '11px', fontFamily: 'monospace', color: rankCol,
      }).setOrigin(0, 0.5);
      this.add.text(left + 36, mid, entry.name, {
        fontSize: '11px', fontFamily: 'monospace', color: nameCol,
      }).setOrigin(0, 0.5);
      this.add.text(right, mid, String(entry.score), {
        fontSize: '11px', fontFamily: 'monospace', color: nameCol,
      }).setOrigin(1, 0.5);
      y += rowH;
    }

    // Gap + player row if player is not already in top N
    if (ctx.player && !this.playerInTop(ctx)) {
      this.add.text(this.scale.width / 2, y + rowH / 2, '·  ·  ·', {
        fontSize: '10px', fontFamily: 'monospace', color: '#335566',
      }).setOrigin(0.5, 0.5);
      y += rowH;

      const p      = ctx.player;
      const pColor = this.isNewHighScore ? '#ffdd44' : '#aaccee';
      const mid    = y + rowH / 2;
      this.add.text(left, mid, `#${p.rank}`, {
        fontSize: '11px', fontFamily: 'monospace', color: pColor,
      }).setOrigin(0, 0.5);
      this.add.text(left + 36, mid, p.name, {
        fontSize: '11px', fontFamily: 'monospace', color: pColor,
      }).setOrigin(0, 0.5);
      this.add.text(right, mid, String(p.score), {
        fontSize: '11px', fontFamily: 'monospace', color: pColor,
      }).setOrigin(1, 0.5);
    }
  }

  private playerInTop(ctx: LeaderboardContext): boolean {
    if (!ctx.player) return false;
    return ctx.top.some(e => e.playerId === ctx.player!.playerId);
  }

  // ── Checkpoint Button ─────────────────────────────────────────────────────────

  private createCheckpointButton(): void {
    if (!this.checkpointAvailable) return;

    const btn = this.add.text(this.scale.width / 2, this.scale.height * 0.87, 'RESPAWN AT CHECKPOINT', {
      fontSize:        '14px',
      fontFamily:      'monospace',
      color:           '#ffffff',
      backgroundColor: '#1a6b3acc',
      padding:         { x: 20, y: 10 },
      fontStyle:       'bold',
    }).setOrigin(0.5);

    btn.on('pointerover', () => { btn.setColor('#aaffcc'); btn.setBackgroundColor('#22994ecc'); });
    btn.on('pointerout',  () => { btn.setColor('#ffffff'); btn.setBackgroundColor('#1a6b3acc'); });

    this.time.delayedCall(1500, () => {
      btn.setInteractive({ useHandCursor: true });
      btn.once('pointerup', () => {
        this.scene.stop('ScoreScene');
        this.scene.stop('GameScene');
        this.scene.start('GameScene', { useCheckpoint: true });
      });
    });
  }

  // ── Menu Prompt ───────────────────────────────────────────────────────────────

  private createMenuPrompt(): void {
    const im    = InputManager.getInstance();
    const label = im.isMobile ? 'TAP ANYWHERE FOR MENU' : 'PRESS ANY KEY FOR MENU';
    const promptY = this.scale.height * 0.95;

    this.add.text(this.scale.width / 2, promptY, label, {
      fontSize:      '16px',
      fontFamily:    'monospace',
      color:         '#ffffff',
      letterSpacing: 2,
    }).setOrigin(0.5).setAlpha(0.4);

    const goMenu = () => {
      this.scene.stop(this._heapParams.isInfinite ? 'InfiniteGameScene' : 'GameScene');
      this.scene.start('MenuScene');
    };

    this.time.delayedCall(1500, () => {
      this.input.keyboard!.once('keydown', goMenu);
      if (im.isMobile) {
        // Full-screen zone at depth -1 so existing buttons (depth 0) stay on top via topOnly.
        this.add.rectangle(
          this.scale.width / 2, this.scale.height / 2,
          this.scale.width, this.scale.height,
          0x000000, 0,
        ).setDepth(-1).setInteractive().once('pointerup', goMenu);
      }
    });
  }
}

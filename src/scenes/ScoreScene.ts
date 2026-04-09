import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, SCORE_TO_COINS_DIVISOR } from '../constants';
import { addBalance, getBalance, getPlayerConfig } from '../systems/SaveData';
import { buildCoinBreakdown, BreakdownRow } from '../systems/coinBreakdown';

const CX = GAME_WIDTH / 2;

export class ScoreScene extends Phaser.Scene {
  private score:               number  = 0;
  private isPeak:              boolean = false;
  private checkpointAvailable: boolean = false;
  private isFailure:           boolean = false;

  constructor() {
    super({ key: 'ScoreScene' });
  }

  init(data: {
    score:                number;
    isPeak?:              boolean;
    checkpointAvailable?: boolean;
    isFailure?:           boolean;
  }): void {
    this.score               = data.score               ?? 0;
    this.isPeak              = data.isPeak              ?? false;
    this.checkpointAvailable = data.checkpointAvailable ?? false;
    this.isFailure           = data.isFailure           ?? false;
  }

  create(): void {
    const cfg    = getPlayerConfig();
    const result = buildCoinBreakdown({
      score:           this.score,
      scoreToCoins:    SCORE_TO_COINS_DIVISOR,
      moneyMultiplier: cfg.moneyMultiplier,
      isPeak:          this.isPeak,
      peakMultiplier:  cfg.peakMultiplier,
      isFailure:       this.isFailure,
    });

    addBalance(result.finalCoins);
    const balance = getBalance();

    this.createBackground();
    this.createStarField();
    if (!this.isFailure) this.createConfetti();
    if (this.isFailure)  this.createFailureGlow();

    this.createTitle();
    this.createScoreDisplay();
    this.createCoinsPanel(result.rows, result.finalCoins);
    this.createBalance(balance);
    this.createCheckpointButton();
    this.createMenuPrompt();
  }

  // ── Background ────────────────────────────────────────────────────────────────

  private createBackground(): void {
    const g = this.add.graphics();
    const bands: [number, number, number][] = [
      [0,              GAME_HEIGHT * 0.4, 0x0a0818],
      [GAME_HEIGHT * 0.4, GAME_HEIGHT * 0.3, 0x1a1040],
      [GAME_HEIGHT * 0.7, GAME_HEIGHT * 0.3, 0x2a1060],
    ];
    for (const [y, h, color] of bands) {
      g.fillStyle(color, 1);
      g.fillRect(0, y, GAME_WIDTH, h);
    }
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
      g.fillCircle(xf * GAME_WIDTH, yf * GAME_HEIGHT, r);
    }
  }

  private createFailureGlow(): void {
    const g = this.add.graphics();
    // Red radial ellipse at top — simulate rgba(255,60,60,0.12)
    for (let i = 5; i >= 1; i--) {
      g.fillStyle(0xff3c3c, 0.024 * i);
      g.fillEllipse(CX, 0, GAME_WIDTH * 0.9, 120 * i / 5);
    }
  }

  private createConfetti(): void {
    const colors = [0xffdd44, 0x44ff88, 0xff88cc, 0x44ddff, 0xcc44ff, 0xff8844];
    for (let i = 0; i < 20; i++) {
      const x     = CX + Phaser.Math.Between(-60, 60);
      const y     = GAME_HEIGHT * 0.22;
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
    const text  = this.isFailure ? 'HEAP FAILURE' : 'HEAP SUCCESSFUL';
    const color = this.isFailure ? '#ff5555' : '#44ffaa';
    this.add.text(CX, GAME_HEIGHT * 0.18, text, {
      fontSize:        '11px',
      fontFamily:      'monospace',
      color,
      letterSpacing:   4,
    }).setOrigin(0.5).setShadow(0, 0, color, 8, true, true);
  }

  private createScoreDisplay(): void {
    const scoreText = this.add.text(CX, GAME_HEIGHT * 0.28, '0', {
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
    glow.fillEllipse(CX, GAME_HEIGHT * 0.28, 160, 60);
    this.children.moveBelow(glow as Phaser.GameObjects.GameObject, scoreText as Phaser.GameObjects.GameObject);

    this.add.text(CX, GAME_HEIGHT * 0.28 + 34, 'SCORE', {
      fontSize:      '9px',
      fontFamily:    'monospace',
      color:         '#ffdd44',
      letterSpacing: 2,
    }).setOrigin(0.5).setAlpha(0.4);

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
  }

  // ── Coins Panel ───────────────────────────────────────────────────────────────

  private createCoinsPanel(_rows: BreakdownRow[], _finalCoins: number): void {
    // Implemented in Task 4
  }

  // ── Balance ───────────────────────────────────────────────────────────────────

  private createBalance(_balance: number): void {
    // Implemented in Task 5
  }

  // ── Checkpoint Button ─────────────────────────────────────────────────────────

  private createCheckpointButton(): void {
    if (!this.checkpointAvailable) return;
    // Full implementation in Task 5
  }

  // ── Menu Prompt ───────────────────────────────────────────────────────────────

  private createMenuPrompt(): void {
    // Implemented in Task 5
  }
}

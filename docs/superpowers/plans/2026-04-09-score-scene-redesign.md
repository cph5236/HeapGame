# Score Scene Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain-text ScoreScene overlay with a styled "Summit Glow" result screen showing outcome title, animated score, and a per-upgrade color-coded coin breakdown with collapse/expand for 4+ multipliers.

**Architecture:** Extract coin breakdown logic into a pure, testable helper (`src/systems/coinBreakdown.ts`). ScoreScene imports this helper and uses its output to drive all rendering. GameScene gets a one-line change to pass `isFailure: true` on enemy death.

**Tech Stack:** Phaser 3.90, TypeScript 5, Vitest (node environment). Phaser scenes cannot be unit-tested directly — all logic that can be isolated goes in `coinBreakdown.ts`. Visual code lives in ScoreScene and is verified by browser smoke test.

---

### Task 1: Extract coin breakdown helper (TDD)

**Files:**
- Create: `src/systems/coinBreakdown.ts`
- Create: `src/systems/__tests__/coinBreakdown.test.ts`

This pure function is the core logic behind the breakdown panel. It takes the run data and player config multipliers and returns the ordered rows to render, plus the final coin total to pass to `addBalance`.

- [ ] **Step 1: Write the failing tests**

Create `src/systems/__tests__/coinBreakdown.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildCoinBreakdown } from '../coinBreakdown';

describe('buildCoinBreakdown', () => {
  it('returns base row only when no multipliers active and not failure', () => {
    const result = buildCoinBreakdown({
      score: 500,
      scoreToCoins: 100,
      moneyMultiplier: 1,
      isPeak: false,
      peakMultiplier: 1.25,
      isFailure: false,
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({ type: 'base', value: 5 });
    expect(result.finalCoins).toBe(5);
  });

  it('adds money_mult row when moneyMultiplier > 1', () => {
    const result = buildCoinBreakdown({
      score: 500,
      scoreToCoins: 100,
      moneyMultiplier: 1.5,
      isPeak: false,
      peakMultiplier: 1.25,
      isFailure: false,
    });
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]).toEqual({ type: 'money_mult', multiplier: 1.5, runningTotal: 7 });
    expect(result.finalCoins).toBe(7);
  });

  it('adds peak_hunter row only when isPeak is true', () => {
    const result = buildCoinBreakdown({
      score: 500,
      scoreToCoins: 100,
      moneyMultiplier: 1,
      isPeak: true,
      peakMultiplier: 1.8,
      isFailure: false,
    });
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]).toEqual({ type: 'peak_hunter', multiplier: 1.8, runningTotal: 9 });
    expect(result.finalCoins).toBe(9);
  });

  it('does NOT add peak_hunter row when isPeak is false', () => {
    const result = buildCoinBreakdown({
      score: 500,
      scoreToCoins: 100,
      moneyMultiplier: 1,
      isPeak: false,
      peakMultiplier: 1.8,
      isFailure: false,
    });
    expect(result.rows).toHaveLength(1);
    expect(result.finalCoins).toBe(5);
  });

  it('adds death_penalty row last when isFailure is true', () => {
    const result = buildCoinBreakdown({
      score: 500,
      scoreToCoins: 100,
      moneyMultiplier: 1.5,
      isPeak: false,
      peakMultiplier: 1.25,
      isFailure: true,
    });
    expect(result.rows).toHaveLength(3);
    expect(result.rows[2]).toEqual({ type: 'death_penalty', multiplier: 0.5, runningTotal: 3 });
    expect(result.finalCoins).toBe(3);
  });

  it('applies multipliers in order: base → money_mult → peak_hunter → death_penalty', () => {
    const result = buildCoinBreakdown({
      score: 1000,
      scoreToCoins: 100,
      moneyMultiplier: 1.5,
      isPeak: true,
      peakMultiplier: 2.0,
      isFailure: true,
    });
    // base: floor(1000/100) = 10
    // money_mult: floor(10 * 1.5) = 15
    // peak_hunter: floor(15 * 2.0) = 30
    // death_penalty: floor(30 * 0.5) = 15
    expect(result.rows[0]).toEqual({ type: 'base', value: 10 });
    expect(result.rows[1]).toEqual({ type: 'money_mult', multiplier: 1.5, runningTotal: 15 });
    expect(result.rows[2]).toEqual({ type: 'peak_hunter', multiplier: 2.0, runningTotal: 30 });
    expect(result.rows[3]).toEqual({ type: 'death_penalty', multiplier: 0.5, runningTotal: 15 });
    expect(result.finalCoins).toBe(15);
  });

  it('floors all intermediate values', () => {
    const result = buildCoinBreakdown({
      score: 330,
      scoreToCoins: 100,
      moneyMultiplier: 1.5,
      isPeak: false,
      peakMultiplier: 1.25,
      isFailure: false,
    });
    // base: floor(330/100) = 3
    // money_mult: floor(3 * 1.5) = 4
    expect(result.rows[1]).toEqual({ type: 'money_mult', multiplier: 1.5, runningTotal: 4 });
    expect(result.finalCoins).toBe(4);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- coinBreakdown
```

Expected: FAIL with "Cannot find module '../coinBreakdown'"

- [ ] **Step 3: Implement `coinBreakdown.ts`**

Create `src/systems/coinBreakdown.ts`:

```typescript
export type BaseRow = {
  type: 'base';
  value: number;
};

export type MultiplierRow = {
  type: 'money_mult' | 'peak_hunter' | 'death_penalty';
  multiplier: number;
  runningTotal: number;
};

export type BreakdownRow = BaseRow | MultiplierRow;

export interface BreakdownInput {
  score:           number;
  scoreToCoins:    number; // SCORE_TO_COINS_DIVISOR
  moneyMultiplier: number;
  isPeak:          boolean;
  peakMultiplier:  number;
  isFailure:       boolean;
}

export interface BreakdownResult {
  rows:       BreakdownRow[];
  finalCoins: number;
}

export function buildCoinBreakdown(input: BreakdownInput): BreakdownResult {
  const { score, scoreToCoins, moneyMultiplier, isPeak, peakMultiplier, isFailure } = input;
  const rows: BreakdownRow[] = [];

  const base = Math.floor(score / scoreToCoins);
  rows.push({ type: 'base', value: base });

  let running = base;

  if (moneyMultiplier > 1) {
    running = Math.floor(running * moneyMultiplier);
    rows.push({ type: 'money_mult', multiplier: moneyMultiplier, runningTotal: running });
  }

  if (isPeak && peakMultiplier > 1) {
    running = Math.floor(running * peakMultiplier);
    rows.push({ type: 'peak_hunter', multiplier: peakMultiplier, runningTotal: running });
  }

  if (isFailure) {
    running = Math.floor(running * 0.5);
    rows.push({ type: 'death_penalty', multiplier: 0.5, runningTotal: running });
  }

  return { rows, finalCoins: running };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- coinBreakdown
```

Expected: all 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/systems/coinBreakdown.ts src/systems/__tests__/coinBreakdown.test.ts
git commit -m "feat: add coinBreakdown pure helper with full test coverage"
```

---

### Task 2: Add `isFailure` flag to GameScene

**Files:**
- Modify: `src/scenes/GameScene.ts:459`

One line change — add `isFailure: true` to the `handleEnemyDamage` launch payload so ScoreScene knows it's a failure run.

- [ ] **Step 1: Edit `handleEnemyDamage` in `src/scenes/GameScene.ts`**

Find line 459 (inside `handleEnemyDamage`):

```typescript
// BEFORE:
this.scene.launch('ScoreScene', { score, isPeak: false, checkpointAvailable });

// AFTER:
this.scene.launch('ScoreScene', { score, isPeak: false, checkpointAvailable, isFailure: true });
```

- [ ] **Step 2: Build to confirm no TypeScript errors**

```bash
npm run build 2>&1 | tail -20
```

Expected: build completes with no errors (ScoreScene.init currently accepts `isFailure?` as optional so no type mismatch yet).

- [ ] **Step 3: Commit**

```bash
git add src/scenes/GameScene.ts
git commit -m "feat: pass isFailure:true to ScoreScene on enemy death"
```

---

### Task 3: Rewrite ScoreScene — background, stars, title, score

**Files:**
- Modify: `src/scenes/ScoreScene.ts` (full rewrite)

This task replaces the entire `create()` method with the new implementation, starting with the background layer, star field, and the title + score text. The coins panel, animations, and buttons come in later tasks — end of this task the scene shows static title + static score number on a gradient sky.

- [ ] **Step 1: Replace ScoreScene with the new skeleton**

Replace the entire contents of `src/scenes/ScoreScene.ts`:

```typescript
import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, SCORE_TO_COINS_DIVISOR } from '../constants';
import { addBalance, getBalance, getPlayerConfig } from '../systems/SaveData';
import { InputManager } from '../systems/InputManager';
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
      alpha:         0.4,
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
    // Implemented in Task 5
  }

  // ── Menu Prompt ───────────────────────────────────────────────────────────────

  private createMenuPrompt(): void {
    // Implemented in Task 5
  }
}
```

- [ ] **Step 2: Build to confirm no TypeScript errors**

```bash
npm run build 2>&1 | tail -20
```

Expected: clean build.

- [ ] **Step 3: Smoke test in browser**

```bash
npm run dev
```

Die to an enemy in-game → verify:
- Dark gradient sky background appears
- Stars visible
- Title says `HEAP FAILURE` in red (death) or `HEAP SUCCESSFUL` in green (success)
- Score counts up from 0 to actual value over ~800ms
- Confetti bursts on success, red glow at top on failure
- Coins panel placeholder (empty) — that's fine

- [ ] **Step 4: Commit**

```bash
git add src/scenes/ScoreScene.ts
git commit -m "feat: ScoreScene — background, stars, title, score count-up"
```

---

### Task 4: Implement the coins panel

**Files:**
- Modify: `src/scenes/ScoreScene.ts` — fill in `createCoinsPanel()`

The panel is a rounded-corner card drawn with `Graphics`, with text objects layered on top. The collapse/expand toggle is built here too.

- [ ] **Step 1: Replace `createCoinsPanel()` stub** in `src/scenes/ScoreScene.ts`

```typescript
private createCoinsPanel(rows: BreakdownRow[], finalCoins: number): void {
  const PANEL_X    = CX;
  const PANEL_TOP  = GAME_HEIGHT * 0.42;
  const PANEL_W    = GAME_WIDTH * 0.88;
  const ROW_H      = 26;
  const PAD_X      = 14;
  const INNER_W    = PANEL_W - PAD_X * 2;

  // Color map keyed by row type
  const ROW_COLORS: Record<string, { accent: number; accentHex: string; labelHex: string }> = {
    money_mult:    { accent: 0xffaa22, accentHex: '#ffaa22', labelHex: '#ffcc66' },
    peak_hunter:   { accent: 0xcc44ff, accentHex: '#cc44ff', labelHex: '#dd88ff' },
    death_penalty: { accent: 0xff4444, accentHex: '#ff4444', labelHex: '#ff8877' },
  };

  // Collapse threshold
  const COLLAPSE_AT  = 4;
  const multRows     = rows.filter(r => r.type !== 'base');
  const shouldCollapse = multRows.length >= COLLAPSE_AT;

  // Measure panel height dynamically
  const visibleRowCount = (collapsed: boolean) =>
    1 + (collapsed ? Math.min(3, multRows.length) : multRows.length); // base + mult rows

  const panelHeight = (collapsed: boolean) => {
    const headerH = 52; // coins total + divider
    const toggleH = shouldCollapse ? 24 : 0;
    return headerH + visibleRowCount(collapsed) * ROW_H + toggleH + 20;
  };

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
    bg.strokeRoundedRect(PANEL_X - PANEL_W / 2, PANEL_TOP, PANEL_W, h, 8);
    bg.fillRoundedRect(PANEL_X - PANEL_W / 2, PANEL_TOP, PANEL_W, h, 8);
  };
  drawBg(shouldCollapse);

  // Header: "+N coins earned"
  const coinColor  = this.isFailure ? '#ff8866' : '#44ff88';
  const headerText = this.add.text(
    PANEL_X, PANEL_TOP + 14,
    `+${finalCoins}`,
    { fontSize: '22px', fontFamily: 'monospace', color: coinColor, fontStyle: 'bold' },
  ).setOrigin(0.5, 0);
  this.add.text(
    PANEL_X + headerText.width / 2 + 6, PANEL_TOP + 18,
    'coins earned',
    { fontSize: '11px', fontFamily: 'monospace', color: coinColor, alpha: 0.5 },
  ).setOrigin(0, 0);

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
        const lbl = this.add.text(left, rowY, 'Base (score ÷ 100)', {
          fontSize: '11px', fontFamily: 'monospace', color: '#ffffff', alpha: 0.33,
        });
        const val = this.add.text(right, rowY, String(row.value), {
          fontSize: '11px', fontFamily: 'monospace', color: '#ffffff', alpha: 0.47,
        }).setOrigin(1, 0);
        rowObjects.push(lbl, val);
        rowY += ROW_H;
        continue;
      }

      // Multiplier rows — skip if collapsed and past visible limit
      const multIndex = i - 1; // offset by base row
      if (collapsed && multIndex >= 3) break;

      const c = ROW_COLORS[row.type];

      // Tinted row background
      const rowBg = this.add.graphics();
      rowBg.fillStyle(c.accent, 0.10);
      rowBg.fillRect(PANEL_X - PANEL_W / 2 + 1, rowY - 2, PANEL_W - 2, ROW_H - 2);
      // Left accent bar
      rowBg.fillStyle(c.accent, 1);
      rowBg.fillRect(PANEL_X - PANEL_W / 2 + 1, rowY - 2, 2, ROW_H - 2);
      rowObjects.push(rowBg);

      const label    = `\u00d7\u00a0${row.multiplier.toFixed(1)}\u2002${this.rowLabel(row.type)}`;
      const labelTxt = this.add.text(left + 8, rowY, label, {
        fontSize: '11px', fontFamily: 'monospace', color: c.labelHex,
      });
      const valTxt = this.add.text(right, rowY, String(row.runningTotal), {
        fontSize: '11px', fontFamily: 'monospace', color: c.accentHex, fontStyle: 'bold',
      }).setOrigin(1, 0);
      rowObjects.push(labelTxt, valTxt);
      rowY += ROW_H;
    }

    return rowY; // bottom of last row
  };

  let collapsed    = shouldCollapse;
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
        alpha:           0.67,
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
    });
  }

  // Panel fade-in + slide-up after 800ms score count-up + 300ms delay
  const fadeTargets: Phaser.GameObjects.GameObject[] = [bg, headerText, divG, ...rowObjects];
  if (toggleText) fadeTargets.push(toggleText);
  fadeTargets.forEach(o => (o as Phaser.GameObjects.Components.Alpha).setAlpha(0));

  this.time.delayedCall(1100, () => {
    this.tweens.add({
      targets:  fadeTargets,
      alpha:    1,
      y:        '-=20',
      duration: 400,
      ease:     'Cubic.Out',
    });
  });
}

private rowLabel(type: string): string {
  const labels: Record<string, string> = {
    money_mult:    'Coin Multiplier',
    peak_hunter:   'Peak Bonus \u2736',
    death_penalty: 'Death Penalty \ud83d\udc80',
  };
  return labels[type] ?? type;
}
```

- [ ] **Step 2: Build to confirm no TypeScript errors**

```bash
npm run build 2>&1 | tail -20
```

Expected: clean build.

- [ ] **Step 3: Smoke test in browser — verify coins panel**

```bash
npm run dev
```

Verify:
- Panel appears ~1.1s after scene starts, fades in and slides up 20px
- Base row visible (white, muted)
- Multiplier rows each have left accent bar + tinted background + their color
- On failure: red-tinted panel border, Death Penalty row in red at bottom
- On success with Peak: purple Peak Bonus row

- [ ] **Step 4: Commit**

```bash
git add src/scenes/ScoreScene.ts
git commit -m "feat: ScoreScene coins panel with colored breakdown rows and collapse"
```

---

### Task 5: Balance, checkpoint button, menu prompt

**Files:**
- Modify: `src/scenes/ScoreScene.ts` — fill in the three remaining stub methods

These are the bottom elements of the screen. Balance and menu prompt are static text; the checkpoint button is interactive.

- [ ] **Step 1: Implement `createBalance()`, `createCheckpointButton()`, `createMenuPrompt()`**

Find and replace the three stub methods in `src/scenes/ScoreScene.ts`:

```typescript
private createBalance(balance: number): void {
  this.add.text(CX, GAME_HEIGHT * 0.73, `Balance: ${balance} coins`, {
    fontSize:   '10px',
    fontFamily: 'monospace',
    color:      '#aaddff',
    alpha:      0.33,
  }).setOrigin(0.5);
}

private createCheckpointButton(): void {
  if (!this.checkpointAvailable) return;

  const btn = this.add.text(CX, GAME_HEIGHT * 0.79, 'Respawn at Checkpoint', {
    fontSize:        '12px',
    fontFamily:      'monospace',
    color:           '#88aaff',
    backgroundColor: '#112266cc',
    padding:         { x: 16, y: 8 },
  }).setOrigin(0.5).setInteractive({ useHandCursor: true });

  btn.on('pointerover', () => btn.setColor('#ffffff'));
  btn.on('pointerout',  () => btn.setColor('#88aaff'));
  btn.once('pointerup', () => {
    this.scene.stop('ScoreScene');
    this.scene.stop('GameScene');
    this.scene.start('GameScene', { useCheckpoint: true });
  });
}

private createMenuPrompt(): void {
  const im    = InputManager.getInstance();
  const label = im.isMobile ? 'TAP ANYWHERE FOR MENU' : 'PRESS ANY KEY FOR MENU';
  const promptY = this.checkpointAvailable ? GAME_HEIGHT * 0.88 : GAME_HEIGHT * 0.82;

  const promptText = this.add.text(CX, promptY, label, {
    fontSize:      '10px',
    fontFamily:    'monospace',
    color:         '#ffffff',
    alpha:         0.16,
    letterSpacing: 2,
  }).setOrigin(0.5);

  const goMenu = () => {
    this.scene.stop('GameScene');
    this.scene.start('MenuScene');
  };

  this.time.delayedCall(300, () => {
    this.input.keyboard!.once('keydown', goMenu);
    if (im.isMobile) {
      promptText.setInteractive({ useHandCursor: true });
      promptText.once('pointerup', goMenu);
    }
  });
}
```

- [ ] **Step 2: Build to confirm no TypeScript errors**

```bash
npm run build 2>&1 | tail -20
```

Expected: clean build.

- [ ] **Step 3: Smoke test — full screen**

```bash
npm run dev
```

Verify the complete screen:
- Balance shows correct coin count below panel
- "PRESS ANY KEY FOR MENU" / "TAP ANYWHERE FOR MENU" at bottom
- Pressing any key returns to MenuScene
- If checkpoint available: button renders, clicking it respawns from checkpoint

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all existing tests still pass (coinBreakdown tests + all prior tests).

- [ ] **Step 5: Commit**

```bash
git add src/scenes/ScoreScene.ts
git commit -m "feat: ScoreScene balance, checkpoint button, menu prompt — scene complete"
```

---

## Self-Review

Checking spec coverage:

| Spec requirement | Task |
|---|---|
| `isFailure` flag in data contract | Task 2 |
| GameScene `handleEnemyDamage` change | Task 2 |
| Gradient background + star field | Task 3 |
| Confetti on success | Task 3 |
| Failure glow | Task 3 |
| `HEAP SUCCESSFUL` / `HEAP FAILURE` title + color | Task 3 |
| Score count-up 800ms | Task 3 |
| `SCORE` micro-label | Task 3 |
| Coins panel — outcome-tinted border | Task 4 |
| Base row | Task 4 |
| `money_mult` row + color | Task 4 |
| `peak_hunter` row + color | Task 4 |
| `death_penalty` row + color, always last | Task 4 |
| Running total per row | Task 4 |
| Collapse at 4+ rows, default collapsed | Task 4 |
| ▼/▲ toggle | Task 4 |
| Panel fade-in + slide-up after score | Task 4 |
| `addBalance` uses final (penalised) total | Task 1 (`finalCoins`) + Task 3 (`create()`) |
| Balance text | Task 5 |
| Respawn at Checkpoint button (conditional) | Task 5 |
| Tap/press anywhere for menu | Task 5 |

All spec requirements covered. `coinBreakdown.ts` is fully unit tested. Visual elements verified by browser smoke test.

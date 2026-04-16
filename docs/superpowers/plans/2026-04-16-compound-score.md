# Compound Score System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace height-only score with a compound score (height + kill bonuses + pace bonus), add ft HUD display, and add a tappable score breakdown panel on the score screen.

**Architecture:** A new `buildRunScore` module owns the compound score formula. `GameScene` tracks `RunStats` (kills per enemy type + elapsed time) and passes it alongside `finalScore` to `ScoreScene`. `ScoreScene` uses `finalScore` for coins and leaderboard, and renders a tappable breakdown panel from the `RunStats` fields.

**Tech Stack:** TypeScript, Phaser 3, Vitest

**Spec:** `docs/superpowers/specs/2026-04-16-compound-score-design.md`

---

## File Map

| File | Action | What changes |
|---|---|---|
| `src/constants.ts` | Modify | Add `PACE_BONUS_CONST`, `SCORE_DISPLAY_DIVISOR` |
| `src/data/enemyDefs.ts` | Modify | Add `scoreValue` and `displayName` to `EnemyDef` + both defs |
| `src/systems/buildRunScore.ts` | Create | Compound score formula + breakdown row types |
| `src/systems/__tests__/buildRunScore.test.ts` | Create | Unit tests for score formula |
| `src/scenes/GameScene.ts` | Modify | Track kills/timer, compute finalScore, update HUD to ft, pass RunStats to ScoreScene |
| `src/scenes/ScoreScene.ts` | Modify | Accept RunStats in init, show finalScore, tappable breakdown panel |

---

## Task 1: Add constants

**Files:**
- Modify: `src/constants.ts`

- [ ] **Step 1: Add the two new constants at the end of `src/constants.ts`**

  Open `src/constants.ts` and add after the last export:

  ```ts
  export const PACE_BONUS_CONST    = 10;  // multiplier on px/s pace component
  export const SCORE_DISPLAY_DIVISOR = 10; // px ÷ 10 = ft for HUD display
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  Run: `npx tsc --noEmit`
  Expected: no errors

- [ ] **Step 3: Commit**

  ```bash
  git add src/constants.ts
  git commit -m "feat: add PACE_BONUS_CONST and SCORE_DISPLAY_DIVISOR constants"
  ```

---

## Task 2: Add scoreValue and displayName to enemy defs

**Files:**
- Modify: `src/data/enemyDefs.ts`

- [ ] **Step 1: Add fields to `EnemyDef` interface**

  In `src/data/enemyDefs.ts`, update the `EnemyDef` interface to add two new fields after `spawnRampEndY`:

  ```ts
  export interface EnemyDef {
    kind: EnemyKind;
    textureKey: string;
    width: number;
    height: number;
    speed: number;
    spawnOnHeapSurface: boolean;
    spawnOnHeapWall: boolean;
    spawnStartY: number;
    spawnEndY: number;
    spawnChanceMin: number;
    spawnChanceMax: number;
    spawnRampEndY: number;
    displayName: string;  // human-readable name shown in score breakdown
    scoreValue: number;   // score points awarded per kill
  }
  ```

- [ ] **Step 2: Add values to `percher` and `ghost` defs**

  In the `ENEMY_DEFS` record, add `displayName` and `scoreValue` to each def:

  `percher`:
  ```ts
  displayName: 'RAT',
  scoreValue: 100,
  ```

  `ghost`:
  ```ts
  displayName: 'VULTURE',
  scoreValue: 200,
  ```

- [ ] **Step 3: Verify TypeScript compiles**

  Run: `npx tsc --noEmit`
  Expected: no errors

- [ ] **Step 4: Commit**

  ```bash
  git add src/data/enemyDefs.ts
  git commit -m "feat: add displayName and scoreValue to EnemyDef"
  ```

---

## Task 3: buildRunScore module + tests

**Files:**
- Create: `src/systems/buildRunScore.ts`
- Create: `src/systems/__tests__/buildRunScore.test.ts`

- [ ] **Step 1: Write the failing tests first**

  Create `src/systems/__tests__/buildRunScore.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import { buildRunScore } from '../buildRunScore';
  import type { EnemyDef } from '../../data/enemyDefs';
  import type { EnemyKind } from '../../entities/Enemy';

  const TEST_DEFS: Record<EnemyKind, EnemyDef> = {
    percher: {
      kind: 'percher', textureKey: 'rat', width: 32, height: 32, speed: 55,
      spawnOnHeapSurface: true, spawnOnHeapWall: false,
      spawnStartY: 50000, spawnEndY: -1,
      spawnChanceMin: 0.15, spawnChanceMax: 0.35, spawnRampEndY: 10000,
      displayName: 'RAT', scoreValue: 100,
    },
    ghost: {
      kind: 'ghost', textureKey: 'vulture-fly-left', width: 51, height: 43, speed: 320,
      spawnOnHeapSurface: true, spawnOnHeapWall: false,
      spawnStartY: 50000, spawnEndY: -1,
      spawnChanceMin: 0.25, spawnChanceMax: 0.5, spawnRampEndY: 5000,
      displayName: 'VULTURE', scoreValue: 200,
    },
  };

  describe('buildRunScore', () => {
    it('returns only height row when no kills and failure run', () => {
      const result = buildRunScore(
        { baseHeightPx: 6000, kills: {}, elapsedMs: 85000 },
        TEST_DEFS,
        true, // isFailure — pace skipped
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({ type: 'height', value: 6000 });
      expect(result.finalScore).toBe(6000);
    });

    it('height row label shows ft reading', () => {
      const result = buildRunScore(
        { baseHeightPx: 6000, kills: {}, elapsedMs: 0 },
        TEST_DEFS,
        true,
      );
      expect(result.rows[0].detail).toBe('600ft');
    });

    it('adds kill row per enemy type with bonus = count × scoreValue', () => {
      const result = buildRunScore(
        { baseHeightPx: 6000, kills: { percher: 2 }, elapsedMs: 0 },
        TEST_DEFS,
        true,
      );
      expect(result.rows).toHaveLength(2);
      expect(result.rows[1]).toMatchObject({ type: 'kill', value: 200 });
      expect(result.finalScore).toBe(6200);
    });

    it('adds pace row for successful run', () => {
      // 6000px / 60s × 10 = 1000
      const result = buildRunScore(
        { baseHeightPx: 6000, kills: {}, elapsedMs: 60000 },
        TEST_DEFS,
        false,
      );
      expect(result.rows).toHaveLength(2);
      expect(result.rows[1]).toMatchObject({ type: 'pace', value: 1000 });
      expect(result.finalScore).toBe(7000);
    });

    it('omits pace row for failure runs', () => {
      const result = buildRunScore(
        { baseHeightPx: 6000, kills: {}, elapsedMs: 60000 },
        TEST_DEFS,
        true,
      );
      expect(result.rows.some(r => r.type === 'pace')).toBe(false);
    });

    it('omits pace row when elapsedMs is 0', () => {
      const result = buildRunScore(
        { baseHeightPx: 6000, kills: {}, elapsedMs: 0 },
        TEST_DEFS,
        false,
      );
      expect(result.rows.some(r => r.type === 'pace')).toBe(false);
    });

    it('computes full compound score: height + kills + pace', () => {
      // 6000 + (2×100 + 1×200) + floor(6000/85×10) = 6000 + 400 + 705 = 7105
      const result = buildRunScore(
        { baseHeightPx: 6000, kills: { percher: 2, ghost: 1 }, elapsedMs: 85000 },
        TEST_DEFS,
        false,
      );
      expect(result.finalScore).toBe(7105);
      expect(result.rows).toHaveLength(4); // height, percher, ghost, pace
    });

    it('floors the pace bonus', () => {
      // 6000 / 85s × 10 = 705.88... → 705
      const result = buildRunScore(
        { baseHeightPx: 6000, kills: {}, elapsedMs: 85000 },
        TEST_DEFS,
        false,
      );
      const paceRow = result.rows.find(r => r.type === 'pace')!;
      expect(paceRow.value).toBe(705);
    });

    it('kill row label uses displayName and count', () => {
      const result = buildRunScore(
        { baseHeightPx: 6000, kills: { ghost: 1 }, elapsedMs: 0 },
        TEST_DEFS,
        true,
      );
      expect(result.rows[1].label).toBe('VULTURE ×1');
    });

    it('pace row detail shows the formula', () => {
      const result = buildRunScore(
        { baseHeightPx: 6000, kills: {}, elapsedMs: 85000 },
        TEST_DEFS,
        false,
      );
      const paceRow = result.rows.find(r => r.type === 'pace')!;
      expect(paceRow.detail).toBe('6000 / 85s × 10');
    });
  });
  ```

- [ ] **Step 2: Run tests to verify they fail**

  Run: `npx vitest run src/systems/__tests__/buildRunScore.test.ts`
  Expected: FAIL — "Cannot find module '../buildRunScore'"

- [ ] **Step 3: Implement `src/systems/buildRunScore.ts`**

  Create `src/systems/buildRunScore.ts`:

  ```ts
  import type { EnemyKind } from '../entities/Enemy';
  import type { EnemyDef } from '../data/enemyDefs';
  import { PACE_BONUS_CONST, SCORE_DISPLAY_DIVISOR } from '../constants';

  export interface RunStats {
    baseHeightPx: number;
    kills:        Partial<Record<EnemyKind, number>>;
    elapsedMs:    number;
  }

  export interface RunScoreRow {
    type:   'height' | 'kill' | 'pace';
    label:  string;
    detail: string;
    value:  number; // score contribution in raw px units
  }

  export interface RunScoreResult {
    rows:       RunScoreRow[];
    finalScore: number;
  }

  export function buildRunScore(
    stats:     RunStats,
    defs:      Record<EnemyKind, EnemyDef>,
    isFailure: boolean,
  ): RunScoreResult {
    const rows: RunScoreRow[] = [];
    let total = stats.baseHeightPx;

    const ft = Math.floor(stats.baseHeightPx / SCORE_DISPLAY_DIVISOR);
    rows.push({
      type:   'height',
      label:  'FEET CLIMBED',
      detail: `${ft}ft`,
      value:  stats.baseHeightPx,
    });

    // Kill bonuses — one row per enemy type, in definition order
    const kinds: EnemyKind[] = ['percher', 'ghost'];
    for (const kind of kinds) {
      const count = stats.kills[kind];
      if (!count) continue;
      const def   = defs[kind];
      const bonus = count * def.scoreValue;
      rows.push({
        type:   'kill',
        label:  `${def.displayName} ×${count}`,
        detail: `${count} × ${def.scoreValue}`,
        value:  bonus,
      });
      total += bonus;
    }

    // Pace bonus — skipped for failure runs or when timer never started
    if (!isFailure && stats.elapsedMs > 0) {
      const elapsedSeconds = stats.elapsedMs / 1000;
      const paceBonus      = Math.floor((stats.baseHeightPx / elapsedSeconds) * PACE_BONUS_CONST);
      const elapsedSec     = Math.round(elapsedSeconds);
      rows.push({
        type:   'pace',
        label:  'PACE',
        detail: `${stats.baseHeightPx} / ${elapsedSec}s × ${PACE_BONUS_CONST}`,
        value:  paceBonus,
      });
      total += paceBonus;
    }

    return { rows, finalScore: total };
  }
  ```

- [ ] **Step 4: Run tests to verify they pass**

  Run: `npx vitest run src/systems/__tests__/buildRunScore.test.ts`
  Expected: all tests PASS

- [ ] **Step 5: Run full suite to check for regressions**

  Run: `npx vitest run`
  Expected: all tests PASS (count should be 171 + 9 new = 180)

- [ ] **Step 6: Commit**

  ```bash
  git add src/systems/buildRunScore.ts src/systems/__tests__/buildRunScore.test.ts
  git commit -m "feat: add buildRunScore module with compound score formula and tests"
  ```

---

## Task 4: GameScene — track RunStats and pass to ScoreScene

**Files:**
- Modify: `src/scenes/GameScene.ts`

This task adds kill tracking, a run timer, and wires finalScore into all three ScoreScene launch calls.

- [ ] **Step 1: Add imports to GameScene**

  At the top of `src/scenes/GameScene.ts`, add these imports after the existing ones:

  ```ts
  import type { EnemyKind } from '../entities/Enemy';
  import { buildRunScore } from '../systems/buildRunScore';
  import { ENEMY_DEFS } from '../data/enemyDefs';
  ```

  Also add `SCORE_DISPLAY_DIVISOR` to the constants import line:
  ```ts
  import {
    GAME_WIDTH,
    GAME_HEIGHT,
    WORLD_WIDTH,
    MOCK_HEAP_HEIGHT_PX,
    GEN_LOOKAHEAD,
    HEAP_TOP_ZONE_PX,
    PLAYER_HEIGHT,
    PEAK_BONUS_ZONE_PX,
    PLAYER_JUMP_VELOCITY,
    PLAYER_INVINCIBLE_MS,
    PLACE_HOLD_DURATION_MS,
    SCORE_DISPLAY_DIVISOR,
  } from '../constants';
  ```

- [ ] **Step 2: Add RunStats tracking fields to GameScene class**

  In the class body, after the `private _holdBar` line, add:

  ```ts
  private _runKills:     Partial<Record<EnemyKind, number>> = {};
  private _runStartTime: number | null = null;
  ```

- [ ] **Step 3: Reset RunStats fields at the start of `create()`**

  At the top of the `create()` method body, after the existing `this.blockPlaced = false;` line, add:

  ```ts
  this._runKills     = {};
  this._runStartTime = null;
  ```

- [ ] **Step 4: Start the run timer on first height gain**

  In the `update()` method, find the block that computes and displays the live score:

  ```ts
  // Live score: pixels climbed from spawn
  const score = Math.max(0, Math.floor(this.spawnY - this.player.sprite.y));
  if (score !== this._lastScore) {
    this._lastScore = score;
    this.scoreText.setText(`Score: ${score}`);
  }
  ```

  Replace it with:

  ```ts
  // Live score: pixels climbed from spawn
  const score = Math.max(0, Math.floor(this.spawnY - this.player.sprite.y));
  if (score > 0 && this._runStartTime === null) {
    this._runStartTime = this.time.now;
  }
  if (score !== this._lastScore) {
    this._lastScore = score;
    const ft = Math.floor(score / SCORE_DISPLAY_DIVISOR);
    this.scoreText.setText(`${ft} ft`);
  }
  ```

- [ ] **Step 5: Track kills per enemy type in `handleStomp`**

  Find the `handleStomp` method. After `e.destroy();`, add:

  ```ts
  const kind = e.getData('kind') as EnemyKind;
  this._runKills[kind] = (this._runKills[kind] ?? 0) + 1;
  ```

  The full block should look like:
  ```ts
  private readonly handleStomp = (
    _player: Phaser.GameObjects.GameObject,
    enemy: Phaser.GameObjects.GameObject,
  ): void => {
    const e = enemy as Phaser.Physics.Arcade.Sprite;
    const stompX = e.x;
    const stompY = e.y;
    e.destroy();

    const kind = e.getData('kind') as EnemyKind;
    this._runKills[kind] = (this._runKills[kind] ?? 0) + 1;

    this.player.sprite.setVelocityY(PLAYER_JUMP_VELOCITY);
    // ... rest unchanged
  ```

- [ ] **Step 6: Update `placeBlock()` to compute finalScore and pass RunStats**

  Find `placeBlock()`. Replace the score computation and `scene.launch` call:

  ```ts
  const score = Math.max(0, Math.floor(this.spawnY - py));
  this.time.delayedCall(2000, () => {
    void appendDone.then(() => {
      this.scene.launch('ScoreScene', { score, heapId: this._heapId, isPeak });
      this.scene.pause();
    });
  });
  ```

  With:

  ```ts
  const baseHeightPx = Math.max(0, Math.floor(this.spawnY - py));
  const elapsedMs    = this._runStartTime !== null ? (this.time.now - this._runStartTime) : 0;
  const runResult    = buildRunScore(
    { baseHeightPx, kills: this._runKills, elapsedMs },
    ENEMY_DEFS,
    false,
  );
  this.time.delayedCall(2000, () => {
    void appendDone.then(() => {
      this.scene.launch('ScoreScene', {
        score:        runResult.finalScore,
        heapId:       this._heapId,
        isPeak,
        baseHeightPx,
        kills:        this._runKills,
        elapsedMs,
      });
      this.scene.pause();
    });
  });
  ```

- [ ] **Step 7: Update TrashWall death ScoreScene launch to pass RunStats**

  Find the TrashWall death callback (inside `this.trashWallManager = new TrashWallManager(...)`). Replace:

  ```ts
  const score = Math.max(0, Math.floor(this.spawnY - this.player.sprite.y));
  this.scene.launch('ScoreScene', { score, heapId: this._heapId, isPeak: false, checkpointAvailable, isFailure: true });
  ```

  With:

  ```ts
  const baseHeightPx = Math.max(0, Math.floor(this.spawnY - this.player.sprite.y));
  const elapsedMs    = this._runStartTime !== null ? (this.time.now - this._runStartTime) : 0;
  const runResult    = buildRunScore(
    { baseHeightPx, kills: this._runKills, elapsedMs },
    ENEMY_DEFS,
    true,
  );
  this.scene.launch('ScoreScene', {
    score:        runResult.finalScore,
    heapId:       this._heapId,
    isPeak:       false,
    checkpointAvailable,
    isFailure:    true,
    baseHeightPx,
    kills:        this._runKills,
    elapsedMs,
  });
  ```

- [ ] **Step 8: Update `handleEnemyDamage` ScoreScene launch to pass RunStats**

  Find `handleEnemyDamage`. Replace:

  ```ts
  const score = Math.max(0, Math.floor(this.spawnY - this.player.sprite.y));
  this.scene.launch('ScoreScene', { score, heapId: this._heapId, isPeak: false, checkpointAvailable, isFailure: true });
  ```

  With:

  ```ts
  const baseHeightPx = Math.max(0, Math.floor(this.spawnY - this.player.sprite.y));
  const elapsedMs    = this._runStartTime !== null ? (this.time.now - this._runStartTime) : 0;
  const runResult    = buildRunScore(
    { baseHeightPx, kills: this._runKills, elapsedMs },
    ENEMY_DEFS,
    true,
  );
  this.scene.launch('ScoreScene', {
    score:        runResult.finalScore,
    heapId:       this._heapId,
    isPeak:       false,
    checkpointAvailable,
    isFailure:    true,
    baseHeightPx,
    kills:        this._runKills,
    elapsedMs,
  });
  ```

- [ ] **Step 9: Verify TypeScript compiles**

  Run: `npx tsc --noEmit`
  Expected: no errors

- [ ] **Step 10: Run full test suite**

  Run: `npx vitest run`
  Expected: all tests PASS

- [ ] **Step 11: Commit**

  ```bash
  git add src/scenes/GameScene.ts
  git commit -m "feat: track RunStats in GameScene, compute compound finalScore, update HUD to ft"
  ```

---

## Task 5: ScoreScene — accept RunStats and show finalScore

**Files:**
- Modify: `src/scenes/ScoreScene.ts`

- [ ] **Step 1: Add imports to ScoreScene**

  At the top of `src/scenes/ScoreScene.ts`, add:

  ```ts
  import { buildRunScore, RunStats, RunScoreRow } from '../systems/buildRunScore';
  import type { EnemyKind } from '../entities/Enemy';
  import { ENEMY_DEFS } from '../data/enemyDefs';
  ```

- [ ] **Step 2: Add RunStats fields to ScoreScene class**

  In the class body, add after `private isNewHighScore: boolean = false;`:

  ```ts
  private _baseHeightPx: number                            = 0;
  private _kills:        Partial<Record<EnemyKind, number>> = {};
  private _elapsedMs:    number                            = 0;
  private _scoreRows:    RunScoreRow[]                     = [];
  ```

- [ ] **Step 3: Accept RunStats fields in `init()`**

  Update the `init` method signature and body:

  ```ts
  init(data: {
    score:                number;
    heapId?:              string;
    isPeak?:              boolean;
    checkpointAvailable?: boolean;
    isFailure?:           boolean;
    baseHeightPx?:        number;
    kills?:               Partial<Record<EnemyKind, number>>;
    elapsedMs?:           number;
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
  }
  ```

- [ ] **Step 4: Populate `_scoreRows` in `create()`**

  At the top of `create()`, after the `if (this.heapId && this.score > 0)` block, add:

  ```ts
  if (this._baseHeightPx > 0) {
    const runResult = buildRunScore(
      { baseHeightPx: this._baseHeightPx, kills: this._kills, elapsedMs: this._elapsedMs },
      ENEMY_DEFS,
      this.isFailure,
    );
    this._scoreRows = runResult.rows;
  }
  ```

- [ ] **Step 5: Verify TypeScript compiles**

  Run: `npx tsc --noEmit`
  Expected: no errors

- [ ] **Step 6: Run full test suite**

  Run: `npx vitest run`
  Expected: all tests PASS

- [ ] **Step 7: Commit**

  ```bash
  git add src/scenes/ScoreScene.ts
  git commit -m "feat: ScoreScene accepts RunStats fields and populates score breakdown rows"
  ```

---

## Task 6: ScoreScene — tappable score breakdown panel

**Files:**
- Modify: `src/scenes/ScoreScene.ts`

This task makes the score number interactive and adds the slide-up breakdown overlay.

- [ ] **Step 1: Make the score text interactive and wire the breakdown toggle**

  In `createScoreDisplay()`, the method currently ends after the count-up tween. After the tween block, add:

  ```ts
  // Only add breakdown if we have row data
  if (this._scoreRows.length > 0) {
    scoreText.setInteractive({ useHandCursor: true });
    scoreText.on('pointerover', () => scoreText.setColor('#ffff88'));
    scoreText.on('pointerout',  () => scoreText.setColor('#ffdd44'));
    scoreText.on('pointerup',   () => this.toggleScoreBreakdown());
  }
  ```

- [ ] **Step 2: Add the `toggleScoreBreakdown` method and breakdown panel**

  Add the following private methods to `ScoreScene`, after `createHighScoreBadge()`:

  ```ts
  // ── Score Breakdown Panel ─────────────────────────────────────────────────────

  private _breakdownOpen = false;
  private _breakdownObjects: Phaser.GameObjects.GameObject[] = [];

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

    const PANEL_W   = GAME_WIDTH * 0.88;
    const PANEL_X   = CX;
    const PANEL_TOP = GAME_HEIGHT * 0.32;
    const ROW_H     = 24;
    const PAD_X     = 14;
    const left      = PANEL_X - PANEL_W / 2 + PAD_X;
    const right     = PANEL_X + PANEL_W / 2 - PAD_X;

    const rows        = this._scoreRows;
    const totalRows   = rows.length + 1; // +1 for divider + total row
    const panelH      = totalRows * ROW_H + 32;

    // Panel background
    const bg = this.add.graphics().setDepth(60);
    bg.fillStyle(0x0a0820, 0.95);
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

    // Tap-outside-to-close overlay (behind panel)
    const blocker = this.add.rectangle(CX, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0)
      .setDepth(59)
      .setInteractive();
    blocker.once('pointerup', () => this.closeScoreBreakdown());
    this._breakdownObjects.push(blocker);

    // Slide-in animation
    this._breakdownObjects.forEach(o => {
      (o as unknown as Phaser.GameObjects.Components.Alpha).setAlpha(0);
      (o as unknown as Phaser.GameObjects.Components.Transform).setY(
        (o as unknown as Phaser.GameObjects.Components.Transform).y + 20,
      );
    });
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
  ```

- [ ] **Step 3: Verify TypeScript compiles**

  Run: `npx tsc --noEmit`
  Expected: no errors

- [ ] **Step 4: Run full test suite**

  Run: `npx vitest run`
  Expected: all tests PASS

- [ ] **Step 5: Commit**

  ```bash
  git add src/scenes/ScoreScene.ts
  git commit -m "feat: add tappable score breakdown panel to ScoreScene"
  ```

---

## Smoke Test Checklist

After all tasks are committed, manually verify in the browser (`npm run dev`):

- [ ] HUD shows `N ft` (not `Score: N`) during a run
- [ ] Stomping an enemy does not change the HUD (kills are end-of-run)
- [ ] Score screen shows the compound finalScore (higher than raw height when kills were made)
- [ ] Tapping/clicking the score number opens the breakdown panel
- [ ] Breakdown rows: FEET CLIMBED, per-enemy kill rows, PACE row (successful run only)
- [ ] Pace row detail shows the formula (e.g. `6000 / 85s × 10`)
- [ ] Tapping outside the panel closes it
- [ ] Failure run: no PACE row in breakdown
- [ ] Failure run with kills: kill rows appear, finalScore is height + kill bonuses only
- [ ] Leaderboard submit uses compound finalScore (verify by checking a run with kills ranks higher than an equal-height run without)

# Compound Score System — Design Spec
_2026-04-16_

## Overview

Replace the current height-only score with a compound score that rewards kills and run speed alongside climbing height. The leaderboard, score screen, and HUD are all updated. Coin economy and stomp gold are left untouched for now.

---

## Score Formula

```
finalScore = baseHeightPx
           + Σ(kills[enemyType] × enemy.scoreValue)
           + (baseHeightPx / elapsedSeconds × PACE_BONUS_CONST)
```

All three terms are additive. `finalScore` is the number submitted to the leaderboard and shown on the score screen.

---

## RunStats

`GameScene` populates a `RunStats` object during the run and passes it to `ScoreScene` via `scene.launch` init data.

```ts
interface RunStats {
  baseHeightPx: number;                    // raw pixels climbed
  kills: Partial<Record<EnemyKind, number>>; // kill count per enemy type
  elapsedMs: number;                       // ms from first player input to run end
}
```

- Timer starts on **first player input** (so menu/load time is excluded).
- `kills` is incremented in `handleStomp` for each enemy type stomped.
- Failure runs: pace bonus is **skipped** (elapsedMs is not used); kill bonuses still apply.

---

## New Constants (`constants.ts`)

| Constant | Default | Description |
|---|---|---|
| `PACE_BONUS_CONST` | `10` | Multiplier on the pace component (`px/s × PACE_BONUS_CONST = score points`) |
| `SCORE_DISPLAY_DIVISOR` | `10` | Divides raw px into ft for HUD display |

---

## Enemy Defs (`src/data/enemyDefs.ts`)

`EnemyDef` gets a new field:

```ts
scoreValue: number; // score points awarded per kill of this enemy type
```

Initial values:
- `percher` (rat): `scoreValue = 100`
- `ghost` (vulture): `scoreValue = 200`

---

## Score Construction (`src/systems/buildRunScore.ts`)

New module. Exports `buildRunScore` and `RunScoreRow` types for the breakdown panel.

```ts
interface RunScoreRow {
  type: 'height' | 'kill' | 'pace';
  label: string;       // e.g. "FEET CLIMBED", "RAT ×2", "PACE"
  detail: string;      // e.g. "600ft", "6000 / 85s × 10"
  value: number;       // score contribution (raw px)
}

interface RunScoreResult {
  rows: RunScoreRow[];
  finalScore: number;
}

function buildRunScore(stats: RunStats, defs: Record<EnemyKind, EnemyDef>): RunScoreResult
```

Pace row is omitted entirely for failure runs.

---

## HUD (`src/ui/HUD.ts` or GameScene score text)

- Display format: `Math.floor(baseHeightPx / SCORE_DISPLAY_DIVISOR) ft`
- Live counter reflects height climbed only (kills and pace are end-of-run calculations).
- Example: 6000px → `600 ft`

---

## Score Screen (`src/scenes/ScoreScene.ts`)

### Init Data Shape

`ScoreScene.init` currently accepts `{ score, heapId, isPeak, checkpointAvailable, isFailure }`. This expands to also accept the `RunStats` fields inline (no nested object, keeps parity with existing callers):

```ts
init(data: {
  score:                number;   // finalScore (compound)
  heapId?:              string;
  isPeak?:              boolean;
  checkpointAvailable?: boolean;
  isFailure?:           boolean;
  // new:
  baseHeightPx?:        number;
  kills?:               Partial<Record<EnemyKind, number>>;
  elapsedMs?:           number;
}): void
```

If `baseHeightPx` is absent (e.g. old callers), the breakdown panel is not shown.

### Main Score Display

- Large number at top shows raw `finalScore` (compound px value, e.g. `6471`).
- Label below reads `SCORE` (unchanged).
- Number is **tappable** — opens the score breakdown panel.

### Score Breakdown Panel

Slides up on tap, dismissed by tapping again or tapping outside. Reuses existing panel visual language (dark rounded rect, monospace, row stripes).

Example layout:
```
FEET CLIMBED   600ft        6000
RAT ×2                      +200
VULTURE ×1                  +200
PACE           6000/85s×10   +71
────────────────────────────────
TOTAL                       6471
```

- `FEET CLIMBED` row: label shows ft reading; value is raw px (baseHeightPx).
- Kill rows: one row per enemy type that had at least one kill; shows kill count and score contribution.
- `PACE` row: shows the formula `baseHeightPx / elapsedSeconds × PACE_BONUS_CONST`; omitted for failure runs.
- `TOTAL` row: `finalScore`.

### Leaderboard

`ScoreClient.submitScore` is called with `finalScore` (compound) instead of raw height. Rankings compare compound scores.

---

## Coin Economy

No changes. Coins continue to use `buildCoinBreakdown` with `finalScore` as the input score (since `finalScore` replaces the old raw height score, coins will naturally reflect the higher compound value — no formula changes needed).

`stompBonus` (direct gold on kill) is unchanged.

---

## Files Touched

| File | Change |
|---|---|
| `src/constants.ts` | Add `PACE_BONUS_CONST`, `SCORE_DISPLAY_DIVISOR` |
| `src/data/enemyDefs.ts` | Add `scoreValue` to `EnemyDef` + both defs |
| `src/systems/buildRunScore.ts` | New module — score formula + breakdown rows |
| `src/scenes/GameScene.ts` | Track `RunStats` (timer, kill map); pass to ScoreScene; update HUD display |
| `src/scenes/ScoreScene.ts` | Accept `RunStats`; use `finalScore`; tappable score + breakdown panel |
| `server/` | No changes — leaderboard already stores whatever score is submitted |

---

## Out of Scope (deferred)

- Stomp gold rebalancing
- Kill coin multiplier in `coinBreakdown`
- Per-enemy kill sounds/effects

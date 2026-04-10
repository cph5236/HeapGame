# ScoreScene Visual Polish — Design Spec

**Date:** 2026-04-09
**Branch:** feature/Mountain-Climber-upgrade
**File:** `src/scenes/ScoreScene.ts`

---

## Overview

Polish the ScoreScene death/score screen to fix four visual issues: blocky background bands, an underpowered failure glow, a dim SCORE label, a misaligned coins header, and an unreadable balance display.

---

## Changes

### 1. Background — `createBackground()`

Replace the current 3 wide discrete color bands with ~18 narrow bands (~47px each), matching the MenuScene pattern exactly (`createSkyGradient`). Interpolate from `0x0a0818` (near-black indigo) at the top to `0x2a1060` (deep purple) at the bottom. This creates a smooth-looking gradient through narrow steps, consistent with the rest of the game's visual language.

### 2. Failure Glow — `createFailureGlow()`

Replace the small red ellipse at `y=0` with a full-width counter-gradient that bleeds down from the top. Implementation: ~10 horizontal bands from `y=0` downward, covering ~55% of `GAME_HEIGHT`. Top band uses deep blood-red (`0x3a0000`) at alpha ~0.45, stepping down quickly to near-zero by the last band. This creates an ominous heavy crimson atmosphere pressing down from above — fighting the cool purple background beneath it.

### 3. SCORE Label — `createScoreDisplay()`

Remove `.setAlpha(0.4)` from the "SCORE" sublabel. Set its color to `#ffdd44` (same as the score number). Full opacity.

### 4. Coins Header — `createCoinsPanel()`

Replace the two separate text objects (`+${finalCoins}` and the offset `coins earned` label) with a single centered text: `+${finalCoins} coins earned`. One `add.text` call at `PANEL_X`, origin `(0.5, 0)`. Removes the alignment issue caused by offsetting the second label by `headerText.width / 2 + 6`.

### 5. Balance — `createBalance()`

- Font size: `10px` → `16px`
- Alpha: `0.33` → `0.85`
- No position change

---

## Files Changed

| File | Change |
|------|--------|
| `src/scenes/ScoreScene.ts` | All 5 changes above — no new files |

---

## Out of Scope

- Confetti animation
- Checkpoint button styling
- Menu prompt styling
- Coins panel rows or collapse logic
- Any gameplay logic

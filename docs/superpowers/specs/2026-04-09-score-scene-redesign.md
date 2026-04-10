# ScoreScene Redesign — Design Spec
_2026-04-09_

## Overview

Redesign `ScoreScene` to deliver player satisfaction on a good run and appropriate weight on failure. The scene replaces the current plain-text overlay with a styled full-screen result screen that communicates outcome, score, and a transparent coin breakdown with per-upgrade color identity.

No changes to: scene transitions, input handling, checkpoint respawn flow, or GameScene launch calls beyond adding an `isFailure` flag. **`addBalance` is called with the final coin total after all multipliers including the death penalty** — the displayed breakdown and the actual balance change must match.

---

## Data Contract

`ScoreScene.init()` receives:

```ts
{
  score:               number;
  isPeak?:             boolean;   // existing — true if player placed near heap top
  checkpointAvailable?: boolean;  // existing — shows Respawn button
  isFailure?:          boolean;   // NEW — true when launched from handleEnemyDamage
}
```

**GameScene changes required:**
- `handleEnemyDamage` (line 459): add `isFailure: true` to the launch payload
- Success path (line 379): no change needed (`isFailure` defaults to `false`)

---

## Background

- Full-screen dark gradient: `#0a0818 → #1a1040 → #2a1060` (matches UpgradeScene)
- Static star field: ~12–16 small white/blue dots at fixed positions, rendered once in `create()`
- **Success only:** confetti burst on `create()` — ~20 small colored rects/circles, Phaser tweens scatter outward from center, fade out over ~1200ms. No confetti on failure.
- **Failure only:** subtle red radial glow at top of screen (`rgba(255,60,60,0.12)`, ellipse gradient)

---

## Layout (top → bottom)

### 1. Title

| State | Text | Color | Effect |
|---|---|---|---|
| Success | `HEAP SUCCESSFUL` | `#44ffaa` | Soft glow `text-shadow` |
| Failure | `HEAP FAILURE` | `#ff5555` | Soft glow `text-shadow` |

- Font: monospace, ~11px, letter-spacing 4px, uppercase
- Rendered as a Phaser Text object

### 2. Score

- Number: ~52px monospace bold, `#ffdd44`
- Glow: Phaser `setShadow(0, 0, '#ffdd44', 16, true, true)` for the bloom effect
- Drop shadow: `setShadow(0, 2, '#aa6600', 0)` — use a separate Graphics ellipse behind the text for a softer radial bloom if `setShadow` alone isn't sufficient
- On failure: slightly reduced opacity (0.85) to feel muted
- Animated: counts up from 0 → final value over 800ms using a Phaser numeric tween on scene enter

### 3. `SCORE` micro-label

- ~9px, letter-spaced 2px, faded gold `#ffdd4466`

### 4. Coins Panel

Rounded card below the score. Border and tint reflect outcome:

| State | Background | Border |
|---|---|---|
| Success | `rgba(0,255,100,0.08)` | `#44ff8833` |
| Failure | `rgba(255,80,80,0.06)` | `#ff555533` |

**Header row:**
- `+N coins earned` — large (~22px), color:
  - Success: `#44ff88`
  - Failure: `#ff8866`
- `coins earned` suffix — smaller, same color at 50% opacity

**Divider:** 1px gradient line

**Breakdown rows:**

1. **Base row** (always first):
   - Left: `Base (score ÷ 100)` — muted white `#ffffff55`
   - Right: base value — `#ffffff77`
   - No accent bar

2. **Multiplier rows** (one per active multiplier, in this order):
   - `money_mult` if `moneyMultiplier > 1`
   - `peak_hunter` if `isPeak && peakMultiplier > 1`
   - `death_penalty` if `isFailure` (always present on failure, always last)

   Each row:
   - Left accent bar (2px) in the upgrade's color
   - Tinted row background (upgrade color at ~10% opacity)
   - Left text: `× N.N  Upgrade Name` — lighter shade of accent color
   - Right text: running total after applying this multiplier — bold, full accent color

3. **Running total logic:**
   - `base = Math.floor(score / SCORE_TO_COINS_DIVISOR)`
   - Apply `money_mult`: `after_money = Math.floor(base * moneyMultiplier)`
   - Apply `peak_hunter` if active: `after_peak = Math.floor(after_money * peakMultiplier)`
   - Apply `death_penalty` if failure: `final = Math.floor(prev * 0.5)`
   - Each row's right value is the running total **after** that row's multiplier

**Collapse behaviour:**
- If ≤ 3 rows: always fully expanded, no toggle
- If 4+ rows: default collapsed — shows header + first 3 rows + `▼ show` toggle button
- Toggle expands to show all rows + `▲ hide` button
- Toggle is a Phaser Text object with `setInteractive`; no animation needed, instant show/hide

**Multiplier color map:**

| Upgrade | Accent color | Label |
|---|---|---|
| `money_mult` | `#ffaa22` amber | `Coin Multiplier` |
| `peak_hunter` | `#cc44ff` purple | `Peak Bonus ✦` |
| `death_penalty` | `#ff4444` red | `Death Penalty 💀` |

Colors are consistent with `ACCENT_COLORS` in `UpgradeScene.ts` where they overlap.

### 5. Balance

- `Balance: N coins`
- ~10px monospace, `#aaddff55`
- Below coins panel

### 6. Respawn at Checkpoint (conditional)

- Only rendered when `checkpointAvailable === true`
- Background: `rgba(68,100,255,0.18)`, border: `#4464ff44`, radius 6px
- Text: `#88aaff`, ~12px monospace
- `pointerover` → `#ffffff`, `pointerout` → `#88aaff`
- Behaviour: unchanged from current implementation

### 7. Tap anywhere for menu

- `TAP ANYWHERE FOR MENU` (mobile) / `PRESS ANY KEY FOR MENU` (desktop) — driven by existing `im.isMobile`
- ~10px monospace, `#ffffff28`, letter-spacing 2px
- Same delayed input logic as current (300ms debounce)

---

## Animations

| Element | Animation | Timing |
|---|---|---|
| Score number | Count up 0 → final, `Cubic.Out` ease | 800ms |
| Coins panel | Fade in + slide up 20px, `Cubic.Out` | 300ms delay after score, 400ms duration |
| Confetti | 20 particles scatter from center, fade out | Fires once on `create()`, 1200ms |

---

## Implementation Scope

**Files to change:**
- `src/scenes/ScoreScene.ts` — full rewrite of `create()` to implement above
- `src/scenes/GameScene.ts` — add `isFailure: true` to `handleEnemyDamage` launch call

**Files unchanged:**
- `src/systems/SaveData.ts` — `addBalance` / `getBalance` / `getPlayerConfig` called identically
- `src/constants.ts` — no new constants needed
- `src/data/upgradeDefs.ts` — death penalty is computed inline, not an upgrade def

---

## Out of Scope

- High score tracking / personal bests
- Animated per-row coin count-up (just panel fade-in is enough)
- Sound effects
- Share / screenshot feature

# In-Game UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the in-game UI for both gameplay scenes into a unified "Clean Arcade" design — status on a top strip, controls in the bottom corners — that resolves the joystick/UI overlap bug and reaches production polish.

**Architecture:** Extract the shared HUD into focused modules: a pure-logic module (`hudLogic`), a theme/texture module (`hudTheme`), an `AbilityTray`, and a `HUD` that owns the full top strip (ability tray, score chip, pause, scrims, revive badge). Both `GameScene` and `InfiniteGameScene` consume the same HUD; `mountJoystick` positions the whole control cluster (stick + dash + place) by handedness and the dash button carries its own cooldown ring.

**Tech Stack:** Phaser 3.90, TypeScript 5.9, Vitest. UI renders on the non-following `GameplayUiCamera`; gradients/shadows are baked into cached textures (no live blur), following the existing `HUD.ensureRadialTexture` pattern.

**Design source:** `docs/superpowers/specs/2026-06-15-in-game-ui-redesign-design.md`

**Open decision (flagged, default chosen):** The spec did not relocate the **hotbar bag** (today bottom-left, now inside the control zone). This plan moves it to the **top strip, immediately left of the pause button**. Revisit during smoke testing if it feels wrong.

---

## File Structure

**Create:**
- `src/ui/hudLogic.ts` — pure functions: dash-indicator rule, air-jump pip states, dash-bar fill, control-cluster layout. Fully unit-tested.
- `src/ui/__tests__/hudLogic.test.ts` — tests for the above.
- `src/ui/hudTheme.ts` — palette + size constants + texture-baking helpers (panel, vertical fade/scrim, glow button) + small shared builders (score chip, pause button, slim bar).
- `src/ui/AbilityTray.ts` — top-left ability tray (cloud + pips, wall-jump, conditional dash bar) with `update()`.

**Modify:**
- `src/ui/HUD.ts` — becomes the top-strip owner: scrims + AbilityTray + score chip (`setScore`) + pause button + revive badge + hotbar bag. New options-object constructor.
- `src/scenes/GameScene.ts` — use new HUD options; remove local `scoreText` + `createMenuButton`; restyle/reposition the PLACE button (handedness-aware via `hudLogic`).
- `src/scenes/InfiniteGameScene.ts` — use new HUD options; remove local `scoreText` (top-left "ft") + `createMenuButton`; call `hud.setScore`.
- `src/systems/mountJoystick.ts` — position whole control cluster by side via `hudLogic.controlClusterLayout`; restyle dash button + drive its cooldown ring each frame; keep suppression rects; expose the place-button anchor.
- `src/systems/JoystickController.ts` — base/thumb visual polish (gradient, highlight, dashed guide ring). Behavior unchanged.
- `src/constants.ts` — new layout constants (top-strip inset, tray/chip/button sizes, place button dims, scrim heights).

**Unchanged:** `InputManager` (suppression-rect API already supports this), `GameplayUiCamera`, all input behavior, the placement hold-bar (`_holdBar`).

---

## Task 1: Pure HUD logic module

**Files:**
- Create: `src/ui/hudLogic.ts`
- Test: `src/ui/__tests__/hudLogic.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/ui/__tests__/hudLogic.test.ts
import { describe, it, expect } from 'vitest';
import {
  showDashIndicator, airJumpPipStates, dashBarFillFraction, controlClusterLayout,
} from '../hudLogic';

describe('showDashIndicator', () => {
  it('shows on desktop regardless of mode', () => {
    expect(showDashIndicator(false, 'tilt')).toBe(true);
    expect(showDashIndicator(false, 'joystick')).toBe(true);
  });
  it('shows on mobile tilt, hides on mobile joystick (button carries it)', () => {
    expect(showDashIndicator(true, 'tilt')).toBe(true);
    expect(showDashIndicator(true, 'joystick')).toBe(false);
  });
});

describe('airJumpPipStates', () => {
  it('marks the first `left` pips available, rest used', () => {
    expect(airJumpPipStates(2, 3)).toEqual([true, true, false]);
    expect(airJumpPipStates(0, 3)).toEqual([false, false, false]);
    expect(airJumpPipStates(3, 3)).toEqual([true, true, true]);
  });
  it('clamps left into [0, max]', () => {
    expect(airJumpPipStates(5, 2)).toEqual([true, true]);
    expect(airJumpPipStates(-1, 2)).toEqual([false, false]);
  });
});

describe('dashBarFillFraction', () => {
  it('is full when cooldown is 0, empty when cooldown is 1', () => {
    expect(dashBarFillFraction(0)).toBe(1);
    expect(dashBarFillFraction(1)).toBe(0);
    expect(dashBarFillFraction(0.25)).toBe(0.75);
  });
  it('clamps out-of-range input', () => {
    expect(dashBarFillFraction(-0.5)).toBe(1);
    expect(dashBarFillFraction(2)).toBe(0);
  });
});

describe('controlClusterLayout', () => {
  const dims = { joyRadius: 64, joyMargin: 28, dashRadius: 34, placeW: 80, placeH: 60, placeGap: 14 };
  it('left side: stick bottom-left, dash + place bottom-right', () => {
    const l = controlClusterLayout('left', 480, 800, dims);
    expect(l.stick).toEqual({ x: 28 + 64, y: 800 - 28 - 64 });
    expect(l.dash).toEqual({ x: 480 - 28 - 34, y: 800 - 28 - 34 });
    // place sits above the dash (action) corner, same x, one gap up
    expect(l.place.x).toBe(480 - 28 - 34);
    expect(l.place.y).toBe((800 - 28 - 34) - 34 - 14 - 30);
  });
  it('right side mirrors horizontally', () => {
    const r = controlClusterLayout('right', 480, 800, dims);
    expect(r.stick).toEqual({ x: 480 - 28 - 64, y: 800 - 28 - 64 });
    expect(r.dash).toEqual({ x: 28 + 34, y: 800 - 28 - 34 });
    expect(r.place.x).toBe(28 + 34);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/__tests__/hudLogic.test.ts`
Expected: FAIL — `Cannot find module '../hudLogic'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/ui/hudLogic.ts
export type ControlMode = 'tilt' | 'joystick';
export type JoystickSide = 'left' | 'right';

/** Tray dash bar shows unless an on-screen dash button carries the cooldown
 *  (mobile joystick mode). Desktop + mobile-tilt have no dash button. */
export function showDashIndicator(isMobile: boolean, mode: ControlMode): boolean {
  return !isMobile || mode !== 'joystick';
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** One boolean per air-jump slot: first `left` are available, rest used. */
export function airJumpPipStates(left: number, max: number): boolean[] {
  const l = clamp(left, 0, max);
  return Array.from({ length: max }, (_, i) => i < l);
}

/** Dash bar fill (0..1): full when ready (cooldown 0), empty mid-cooldown (1). */
export function dashBarFillFraction(cooldownFraction: number): number {
  return 1 - clamp(cooldownFraction, 0, 1);
}

export interface ClusterDims {
  joyRadius: number; joyMargin: number; dashRadius: number;
  placeW: number; placeH: number; placeGap: number;
}
export interface ClusterLayout {
  stick: { x: number; y: number };
  dash:  { x: number; y: number };
  place: { x: number; y: number };
}

/** Position the whole control cluster by handedness. Stick in one bottom corner;
 *  dash button + PLACE (stacked above it) in the opposite corner. Centers. */
export function controlClusterLayout(
  side: JoystickSide, w: number, h: number, d: ClusterDims,
): ClusterLayout {
  const stickX = side === 'left' ? d.joyMargin + d.joyRadius : w - d.joyMargin - d.joyRadius;
  const stickY = h - d.joyMargin - d.joyRadius;
  const dashX  = side === 'left' ? w - d.joyMargin - d.dashRadius : d.joyMargin + d.dashRadius;
  const dashY  = h - d.joyMargin - d.dashRadius;
  const placeX = dashX;
  const placeY = dashY - d.dashRadius - d.placeGap - d.placeH / 2;
  return {
    stick: { x: stickX, y: stickY },
    dash:  { x: dashX,  y: dashY  },
    place: { x: placeX, y: placeY },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/__tests__/hudLogic.test.ts`
Expected: PASS (all 4 describe blocks green). Note `placeH/2 = 30` in the layout test.

- [ ] **Step 5: Commit**

```bash
git add src/ui/hudLogic.ts src/ui/__tests__/hudLogic.test.ts
git commit -m "feat(ui): pure HUD logic (dash rule, pips, dash fill, control layout)"
```

---

## Task 2: HUD theme & texture helpers

**Files:**
- Create: `src/ui/hudTheme.ts`
- Modify: `src/constants.ts`

- [ ] **Step 1: Add layout constants**

Append to `src/constants.ts`:

```typescript
// ── In-game UI redesign (Clean Arcade) ──────────────────────────────────────
export const HUD_INSET        = 12;   // px padding from top/side screen edges
export const HUD_TRAY_PAD      = 10;  // inner padding of the ability tray panel
export const HUD_DASH_BAR_W    = 46;  // slim dash cooldown bar width
export const HUD_DASH_BAR_H    = 8;   // slim dash cooldown bar height
export const HUD_PLACE_W       = 80;  // PLACE button width
export const HUD_PLACE_H       = 60;  // PLACE button height
export const HUD_PLACE_GAP     = 14;  // gap between dash button and PLACE
export const HUD_SCRIM_TOP_H   = 64;  // top legibility scrim height
export const HUD_SCRIM_BOT_H   = 150; // bottom legibility scrim height
```

- [ ] **Step 2: Write `hudTheme.ts`**

```typescript
// src/ui/hudTheme.ts
import Phaser from 'phaser';
import { getDprCap } from '../systems/displayMetrics';

/** Clean Arcade palette. Numbers are 0xRRGGBB; strings are for Text styles. */
export const HUD = {
  panelFill:   0x0a0c1a, panelAlpha: 0.45,
  border:      0xffffff, borderAlpha: 0.12,
  accent:      0xff9922,           // orange (primary action)
  accentDark:  0xb3650f,
  dash:        0x44aaff, dashGlow: 0x5cc8ff, dashDim: 0x225588,
  dashStroke:  0xff7755,           // dash button ring/stroke
  cloud:       0xdce8ff,
  textWhite:   '#ffffff',
  textAccent:  '#ffce8a',
} as const;

/** Bake (once) a rounded translucent panel texture at DPR scale, then return an
 *  Image using it. Avoids per-frame fillRoundedRect. Keyed by w×h×radius. */
export function makePanel(
  scene: Phaser.Scene, cx: number, cy: number, w: number, h: number, radius = 14,
): Phaser.GameObjects.Image {
  const key = `hud-panel-${w}x${h}-${radius}`;
  if (!scene.textures.exists(key)) {
    const dpr = getDprCap();
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(HUD.panelFill, HUD.panelAlpha);
    g.fillRoundedRect(0, 0, w * dpr, h * dpr, radius * dpr);
    g.lineStyle(1 * dpr, HUD.border, HUD.borderAlpha);
    g.strokeRoundedRect(0, 0, w * dpr, h * dpr, radius * dpr);
    g.generateTexture(key, Math.ceil(w * dpr), Math.ceil(h * dpr));
    g.destroy();
  }
  return scene.add.image(cx, cy, key).setScrollFactor(0).setDisplaySize(w, h);
}

/** Bake a 1×H vertical alpha-fade strip (top→bottom) and stretch it to the screen
 *  width. Used for the top/bottom legibility scrims. */
export function makeScrim(
  scene: Phaser.Scene, x: number, y: number, w: number, h: number,
  topAlpha: number, botAlpha: number,
): Phaser.GameObjects.Image {
  const key = `hud-scrim-${h}-${topAlpha}-${botAlpha}`;
  if (!scene.textures.exists(key)) {
    const dpr = getDprCap();
    const ph = Math.ceil(h * dpr);
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    for (let i = 0; i < ph; i++) {
      const t = i / (ph - 1);
      const a = topAlpha + (botAlpha - topAlpha) * t;
      g.fillStyle(0x080814, a);
      g.fillRect(0, i, dpr, 1);
    }
    g.generateTexture(key, dpr, ph);
    g.destroy();
  }
  return scene.add.image(x, y, key).setOrigin(0, 0).setDisplaySize(w, h).setScrollFactor(0);
}
```

- [ ] **Step 3: Verify build is clean**

Run: `npm run build`
Expected: built successfully, no TS errors. (No unit test — texture pixels aren't meaningfully testable; correctness is verified visually in later tasks.)

- [ ] **Step 4: Commit**

```bash
git add src/ui/hudTheme.ts src/constants.ts
git commit -m "feat(ui): hud theme palette + panel/scrim texture bakers + layout constants"
```

---

## Task 3: AbilityTray component

**Files:**
- Create: `src/ui/AbilityTray.ts`

The tray stacks (top→bottom): air-jump cloud + pips row, wall-jump icon (if owned), dash bar (if `showDashIndicator`). Returns its game objects for UI-camera registration and an `update()` to refresh state each frame.

- [ ] **Step 1: Write `AbilityTray.ts`**

```typescript
// src/ui/AbilityTray.ts
import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { HUD, makePanel } from './hudTheme';
import { airJumpPipStates, dashBarFillFraction } from './hudLogic';
import { HUD_DASH_BAR_W, HUD_DASH_BAR_H, HUD_INSET, HUD_TRAY_PAD } from '../constants';

export class AbilityTray {
  readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly player: Player;
  private readonly pips: Phaser.GameObjects.Arc[] = [];
  private readonly wallIcon?: Phaser.GameObjects.Image;
  private readonly dashFill?: Phaser.GameObjects.Rectangle;
  private readonly showDash: boolean;

  constructor(scene: Phaser.Scene, player: Player, showDashIndicator: boolean) {
    this.player = player;
    this.showDash = showDashIndicator;

    // Tray geometry: a column anchored top-left under the inset.
    const left = HUD_INSET;
    const top  = HUD_INSET;
    const colW = 56;
    const max  = player.maxAirJumpsCount;
    const hasWall = player.hasWallJump;
    const rows = 1 + (hasWall ? 1 : 0) + (showDashIndicator ? 1 : 0);
    const rowH = 26;
    const panelH = HUD_TRAY_PAD * 2 + rows * rowH;
    const cx = left + colW / 2;

    this.objects.push(
      makePanel(scene, cx, top + panelH / 2, colW, panelH, 14).setDepth(19),
    );

    let rowY = top + HUD_TRAY_PAD + rowH / 2;

    // Air-jump: cloud glyph + pip row.
    this.objects.push(
      scene.add.image(cx, rowY - 4, 'cloud').setScrollFactor(0).setDepth(20).setScale(0.9),
    );
    const pipGap = 9;
    const startX = cx - ((max - 1) * pipGap) / 2;
    for (let i = 0; i < max; i++) {
      const pip = scene.add.circle(startX + i * pipGap, rowY + 8, 3, HUD.cloud)
        .setScrollFactor(0).setDepth(20);
      this.pips.push(pip);
      this.objects.push(pip);
    }
    rowY += rowH;

    // Wall-jump icon (single charge → lit/dim).
    if (hasWall) {
      this.wallIcon = scene.add.image(cx, rowY, 'wall-jump').setScrollFactor(0).setDepth(20);
      this.objects.push(this.wallIcon);
      rowY += rowH;
    }

    // Dash bar: » glyph + slim cooldown bar (only when no on-screen dash button).
    if (showDashIndicator && player.hasDash) {
      const barLeft = cx - HUD_DASH_BAR_W / 2 + 6;
      this.objects.push(
        scene.add.text(barLeft - 12, rowY, '»', {
          fontSize: '13px', color: '#9cf', fontStyle: 'bold',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(20),
      );
      this.objects.push(
        scene.add.rectangle(barLeft, rowY, HUD_DASH_BAR_W, HUD_DASH_BAR_H, 0x000000, 0.45)
          .setOrigin(0, 0.5).setScrollFactor(0).setDepth(20).setStrokeStyle(1, HUD.border, HUD.borderAlpha),
      );
      this.dashFill = scene.add.rectangle(barLeft, rowY, HUD_DASH_BAR_W, HUD_DASH_BAR_H, HUD.dashGlow, 1)
        .setOrigin(0, 0.5).setScrollFactor(0).setDepth(21);
      this.objects.push(this.dashFill);
    }
  }

  update(): void {
    const states = airJumpPipStates(this.player.airJumpsLeft, this.pips.length);
    for (let i = 0; i < this.pips.length; i++) this.pips[i].setAlpha(states[i] ? 1 : 0.22);

    if (this.wallIcon) this.wallIcon.setAlpha(this.player.canWallJump ? 1 : 0.25);

    if (this.showDash && this.dashFill) {
      const f = dashBarFillFraction(this.player.dashCooldownFraction);
      this.dashFill.scaleX = f;
      this.dashFill.fillColor = f >= 1 ? HUD.dashGlow : HUD.dashDim;
    }
  }
}
```

- [ ] **Step 2: Verify build is clean**

Run: `npm run build`
Expected: built successfully, no TS errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/AbilityTray.ts
git commit -m "feat(ui): AbilityTray — cloud+pips air-jumps, wall-jump, slim dash bar"
```

---

## Task 4: Rework HUD into the top-strip owner

**Files:**
- Modify: `src/ui/HUD.ts`

HUD now builds: scrims (top + bottom), AbilityTray (left), score chip (center, `setScore`), pause button (right), hotbar bag (left of pause), revive badge (below score). New options-object constructor.

- [ ] **Step 1: Replace `HUD.ts` with the reworked version**

```typescript
// src/ui/HUD.ts
import Phaser from 'phaser';
import { Player } from '../entities/Player';
import type { PlaceableManager } from '../systems/PlaceableManager';
import { logicalWidth, logicalHeight } from '../systems/displayMetrics';
import { addToGameplayUi } from '../systems/GameplayUiCamera';
import { AbilityTray } from './AbilityTray';
import { HUD as TH, makePanel, makeScrim } from './hudTheme';
import { HUD_INSET, HUD_SCRIM_TOP_H, HUD_SCRIM_BOT_H } from '../constants';

export interface HudOptions {
  placeableManager?: PlaceableManager;
  showDashIndicator: boolean;
  onPause: () => void;
}

export class HUD {
  private readonly tray: AbilityTray;
  private readonly scoreText: Phaser.GameObjects.Text;
  private readonly reviveBadge: Phaser.GameObjects.Text;
  private readonly player: Player;

  constructor(scene: Phaser.Scene, player: Player, opts: HudOptions) {
    this.player = player;
    const w = logicalWidth(scene);
    const parts: Phaser.GameObjects.GameObject[] = [];

    // ── Legibility scrims ────────────────────────────────────────────────────
    parts.push(makeScrim(scene, 0, 0, w, HUD_SCRIM_TOP_H, 0.55, 0).setDepth(18));
    parts.push(makeScrim(scene, 0, logicalHeight(scene) - HUD_SCRIM_BOT_H, w, HUD_SCRIM_BOT_H, 0, 0.5).setDepth(18));

    // ── Ability tray (top-left) ──────────────────────────────────────────────
    this.tray = new AbilityTray(scene, player, opts.showDashIndicator);
    parts.push(...this.tray.objects);

    // ── Score chip (top-center) ──────────────────────────────────────────────
    const chipY = HUD_INSET + 16;
    parts.push(makePanel(scene, w / 2, chipY, 116, 30, 16).setDepth(19));
    this.scoreText = scene.add.text(w / 2, chipY, '0 ft', {
      fontSize: '14px', color: TH.textWhite, fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);
    parts.push(this.scoreText);

    // ── Pause button (top-right) ─────────────────────────────────────────────
    const pauseX = w - HUD_INSET - 19;
    parts.push(makePanel(scene, pauseX, chipY, 38, 38, 12).setDepth(19));
    parts.push(scene.add.text(pauseX, chipY, '☰', {
      fontSize: '18px', color: TH.textWhite, fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20));
    const pauseHit = scene.add.zone(pauseX, chipY, 44, 44).setScrollFactor(0).setDepth(21)
      .setInteractive({ useHandCursor: true });
    pauseHit.on('pointerup', opts.onPause);
    parts.push(pauseHit);

    // ── Hotbar bag (top strip, left of pause) ── DECISION: moved off bottom-left
    if (opts.placeableManager) {
      const bagX = pauseX - 44;
      parts.push(makePanel(scene, bagX, chipY, 38, 38, 12).setDepth(19));
      parts.push(scene.add.text(bagX, chipY, '🎒', { fontSize: '20px' })
        .setOrigin(0.5).setScrollFactor(0).setDepth(20));
      const bagHit = scene.add.zone(bagX, chipY, 44, 44).setScrollFactor(0).setDepth(21)
        .setInteractive({ useHandCursor: true });
      const pm = opts.placeableManager;
      bagHit.on('pointerup', () => pm.openHotbar());
      parts.push(bagHit);
    }

    // ── Revive badge (below score, center) ───────────────────────────────────
    this.reviveBadge = scene.add.text(w / 2, chipY + 26, '♥ REVIVE', {
      fontSize: '12px', color: '#ff6688', stroke: '#000000', strokeThickness: 3, fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20).setVisible(false);
    parts.push(this.reviveBadge);

    addToGameplayUi(scene, parts);
  }

  /** Update the centered score/height readout. */
  setScore(text: string): void {
    this.scoreText.setText(text);
  }

  update(): void {
    this.tray.update();
    this.reviveBadge.setVisible(this.player.isReviveArmed);
  }
}
```

- [ ] **Step 2: Verify build fails on the callers (expected)**

Run: `npm run build`
Expected: TS errors in `GameScene.ts` and `InfiniteGameScene.ts` — old `new HUD(this, player, placeableManager)` signature and removed `scoreText`/`createMenuButton` usages. These are fixed in Tasks 5–6.

- [ ] **Step 3: Commit**

```bash
git add src/ui/HUD.ts
git commit -m "feat(ui): HUD owns unified top strip (tray, score chip, pause, bag, scrims)"
```

---

## Task 5: GameScene integration

**Files:**
- Modify: `src/scenes/GameScene.ts`

- [ ] **Step 1: Update HUD construction and score updates**

In `GameScene.ts`, find the score-text creation (around line 323) and delete it:

```typescript
// DELETE these lines (scoreText is now owned by HUD):
this.scoreText = this.add.text(logicalWidth(this) / 2, 30, 'Score: 0', {
  fontSize: '20px', color: '#ffffff', stroke: '#000000', strokeThickness: 3,
}).setOrigin(0.5).setScrollFactor(0).setDepth(20);
addToGameplayUi(this, this.scoreText);
```

Replace the HUD construction (line ~359) and remove the `createMenuButton()` call (line ~362):

```typescript
// was: this.hud = new HUD(this, this.player, this.placeableManager);
const im = InputManager.getInstance();
this.hud = new HUD(this, this.player, {
  placeableManager: this.placeableManager,
  showDashIndicator: showDashIndicator(im.isMobile, getEffectiveControlMode()),
  onPause: () => this.openPauseMenu(),
});
// DELETE: this.createMenuButton();
```

- [ ] **Step 2: Repoint the score update**

At the score update (line ~502), replace the `scoreText.setText` with the HUD setter:

```typescript
if (score !== this._lastScore) {
  this._lastScore = score;
  const ft = Math.floor(score / SCORE_DISPLAY_DIVISOR);
  this.hud.setScore(`${ft} ft`);   // was: this.scoreText.setText(`${ft} ft`);
}
```

- [ ] **Step 3: Remove the now-dead members and method**

- Delete the `private scoreText!: Phaser.GameObjects.Text;` field declaration.
- Delete the entire `private createMenuButton(): void { ... }` method (its ESC/P keyboard bindings move to Step 4).

- [ ] **Step 4: Preserve ESC/P pause keybindings**

The deleted `createMenuButton` registered ESC/P. Add to `create()` after HUD construction:

```typescript
this.input.keyboard?.on('keydown-ESC', () => this.openPauseMenu());
this.input.keyboard?.on('keydown-P',   () => this.openPauseMenu());
```

- [ ] **Step 5: Add imports**

Ensure these imports exist at the top of `GameScene.ts`:

```typescript
import { showDashIndicator } from '../ui/hudLogic';
import { getEffectiveControlMode } from '../systems/SaveData';
import { InputManager } from '../systems/InputManager';
```
(InputManager / getEffectiveControlMode likely already imported — do not duplicate.)

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: GameScene errors resolved. InfiniteGameScene still errors (fixed in Task 6).

- [ ] **Step 7: Commit**

```bash
git add src/scenes/GameScene.ts
git commit -m "feat(ui): GameScene uses unified HUD top strip; score via hud.setScore"
```

---

## Task 6: InfiniteGameScene integration

**Files:**
- Modify: `src/scenes/InfiniteGameScene.ts`

- [ ] **Step 1: Replace HUD construction + score text**

Find (around line 294–300):

```typescript
this.hud = new HUD(this, this.player, this.placeableManager);
this.scoreText = this.add.text(8, 8, '0 ft', { /* ... */ });
addToGameplayUi(this, this.scoreText);
```

Replace with:

```typescript
this.hud = new HUD(this, this.player, {
  placeableManager: this.placeableManager,
  showDashIndicator: showDashIndicator(this.im.isMobile, getEffectiveControlMode()),
  onPause: () => this.openPauseMenu(),
});
```

- [ ] **Step 2: Repoint the score update**

At the score update (line ~378):

```typescript
this.hud.setScore(`${Math.floor(score / 100)} ft`);   // was: this.scoreText.setText(...)
```

- [ ] **Step 3: Remove dead members and method**

- Delete `private scoreText!: Phaser.GameObjects.Text;`.
- Delete the `private createMenuButton(): void { ... }` method (line ~339) and its call (line ~302).
- Add the ESC/P keybindings into `create()` (if the deleted method had them):

```typescript
this.input.keyboard?.on('keydown-ESC', () => this.openPauseMenu());
this.input.keyboard?.on('keydown-P',   () => this.openPauseMenu());
```

- [ ] **Step 4: Add imports**

```typescript
import { showDashIndicator } from '../ui/hudLogic';
import { getEffectiveControlMode } from '../systems/SaveData';
```
(Skip any already present.)

- [ ] **Step 5: Verify build is fully clean**

Run: `npm run build`
Expected: built successfully, no TS errors anywhere.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all tests pass (incl. Task 1's `hudLogic` tests).

- [ ] **Step 7: Commit**

```bash
git add src/scenes/InfiniteGameScene.ts
git commit -m "feat(ui): InfiniteGameScene uses unified HUD; ft readout into center chip"
```

---

## Task 7: mountJoystick — cluster layout, restyled dash button + cooldown ring

**Files:**
- Modify: `src/systems/mountJoystick.ts`

- [ ] **Step 1: Use `controlClusterLayout` and expose the PLACE anchor**

Replace the body of `mountJoystick` from the `side`/position computation through the dash button creation with the cluster-driven version:

```typescript
import { controlClusterLayout } from '../ui/hudLogic';
import { HUD_PLACE_W, HUD_PLACE_H, HUD_PLACE_GAP } from '../constants';
import { HUD as TH } from '../ui/hudTheme';

// ... after `if (mode !== 'joystick') return null;`
const side = getJoystickSide();
const w = logicalWidth(scene);
const h = logicalHeight(scene);
const layout = controlClusterLayout(side, w, h, {
  joyRadius: JOYSTICK_RADIUS, joyMargin: JOYSTICK_MARGIN, dashRadius: DASH_BUTTON_RADIUS,
  placeW: HUD_PLACE_W, placeH: HUD_PLACE_H, placeGap: HUD_PLACE_GAP,
});

const controller = new JoystickController(scene, layout.stick.x, layout.stick.y);

im.setSuppressionRect(JOYSTICK_SUPPRESS_ID, {
  x: layout.stick.x - JOYSTICK_RADIUS, y: layout.stick.y - JOYSTICK_RADIUS,
  w: JOYSTICK_RADIUS * 2, h: JOYSTICK_RADIUS * 2,
});

const dashX = layout.dash.x, dashY = layout.dash.y;
const dashBtn = scene.add.circle(dashX, dashY, DASH_BUTTON_RADIUS, 0x14100c, 0.5)
  .setStrokeStyle(2, TH.dashStroke).setScrollFactor(0).setDepth(40).setVisible(player.hasDash);
const dashLabel = scene.add.text(dashX, dashY, '»', {
  fontSize: '26px', color: '#ffd0c2', fontStyle: 'bold',
}).setOrigin(0.5).setScrollFactor(0).setDepth(41).setVisible(player.hasDash);
// Cooldown ring drawn each frame as an arc that depletes/refills.
const dashRing = scene.add.graphics().setScrollFactor(0).setDepth(41).setVisible(player.hasDash);
addToGameplayUi(scene, [dashBtn, dashLabel, dashRing]);
```

- [ ] **Step 2: Drive the dash cooldown ring and keep the dash tap handler**

Keep the existing `if (player.hasDash) { dashBtn.setInteractive()... pointerdown... im.pulseDash(dir); im.setSuppressionRect(DASH_SUPPRESS_ID, ...) }` block, but update the suppression rect to use `dashX/dashY` (already the case via the variables). Then add a per-frame ring update and wire it into the returned `update`:

```typescript
const RING_R = DASH_BUTTON_RADIUS + 3;
const TWO_PI = Math.PI * 2;
const drawRing = (): void => {
  if (!player.hasDash) return;
  const filled = 1 - Math.max(0, Math.min(1, player.dashCooldownFraction));
  dashRing.clear();
  dashRing.lineStyle(4, filled >= 1 ? 0xff7755 : 0xaa5544, 1);
  dashRing.beginPath();
  dashRing.arc(dashX, dashY, RING_R, -Math.PI / 2, -Math.PI / 2 + TWO_PI * filled, false);
  dashRing.strokePath();
};

return {
  update: (delta: number) => { controller.update(delta); drawRing(); },
  destroy: () => {
    controller.destroy();
    dashBtn.destroy(); dashLabel.destroy(); dashRing.destroy();
    im.setSuppressionRect(DASH_SUPPRESS_ID, null);
    im.setSuppressionRect(JOYSTICK_SUPPRESS_ID, null);
  },
};
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: built successfully, no TS errors.

- [ ] **Step 4: Commit**

```bash
git add src/systems/mountJoystick.ts
git commit -m "feat(ui): joystick cluster layout + restyled dash button with cooldown ring"
```

---

## Task 8: GameScene PLACE button restyle + handedness

**Files:**
- Modify: `src/scenes/GameScene.ts`

The mobile PLACE button currently sits top-center (line ~330). Move it to the control cluster's `place` anchor and restyle it.

- [ ] **Step 1: Replace the mobile PLACE button block**

Replace the `if (im.isMobile) { this.placeBtnBg = ... top-center ... }` block with cluster-anchored placement:

```typescript
if (im.isMobile) {
  const layout = controlClusterLayout(getJoystickSide(), logicalWidth(this), logicalHeight(this), {
    joyRadius: JOYSTICK_RADIUS, joyMargin: JOYSTICK_MARGIN, dashRadius: DASH_BUTTON_RADIUS,
    placeW: HUD_PLACE_W, placeH: HUD_PLACE_H, placeGap: HUD_PLACE_GAP,
  });
  const px = layout.place.x, py = layout.place.y;

  this.placeBtnBg = this.add.rectangle(px, py, HUD_PLACE_W, HUD_PLACE_H, 0xff9012, 0.95)
    .setScrollFactor(0).setDepth(40).setVisible(false)
    .setStrokeStyle(2, 0xffffff, 0.5);
  this.placeBtnBg.setInteractive({ useHandCursor: true });
  this.placeBtnBg.on('pointerdown', () => im.startPlace());
  this.placeBtnBg.on('pointerup',   () => im.endPlace());
  this.placeBtnBg.on('pointerout',  () => im.endPlace());

  this.placeBtnLabel = this.add.text(px, py, 'PLACE', {
    fontSize: '15px', color: '#241200', fontStyle: 'bold',
  }).setOrigin(0.5).setScrollFactor(0).setDepth(41).setVisible(false);

  this.topZoneText = this.add.text(0, 0, '').setVisible(false);
  addToGameplayUi(this, [this.placeBtnBg, this.placeBtnLabel, this.topZoneText]);

  // Suppress taps on the PLACE button so they never leak into a gesture.
  im.setSuppressionRect('place', {
    x: px - HUD_PLACE_W / 2, y: py - HUD_PLACE_H / 2, w: HUD_PLACE_W, h: HUD_PLACE_H,
  });
}
```

- [ ] **Step 2: Add imports**

```typescript
import { controlClusterLayout } from '../ui/hudLogic';
import { getJoystickSide } from '../systems/SaveData';
import { JOYSTICK_RADIUS, JOYSTICK_MARGIN, DASH_BUTTON_RADIUS,
         HUD_PLACE_W, HUD_PLACE_H, HUD_PLACE_GAP } from '../constants';
```
(Skip any already imported.)

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: built successfully, no TS errors.

- [ ] **Step 4: Commit**

```bash
git add src/scenes/GameScene.ts
git commit -m "feat(ui): PLACE button restyled + anchored to the control cluster"
```

---

## Task 9: JoystickController visual polish

**Files:**
- Modify: `src/systems/JoystickController.ts`

Behavior unchanged — only the base/thumb visuals. The rex plugin drives an `Arc` base + thumb today; we layer cosmetic graphics on top at the same position.

- [ ] **Step 1: Add a dashed guide ring and richer thumb**

In the constructor, after creating `this.base`/`this.thumb`, restyle:

```typescript
// Base: keep the rex-driven arc but soften it; add a faint dashed 8-dir guide.
this.base.setFillStyle(0x14182c, 0.42).setStrokeStyle(2, 0xffffff, 0.28);
const guide = scene.add.circle(x, y, JOYSTICK_RADIUS - 8)
  .setStrokeStyle(1, 0xffffff, 0.14).setScrollFactor(0).setDepth(40);
// Thumb: brighter, with a subtle inner highlight ring.
this.thumb.setFillStyle(0x4f63e6, 0.95);
const thumbHi = scene.add.circle(x, y, JOYSTICK_RADIUS * 0.42 - 4)
  .setStrokeStyle(2, 0x9db4ff, 0.6).setScrollFactor(0).setDepth(42);
addToGameplayUi(scene, [guide, thumbHi]);
```

Note: the guide is static (the base is `fixed: true`), and `thumbHi` is decorative — rex moves `this.thumb` but not `thumbHi`; keep `thumbHi` at the base center as a static accent (acceptable — the moving thumb already reads as the stick). If a moving highlight is wanted, that's a follow-up.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: built successfully, no TS errors.

- [ ] **Step 3: Commit**

```bash
git add src/systems/JoystickController.ts
git commit -m "feat(ui): joystick base/thumb visual polish (guide ring + highlight)"
```

---

## Task 10: Visual smoke across the matrix + finalize

**Files:** none (verification only)

- [ ] **Step 1: Build + full test suite**

Run: `npm run build && npm test`
Expected: build clean, all tests pass.

- [ ] **Step 2: Visual smoke via the live dev server**

With the dev server running (localhost:3000), use Playwright + `window.game` to load each configuration and screenshot. Verify for each:
- **No overlap** between controls and status (the original bug).
- **Legibility** of all UI over both the blue (top) and brown (bottom) background.
- **Dash cooldown shows in exactly one place** per mode (tray bar vs button ring).
- Score chip centered; ability tray top-left; pause + bag top-right; revive badge appears below score when armed.

Matrix to check (both `GameScene` and `InfiniteGameScene`):
1. Desktop (no touch) — tray dash bar present, no bottom controls.
2. Mobile tilt — tray dash bar present, no dash button.
3. Mobile joystick, side=left — stick bottom-left, dash+place bottom-right, tray has NO dash bar.
4. Mobile joystick, side=right — mirrored.

Use the project's scene-preview tooling and/or drive the scene as in prior sessions. Capture before/after screenshots for the PR.

- [ ] **Step 3: Update Todo/Bugs.md**

Mark the in-game UI redesign / joystick-overlap item resolved in `Todo/Bugs.md` (remove or check off the Gameplay bullet).

- [ ] **Step 4: Final commit + open PR**

```bash
git add -A
git commit -m "chore(ui): mark in-game UI redesign complete in Bugs.md"
git push -u origin feat/in-game-ui-redesign
gh pr create --base main --title "feat: in-game UI redesign (Clean Arcade) + joystick overlap fix" --body "Implements docs/superpowers/specs/2026-06-15-in-game-ui-redesign-design.md. Status-on-top / controls-on-bottom layout resolves the joystick/UI overlap; unified HUD across both gameplay scenes; ability tray (cloud+pips + slim dash bar), restyled PLACE/dash/joystick, legibility scrims. Pending device smoke test."
```

---

## Self-Review

**Spec coverage:**
- §1 overlap fix → Tasks 5–8 (status moved to top strip; cluster repositioned). ✓
- §3 Clean Arcade visuals → Tasks 2 (theme), 3, 4, 7, 8, 9. ✓
- §4.1 ability tray (cloud+pips, wall-jump, dash bar) → Task 3. ✓
- §4.2 unified score chip → Task 4 (HUD owns it), 5–6 (scenes feed it). ✓
- §4.3 pause restyle, shared → Task 4. ✓
- §4.4 revive badge relocation → Task 4. ✓
- §4.5 PLACE restyle + anchor + suppression → Task 8. ✓
- §4.6 joystick polish → Task 9. ✓
- §4.7 dash button + cooldown ring → Task 7. ✓
- §5 dash display rule → Task 1 (`showDashIndicator`), consumed in Tasks 4–6. ✓
- §6 handedness mirror of whole cluster → Task 1 (`controlClusterLayout`), Tasks 7–8. ✓
- §7 shared modules → Tasks 1–4. ✓
- §8 scrims + DPR texture baking → Tasks 2, 4. ✓
- §9 testing → Task 1 unit tests; Task 10 visual matrix. ✓
- **Gap noted:** hotbar bag relocation (not in spec) — decided in Task 4 (top strip, left of pause), flagged for review.

**Placeholder scan:** All steps contain complete, runnable code. No TBD/TODO, no discarded drafts. (A confusing draft snippet originally in Task 7 Step 2 was removed.)

**Type consistency:** `showDashIndicator`, `airJumpPipStates`, `dashBarFillFraction`, `controlClusterLayout` signatures match between Task 1 and their consumers (Tasks 4–8). `HUD` constructor options object (`HudOptions`) is used consistently in Tasks 4–6. `hud.setScore(string)` defined in Task 4, called in Tasks 5–6.

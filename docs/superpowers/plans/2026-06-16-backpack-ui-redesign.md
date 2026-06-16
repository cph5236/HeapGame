# Backpack UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the in-game backpack / item-picker tray to match the "Clean Arcade" HUD theme and add a "BACKPACK" title, as a purely visual change.

**Architecture:** The tray lives in `src/systems/PlaceableManager.ts` (`createUI` builds the objects; `refreshHotbar` lays them out on each open/scroll). We extract the layout math into a pure, unit-tested function (`hotbarLayout.ts`), draw all panel/slot chrome with a single `Phaser.GameObjects.Graphics` redrawn only on open/scroll (rounded corners, accent stripes, qty pills), keep transparent interactive `Rectangle`s as hit areas, and reuse `HUD_THEME` + a shared per-item `ACCENT_COLORS` map.

**Tech Stack:** Phaser 3.90, TypeScript 5.9, Vitest. Graphics drawn at logical coordinates (the game uses `Scale.NONE` + camera zoom for DPR, so no per-object DPR scaling is needed for live Graphics).

---

## Deviations from the design spec (read first)

1. **No persistent "selected" ring.** The spec/mockup showed a selected slot with an
   orange ring. In the real flow `selectItem` fires immediately on tap (consumables
   activate & close; placeables switch to placement mode and hide the tray), so there
   is no moment where a slot is "selected" while the tray is visible. The approved
   orange/amber accent is instead carried by the **amber qty pill badges**
   (`HUD_THEME.textAccent`). No selection state is implemented.
2. **Rounded chrome via a live `Graphics`**, redrawn only inside `refreshHotbar`
   (open/scroll — not per-frame), rather than `makePanel`'s baked textures, because the
   panel width is dynamic. This still satisfies the "no per-frame Graphics" guidance.

## File structure

- **Create** `src/data/itemAccents.ts` — single source of truth for per-item accent
  colors (moved out of `StoreScene`).
- **Create** `src/systems/__tests__/itemAccents.test.ts` — asserts coverage.
- **Create** `src/systems/hotbarLayout.ts` — pure layout math + dimension constants.
- **Create** `src/systems/__tests__/hotbarLayout.test.ts` — layout unit tests.
- **Modify** `src/scenes/StoreScene.ts` — import `ACCENT_COLORS` from `itemAccents`.
- **Modify** `src/systems/PlaceableManager.ts` — `createUI` + `refreshHotbar` restyle.

---

## Task 1: Shared per-item accent color map

**Files:**
- Create: `src/data/itemAccents.ts`
- Test: `src/systems/__tests__/itemAccents.test.ts`
- Modify: `src/scenes/StoreScene.ts:22-31` (remove local map), `src/scenes/StoreScene.ts:4` (add import)

- [ ] **Step 1: Write the failing test**

```ts
// src/systems/__tests__/itemAccents.test.ts
import { describe, it, expect } from 'vitest';
import { ACCENT_COLORS } from '../../data/itemAccents';
import { ITEM_DEFS } from '../../data/itemDefs';

describe('ACCENT_COLORS', () => {
  it('has a color for every item def', () => {
    for (const def of ITEM_DEFS) {
      expect(ACCENT_COLORS[def.id], `missing accent for ${def.id}`).toBeTypeOf('number');
    }
  });

  it('values are valid 24-bit colors', () => {
    for (const c of Object.values(ACCENT_COLORS)) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(0xffffff);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/systems/__tests__/itemAccents.test.ts`
Expected: FAIL — cannot find module `../../data/itemAccents`.

- [ ] **Step 3: Create the shared module**

```ts
// src/data/itemAccents.ts
import type { ItemId } from '../../shared/itemIds';

/** Per-item accent color (0xRRGGBB). Single source of truth shared by the store
 *  rows and the in-game backpack tray. */
export const ACCENT_COLORS: Record<ItemId, number> = {
  ladder:     0x44cc88,
  ibeam:      0x4488ff,
  checkpoint: 0xffaa22,
  shield:     0xcc44ff,
  revive:     0xff5577,
  adrenaline: 0xff7733,
  pogo:       0x33ddff,
  stall:      0xaa88ff,
};
```

> If `ItemId` is a union that the compiler says is missing keys (or has extra
> keys), reconcile against `shared/itemIds.ts` — every id there must appear here.
> If `Record<ItemId, number>` is too strict for ids without a color, fall back to
> `Record<string, number>` to match the original.

- [ ] **Step 4: Point StoreScene at the shared map**

In `src/scenes/StoreScene.ts`, delete the local `const ACCENT_COLORS = { ... }`
block (lines ~22-31) and add to the existing imports near line 4:

```ts
import { ACCENT_COLORS } from '../data/itemAccents';
```

Leave the `ACCENT_COLORS[def.id] ?? 0x888888` usage at line ~238 unchanged.

- [ ] **Step 5: Run tests + build**

Run: `npx vitest run src/systems/__tests__/itemAccents.test.ts && npm run build`
Expected: test PASS; build succeeds with no TS errors.

- [ ] **Step 6: Commit**

```bash
git add src/data/itemAccents.ts src/systems/__tests__/itemAccents.test.ts src/scenes/StoreScene.ts
git commit -m "refactor: extract shared ACCENT_COLORS to itemAccents module"
```

---

## Task 2: Pure hotbar layout function

Extracts the tray geometry (panel rect, slot positions, scroll-button positions
and visibility) so it can be unit-tested independent of Phaser. New slot
dimensions (64×58) and a header band are baked into the constants here.

**Files:**
- Create: `src/systems/hotbarLayout.ts`
- Test: `src/systems/__tests__/hotbarLayout.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/systems/__tests__/hotbarLayout.test.ts
import { describe, it, expect } from 'vitest';
import { computeHotbarLayout, HOTBAR } from '../hotbarLayout';

describe('computeHotbarLayout', () => {
  it('lays out a few items with no scroll arrows', () => {
    const L = computeHotbarLayout({ gameWidth: 448, gameHeight: 970, ownedCount: 3, scrollOffset: 0 });
    expect(L.visibleCount).toBe(3);
    expect(L.showLeft).toBe(false);
    expect(L.showRight).toBe(false);
    expect(L.slotCxs).toHaveLength(3);
    // slots are evenly spaced by the stride
    expect(L.slotCxs[1] - L.slotCxs[0]).toBeCloseTo(HOTBAR.slotStride);
    // panel sits above the PLACE/CANCEL row (bottom edge at gameHeight - bottomMargin)
    expect(L.panelCy + L.panelH / 2).toBeCloseTo(970 - HOTBAR.bottomMargin);
    // header is above the slot row
    expect(L.headerCy).toBeLessThan(L.slotCy);
  });

  it('shows scroll arrows and clamps offset when items overflow', () => {
    const L = computeHotbarLayout({ gameWidth: 448, gameHeight: 970, ownedCount: 8, scrollOffset: 99 });
    expect(L.visibleCount).toBeLessThan(8);
    expect(L.showRight).toBe(false);            // clamped to the last page
    expect(L.showLeft).toBe(true);
    expect(L.scrollOffset).toBe(8 - L.visibleCount);
    expect(L.leftBtnCx).toBeLessThan(L.slotCxs[0]);
    expect(L.rightBtnCx).toBeGreaterThan(L.slotCxs[L.slotCxs.length - 1]);
  });

  it('first page of an overflow shows only the right arrow', () => {
    const L = computeHotbarLayout({ gameWidth: 448, gameHeight: 970, ownedCount: 8, scrollOffset: 0 });
    expect(L.showLeft).toBe(false);
    expect(L.showRight).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/systems/__tests__/hotbarLayout.test.ts`
Expected: FAIL — cannot find module `../hotbarLayout`.

- [ ] **Step 3: Implement the layout module**

```ts
// src/systems/hotbarLayout.ts

/** Tray dimension constants (logical px). */
export const HOTBAR = {
  slotW: 64, slotH: 58, slotGap: 7, slotStride: 71,   // stride = slotW + slotGap
  headerH: 22, padX: 11, padTop: 8, padBottom: 11,
  scrollBtnW: 26, scrollBtnGap: 7,
  bottomMargin: 80,        // panel bottom edge = gameHeight - bottomMargin
  cornerRadius: 12,
  slotRadius: 9,
  stripeH: 6,
} as const;

export interface HotbarLayoutParams {
  gameWidth:    number;
  gameHeight:   number;
  ownedCount:   number;
  scrollOffset: number;
}

export interface HotbarLayout {
  panelCx: number; panelCy: number; panelW: number; panelH: number;
  headerCy: number;            // y-center for the BACKPACK title
  slotCy:   number;            // y-center of the slot row
  slotCxs:  number[];          // x-center per visible slot (left→right)
  visibleCount: number;
  scrollOffset: number;        // clamped to a valid page
  showLeft: boolean; showRight: boolean;
  leftBtnCx: number; rightBtnCx: number;
}

/** Max slots that fit, always reserving room for both scroll buttons so the
 *  layout width stays stable whether or not arrows are currently shown. */
function maxVisible(gameWidth: number): number {
  const reserved = 2 * HOTBAR.padX + 2 * (HOTBAR.scrollBtnW + HOTBAR.scrollBtnGap);
  const avail = gameWidth - reserved + HOTBAR.slotGap; // +gap: last slot has no trailing gap
  return Math.max(1, Math.floor(avail / HOTBAR.slotStride));
}

export function computeHotbarLayout(p: HotbarLayoutParams): HotbarLayout {
  const mv          = maxVisible(p.gameWidth);
  const needsScroll = p.ownedCount > mv;
  const maxOffset   = Math.max(0, p.ownedCount - mv);
  const scrollOffset = Math.min(Math.max(0, p.scrollOffset), maxOffset);
  const visibleCount = Math.min(p.ownedCount, mv);

  const scrollSpace = needsScroll ? 2 * (HOTBAR.scrollBtnW + HOTBAR.scrollBtnGap) : 0;
  const slotsW      = Math.max(0, visibleCount * HOTBAR.slotStride - HOTBAR.slotGap);
  const panelW      = Math.min(slotsW + 2 * HOTBAR.padX + scrollSpace, p.gameWidth - 10);
  const panelH      = HOTBAR.headerH + HOTBAR.padTop + HOTBAR.slotH + HOTBAR.padBottom;

  const panelCx = p.gameWidth / 2;
  const panelBottom = p.gameHeight - HOTBAR.bottomMargin;
  const panelTop    = panelBottom - panelH;
  const panelCy     = panelTop + panelH / 2;

  const headerCy = panelTop + HOTBAR.headerH / 2;
  const slotCy   = panelTop + HOTBAR.headerH + HOTBAR.padTop + HOTBAR.slotH / 2;

  const leftEdge   = panelCx - panelW / 2;
  const rightEdge  = panelCx + panelW / 2;
  const startX = leftEdge + HOTBAR.padX
    + (needsScroll ? HOTBAR.scrollBtnW + HOTBAR.scrollBtnGap : 0)
    + HOTBAR.slotW / 2;

  const slotCxs: number[] = [];
  for (let i = 0; i < visibleCount; i++) slotCxs.push(startX + i * HOTBAR.slotStride);

  return {
    panelCx, panelCy, panelW, panelH, headerCy, slotCy, slotCxs,
    visibleCount, scrollOffset,
    showLeft:  needsScroll && scrollOffset > 0,
    showRight: needsScroll && scrollOffset < maxOffset,
    leftBtnCx:  leftEdge + HOTBAR.padX + HOTBAR.scrollBtnW / 2,
    rightBtnCx: rightEdge - HOTBAR.padX - HOTBAR.scrollBtnW / 2,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/systems/__tests__/hotbarLayout.test.ts`
Expected: PASS (all 3 cases).

- [ ] **Step 5: Commit**

```bash
git add src/systems/hotbarLayout.ts src/systems/__tests__/hotbarLayout.test.ts
git commit -m "feat: pure hotbar layout function with tests"
```

---

## Task 3: Restyle `createUI` — Graphics chrome, title, transparent slots

Replace the opaque purple panel + per-slot visible rectangles with: one Graphics
object for all chrome, a "BACKPACK" title, and transparent interactive hit-area
rectangles. Names/qty/scroll-glyph text objects are retained.

**Files:**
- Modify: `src/systems/PlaceableManager.ts` (fields ~61-70; `createUI` ~155-266)

- [ ] **Step 1: Update fields**

Replace the hotbar field block (lines ~61-70) with:

```ts
  private hotbarGfx!:          Phaser.GameObjects.Graphics;
  private hotbarTitle!:        Phaser.GameObjects.Text;
  private hotbarItems:         Phaser.GameObjects.Rectangle[] = [];  // transparent hit areas
  private hotbarLabels:        Phaser.GameObjects.Text[] = [];
  private hotbarQtys:          Phaser.GameObjects.Text[] = [];
  private hotbarScrollOffset:  number = 0;
  private hotbarOwnedIds:      string[] = [];
  private scrollLeftBtn!:      Phaser.GameObjects.Rectangle;  // transparent hit area
  private scrollLeftTxt!:      Phaser.GameObjects.Text;
  private scrollRightBtn!:     Phaser.GameObjects.Rectangle;  // transparent hit area
  private scrollRightTxt!:     Phaser.GameObjects.Text;
```

(`hotbarBg` is removed.)

- [ ] **Step 2: Add imports**

Ensure these are imported at the top of the file (add what's missing):

```ts
import { HUD_THEME } from '../ui/hudTheme';
import { ACCENT_COLORS } from '../data/itemAccents';
import { computeHotbarLayout, HOTBAR } from './hotbarLayout';
```

- [ ] **Step 3: Rewrite the hotbar half of `createUI`**

In `createUI`, replace everything from the `// Hotbar background panel` comment
(line ~173) through the end of the scroll-button construction (line ~224) with:

```ts
    // Chrome for the whole tray is drawn in one Graphics, redrawn in refreshHotbar.
    this.hotbarGfx = scene.add.graphics().setScrollFactor(0).setDepth(25).setVisible(false);

    // Title
    this.hotbarTitle = scene.add.text(0, 0, 'BACKPACK', {
      fontSize: '11px', color: HUD_THEME.textWhite, fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 1,
    }).setOrigin(0.5).setLetterSpacing(2).setScrollFactor(0).setDepth(27).setVisible(false);

    // Per-item: transparent interactive hit area + name + qty (positions set in refreshHotbar)
    ITEM_DEFS.forEach((def) => {
      const slot = scene.add.rectangle(0, 0, HOTBAR.slotW, HOTBAR.slotH, 0x000000, 0)
        .setScrollFactor(0).setDepth(26)
        .setVisible(false)
        .setInteractive({ useHandCursor: true });

      const label = scene.add.text(0, 0, def.name, {
        fontSize: '11px', color: '#ffffff', stroke: '#000000', strokeThickness: 2,
        align: 'center', wordWrap: { width: HOTBAR.slotW - 8 },
      }).setOrigin(0.5).setScrollFactor(0).setDepth(27).setVisible(false);

      const qty = scene.add.text(0, 0, '', {
        fontSize: '11px', color: '#0a0c1a', fontStyle: 'bold',
      }).setOrigin(1, 0).setScrollFactor(0).setDepth(28).setVisible(false);

      slot.on('pointerup', () => this.selectItem(def.id));

      this.hotbarItems.push(slot);
      this.hotbarLabels.push(label);
      this.hotbarQtys.push(qty);
    });

    // Scroll buttons — transparent hit areas; chrome + glyph drawn/positioned in refreshHotbar
    this.scrollLeftBtn = scene.add.rectangle(0, 0, HOTBAR.scrollBtnW, HOTBAR.slotH, 0x000000, 0)
      .setScrollFactor(0).setDepth(27).setInteractive({ useHandCursor: true }).setVisible(false);
    this.scrollLeftTxt = scene.add.text(0, 0, '◀', {
      fontSize: '15px', color: '#aabbff', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(28).setVisible(false);
    this.scrollLeftBtn.on('pointerup', () => {
      this.hotbarScrollOffset = Math.max(0, this.hotbarScrollOffset - 1);
      this.refreshHotbar();
    });

    this.scrollRightBtn = scene.add.rectangle(0, 0, HOTBAR.scrollBtnW, HOTBAR.slotH, 0x000000, 0)
      .setScrollFactor(0).setDepth(27).setInteractive({ useHandCursor: true }).setVisible(false);
    this.scrollRightTxt = scene.add.text(0, 0, '▶', {
      fontSize: '15px', color: '#aabbff', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(28).setVisible(false);
    this.scrollRightBtn.on('pointerup', () => {
      const maxOffset = Math.max(0, this.hotbarOwnedIds.length - this.hotbarMaxVisibleCount());
      this.hotbarScrollOffset = Math.min(maxOffset, this.hotbarScrollOffset + 1);
      this.refreshHotbar();
    });
```

> `setLetterSpacing` exists on Phaser 3.90 `Text`. If the TS types reject it,
> drop that call (cosmetic only) — do not block on it.

- [ ] **Step 4: Update the camera registration list**

In the `addToGameplayUi(scene, [ ... ])` call at the end of `createUI` (line ~261),
replace `this.hotbarBg` with `this.hotbarGfx, this.hotbarTitle`:

```ts
    addToGameplayUi(scene, [
      this.hotbarGfx, this.hotbarTitle, ...this.hotbarItems, ...this.hotbarLabels, ...this.hotbarQtys,
      this.scrollLeftBtn, this.scrollLeftTxt, this.scrollRightBtn, this.scrollRightTxt,
      this.confirmBtn, this.confirmTxt, this.cancelBtn, this.cancelTxt, this.statusLabel,
    ]);
```

- [ ] **Step 5: Build to verify the file compiles**

Run: `npm run build`
Expected: build fails ONLY at `refreshHotbar`/`setHotbarVisible`/`hotbarMaxVisible`
references that Task 4 rewrites (e.g. `hotbarBg` no longer exists,
`hotbarMaxVisibleCount` not yet defined). That is expected — Task 4 fixes them.
If errors appear anywhere else, fix them before moving on.

- [ ] **Step 6: Commit (with Task 4)** — `createUI` and `refreshHotbar` change
together; commit at the end of Task 4.

---

## Task 4: Rewrite `refreshHotbar` + `setHotbarVisible` to draw the chrome

**Files:**
- Modify: `src/systems/PlaceableManager.ts` — `hotbarMaxVisible` (~616), `refreshHotbar`
  (~621-676), `setHotbarVisible` (~678-690)

- [ ] **Step 1: Replace `hotbarMaxVisible` with a thin wrapper**

Replace the `private hotbarMaxVisible()` method (lines ~616-619) with:

```ts
  private hotbarMaxVisibleCount(): number {
    return computeHotbarLayout({
      gameWidth: logicalWidth(this.scene), gameHeight: logicalHeight(this.scene),
      ownedCount: this.hotbarOwnedIds.length, scrollOffset: this.hotbarScrollOffset,
    }).visibleCount;
  }
```

- [ ] **Step 2: Rewrite `refreshHotbar`**

Replace the whole `refreshHotbar` method (lines ~621-676) with:

```ts
  private refreshHotbar(): void {
    const GAME_WIDTH  = logicalWidth(this.scene);
    const GAME_HEIGHT = logicalHeight(this.scene);

    // Only show items the player owns (qty > 0), respecting checkpoint exclusion.
    this.hotbarOwnedIds = ITEM_DEFS
      .filter(def => !(this._excludeCheckpoint && def.id === 'checkpoint'))
      .filter(def => getItemQuantity(def.id) > 0)
      .map(def => def.id);

    const L = computeHotbarLayout({
      gameWidth: GAME_WIDTH, gameHeight: GAME_HEIGHT,
      ownedCount: this.hotbarOwnedIds.length, scrollOffset: this.hotbarScrollOffset,
    });
    this.hotbarScrollOffset = L.scrollOffset;

    // Hide all per-item objects first.
    ITEM_DEFS.forEach((_, i) => {
      this.hotbarItems[i]?.setVisible(false);
      this.hotbarLabels[i]?.setVisible(false);
      this.hotbarQtys[i]?.setVisible(false);
    });

    // ── Draw chrome ────────────────────────────────────────────────────────────
    const g = this.hotbarGfx;
    g.clear();
    g.setVisible(true);

    const panelX = L.panelCx - L.panelW / 2;
    const panelY = L.panelCy - L.panelH / 2;

    // Panel
    g.fillStyle(HUD_THEME.panelFill, 0.55);
    g.fillRoundedRect(panelX, panelY, L.panelW, L.panelH, HOTBAR.cornerRadius);
    g.lineStyle(1, HUD_THEME.border, 0.18);
    g.strokeRoundedRect(panelX, panelY, L.panelW, L.panelH, HOTBAR.cornerRadius);
    // Header divider
    const divY = panelY + HOTBAR.headerH;
    g.lineStyle(1, HUD_THEME.border, 0.12);
    g.lineBetween(panelX + 8, divY, panelX + L.panelW - 8, divY);

    this.hotbarTitle.setPosition(L.panelCx, L.headerCy).setVisible(true);

    // Slots
    const visibleIds = this.hotbarOwnedIds.slice(L.scrollOffset, L.scrollOffset + L.visibleCount);
    visibleIds.forEach((itemId, vi) => {
      const defIdx = ITEM_DEFS.findIndex(d => d.id === itemId);
      if (defIdx < 0) return;
      const cx = L.slotCxs[vi];
      const sx = cx - HOTBAR.slotW / 2;
      const sy = L.slotCy - HOTBAR.slotH / 2;
      const qty = getItemQuantity(itemId);

      // slot body
      g.fillStyle(0xffffff, 0.06);
      g.fillRoundedRect(sx, sy, HOTBAR.slotW, HOTBAR.slotH, HOTBAR.slotRadius);
      g.lineStyle(1, 0xffffff, 0.14);
      g.strokeRoundedRect(sx, sy, HOTBAR.slotW, HOTBAR.slotH, HOTBAR.slotRadius);
      // accent stripe (top corners rounded only)
      g.fillStyle(ACCENT_COLORS[itemId] ?? 0x888888, 1);
      g.fillRoundedRect(sx, sy, HOTBAR.slotW, HOTBAR.stripeH,
        { tl: HOTBAR.slotRadius, tr: HOTBAR.slotRadius, bl: 0, br: 0 });

      // hit area + name
      this.hotbarItems[defIdx]?.setPosition(cx, L.slotCy).setVisible(true);
      this.hotbarLabels[defIdx]?.setPosition(cx, L.slotCy + 6).setVisible(true);

      // qty pill (top-right) — size to the text
      const qtyTxt = this.hotbarQtys[defIdx];
      if (qtyTxt) {
        qtyTxt.setText(`×${qty}`);
        const pillRight = sx + HOTBAR.slotW - 4;
        const pillTop   = sy + 4;
        const pillW = qtyTxt.width + 8;
        const pillH = qtyTxt.height + 2;
        g.fillStyle(0xffce8a, 1);
        g.fillRoundedRect(pillRight - pillW, pillTop, pillW, pillH, 6);
        qtyTxt.setPosition(pillRight - 4, pillTop + 1).setVisible(true);
      }
    });

    // Scroll buttons
    const drawBtn = (cx: number, show: boolean,
                     btn: Phaser.GameObjects.Rectangle, txt: Phaser.GameObjects.Text) => {
      btn.setPosition(cx, L.slotCy).setVisible(show);
      txt.setPosition(cx, L.slotCy).setVisible(show);
      if (!show) return;
      const bx = cx - HOTBAR.scrollBtnW / 2;
      const by = L.slotCy - HOTBAR.slotH / 2;
      g.fillStyle(0xffffff, 0.05);
      g.fillRoundedRect(bx, by, HOTBAR.scrollBtnW, HOTBAR.slotH, HOTBAR.slotRadius);
      g.lineStyle(1, 0xffffff, 0.14);
      g.strokeRoundedRect(bx, by, HOTBAR.scrollBtnW, HOTBAR.slotH, HOTBAR.slotRadius);
    };
    drawBtn(L.leftBtnCx,  L.showLeft,  this.scrollLeftBtn,  this.scrollLeftTxt);
    drawBtn(L.rightBtnCx, L.showRight, this.scrollRightBtn, this.scrollRightTxt);
  }
```

> Draw order note: chrome is drawn into `hotbarGfx` (depth 25). The qty pill is
> drawn in the same Graphics, and the qty Text is depth 28, so the number sits on
> top of its pill. Good.

- [ ] **Step 3: Update `setHotbarVisible` to hide the Graphics + title**

In `setHotbarVisible` (lines ~678-690), replace the `if (!visible)` block body with:

```ts
    if (!visible) {
      this.hotbarGfx?.clear();
      this.hotbarGfx?.setVisible(false);
      this.hotbarTitle?.setVisible(false);
      this.hotbarItems.forEach(o => o.setVisible(false));
      this.hotbarLabels.forEach(o => o.setVisible(false));
      this.hotbarQtys.forEach(o => o.setVisible(false));
      this.scrollLeftBtn?.setVisible(false);
      this.scrollLeftTxt?.setVisible(false);
      this.scrollRightBtn?.setVisible(false);
      this.scrollRightTxt?.setVisible(false);
    }
    // visible=true is handled by refreshHotbar()
```

- [ ] **Step 4: Grep for any remaining `hotbarBg` / `hotbarMaxVisible` references**

Run: `grep -n "hotbarBg\|hotbarMaxVisible\b" src/systems/PlaceableManager.ts`
Expected: no matches (the rename to `hotbarMaxVisibleCount` and removal of
`hotbarBg` are complete). Fix any stragglers.

- [ ] **Step 5: Build + run the full test suite**

Run: `npm run build && npm test`
Expected: build passes; all tests green (UI is not unit-tested; the new
`itemAccents` and `hotbarLayout` tests pass).

- [ ] **Step 6: Commit**

```bash
git add src/systems/PlaceableManager.ts
git commit -m "feat: restyle backpack tray to Clean Arcade theme with title"
```

---

## Task 5: Visual verification at phone size

**Files:** none (verification only).

- [ ] **Step 1: Capture the tray with a few items**

Use the `heap-scene-preview` skill to screenshot the gameplay scene with the
backpack open and a small number of owned items (e.g. ladder + i-beam +
checkpoint). Confirm: rounded translucent navy panel, centered "BACKPACK" title
with divider, per-slot accent stripes, amber qty pills in the top-right, names
legible, no overlap with the PLACE/CANCEL row or status label.

- [ ] **Step 2: Capture the overflow state**

Screenshot with enough owned items to trigger scrolling (≥6 distinct items).
Confirm the ◀ / ▶ buttons appear, are styled to match, and that scrolling pages
the items without the panel running off-screen.

- [ ] **Step 3: Check the narrow + wide devices**

Repeat Step 1 on `iphone14` (390 wide) and `desktop` (1280 wide) to confirm the
panel centers and the slot count adapts. Note any clipping.

- [ ] **Step 4: Fix-and-recapture loop**

If anything is misaligned (vertical fit, pill position, stripe rounding), adjust
the constants in `HOTBAR` (Task 2) or the draw code (Task 4), rebuild, and
re-capture until correct. Commit any fixes:

```bash
git add -A && git commit -m "fix: backpack tray visual polish from device review"
```

---

## Self-review notes

- **Spec coverage:** title (Tasks 3-4), theme-matched panel/border (Task 4),
  accent stripes via shared map (Tasks 1, 4), corner qty pill (Task 4), restyled
  scroll arrows (Tasks 3-4), shared `ACCENT_COLORS` (Task 1), reuse of `HUD_THEME`
  (Tasks 3-4), build + scene-preview testing (Tasks 1-5). The spec's "selected
  ring" is intentionally dropped (see Deviations) — orange/amber is carried by the
  qty pills.
- **Behavior unchanged:** item filter, scroll offset semantics, and `selectItem`
  wiring are preserved; only geometry source (now `computeHotbarLayout`) and
  rendering (now Graphics) changed.
- **Type consistency:** `hotbarMaxVisible()` → `hotbarMaxVisibleCount()` renamed
  in both its definition (Task 4) and its caller in the right-scroll handler
  (Task 3). `ACCENT_COLORS` import path identical in `StoreScene` and
  `PlaceableManager`.

# Fullscreen RESIZE Viewport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch Phaser's scale mode to RESIZE so the game canvas fills the full phone screen, showing more of the heap above/below the player on tall phones.

**Architecture:** `index.html` constrains `#game` to `min(100vw, 480px) × 100dvh` via CSS so wide desktop windows stay 480px; Phaser RESIZE fills that container. Every scene and the HUD replace hardcoded `GAME_WIDTH`/`GAME_HEIGHT` constant references with `this.scale.width` / `this.scale.height` (or `scene.scale.*` in non-scene classes). `GAME_WIDTH`/`GAME_HEIGHT` constants remain in `constants.ts` for game-world geometry only.

**Tech Stack:** Phaser 3.90, TypeScript 5.9, Vite 6, Vitest.

---

> **Note on TDD:** This is a pure layout/config refactor with no testable logic changes. There are no failing tests to write first. Each task ends with `npm run test` to catch regressions in the existing 329-test suite.

---

### Task 1: CSS + main.ts — scale config foundation

**Files:**
- Modify: `index.html`
- Modify: `src/main.ts`

- [ ] **Step 1: Update `#game` CSS in `index.html`**

Replace the existing `#game` rule (inside the `<style>` block):

```css
#game {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(100vw, 480px);
  height: 100dvh;
}
```

`width: min(100vw, 480px)` — on mobile fills the screen; on desktop caps at 480px.
`height: 100dvh` — dynamic viewport height handles shrinking mobile browser chrome.

- [ ] **Step 2: Update scale config in `src/main.ts`**

Remove `width: 480,` and `height: 854,` from the game config object. Change the `scale` block to:

```ts
scale: {
  mode: Phaser.Scale.RESIZE,
  autoCenter: Phaser.Scale.NO_CENTER,
},
```

The full updated `config` object (for reference — only these three changes):

```ts
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  backgroundColor: '#5B8FC9',
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 800 },
      debug: false,
    },
  },
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.NO_CENTER,
  },
  render: {
    antialias: true,
    roundPixels: true,
  },
  fps: {
    target: 60,
    smoothStep: true,
  },
  scene: [BootScene, MenuScene, HeapSelectScene, GameScene, ScoreScene, UpgradeScene, StoreScene, InfiniteGameScene, TexturePreviewScene],
  parent: 'game',
};
```

- [ ] **Step 3: Verify build compiles**

```bash
cd /home/connor/Documents/Repos/HeapGame && npm run build
```

Expected: `✓ built in X.XXs` with no errors.

- [ ] **Step 4: Run tests**

```bash
npm run test
```

Expected: all 329 tests passing.

- [ ] **Step 5: Commit**

```bash
git add index.html src/main.ts
git commit -m "feat(scale): switch to RESIZE mode, constrain #game container"
```

---

### Task 2: HUD — dynamic hudY field

**Files:**
- Modify: `src/ui/HUD.ts`

The `HUD` class is not a Phaser.Scene subclass, so it cannot call `this.scale`. It receives `scene: Phaser.Scene` in the constructor. The module-level `const HUD_Y = GAME_HEIGHT - 44` is used in both the constructor and `update()`, so it must become a stored field.

- [ ] **Step 1: Replace module-level constant with class field**

In `src/ui/HUD.ts`:

Remove line 3 import of `GAME_WIDTH, GAME_HEIGHT`:
```ts
// Remove this line:
import { GAME_WIDTH, GAME_HEIGHT } from '../constants';
```

Remove module-level constant (line 6):
```ts
// Remove this line:
const HUD_Y    = GAME_HEIGHT - 44;
```

Add `private readonly hudY: number;` to the class field declarations (after `private dashLeft`):
```ts
private          dashLeft:      number = 0;
private readonly hudY:          number;
```

- [ ] **Step 2: Set hudY in constructor, replace remaining usages**

At the **top** of the constructor body (first line inside the `constructor` block), add:
```ts
this.hudY = scene.scale.height - 44;
```

Replace every remaining occurrence of `HUD_Y` in the file with `this.hudY` — there are usages in the constructor (lines ~45, 50, 68, 81) and in `update()` (line ~117).

Replace `GAME_WIDTH - MARGIN_R` (line ~38) with `scene.scale.width - MARGIN_R`:
```ts
let cursorX = scene.scale.width - MARGIN_R;
```

Replace `GAME_HEIGHT - 44` (bagY at line ~90) with `scene.scale.height - 44`:
```ts
const bagY = scene.scale.height - 44;
```

- [ ] **Step 3: Run tests**

```bash
npm run test
```

Expected: all 329 passing.

- [ ] **Step 4: Commit**

```bash
git add src/ui/HUD.ts
git commit -m "feat(scale): HUD reads screen dimensions dynamically"
```

---

### Task 3: ParallaxBackground — use scene.scale

**Files:**
- Modify: `src/systems/ParallaxBackground.ts`

`ParallaxBackground` stores `this.scene` and already uses it for `add.graphics()`. It just needs to replace imported constants with `this.scene.scale.*` calls.

- [ ] **Step 1: Remove GAME_WIDTH and GAME_HEIGHT imports**

In `src/systems/ParallaxBackground.ts`, remove `GAME_WIDTH` and `GAME_HEIGHT` from the import (lines 3–4). Keep the other constants:

```ts
import {
  WORLD_WIDTH,
  MOCK_HEAP_HEIGHT_PX,
  CLOUD_POOL_SIZE,
  CLOUD_PARALLAX_FACTOR,
  CLOUD_START_WORLD_Y,
} from '../constants';
```

- [ ] **Step 2: Replace GAME_WIDTH/GAME_HEIGHT with scene.scale calls**

In `createCloudPool()` (line ~76–77):
```ts
virtualX: Phaser.Math.Between(-80, this.scene.scale.width + 80),
virtualY: Phaser.Math.Between(-this.scene.scale.height, this.scene.scale.height),
```

In `updateClouds()` — cloud zone check (line ~91):
```ts
const inCloudZone = scrollY + this.scene.scale.height <= CLOUD_START_WORLD_Y;
```

In `updateClouds()` — recycle below screen (line ~105–106):
```ts
if (cloud.virtualY > this.scene.scale.height + 200) {
  cloud.virtualX = Phaser.Math.Between(-60, this.scene.scale.width + 60);
```

In `updateClouds()` — recycle above screen (line ~112–113):
```ts
  cloud.virtualX = Phaser.Math.Between(-60, this.scene.scale.width + 60);
  cloud.virtualY = this.scene.scale.height + Phaser.Math.Between(20, 200);
```

- [ ] **Step 3: Run tests**

```bash
npm run test
```

Expected: all 329 passing.

- [ ] **Step 4: Commit**

```bash
git add src/systems/ParallaxBackground.ts
git commit -m "feat(scale): ParallaxBackground reads screen dimensions from scene.scale"
```

---

### Task 4: GameScene — dynamic UI positioning

**Files:**
- Modify: `src/scenes/GameScene.ts`

All `GAME_WIDTH`/`GAME_HEIGHT` usages in `GameScene` are UI layout (score text, buttons, overlays, hold bar). The `physics.world.setBounds` uses `WORLD_WIDTH` and `this._worldHeight` — unchanged. Use `this.scale.width` and `this.scale.height` inline everywhere.

- [ ] **Step 1: Remove GAME_WIDTH and GAME_HEIGHT from imports**

In `src/scenes/GameScene.ts`, remove `GAME_WIDTH` and `GAME_HEIGHT` from the constants import block (lines 14–15). Keep all other imports from `'../constants'`.

- [ ] **Step 2: Replace all GAME_WIDTH → this.scale.width and GAME_HEIGHT → this.scale.height**

The usages to replace (line numbers are approximate — verify in editor):

| Original | Replacement |
|---|---|
| `this.add.text(GAME_WIDTH / 2, 30, ...)` | `this.add.text(this.scale.width / 2, 30, ...)` |
| `this.add.rectangle(GAME_WIDTH / 2, 82, ...)` | `this.add.rectangle(this.scale.width / 2, 82, ...)` |
| `this.add.text(GAME_WIDTH / 2, 82, ...)` ×2 | `this.add.text(this.scale.width / 2, 82, ...)` |
| `this._drawHoldBar(progress, GAME_WIDTH / 2 - 134, ...)` | `this._drawHoldBar(progress, this.scale.width / 2 - 134, ...)` |
| `this._drawHoldBar(progress, GAME_WIDTH / 2 - 100, ...)` | `this._drawHoldBar(progress, this.scale.width / 2 - 100, ...)` |
| `const bx = GAME_WIDTH - 22` | `const bx = this.scale.width - 22` |
| `this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, ...)` | `this.add.rectangle(this.scale.width / 2, this.scale.height / 2, this.scale.width, this.scale.height, ...)` |
| `this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 380, 320, ...)` | `this.add.rectangle(this.scale.width / 2, this.scale.height / 2, 380, 320, ...)` |
| `this.add.text(GAME_WIDTH / 2 - 160, GAME_HEIGHT / 2 - 120, ...)` | `this.add.text(this.scale.width / 2 - 160, this.scale.height / 2 - 120, ...)` |

Do a final grep on the file to confirm no `GAME_WIDTH` or `GAME_HEIGHT` remain:
```bash
grep -n "GAME_WIDTH\|GAME_HEIGHT" src/scenes/GameScene.ts
```
Expected: no output.

- [ ] **Step 3: Run tests**

```bash
npm run test
```

Expected: all 329 passing.

- [ ] **Step 4: Commit**

```bash
git add src/scenes/GameScene.ts
git commit -m "feat(scale): GameScene UI positions use dynamic screen dimensions"
```

---

### Task 5: MenuScene — dynamic UI positioning

**Files:**
- Modify: `src/scenes/MenuScene.ts`

All `GAME_WIDTH`/`GAME_HEIGHT` usages are UI layout (background strips, stars, buttons, overlays).

- [ ] **Step 1: Remove GAME_WIDTH and GAME_HEIGHT from imports**

In `src/scenes/MenuScene.ts`, remove `GAME_WIDTH` and `GAME_HEIGHT` from the constants import.

- [ ] **Step 2: Replace all GAME_WIDTH → this.scale.width and GAME_HEIGHT → this.scale.height**

Replace all occurrences throughout the file. Key usages to check:
- Background strip fills: `g.fillRect(0, y, GAME_WIDTH, h)` → `g.fillRect(0, y, this.scale.width, h)`
- Star/particle X positions: `Phaser.Math.Between(0, GAME_WIDTH)` → `Phaser.Math.Between(0, this.scale.width)`
- Horizon glow: `GAME_WIDTH / 2` → `this.scale.width / 2`
- All button/text X center positions: `GAME_WIDTH / 2` → `this.scale.width / 2`
- Bottom-anchored elements: `GAME_HEIGHT - 52`, `GAME_HEIGHT - 22` → `this.scale.height - 52`, `this.scale.height - 22`
- Overlay/panel positioning: `GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT` → `this.scale.width / 2, this.scale.height / 2, this.scale.width, this.scale.height`
- Off-screen slide targets: `GAME_WIDTH + offscreen` and `-offscreen` vs `GAME_WIDTH + offscreen` → `this.scale.width + offscreen`

Verify with:
```bash
grep -n "GAME_WIDTH\|GAME_HEIGHT" src/scenes/MenuScene.ts
```
Expected: no output.

- [ ] **Step 3: Run tests**

```bash
npm run test
```

Expected: all 329 passing.

- [ ] **Step 4: Commit**

```bash
git add src/scenes/MenuScene.ts
git commit -m "feat(scale): MenuScene UI positions use dynamic screen dimensions"
```

---

### Task 6: ScoreScene — move module-level CX, dynamic positioning

**Files:**
- Modify: `src/scenes/ScoreScene.ts`

`ScoreScene` has a **module-level** `const CX = GAME_WIDTH / 2` (line 22) used across many methods. Since it's computed at import time with the old constant, it must be replaced with `this.scale.width / 2` inline everywhere `CX` appears.

- [ ] **Step 1: Remove module-level CX and GAME_WIDTH/GAME_HEIGHT imports**

In `src/scenes/ScoreScene.ts`:

Remove line 22:
```ts
// Remove:
const CX = GAME_WIDTH / 2;
```

Remove `GAME_WIDTH` and `GAME_HEIGHT` from the line 2 import (keep `SCORE_TO_COINS_DIVISOR` and `LEADERBOARD_TOP_N`):
```ts
import { SCORE_TO_COINS_DIVISOR, LEADERBOARD_TOP_N } from '../constants';
```

- [ ] **Step 2: Replace CX with this.scale.width / 2 and GAME_HEIGHT with this.scale.height**

Replace every `CX` occurrence with `this.scale.width / 2`.

Replace every `GAME_WIDTH` occurrence with `this.scale.width` and every `GAME_HEIGHT` occurrence with `this.scale.height`.

Key usages:
- Background fills: `g.fillRect(0, y, GAME_WIDTH, h)` → `g.fillRect(0, y, this.scale.width, h)`
- Panel width: `const PANEL_W = GAME_WIDTH * 0.88` → `const PANEL_W = this.scale.width * 0.88`
- Panel top: `const PANEL_TOP = GAME_HEIGHT * 0.32` → `const PANEL_TOP = this.scale.height * 0.32`
- All `CX` (text/element center X) → `this.scale.width / 2`
- All `GAME_HEIGHT * fraction` → `this.scale.height * fraction`
- Blocker rectangle: `GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT` → `this.scale.width / 2, this.scale.height / 2, this.scale.width, this.scale.height`

Verify:
```bash
grep -n "GAME_WIDTH\|GAME_HEIGHT\b\|^const CX" src/scenes/ScoreScene.ts
```
Expected: no output.

- [ ] **Step 3: Run tests**

```bash
npm run test
```

Expected: all 329 passing.

- [ ] **Step 4: Commit**

```bash
git add src/scenes/ScoreScene.ts
git commit -m "feat(scale): ScoreScene removes module-level CX, uses dynamic screen dimensions"
```

---

### Task 7: StoreScene — move module-level COL_RIGHT, dynamic positioning

**Files:**
- Modify: `src/scenes/StoreScene.ts`

`StoreScene` has a **module-level** `const COL_RIGHT = GAME_WIDTH - 16` (line 12) used in layout methods. The `StoreItem` inner class also uses `GAME_WIDTH` directly (line ~382, ~404). Replace all with `this.scale.width` / `scene.scale.width`.

- [ ] **Step 1: Remove module-level COL_RIGHT and GAME_WIDTH/GAME_HEIGHT imports**

Remove line 12:
```ts
// Remove:
const COL_RIGHT     = GAME_WIDTH - 16;
```

Remove `GAME_WIDTH` and `GAME_HEIGHT` from the import on line 3 (keep the rest).

- [ ] **Step 2: Replace COL_RIGHT in scene methods**

Everywhere `COL_RIGHT` was used inside `StoreScene` methods, replace with `this.scale.width - 16`.

- [ ] **Step 3: Replace GAME_WIDTH and GAME_HEIGHT throughout the file**

In `StoreScene` methods:
- Background fills: `g.fillRect(0, y, GAME_WIDTH, h)` → `g.fillRect(0, y, this.scale.width, h)`
- Star X positions: `Phaser.Math.Between(0, GAME_WIDTH)` → `Phaser.Math.Between(0, this.scale.width)`
- Slide targets: `GAME_WIDTH + offscreen` → `this.scale.width + offscreen`
- Footer bar: `GAME_WIDTH / 2, GAME_HEIGHT - FOOTER_HEIGHT / 2, GAME_WIDTH, FOOTER_HEIGHT` → `this.scale.width / 2, this.scale.height - FOOTER_HEIGHT / 2, this.scale.width, FOOTER_HEIGHT`
- Fade gradient: `GAME_HEIGHT - FOOTER_HEIGHT - 28` → `this.scale.height - FOOTER_HEIGHT - 28`
- Back button: `GAME_WIDTH / 2, GAME_HEIGHT - 24` → `this.scale.width / 2, this.scale.height - 24`
- Content max scroll: `GAME_HEIGHT - FOOTER_HEIGHT` → `this.scale.height - FOOTER_HEIGHT`

In `StoreItem` inner class (which receives `scene: StoreScene` or `scene: Phaser.Scene`):
- Row bg: `GAME_WIDTH / 2, y + ...` → `scene.scale.width / 2, y + ...`
- Row width: `GAME_WIDTH - 20` → `scene.scale.width - 20`
- Buy button X: `GAME_WIDTH - 52` → `scene.scale.width - 52`

Verify:
```bash
grep -n "GAME_WIDTH\|GAME_HEIGHT\|COL_RIGHT" src/scenes/StoreScene.ts
```
Expected: no output (or only inside string literals/comments).

- [ ] **Step 4: Run tests**

```bash
npm run test
```

Expected: all 329 passing.

- [ ] **Step 5: Commit**

```bash
git add src/scenes/StoreScene.ts
git commit -m "feat(scale): StoreScene removes module-level COL_RIGHT, uses dynamic screen dimensions"
```

---

### Task 8: UpgradeScene — move module-level COL_RIGHT, dynamic positioning

**Files:**
- Modify: `src/scenes/UpgradeScene.ts`

Same pattern as StoreScene.

- [ ] **Step 1: Remove module-level COL_RIGHT and GAME_WIDTH/GAME_HEIGHT imports**

Remove line 11:
```ts
// Remove:
const COL_RIGHT     = GAME_WIDTH - 16;
```

Remove `GAME_WIDTH` and `GAME_HEIGHT` from the line 2 import.

- [ ] **Step 2: Replace COL_RIGHT in scene methods**

Everywhere `COL_RIGHT` was used inside `UpgradeScene` methods, replace with `this.scale.width - 16`.

- [ ] **Step 3: Replace GAME_WIDTH and GAME_HEIGHT throughout the file**

- Background fills: `g.fillRect(0, y, GAME_WIDTH, h)` → `g.fillRect(0, y, this.scale.width, h)`
- Star X positions: `Phaser.Math.Between(0, GAME_WIDTH)` → `Phaser.Math.Between(0, this.scale.width)`
- Slide targets: `GAME_WIDTH + offscreen` → `this.scale.width + offscreen`
- Header rectangle: `GAME_WIDTH / 2, HEADER_BOTTOM / 2, GAME_WIDTH, HEADER_BOTTOM` → `this.scale.width / 2, HEADER_BOTTOM / 2, this.scale.width, HEADER_BOTTOM`
- Balance text: `GAME_WIDTH / 2, 96` → `this.scale.width / 2, 96`
- Tab layout: `GAME_WIDTH / 2 - (...)` → `this.scale.width / 2 - (...)`
- Any `UpgradeItem` inner class usages: same `scene.scale.width` pattern as StoreItem above

Verify:
```bash
grep -n "GAME_WIDTH\|GAME_HEIGHT\|COL_RIGHT" src/scenes/UpgradeScene.ts
```
Expected: no output.

- [ ] **Step 4: Run tests**

```bash
npm run test
```

Expected: all 329 passing.

- [ ] **Step 5: Commit**

```bash
git add src/scenes/UpgradeScene.ts
git commit -m "feat(scale): UpgradeScene removes module-level COL_RIGHT, uses dynamic screen dimensions"
```

---

### Task 9: HeapSelectScene — dynamic UI positioning

**Files:**
- Modify: `src/scenes/HeapSelectScene.ts`

All `GAME_WIDTH`/`GAME_HEIGHT` usages are UI layout (header, rows, close button, footer bar).

- [ ] **Step 1: Remove GAME_WIDTH and GAME_HEIGHT from imports**

Remove `GAME_WIDTH` and `GAME_HEIGHT` from the line 2 constants import.

- [ ] **Step 2: Replace all GAME_WIDTH → this.scale.width and GAME_HEIGHT → this.scale.height**

Key usages:
- Background fill: `bg.fillRect(0, y, GAME_WIDTH, h)` → `bg.fillRect(0, y, this.scale.width, h)`
- Header title: `GAME_WIDTH / 2, 34` → `this.scale.width / 2, 34`
- Divider line: `GAME_WIDTH / 2, 58, GAME_WIDTH - 2 * ROW_PAD_X, 1` → `this.scale.width / 2, 58, this.scale.width - 2 * ROW_PAD_X, 1`
- Close button: `GAME_WIDTH - 20, 34` → `this.scale.width - 20, 34`
- Empty state text: `GAME_WIDTH / 2, GAME_HEIGHT / 2` → `this.scale.width / 2, this.scale.height / 2`
- Row width: `GAME_WIDTH / 2, y + ...` → `this.scale.width / 2, y + ...`
- Row bg: `GAME_WIDTH - 2 * ROW_PAD_X, ROW_H - 6` → `this.scale.width - 2 * ROW_PAD_X, ROW_H - 6`
- Right-edge label: `const rx = GAME_WIDTH - ROW_PAD_X - 14` → `const rx = this.scale.width - ROW_PAD_X - 14`
- Footer bar: `GAME_WIDTH / 2, GAME_HEIGHT - 25, GAME_WIDTH, 50` → `this.scale.width / 2, this.scale.height - 25, this.scale.width, 50`
- Footer text: `GAME_WIDTH / 2, GAME_HEIGHT - 25` → `this.scale.width / 2, this.scale.height - 25`

Verify:
```bash
grep -n "GAME_WIDTH\|GAME_HEIGHT" src/scenes/HeapSelectScene.ts
```
Expected: no output.

- [ ] **Step 3: Run tests**

```bash
npm run test
```

Expected: all 329 passing.

- [ ] **Step 4: Commit**

```bash
git add src/scenes/HeapSelectScene.ts
git commit -m "feat(scale): HeapSelectScene UI positions use dynamic screen dimensions"
```

---

### Task 10: Final build verification

**Files:** none — verification only.

- [ ] **Step 1: Full build**

```bash
cd /home/connor/Documents/Repos/HeapGame && npm run build
```

Expected: `✓ built in X.XXs`, no TypeScript errors.

- [ ] **Step 2: Full test run**

```bash
npm run test
```

Expected: all 329 tests passing.

- [ ] **Step 3: Manual smoke test in browser**

```bash
npm run dev
```

Open browser devtools → Device emulation → select Samsung Galaxy S21 (or equivalent 9:20 portrait phone). Navigate to `http://localhost:3000`.

Verify:
- No black bars at top or bottom of the game canvas
- Menu scene UI (buttons, balance text, bottom hint text) is correctly anchored to screen edges
- Start a game: score text top-centered, DASH button bottom-right, hold bar centered
- Open store / upgrade scene: rows span screen width, footer bar at screen bottom
- Score scene: text elements vertically distributed across full screen height

Also verify desktop browser (no device emulation):
- Canvas is capped at 480px wide, centered on a wide window
- No visual regressions on default browser window

- [ ] **Step 4: Commit if any last fixes applied**

If any minor position corrections were needed during smoke testing:
```bash
git add -p
git commit -m "fix(scale): correct UI edge positions after RESIZE smoke test"
```

# Placement Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the disconnected ghost-block placement UI with physics-contact detection, a 1-second hold-to-confirm mechanic, and a progress bar on the place button.

**Architecture:** Remove all ghost-block state and surface-math from GameScene. Gate placement on `blocked.down && inTopZone && inCenterZone`. Replace InputManager's impulse `placeJustPressed` with a continuous `placeHeld` boolean driven by button hold. Drive a `_holdBar` Graphics object from the hold timer each frame.

**Tech Stack:** Phaser 3.90 (arcade physics, Graphics API), TypeScript, Vitest (node environment)

**Spec:** `docs/superpowers/specs/2026-04-03-placement-rework-design.md`

---

### Task 1: Add PLACE_HOLD_DURATION_MS to constants

**Files:**
- Modify: `src/constants.ts`

- [ ] **Step 1: Add the constant**

Open `src/constants.ts`. After the `PEAK_COIN_MULTIPLIER` line, add:

```ts
export const PLACE_HOLD_DURATION_MS = 1000; // ms player must hold to confirm placement
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build
```

Expected: build succeeds, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/constants.ts
git commit -m "feat: add PLACE_HOLD_DURATION_MS constant"
```

---

### Task 2: Update InputManager — replace impulse with hold (TDD)

**Files:**
- Create: `src/systems/__tests__/InputManager.test.ts`
- Modify: `src/systems/InputManager.ts`

The current InputManager has `placeJustPressed` (consumed once per frame) and `triggerPlace()` (fires from mobile button `pointerup`). We replace these with `placeHeld` (continuous) + `startPlace()` / `endPlace()`.

- [ ] **Step 1: Write the failing tests**

Create `src/systems/__tests__/InputManager.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Stub window and navigator before the module loads (constructor accesses both)
beforeEach(() => {
  vi.stubGlobal('window', {});
  vi.stubGlobal('navigator', { maxTouchPoints: 0 });
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('InputManager — placeHeld', () => {
  it('starts as false', async () => {
    const { InputManager } = await import('../InputManager');
    expect(InputManager.getInstance().placeHeld).toBe(false);
  });

  it('startPlace() sets placeHeld to true', async () => {
    const { InputManager } = await import('../InputManager');
    const im = InputManager.getInstance();
    im.startPlace();
    expect(im.placeHeld).toBe(true);
  });

  it('endPlace() resets placeHeld to false after startPlace', async () => {
    const { InputManager } = await import('../InputManager');
    const im = InputManager.getInstance();
    im.startPlace();
    im.endPlace();
    expect(im.placeHeld).toBe(false);
  });

  it('endPlace() is safe to call when not holding', async () => {
    const { InputManager } = await import('../InputManager');
    const im = InputManager.getInstance();
    im.endPlace();
    expect(im.placeHeld).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test
```

Expected: 4 failures — `placeHeld` does not exist on InputManager.

- [ ] **Step 3: Update InputManager**

In `src/systems/InputManager.ts`, make the following changes:

**Remove** these fields:
```ts
placeJustPressed = false;
private pendingPlace    = false;
```

**Add** this field (in the public section, after `dashDir`):
```ts
placeHeld = false;
```

**In `update()`**, remove these two lines:
```ts
this.placeJustPressed = this.pendingPlace;
this.pendingPlace = false;
```

**Replace** the `triggerPlace()` method with `startPlace()` and `endPlace()`:
```ts
/** Called by the on-screen placement button on pointerdown. */
startPlace(): void {
  this.placeHeld = true;
}

/** Called by the on-screen placement button on pointerup / pointerout. */
endPlace(): void {
  this.placeHeld = false;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test
```

Expected: all 4 InputManager tests pass (plus any existing HeapClient tests).

- [ ] **Step 5: Verify build**

```bash
npm run build
```

Expected: TypeScript compiler will report errors referencing `placeJustPressed` and `triggerPlace()` in GameScene — that's expected and will be resolved in later tasks. If errors are only in GameScene, the task is complete.

- [ ] **Step 6: Commit**

```bash
git add src/systems/__tests__/InputManager.test.ts src/systems/InputManager.ts
git commit -m "feat: replace InputManager impulse place with continuous placeHeld"
```

---

### Task 3: Remove ghost block from GameScene

**Files:**
- Modify: `src/scenes/GameScene.ts`

Remove all ghost-block fields, the `updatePlacementGhost()` method, and its call in `update()`. The `findSurfaceYFromPolygon` import is still used in `placeBlock()` at this point — do not remove it yet.

- [ ] **Step 1: Remove ghost fields**

In `src/scenes/GameScene.ts`, remove these field declarations:

```ts
private placementGhost!: Phaser.GameObjects.Graphics;
private _ghostLastX = NaN;
private _ghostLastSurfaceY = NaN;
private _ghostLastValid: boolean | null = null;
private _ghostLastInZone = false;
```

- [ ] **Step 2: Remove ghost creation in create()**

Remove this line from `create()`:

```ts
this.placementGhost = this.add.graphics().setDepth(15);
```

- [ ] **Step 3: Remove ghost call in update()**

Remove this line from `update()`:

```ts
// Placement ghost preview
this.updatePlacementGhost(inTopZone);
```

- [ ] **Step 4: Remove updatePlacementGhost() method**

Delete the entire `updatePlacementGhost()` method (lines ~280–336 in the current file).

- [ ] **Step 5: Verify build**

```bash
npm run build
```

Expected: build succeeds (ghost refs are gone; remaining errors are from `placeJustPressed` / `triggerPlace` in update() — leave those for Task 5).

- [ ] **Step 6: Commit**

```bash
git add src/scenes/GameScene.ts
git commit -m "refactor: remove placement ghost block and surface-math state"
```

---

### Task 4: Update placeBlock() — player-center payload, remove dead code

**Files:**
- Modify: `src/scenes/GameScene.ts`

Replace the surface-math-based payload with player center coords. Remove the guards that are now handled by the hold validity condition. Remove `flashText`, `showFlash()`, and dead imports.

- [ ] **Step 1: Rewrite placeBlock()**

Replace the entire `placeBlock()` method body with:

```ts
private placeBlock(): void {
  this.blockPlaced = true;

  const px     = this.player.sprite.x;
  const py     = this.player.sprite.y;
  const isPeak = py <= this.heapGenerator.topY + PEAK_BONUS_ZONE_PX;

  void HeapClient.append(this._heapId, px, py).then(() =>
    HeapClient.load(this._heapId),
  ).then(freshPolygon => {
    this._heapPolygon = freshPolygon;
    applyPolygonToGenerator(freshPolygon, this.heapGenerator);
    this.heapGenerator.setPolygonTopY(polygonTopY(freshPolygon));
  });

  const score = Math.max(0, Math.floor(this.spawnY - py));
  this.time.delayedCall(2000, () => {
    this.scene.launch('ScoreScene', { score, isPeak });
  });
}
```

- [ ] **Step 2: Remove flashText field and creation**

Remove field declaration:
```ts
private flashText!: Phaser.GameObjects.Text;
```

Remove from `create()`:
```ts
// Flash message for invalid placement attempts
this.flashText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, '', {
  fontSize: '22px', color: '#ff6666',
  stroke: '#000000', strokeThickness: 3,
  backgroundColor: '#000000aa',
  padding: { x: 14, y: 8 },
}).setOrigin(0.5).setScrollFactor(0).setDepth(30).setVisible(false);
```

- [ ] **Step 3: Remove showFlash() method**

Delete the entire `showFlash()` method:
```ts
private showFlash(message: string): void {
  this.flashText.setText(message).setVisible(true);
  this.time.delayedCall(1500, () => this.flashText.setVisible(false));
}
```

- [ ] **Step 4: Clean up unused imports**

At the top of `GameScene.ts`, remove these imports that are now unused:

- `findSurfaceYFromPolygon` from `'../systems/HeapPolygonLoader'`
- `OBJECT_DEFS, HEAP_ITEM_COUNT` from `'../data/heapObjectDefs'`

The remaining imports from `HeapPolygonLoader` (`applyPolygonToGenerator`, `polygonTopY`) are still used — keep them.

- [ ] **Step 5: Verify build**

```bash
npm run build
```

Expected: errors only for `placeJustPressed` / `triggerPlace` in `update()` (resolved in Task 5). No unused-import warnings.

- [ ] **Step 6: Commit**

```bash
git add src/scenes/GameScene.ts
git commit -m "feat: send player center coords for placement, remove dead ghost/flash code"
```

---

### Task 5: Add hold timer and center-zone validity to update()

**Files:**
- Modify: `src/scenes/GameScene.ts`

Add `_holdElapsed` field. Replace the instant-placement trigger with a hold timer. Add `inCenterZone` to the validity check.

- [ ] **Step 1: Add _holdElapsed field**

In the class field declarations, add after `_heapId`:

```ts
private _holdElapsed = 0;
```

- [ ] **Step 2: Add PLACE_HOLD_DURATION_MS to constants import**

Find the import line that pulls from `'../constants'` and add `PLACE_HOLD_DURATION_MS` to it:

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
} from '../constants';
```

- [ ] **Step 3: Replace instant-placement trigger with hold timer**

Find and remove the old placement trigger block in `update()`:

```ts
// Placement trigger
if (!this.blockPlaced && inTopZone &&
    (Phaser.Input.Keyboard.JustDown(this.placeKey) || im.placeJustPressed)) {
  this.placeBlock();
}
```

Replace it with:

```ts
// Hold-to-confirm placement
const body = this.player.sprite.body as Phaser.Physics.Arcade.Body;
const onHeapSurface = body.blocked.down;
const inCenterZone  = this.player.sprite.x >= WORLD_WIDTH * 0.125 &&
                      this.player.sprite.x <= WORLD_WIDTH * 0.875;
const holdInputActive = im.isMobile ? im.placeHeld : this.placeKey.isDown;
const canPlace = !this.blockPlaced && inTopZone && inCenterZone && onHeapSurface;

if (canPlace && holdInputActive) {
  this._holdElapsed += delta;
  if (this._holdElapsed >= PLACE_HOLD_DURATION_MS) {
    this._holdElapsed = 0;
    this.placeBlock();
  }
} else {
  this._holdElapsed = 0;
}
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```

Expected: build succeeds. No remaining references to `placeJustPressed` or `triggerPlace`.

- [ ] **Step 5: Commit**

```bash
git add src/scenes/GameScene.ts
git commit -m "feat: add 1s hold-to-confirm placement with physics surface detection"
```

---

### Task 6: Add progress bar and wire mobile button

**Files:**
- Modify: `src/scenes/GameScene.ts`

Add `_holdBar` Graphics object, `_drawHoldBar()` helper, progress bar rendering in `update()`, and swap the mobile button from `pointerup → triggerPlace()` to `pointerdown/pointerout → startPlace/endPlace`.

- [ ] **Step 1: Add _holdBar field**

In the class field declarations, add after `_holdElapsed`:

```ts
private _holdBar!: Phaser.GameObjects.Graphics;
```

- [ ] **Step 2: Create _holdBar in create()**

After the line `this.im = InputManager.getInstance();`, add:

```ts
this._holdBar = this.add.graphics().setScrollFactor(0).setDepth(26);
```

- [ ] **Step 3: Add _drawHoldBar() helper method**

Add this private method to GameScene (place it in the `// ── Private ──` section):

```ts
/**
 * Draws a hold-progress bar. Track is a dark rounded rect; fill is a white
 * inset rect that grows left-to-right. Clears when progress <= 0.
 */
private _drawHoldBar(progress: number, x: number, y: number, w: number, h: number): void {
  this._holdBar.clear();
  if (progress <= 0) return;
  // Track
  this._holdBar.fillStyle(0x000000, 0.4);
  this._holdBar.fillRoundedRect(x, y, w, h, 4);
  // Fill — straight rect inset 2px so it sits inside the rounded track
  const fillW = Math.max(0, (w - 4) * Math.min(progress, 1));
  if (fillW > 0) {
    this._holdBar.fillStyle(0xffffff, 0.8);
    this._holdBar.fillRect(x + 2, y + 2, fillW, h - 4);
  }
}
```

- [ ] **Step 4: Draw progress bar in update()**

After the hold-timer block added in Task 5, add:

```ts
// Progress bar + button highlight
const progress = this._holdElapsed / PLACE_HOLD_DURATION_MS;
if (showPlaceUI) {
  const holdActive = canPlace && holdInputActive;
  if (im.isMobile) {
    this.placeBtnBg?.setStrokeStyle(2, holdActive ? 0x88ddff : 0x4488dd);
    // Bar anchored to bottom of button: center=(GAME_WIDTH/2, 82), size=(280, 56)
    this._drawHoldBar(progress, GAME_WIDTH / 2 - 134, 96, 268, 8);
  } else {
    // Bar anchored below topZoneText at (GAME_WIDTH/2, 82)
    this._drawHoldBar(progress, GAME_WIDTH / 2 - 100, 97, 200, 6);
  }
} else {
  if (im.isMobile) this.placeBtnBg?.setStrokeStyle(2, 0x4488dd);
  this._holdBar.clear();
}
```

**Note on coordinates:**
- Mobile button rect: center `(240, 82)`, size `(280, 56)` → spans x `100–380`, y `54–110`
- Bar at `x=106, y=96, w=268, h=8` sits in the lower portion of the button, inset 6px from edges
- Desktop bar at `x=140, y=97, w=200, h=6` sits below the 18px hint text

- [ ] **Step 5: Rewire mobile button to hold API**

In `create()`, find the mobile button setup block. It currently reads:

```ts
this.placeBtnBg.setInteractive({ useHandCursor: true });
this.placeBtnBg.on('pointerup', () => im.triggerPlace());
```

Replace with:

```ts
this.placeBtnBg.setInteractive({ useHandCursor: true });
this.placeBtnBg.on('pointerdown', () => im.startPlace());
this.placeBtnBg.on('pointerup',   () => im.endPlace());
this.placeBtnBg.on('pointerout',  () => im.endPlace());
```

- [ ] **Step 6: Verify build**

```bash
npm run build
```

Expected: clean build, no errors.

- [ ] **Step 7: Run full test suite**

```bash
npm test
```

Expected: all tests pass (InputManager × 4, HeapClient × existing).

- [ ] **Step 8: Smoke test in browser**

```bash
npm run dev
```

Open `http://localhost:3000`. Verify:
1. Ghost block is gone — no blue/red rectangle follows the player
2. In the top zone, standing on heap surface: PLACE BLOCK button appears (mobile) / hint text appears (desktop)
3. Holding the button fills the white progress bar left-to-right over ~1 second
4. Button stroke turns brighter blue while holding (mobile)
5. Releasing before 1s resets the bar to empty
6. Completing the hold triggers placement and transitions to ScoreScene
7. Moving out of center zone while holding resets the bar

- [ ] **Step 9: Commit**

```bash
git add src/scenes/GameScene.ts
git commit -m "feat: add hold-progress bar and wire mobile button to startPlace/endPlace"
```

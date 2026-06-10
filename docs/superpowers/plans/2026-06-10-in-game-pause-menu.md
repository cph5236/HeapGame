# In-game Pause Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a top-right ☰ menu everywhere — in-game it pauses and offers Resume/Controls/Volume/Exit; on the main menu it becomes the single settings entry point — by adding a `PauseScene` overlay and extracting a shared volume-slider builder.

**Architecture:** A new `PauseScene` overlay is launched by both game scenes (which then `scene.pause()` themselves), showing a menu with sub-views for Controls (reusing `buildControlsOverlay`) and Volume (reusing a new shared `buildVolumePanel`), plus an exit-confirm. The main menu drops its `?` button, moves its settings button to the top-right as a ☰, and folds the controls help into the settings Controls tab.

**Tech Stack:** Phaser 3.90, TypeScript 5.9, Vitest. Phaser `Scale.RESIZE` mode (so size everything off `scale.width/height`).

**Testing philosophy:** This repo unit-tests pure logic and verifies Phaser scene/UI work via `npm run scene-preview` + `npm run build`. The plan TDDs the pure slider math and uses scene-preview for visual/wiring tasks.

**Branch:** `feature/in-game-pause-menu` (based on `fix/controls-menu-overflow` / PR #45, which provides `src/ui/buildControlsOverlay.ts`).

**Spec:** `docs/superpowers/specs/2026-06-10-in-game-pause-menu-design.md`

---

## File Structure

- **Create** `src/ui/buildVolumePanel.ts` — pure slider math (`clampVolume`, `volumeFromTrackX`), the shared `createVolumeSlider` widget (moved out of MenuScene), and a standalone `buildVolumePanel` (dim bg + panel + 5 stacked sliders) for PauseScene.
- **Create** `src/ui/__tests__/buildVolumePanel.test.ts` — unit tests for the pure math.
- **Create** `src/scenes/PauseScene.ts` — the overlay scene (menu / controls / volume / exit-confirm views).
- **Modify** `src/main.ts` — register `PauseScene` in the scene list.
- **Modify** `src/scenes/MenuScene.ts` — use shared `createVolumeSlider`; remove `?` button; move settings button top-right with ☰; fold controls help into the Controls tab.
- **Modify** `src/scenes/GameScene.ts` — replace `createInfoButton`/info-overlay with a ☰ `createMenuButton` + `openPauseMenu()` + Esc/P.
- **Modify** `src/scenes/InfiniteGameScene.ts` — add ☰ `createMenuButton` + `openPauseMenu()` + Esc/P.

---

## Task 1: Pure volume-slider math (TDD)

**Files:**
- Create: `src/ui/buildVolumePanel.ts`
- Test: `src/ui/__tests__/buildVolumePanel.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/ui/__tests__/buildVolumePanel.test.ts
import { describe, it, expect } from 'vitest';
import { clampVolume, volumeFromTrackX } from '../buildVolumePanel';

describe('clampVolume', () => {
  it('passes through values in [0,1]', () => {
    expect(clampVolume(0)).toBe(0);
    expect(clampVolume(0.5)).toBe(0.5);
    expect(clampVolume(1)).toBe(1);
  });
  it('clamps out-of-range values', () => {
    expect(clampVolume(-0.3)).toBe(0);
    expect(clampVolume(1.7)).toBe(1);
  });
});

describe('volumeFromTrackX', () => {
  const trackLeft = 100;
  const trackW = 220;
  it('maps the left edge to 0 and the right edge to 1', () => {
    expect(volumeFromTrackX(trackLeft, trackLeft, trackW)).toBe(0);
    expect(volumeFromTrackX(trackLeft + trackW, trackLeft, trackW)).toBe(1);
  });
  it('maps the midpoint to 0.5', () => {
    expect(volumeFromTrackX(trackLeft + trackW / 2, trackLeft, trackW)).toBeCloseTo(0.5, 5);
  });
  it('clamps pointers beyond the track ends', () => {
    expect(volumeFromTrackX(trackLeft - 50, trackLeft, trackW)).toBe(0);
    expect(volumeFromTrackX(trackLeft + trackW + 50, trackLeft, trackW)).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/__tests__/buildVolumePanel.test.ts`
Expected: FAIL — cannot import `clampVolume`/`volumeFromTrackX` from `../buildVolumePanel` (module/exports do not exist).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/ui/buildVolumePanel.ts
/** Clamp a raw volume to the playable [0,1] range. */
export function clampVolume(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Convert a pointer X over a slider track into a clamped [0,1] volume. */
export function volumeFromTrackX(pointerX: number, trackLeft: number, trackW: number): number {
  return clampVolume((pointerX - trackLeft) / trackW);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ui/__tests__/buildVolumePanel.test.ts`
Expected: PASS (7 assertions across 5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/buildVolumePanel.ts src/ui/__tests__/buildVolumePanel.test.ts
git commit -m "feat(ui): pure volume-slider math (clampVolume, volumeFromTrackX)"
```

---

## Task 2: Shared `createVolumeSlider` widget + standalone `buildVolumePanel`

**Files:**
- Modify: `src/ui/buildVolumePanel.ts`

This moves MenuScene's private `createVolumeSlider` into the shared module (taking `scene` as a parameter and using the Task 1 math), then adds a standalone `buildVolumePanel` that stacks the five sliders inside its own dim bg + panel for PauseScene. MenuScene is migrated to it in Task 8.

- [ ] **Step 1: Add the imports and slider widget**

Prepend the imports and append the widget to `src/ui/buildVolumePanel.ts`:

```ts
import Phaser from 'phaser';
import { AudioManager } from '../systems/AudioManager';
import type { SoundCategory } from '../systems/AudioManager';
```

> Note: `SoundCategory` is exported from `src/systems/AudioManager.ts`. If it is not, change the import to wherever the type lives (grep `SoundCategory`), but do not redefine it.

```ts
const TRACK_W = 220;
const TRACK_H = 6;
const THUMB_R = 9;

/**
 * Build one labelled volume slider at (x, y). Moved verbatim out of MenuScene so
 * MenuScene's Sounds tab and PauseScene's Volume view share one widget. Returns the
 * display objects (created hidden) so the caller controls visibility.
 */
export function createVolumeSlider(
  scene: Phaser.Scene,
  x: number, y: number, labelText: string,
  cat: SoundCategory | 'master', initialValue: number, depth: number,
): Phaser.GameObjects.GameObject[] {
  const trackLeft = x - TRACK_W / 2;

  const label = scene.add.text(trackLeft, y - 14, labelText, {
    fontSize: '13px', color: '#aaaacc',
  }).setOrigin(0, 0.5).setDepth(depth);

  const track = scene.add.rectangle(x, y, TRACK_W, TRACK_H, 0x334466).setDepth(depth);

  const fill = scene.add.rectangle(
    trackLeft + (TRACK_W * initialValue) / 2, y, TRACK_W * initialValue, TRACK_H, 0x4466cc,
  ).setDepth(depth);

  const thumb = scene.add.circle(trackLeft + TRACK_W * initialValue, y, THUMB_R, 0x6688ff)
    .setDepth(depth + 1).setInteractive({ draggable: true, useHandCursor: true });

  const apply = (newValue: number) => {
    const clamped = clampVolume(newValue);
    const thumbX  = trackLeft + TRACK_W * clamped;
    thumb.setPosition(thumbX, y);
    fill.setPosition(trackLeft + (TRACK_W * clamped) / 2, y);
    fill.setSize(TRACK_W * clamped, TRACK_H);
    AudioManager.setCategoryVolume(cat, clamped);
  };

  scene.input.setDraggable(thumb);
  thumb.on('drag', (_ptr: Phaser.Input.Pointer, dragX: number) => {
    apply(volumeFromTrackX(dragX, trackLeft, TRACK_W));
  });

  track.setInteractive({
    hitArea: new Phaser.Geom.Rectangle(0, -(28 - TRACK_H) / 2, TRACK_W, 28),
    hitAreaCallback: Phaser.Geom.Rectangle.Contains,
    useHandCursor: true,
  });
  track.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
    apply(volumeFromTrackX(ptr.x, trackLeft, TRACK_W));
  });

  [label, track, fill, thumb].forEach(o => o.setVisible(false));
  return [label, track, fill, thumb];
}
```

- [ ] **Step 2: Add the standalone `buildVolumePanel`**

Append to `src/ui/buildVolumePanel.ts`:

```ts
export interface VolumePanel {
  parts: Phaser.GameObjects.GameObject[];
  setOpen: (open: boolean) => void;
  relayout: () => void;
}

const PANEL_W = 320;
const PANEL_H = 300;
const MARGIN  = 16;

/**
 * Standalone volume panel (dim bg + panel + title + 5 stacked sliders) for use as a
 * sub-view inside PauseScene. Sized PANEL_W x PANEL_H, clamped to the viewport so it
 * fits narrow 21:9 phones. Sliders read AudioManager.getVolumes() at build time.
 */
export function buildVolumePanel(
  scene: Phaser.Scene,
  opts: { depth: number; onBackgroundTap: () => void },
): VolumePanel {
  const { depth, onBackgroundTap } = opts;
  const vols = AudioManager.getVolumes();

  const bg = scene.add.rectangle(0, 0, 10, 10, 0x000000, 0.72)
    .setScrollFactor(0).setDepth(depth).setVisible(false).setInteractive();
  bg.on('pointerup', onBackgroundTap);

  const panel = scene.add.rectangle(0, 0, PANEL_W, PANEL_H, 0x0d0d20)
    .setScrollFactor(0).setDepth(depth + 1).setVisible(false).setStrokeStyle(2, 0x4455aa).setInteractive();

  const title = scene.add.text(0, 0, 'VOLUME', {
    fontSize: '20px', color: '#ffffff', stroke: '#000000', strokeThickness: 3,
  }).setOrigin(0.5).setScrollFactor(0).setDepth(depth + 2).setVisible(false);

  // Placeholder layout; relayout() positions everything against the live viewport.
  const sliderDepth = depth + 2;
  const sliderSpecs: Array<[string, SoundCategory | 'master', number]> = [
    ['MASTER',       'master',    vols.master],
    ['Music',        'music',     vols.music],
    ['Player SFX',   'playerSfx', vols.playerSfx],
    ['Enemy SFX',    'enemySfx',  vols.enemySfx],
    ['Environment',  'envSfx',    vols.envSfx],
  ];
  const sliderParts = sliderSpecs.map(([labelText, cat, val]) =>
    createVolumeSlider(scene, 0, 0, labelText, cat, val, sliderDepth),
  );

  const relayout = (): void => {
    const vw = scene.scale.width;
    const vh = scene.scale.height;
    const cx = vw / 2;
    const cy = vh / 2;
    bg.setPosition(cx, cy).setSize(vw, vh);

    const panelW = Math.min(PANEL_W, vw - MARGIN * 2);
    const panelH = Math.min(PANEL_H, vh - MARGIN * 2);
    panel.setPosition(cx, cy).setSize(panelW, panelH);
    title.setPosition(cx, cy - panelH / 2 + 22);

    // Stack sliders evenly below the title.
    const top = cy - panelH / 2 + 64;
    const step = 48;
    sliderParts.forEach((parts, i) => {
      const sy = top + i * step;
      const [label, track, fill, thumb] = parts as [
        Phaser.GameObjects.Text, Phaser.GameObjects.Rectangle,
        Phaser.GameObjects.Rectangle, Phaser.GameObjects.Arc,
      ];
      const trackLeft = cx - TRACK_W / 2;
      label.setPosition(trackLeft, sy - 14);
      track.setPosition(cx, sy);
      // Preserve current fill width / thumb X (proportional to their existing value).
      const ratio = thumb.x === 0 ? 0 : (thumb.x - track.x + TRACK_W / 2) / TRACK_W;
      fill.setPosition(trackLeft + (TRACK_W * ratio) / 2, sy);
      thumb.setPosition(trackLeft + TRACK_W * ratio, sy);
    });
  };

  const setOpen = (open: boolean): void => {
    if (open) relayout();
    bg.setVisible(open); panel.setVisible(open); title.setVisible(open);
    sliderParts.flat().forEach(o => (o as Phaser.GameObjects.Components.Visible).setVisible(open));
  };

  return {
    parts: [bg, panel, title, ...sliderParts.flat()],
    setOpen,
    relayout,
  };
}
```

> The initial slider thumb X is set by `createVolumeSlider` at x=0; `relayout()` recomputes positions from the value ratio before first show, so initial values render correctly.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: `✓ built` with no TypeScript errors. (If `SoundCategory` isn't exported from AudioManager, fix the import per Step 1's note and re-run.)

- [ ] **Step 4: Commit**

```bash
git add src/ui/buildVolumePanel.ts
git commit -m "feat(ui): shared createVolumeSlider widget + standalone buildVolumePanel"
```

---

## Task 3: `PauseScene` skeleton + registration (menu view only)

**Files:**
- Create: `src/scenes/PauseScene.ts`
- Modify: `src/main.ts:2-11` (imports) and `src/main.ts:73` (scene list)

- [ ] **Step 1: Create the scene with the menu (button-list) view**

```ts
// src/scenes/PauseScene.ts
import Phaser from 'phaser';

export interface PauseSceneData {
  /** Scene key of the paused game scene to resume/stop. */
  gameSceneKey: string;
  /** Whether the device is mobile (drives controls-help copy). */
  isMobile: boolean;
}

type View = 'menu' | 'controls' | 'volume' | 'confirm';

const PANEL_W = 300;
const BTN_W   = 240;
const BTN_H   = 48;
const BTN_GAP = 14;

export class PauseScene extends Phaser.Scene {
  private gameSceneKey!: string;
  private isMobile = false;
  private view: View = 'menu';
  private menuParts: Phaser.GameObjects.GameObject[] = [];

  constructor() { super({ key: 'PauseScene' }); }

  init(data: PauseSceneData): void {
    this.gameSceneKey = data.gameSceneKey;
    this.isMobile     = data.isMobile;
    this.view         = 'menu';
    this.menuParts    = [];
  }

  create(): void {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;

    const bg = this.add.rectangle(cx, cy, this.scale.width, this.scale.height, 0x000000, 0.72)
      .setScrollFactor(0).setDepth(40).setInteractive();

    const titleY = cy - (BTN_H * 4 + BTN_GAP * 3) / 2 - 48;
    const title = this.add.text(cx, titleY, 'PAUSED', {
      fontSize: '28px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(42);

    const panelH = BTN_H * 4 + BTN_GAP * 3 + 40;
    const panel = this.add.rectangle(cx, cy, Math.min(PANEL_W, this.scale.width - 32), panelH, 0x0d0d20)
      .setScrollFactor(0).setDepth(41).setStrokeStyle(2, 0x4455aa).setInteractive();

    this.menuParts = [bg, title, panel];

    const labels: Array<[string, () => void]> = [
      ['Resume',           () => this.resumeGame()],
      ['Controls',         () => this.showView('controls')],
      ['Volume',           () => this.showView('volume')],
      ['Exit to Main Menu', () => this.showView('confirm')],
    ];
    const top = cy - (BTN_H * 4 + BTN_GAP * 3) / 2 + BTN_H / 2;
    labels.forEach(([text, onTap], i) => {
      const by = top + i * (BTN_H + BTN_GAP);
      const btn = this.add.rectangle(cx, by, BTN_W, BTN_H, 0x1a3a5c)
        .setScrollFactor(0).setDepth(42).setStrokeStyle(2, 0x4488ff).setInteractive({ useHandCursor: true });
      const lbl = this.add.text(cx, by, text, {
        fontSize: '19px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(43);
      btn.on('pointerup', onTap);
      this.menuParts.push(btn, lbl);
    });

    // Esc / P resume the game (toggle off).
    this.input.keyboard?.on('keydown-ESC', () => this.resumeGame());
    this.input.keyboard?.on('keydown-P',   () => this.resumeGame());
  }

  private showView(view: View): void {
    this.view = view;
    // Controls / Volume / confirm sub-views are added in Tasks 4 & 5.
    // For now only 'menu' exists; this method is fleshed out there.
  }

  private resumeGame(): void {
    this.scene.resume(this.gameSceneKey);
    this.scene.stop();
  }
}
```

- [ ] **Step 2: Register PauseScene in main.ts**

In `src/main.ts`, add the import alongside the other scene imports (after the `LeaderboardScene` import on line 11):

```ts
import { PauseScene } from './scenes/PauseScene';
```

And add `PauseScene` to the end of the scene array on line 73:

```ts
scene: [BootScene, MenuScene, HeapSelectScene, GameScene, ScoreScene, UpgradeScene, StoreScene, InfiniteGameScene, TexturePreviewScene, LeaderboardScene, PauseScene],
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: `✓ built` with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/scenes/PauseScene.ts src/main.ts
git commit -m "feat(pause): PauseScene skeleton (menu view) + register in scene list"
```

---

## Task 4: PauseScene Controls & Volume sub-views

**Files:**
- Modify: `src/scenes/PauseScene.ts`

Reuse `buildControlsOverlay` (PR #45) and `buildVolumePanel` (Task 2). Each sub-view shows its panel plus a "← Back" button that returns to the menu.

- [ ] **Step 1: Import the builders and add sub-view fields**

At the top of `src/scenes/PauseScene.ts`:

```ts
import { buildControlsOverlay, type ControlsOverlay } from '../ui/buildControlsOverlay';
import { buildVolumePanel, type VolumePanel } from '../ui/buildVolumePanel';
```

Add fields to the class:

```ts
  private controls?: ControlsOverlay;
  private volume?: VolumePanel;
  private backBtn?: Phaser.GameObjects.GameObject[];
```

- [ ] **Step 2: Build the sub-views and a Back button in `create()`**

Append to the end of `create()` (before the keyboard handlers is fine):

```ts
    // Sub-views (hidden until selected). Tapping their dim bg returns to the menu.
    this.controls = buildControlsOverlay(this, {
      isMobile: this.isMobile, depth: 44, onBackgroundTap: () => this.showView('menu'),
    });
    this.volume = buildVolumePanel(this, {
      depth: 44, onBackgroundTap: () => this.showView('menu'),
    });

    // Shared "← Back" button shown on any sub-view.
    const backY = this.scale.height - 48;
    const bg = this.add.rectangle(this.scale.width / 2, backY, 160, 40, 0x222244)
      .setScrollFactor(0).setDepth(47).setStrokeStyle(2, 0x8899bb).setInteractive({ useHandCursor: true })
      .setVisible(false);
    const lbl = this.add.text(this.scale.width / 2, backY, '← Back', {
      fontSize: '17px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(48).setVisible(false);
    bg.on('pointerup', () => this.showView('menu'));
    this.backBtn = [bg, lbl];
```

- [ ] **Step 3: Flesh out `showView` to switch visibility**

Replace the placeholder `showView` body with:

```ts
  private showView(view: View): void {
    this.view = view;
    const onMenu = view === 'menu';
    this.menuParts.forEach(o => (o as Phaser.GameObjects.Components.Visible).setVisible(onMenu));
    this.controls?.setOpen(view === 'controls');
    this.volume?.setOpen(view === 'volume');
    const showBack = view === 'controls' || view === 'volume';
    this.backBtn?.forEach(o => (o as Phaser.GameObjects.Components.Visible).setVisible(showBack));
    // 'confirm' view is handled in Task 5.
  }
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: `✓ built` with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/scenes/PauseScene.ts
git commit -m "feat(pause): Controls and Volume sub-views with Back button"
```

---

## Task 5: PauseScene exit-confirm + exit transition

**Files:**
- Modify: `src/scenes/PauseScene.ts`

- [ ] **Step 1: Add confirm-view fields and builder**

Add a field:

```ts
  private confirmParts: Phaser.GameObjects.GameObject[] = [];
```

In `create()`, after the Back button block, append:

```ts
    // ── Exit-confirm sub-view (hidden until 'confirm') ─────────────────────────
    const ccx = this.scale.width / 2;
    const ccy = this.scale.height / 2;
    const cbg = this.add.rectangle(ccx, ccy, this.scale.width, this.scale.height, 0x000000, 0.8)
      .setScrollFactor(0).setDepth(49).setVisible(false).setInteractive();
    const cpanel = this.add.rectangle(ccx, ccy, Math.min(320, this.scale.width - 32), 200, 0x0d0d20)
      .setScrollFactor(0).setDepth(50).setStrokeStyle(2, 0xff4444).setVisible(false);
    const cmsg = this.add.text(ccx, ccy - 50, 'Quit run?\nThis run’s progress is lost.', {
      fontSize: '17px', color: '#ffdddd', align: 'center', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(51).setVisible(false);
    const cancelBtn = this.add.rectangle(ccx - 70, ccy + 40, 120, 44, 0x223344)
      .setScrollFactor(0).setDepth(51).setStrokeStyle(2, 0x8899bb).setVisible(false).setInteractive({ useHandCursor: true });
    const cancelLbl = this.add.text(ccx - 70, ccy + 40, 'Cancel', {
      fontSize: '17px', color: '#ffffff',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(52).setVisible(false);
    const quitBtn = this.add.rectangle(ccx + 70, ccy + 40, 120, 44, 0x881111)
      .setScrollFactor(0).setDepth(51).setStrokeStyle(2, 0xff4444).setVisible(false).setInteractive({ useHandCursor: true });
    const quitLbl = this.add.text(ccx + 70, ccy + 40, 'Quit', {
      fontSize: '17px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(52).setVisible(false);
    cancelBtn.on('pointerup', () => this.showView('menu'));
    quitBtn.on('pointerup',   () => this.exitToMenu());
    this.confirmParts = [cbg, cpanel, cmsg, cancelBtn, cancelLbl, quitBtn, quitLbl];
```

- [ ] **Step 2: Show the confirm view in `showView`**

In `showView`, before the closing brace, add:

```ts
    this.confirmParts.forEach(o => (o as Phaser.GameObjects.Components.Visible).setVisible(view === 'confirm'));
```

- [ ] **Step 3: Add the `exitToMenu` transition**

Add the method:

```ts
  private exitToMenu(): void {
    this.scene.stop(this.gameSceneKey);
    this.scene.stop();
    this.scene.start('MenuScene');
  }
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: `✓ built` with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/scenes/PauseScene.ts
git commit -m "feat(pause): exit-to-menu confirm sub-view"
```

---

## Task 6: Wire GameScene — ☰ menu button replaces the info overlay

**Files:**
- Modify: `src/scenes/GameScene.ts` (fields ~70-71; `createInfoButton` call site ~354; `createInfoButton`/`toggleInfoOverlay` ~802-851; imports ~17,20)

- [ ] **Step 1: Remove the info-overlay fields and add a double-open guard import**

Delete the two info-overlay fields:

```ts
  private infoOverlay?: ControlsOverlay;
  private infoOpen = false;
```

Remove the now-unused import line:

```ts
import { buildControlsOverlay, type ControlsOverlay } from '../ui/buildControlsOverlay';
```

`InputManager` is already imported (line 17). Confirm `import { InputManager } from '../systems/InputManager';` is present; if not, add it.

- [ ] **Step 2: Replace `createInfoButton` + `toggleInfoOverlay` with `createMenuButton` + `openPauseMenu`**

Replace the whole `createInfoButton(isMobile: boolean)` method and the `toggleInfoOverlay()` method with:

```ts
  private createMenuButton(): void {
    const bx = this.scale.width - 22;
    const by = 22;

    const btnGfx = this.add.graphics().setScrollFactor(0).setDepth(26);
    btnGfx.fillStyle(0x000000, 0.65);
    btnGfx.fillCircle(bx, by, 14);
    btnGfx.lineStyle(2, 0x8899bb, 1);
    btnGfx.strokeCircle(bx, by, 14);

    // ☰ hamburger glyph
    this.add.text(bx, by, '☰', {
      fontSize: '16px', color: '#ffffff', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(27);

    const hitZone = this.add.zone(bx, by, 40, 40).setScrollFactor(0).setDepth(27)
      .setInteractive({ useHandCursor: true });
    hitZone.on('pointerup', () => this.openPauseMenu());

    this.input.keyboard?.on('keydown-ESC', () => this.openPauseMenu());
    this.input.keyboard?.on('keydown-P',   () => this.openPauseMenu());
  }

  private openPauseMenu(): void {
    if (this.scene.isActive('PauseScene')) return; // guard against double-open
    this.scene.launch('PauseScene', {
      gameSceneKey: this.scene.key,
      isMobile: InputManager.getInstance().isMobile,
    });
    this.scene.pause();
  }
```

- [ ] **Step 3: Update the call site**

Change the call (around line 354) from:

```ts
    this.createInfoButton(im.isMobile);
```

to:

```ts
    this.createMenuButton();
```

- [ ] **Step 4: Remove the create()-reset of `infoOpen`**

In `create()`, delete the line:

```ts
    this.infoOpen = false;
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: `✓ built` — no references to `infoOverlay`, `infoOpen`, `toggleInfoOverlay`, `createInfoButton`, `buildControlsOverlay`, or `controlHelpLines` remain in GameScene.

- [ ] **Step 6: Commit**

```bash
git add src/scenes/GameScene.ts
git commit -m "feat(game): replace ? info overlay with hamburger pause-menu button + Esc/P"
```

---

## Task 7: Wire InfiniteGameScene — add ☰ menu button

**Files:**
- Modify: `src/scenes/InfiniteGameScene.ts` (it has no menu button today; add one in `create()` near the HUD/scoreText setup ~274-280, and add the two methods)

- [ ] **Step 1: Add the menu-button creation call in `create()`**

After the score text is created (search for `this.scoreText = this.add.text(8, 8, '0 ft'`), add on the next line:

```ts
    this.createMenuButton();
```

- [ ] **Step 2: Add the `createMenuButton` and `openPauseMenu` methods**

Add these methods to the `InfiniteGameScene` class (e.g. just before `update`). `InputManager` is already imported in this file.

```ts
  private createMenuButton(): void {
    const bx = this.scale.width - 22;
    const by = 22;

    const btnGfx = this.add.graphics().setScrollFactor(0).setDepth(26);
    btnGfx.fillStyle(0x000000, 0.65);
    btnGfx.fillCircle(bx, by, 14);
    btnGfx.lineStyle(2, 0x8899bb, 1);
    btnGfx.strokeCircle(bx, by, 14);

    this.add.text(bx, by, '☰', {
      fontSize: '16px', color: '#ffffff', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(27);

    const hitZone = this.add.zone(bx, by, 40, 40).setScrollFactor(0).setDepth(27)
      .setInteractive({ useHandCursor: true });
    hitZone.on('pointerup', () => this.openPauseMenu());

    this.input.keyboard?.on('keydown-ESC', () => this.openPauseMenu());
    this.input.keyboard?.on('keydown-P',   () => this.openPauseMenu());
  }

  private openPauseMenu(): void {
    if (this.scene.isActive('PauseScene')) return;
    this.scene.launch('PauseScene', {
      gameSceneKey: this.scene.key,
      isMobile: InputManager.getInstance().isMobile,
    });
    this.scene.pause();
  }
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: `✓ built` with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/scenes/InfiniteGameScene.ts
git commit -m "feat(infinite): add hamburger pause-menu button + Esc/P"
```

---

## Task 8: MenuScene consolidation — remove ?, top-right ☰ settings, fold controls help in

**Files:**
- Modify: `src/scenes/MenuScene.ts` (`createInfoButton` ~1073+; `createSettingsButton` ~815-827; Controls-tab `ctrlHint` ~948-953; `createVolumeSlider` private method ~762-814; the `vols`/slider call sites ~903-920; imports ~6,13; the `createInfoButton()` call ~97)

- [ ] **Step 1: Remove the `?` info button**

Delete the entire `createInfoButton()` method (the one in MenuScene, ~1073 to its closing brace) and its call in `create()` (search `this.createInfoButton()`). Remove the now-unused import:

```ts
import { buildControlsOverlay } from '../ui/buildControlsOverlay';
```

- [ ] **Step 2: Migrate to the shared volume slider**

Delete MenuScene's private `createVolumeSlider(...)` method (~762-814). Add the import:

```ts
import { createVolumeSlider } from '../ui/buildVolumePanel';
```

Update the five call sites (~909-914) to call the shared function with `this` as the first argument, e.g.:

```ts
    const masterSliderParts = createVolumeSlider(this, SLIDER_X, CONTENT_TOP + 24, 'MASTER', 'master', vols.master, SLIDER_DEPTH);
    const musicSliderParts   = createVolumeSlider(this, SLIDER_X, CONTENT_TOP + 96,  'Music',        'music',     vols.music,     SLIDER_DEPTH);
    const playerSliderParts  = createVolumeSlider(this, SLIDER_X, CONTENT_TOP + 150, 'Player SFX',   'playerSfx', vols.playerSfx, SLIDER_DEPTH);
    const enemySliderParts   = createVolumeSlider(this, SLIDER_X, CONTENT_TOP + 204, 'Enemy SFX',    'enemySfx',  vols.enemySfx,  SLIDER_DEPTH);
    const envSliderParts     = createVolumeSlider(this, SLIDER_X, CONTENT_TOP + 258, 'Environment',  'envSfx',    vols.envSfx,    SLIDER_DEPTH);
```

- [ ] **Step 3: Move the settings button to top-right with a ☰ glyph**

In `createSettingsButton()`, change the position (lines ~816-817) from bottom-right to top-right and the glyph (line ~827) from gear to hamburger:

```ts
    const bx = this.scale.width - 22;
    const by = 22;
```

```ts
    this.add.text(bx, by, '☰', { fontSize: '16px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5).setDepth(20);
```

- [ ] **Step 4: Fold the controls help into the Controls tab**

Add the import for the help copy:

```ts
import { controlHelpLines } from '../ui/controlHelp';
```

Replace the static `ctrlHint` (lines ~948-951) with mode-aware help text at a smaller font, and refresh it when the mode changes. Change the `ctrlHint` creation to:

```ts
    const ctrlHint = this.add.text(cx, CONTENT_TOP + 108,
      controlHelpLines(im.isMobile, ctrlMode).join('\n'),
      { fontSize: '11px', color: '#aaaacc', align: 'left', lineSpacing: 3 },
    ).setOrigin(0.5, 0).setDepth(33).setVisible(false);
```

> `im` is the InputManager instance already obtained at the top of `createSettingsButton` (it is used for the tilt prompt). If `im` is not in scope there, add `const im = InputManager.getInstance();` at the top of the method.

In `paintMode()` (around line 955), refresh the help text so it matches the selected mode — append inside the function body:

```ts
      ctrlHint.setText(controlHelpLines(im.isMobile, ctrlMode).join('\n'));
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: `✓ built` — no references to the removed `createInfoButton`, the private `createVolumeSlider`, or `buildControlsOverlay` remain in MenuScene.

- [ ] **Step 6: Commit**

```bash
git add src/scenes/MenuScene.ts
git commit -m "feat(menu): consolidate to top-right hamburger; fold controls help into settings"
```

---

## Task 9: Verification — tests, build, and scene-preview

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `npm test`
Expected: all tests PASS (existing suite + the Task 1 volume-math tests).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: `✓ built`, no TypeScript errors.

- [ ] **Step 3: Scene-preview the main menu (verify ☰ top-right, no `?`)**

Ensure `npm run dev` is running, then:

Run: `npm run scene-preview -- MenuScene '{}' iphone14`
Read: `screenshots/preview.png`
Expected: a single ☰ button at the top-right; no `?` button. (Bottom-right gear gone.)

Run: `npm run scene-preview -- MenuScene '{"forceSettingsOpen":true}' iphone14`
Read: `screenshots/preview.png`
Expected: settings panel opens; the Controls tab shows the mode-aware help text inside the panel without clipping.

- [ ] **Step 4: Manual/headed check of the pause menu (PauseScene has no direct preview entry)**

PauseScene is launched from a running game scene, so verify it via the headed browser:

Run: `npm run scene-preview -- GameScene '{}' headed`
In the opened browser, tap the top-right ☰ (or press Esc), then confirm: PAUSED panel with Resume / Controls / Volume / Exit; the game is frozen behind it; Controls and Volume sub-views open with a working "← Back"; Exit shows the confirm and returns to the main menu; Resume/Esc closes and unfreezes.

> If a non-interactive screenshot of PauseScene is wanted later, add a `forcePause` dev flag to a game scene's `init` in a follow-up; out of scope here.

- [ ] **Step 5: Final commit (if any preview-driven tweaks were needed)**

```bash
git add -A
git commit -m "test(pause): verify pause menu + main-menu consolidation via build/test/preview"
```

---

## Self-Review notes

- **Spec coverage:** PauseScene overlay (T3-5), Resume/Controls/Volume/Exit + confirm (T3,4,5), Esc/P (T3,6,7), both game scenes (T6,7), `buildVolumePanel` extraction + MenuScene reuse (T2,8), main-menu `?` removal + top-right ☰ + folded controls help (T8), pause semantics via `scene.pause()` (T6,7), double-open guard (T6,7), testing via pure-math unit tests + scene-preview (T1,9). All spec sections map to a task.
- **Type consistency:** `createVolumeSlider(scene, x, y, label, cat, initial, depth)` and `buildVolumePanel(scene, {depth, onBackgroundTap})` are used identically in T2/T8 and T2/T4. `PauseSceneData { gameSceneKey, isMobile }` is produced in T6/T7 and consumed in T3. `ControlsOverlay`/`VolumePanel` interfaces from T2/PR-#45 are used in T4.
- **Open risk:** the Controls-tab help text fit at 11px is approximate; T9 Step 3 verifies it and the engineer reduces font/spacing if it clips (noted in spec).

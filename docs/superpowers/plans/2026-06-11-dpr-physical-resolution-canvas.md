# DPR Physical-Resolution Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the game canvas at physical device pixels so mobile text is crisp, by switching to a self-managed `Scale.NONE` sizing loop + `camera.zoom = DPRcap`, and migrating all logical-coordinate consumers to a `DPRcap`-aware helper.

**Architecture:** The canvas backing store is sized to `cssSize × DPRcap` (crisp) while its CSS display size stays `cssSize` (1:1 with the device, no OS upscale). Every camera gets `zoom = DPRcap` so logical-authored world/UI content fills the physical canvas. A new `displayMetrics` module is the single source of truth for `DPRcap` and logical dimensions; ~190 `scale.width/height` reads, a class of camera-viewport world-math reads, and `InputManager` touch mapping migrate to it. `DPRcap = min(devicePixelRatio, 2.5)`, and `1` under the scene-preview (`?dev`) tooling.

**Tech Stack:** Phaser 3.90 (Scale Manager, multi-camera), TypeScript 5.9, Vite 6, Vitest, Playwright (DPR verification).

**Spec:** [docs/superpowers/specs/2026-06-11-dpr-physical-resolution-canvas-design.md](../specs/2026-06-11-dpr-physical-resolution-canvas-design.md)

**Branching:** This work must land on a fresh feature branch off `main` (e.g. `feat/dpr-physical-canvas`), per CLAUDE.md. The current branch `docs/7b-dpr-diagnosis` holds only the diagnosis + spec/plan docs; create the feature branch before Task 2 (the first code change). Commit docs first if not already merged.

---

## Verification model (read first)

Most of this change is integration-level (Scale Manager + rendering) and cannot be unit-tested. Only two units are pure and get TDD: `displayMetrics` (Task 1) and the `InputManager` transform normalization (Task 9). Everything else is verified by, in order of authority:

1. **Milestone-1 gate (Task 2)** — a Playwright script at `deviceScaleFactor: 2.5` proves the physical-backing-store mechanism and touch-transform correctness. **Blocking: do not start Task 3+ until it passes.**
2. **`npm run build`** after every code task (catches TS errors tests miss — see CLAUDE.md).
3. **`npm test`** — the existing suite must stay green (787 client tests baseline).
4. **scene-preview screenshots** per migrated scene (`npm run scene-preview`) — confirm layouts unchanged.
5. **Live-play / device QA (Task 13)** — camera-space culling + crispness + perf; cannot be seen in screenshots.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/systems/displayMetrics.ts` | **Create** | Source of truth: `getDprCap()`, `DPR_CAP`, `logicalWidth/Height(scene)`, `applyCameraZoom(scene)` |
| `src/systems/__tests__/displayMetrics.test.ts` | **Create** | Unit tests for the above |
| `src/main.ts` | Modify | `Scale.NONE` config + `applyCanvasSize()` resize loop + text-factory cap alignment |
| `src/systems/CameraController.ts` | Modify | Apply `zoom` on gameplay cameras |
| `scripts/dpr-gate.mjs` | **Create** | Playwright DPR verification (milestone-1 gate) |
| `src/scenes/*.ts` (8 scenes) | Modify | Migrate `scale.width/height` → logical helper; UI scenes apply camera zoom; gameplay scenes fix camera-space reads |
| `src/ui/buildVolumePanel.ts`, `src/ui/buildControlsOverlay.ts` | Modify | Migrate layout reads |
| `src/ui/HUD.ts`, `src/systems/ParallaxBackground.ts`, `src/systems/PickupManager.ts`, `src/systems/PlaceableManager.ts`, `src/systems/PortalManager.ts`, `src/systems/mountJoystick.ts`, `src/entities/PlayerOutro.ts` | Modify | Migrate layout + camera-space reads |
| `src/systems/InputManager.ts` | Modify | Normalize `transformX/Y` output by `DPRcap` so suppression rects stay logical |
| `src/systems/__tests__/InputManager.test.ts` | Modify | Cover the DPR-normalized transform |

---

## Task 1: `displayMetrics` module (TDD)

**Files:**
- Create: `src/systems/displayMetrics.ts`
- Test: `src/systems/__tests__/displayMetrics.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/systems/__tests__/displayMetrics.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDprCap, DPR_CAP, logicalWidth, logicalHeight } from '../displayMetrics';

function stubWindow(dpr: number, search = ''): void {
  vi.stubGlobal('window', {
    devicePixelRatio: dpr,
    location: { search },
  } as unknown as Window);
}

describe('displayMetrics', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('DPR_CAP is 2.5', () => {
    expect(DPR_CAP).toBe(2.5);
  });

  it('caps a high devicePixelRatio at 2.5', () => {
    stubWindow(3.5);
    expect(getDprCap()).toBe(2.5);
  });

  it('returns the real ratio below the cap', () => {
    stubWindow(2);
    expect(getDprCap()).toBe(2);
  });

  it('returns 1 under the scene-preview (?dev) tooling regardless of ratio', () => {
    stubWindow(3, '?dev');
    expect(getDprCap()).toBe(1);
  });

  it('falls back to 1 when devicePixelRatio is missing', () => {
    stubWindow(undefined as unknown as number);
    expect(getDprCap()).toBe(1);
  });

  it('derives logical width/height by dividing scale size by the cap', () => {
    stubWindow(2);
    const scene = { scale: { width: 822, height: 1600 } } as unknown as Phaser.Scene;
    expect(logicalWidth(scene)).toBe(411);
    expect(logicalHeight(scene)).toBe(800);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/systems/__tests__/displayMetrics.test.ts`
Expected: FAIL — `Cannot find module '../displayMetrics'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/systems/displayMetrics.ts
import type Phaser from 'phaser';

/** Hard ceiling on render resolution. Bounds the ~DPRcap² fill cost on flagship
 *  phones while keeping text near-native on a ~2.6 DPR device (see spec §"Decisions"). */
export const DPR_CAP = 2.5;

/** Effective device pixel ratio used for the physical canvas + camera zoom.
 *  Returns 1 under the scene-preview (`?dev`) tooling, which forces the Canvas
 *  renderer at a fixed device size and must stay logical. */
export function getDprCap(): number {
  if (typeof window === 'undefined') return 1;
  const isScenePreview =
    typeof window.location !== 'undefined' &&
    new URLSearchParams(window.location.search).has('dev');
  if (isScenePreview) return 1;
  const dpr = window.devicePixelRatio;
  return Math.min(typeof dpr === 'number' && dpr > 0 ? dpr : 1, DPR_CAP);
}

/** Logical (CSS-pixel) viewport width. `scene.scale.width` is physical once the
 *  game size is `css × DPRcap`; divide it back to author layout in logical px. */
export function logicalWidth(scene: Phaser.Scene): number {
  return scene.scale.width / getDprCap();
}

/** Logical (CSS-pixel) viewport height. See {@link logicalWidth}. */
export function logicalHeight(scene: Phaser.Scene): number {
  return scene.scale.height / getDprCap();
}

/** Set a scene's main camera zoom to DPRcap so logical-authored content fills the
 *  physical canvas. Idempotent — safe to call again after a scene restart. */
export function applyCameraZoom(scene: Phaser.Scene): void {
  scene.cameras.main.setZoom(getDprCap());
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/systems/__tests__/displayMetrics.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Build + commit**

```bash
npm run build
git add src/systems/displayMetrics.ts src/systems/__tests__/displayMetrics.test.ts
git commit -m "feat(dpr): add displayMetrics — DPRcap + logical dimension helpers"
```

---

## Task 2: Scale.NONE self-managed sizing + camera zoom — **MILESTONE-1 GATE**

This is the risky core. The whole approach lives or dies here. Build the mechanism, then prove it with the Playwright gate **before** any migration work.

**Files:**
- Modify: `src/main.ts` (scale config ~line 56-63; resize handler ~line 95-119)
- Modify: `src/systems/CameraController.ts`
- Create: `scripts/dpr-gate.mjs`

- [ ] **Step 1: Extend `CameraController.setup` with a zoom argument**

```ts
// src/systems/CameraController.ts
import Phaser from 'phaser';
import { getDprCap } from './displayMetrics';

export class CameraController {
  static setup(
    scene: Phaser.Scene,
    target: Phaser.GameObjects.Sprite,
    worldWidth: number,
    worldHeight: number,
    worldX = 0,
    zoom = getDprCap(),
  ): void {
    scene.cameras.main.setBounds(worldX, 0, worldWidth, worldHeight);
    scene.cameras.main.setZoom(zoom);
    scene.cameras.main.startFollow(target, true, 1, 0.1);
    scene.cameras.main.centerOn(target.x, target.y);
  }
}
```

- [ ] **Step 2: Switch the scale config to `NONE` in `src/main.ts`**

Replace the `scale` block:

```ts
  scale: {
    mode: Phaser.Scale.NONE,
    autoCenter: Phaser.Scale.NO_CENTER,
    width: window.innerWidth * UI_TEXT_RESOLUTION,   // corrected immediately by applyCanvasSize()
    height: window.innerHeight * UI_TEXT_RESOLUTION,
  },
```

(`UI_TEXT_RESOLUTION` is replaced by `getDprCap()` in Step 5; until then this is a sane initial guess that `applyCanvasSize()` overwrites on first call.)

- [ ] **Step 3: Replace the resize handler with the self-managed sizing loop**

Replace the existing `game.scale.on(Phaser.Scale.Events.RESIZE, ...)` block (and keep the `RESIZE_SAFE_SCENES`/debounce/`gameAssetsReady` guards) with:

```ts
import { getDprCap, applyCameraZoom } from './systems/displayMetrics';

const RESIZE_SAFE_SCENES = ['MenuScene', 'HeapSelectScene', 'UpgradeScene', 'StoreScene', 'LeaderboardScene'];

/**
 * Size the canvas backing store to physical pixels (css × DPRcap) for crisp
 * rendering, while pinning the CSS display size to logical px (1:1 with the
 * device). Then re-cache the ScaleManager bounds (so touch transforms aren't
 * stale — spec §1) and re-apply camera zoom on every live scene.
 */
function applyCanvasSize(): void {
  const parent = document.getElementById('game');
  if (!parent) return;
  const cssW = parent.clientWidth || window.innerWidth;
  const cssH = parent.clientHeight || window.innerHeight;
  const dpr  = getDprCap();

  game.scale.resize(cssW * dpr, cssH * dpr);   // physical backing store

  const canvas = game.canvas;
  canvas.style.width  = cssW + 'px';           // logical display size
  canvas.style.height = cssH + 'px';

  game.scale.refresh();                         // re-cache canvasBounds + displayScale

  for (const scene of game.scene.getScenes(true)) {
    if (scene.cameras?.main) {
      scene.cameras.resize(cssW * dpr, cssH * dpr);
      applyCameraZoom(scene);
    }
  }
}

// Initial sizing once the game boots, then on every window resize (debounced).
game.events.once(Phaser.Core.Events.READY, applyCanvasSize);

let _resizeTimer: ReturnType<typeof setTimeout>;
let _lastResizeW = 0;
let _lastResizeH = 0;
window.addEventListener('resize', () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    if (game.registry.get('gameAssetsReady') !== true) { applyCanvasSize(); return; }

    const parent = document.getElementById('game');
    const w = Math.round(parent?.clientWidth ?? window.innerWidth);
    const h = Math.round(parent?.clientHeight ?? window.innerHeight);
    if (w === _lastResizeW && h === _lastResizeH) return;
    _lastResizeW = w;
    _lastResizeH = h;

    applyCanvasSize();
    for (const scene of game.scene.getScenes(true)) {
      if (RESIZE_SAFE_SCENES.includes(scene.scene.key)) scene.scene.restart();
    }
  }, 200);
});
```

> Note: gameplay scenes (`GameScene`, `InfiniteGameScene`) are intentionally NOT in `RESIZE_SAFE_SCENES` — they re-zoom live via `applyCanvasSize()` without a state-destroying restart.

- [ ] **Step 4: Have gameplay scenes pass the zoom through `CameraController`**

In `GameScene.ts` and `InfiniteGameScene.ts`, the existing `CameraController.setup(...)` calls now pick up `zoom = getDprCap()` by default (added in Step 1) — no change needed unless a call already passes a 6th arg. Verify by grep: `grep -n "CameraController.setup" src/scenes/*.ts` and confirm none pass a 6th positional argument.

- [ ] **Step 5: Align the text-resolution factory cap to DPRcap**

In `src/main.ts`, replace the `UI_TEXT_RESOLUTION` constant and its use in the `add.text` factory:

```ts
import { getDprCap } from './systems/displayMetrics';
// ...delete the old `const UI_TEXT_RESOLUTION = Math.min(...3)`...
// In the factory body, replace `resolution: UI_TEXT_RESOLUTION` with:
const merged = { resolution: getDprCap(), ...(style ?? {}) };
```

Also update the Step-2 scale config `width/height` to use `getDprCap()` instead of `UI_TEXT_RESOLUTION`.

- [ ] **Step 6: Write the DPR verification gate script**

```js
// scripts/dpr-gate.mjs
// Verifies the physical-backing-store mechanism at a simulated high DPR.
// Requires the dev server running: `npm run dev` (http://localhost:3000).
// Run: node scripts/dpr-gate.mjs
import { chromium } from 'playwright';

const DPR = 2.5;
const URL = 'http://localhost:3000';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 411, height: 891 },
  deviceScaleFactor: DPR,
});
const page = await context.newPage();
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!(window).game?.scale?.canvas, null, { timeout: 15000 });

const result = await page.evaluate(() => {
  const g = (window).game;
  const canvas = g.scale.canvas;
  const parent = document.getElementById('game');
  const cssW = parent.clientWidth;
  // transformX of a known page point should map to physical game-space:
  const tx = g.scale.transformX(cssW / 2); // center page x -> expect ~ canvas.width/2
  return {
    backingW: canvas.width,
    styleW: canvas.style.width,
    cssW,
    expectedBackingW: Math.round(cssW * 2.5),
    transformXCenter: tx,
    expectedTransformX: canvas.width / 2,
  };
});

const okBacking = Math.abs(result.backingW - result.expectedBackingW) <= 2;
const okStyle = result.styleW === result.cssW + 'px';
const okTransform = Math.abs(result.transformXCenter - result.expectedTransformX) <= 3;

console.log(JSON.stringify(result, null, 2));
console.log({ okBacking, okStyle, okTransform });

await page.screenshot({ path: 'dpr-gate.png' });
await browser.close();

if (!(okBacking && okStyle && okTransform)) {
  console.error('DPR GATE FAILED');
  process.exit(1);
}
console.log('DPR GATE PASSED');
```

- [ ] **Step 7: Run the gate**

```bash
npm run dev &   # in one shell
node scripts/dpr-gate.mjs
```

Expected: `okBacking`, `okStyle`, `okTransform` all `true`; `DPR GATE PASSED`. Open `dpr-gate.png` and confirm the MenuScene text is crisp (compare against a `deviceScaleFactor:1` run).

**If the gate fails (esp. `okStyle` — Phaser re-overwriting the CSS, or `okTransform` — stale bounds): STOP.** Do not proceed to migration. Re-evaluate per spec "Items to double-check #1": either add a post-`refresh()` style re-pin on the Scale Manager's own `RESIZE` event, or fall back to keeping `Scale.RESIZE` and overriding only the backing store in the resize handler. Report findings before continuing.

- [ ] **Step 8: Build + commit (only if gate passed)**

```bash
npm run build
git add src/main.ts src/systems/CameraController.ts scripts/dpr-gate.mjs
git commit -m "feat(dpr): physical-resolution canvas via Scale.NONE + camera zoom (gate passing)"
```

---

## Task 3: Apply camera zoom to UI scenes (restart-safe)

UI scenes use the default camera (no `CameraController`); after a resize restart their zoom resets to 1. Set it in each `create()`.

**Files:** Modify `create()` in: `MenuScene.ts`, `HeapSelectScene.ts`, `UpgradeScene.ts`, `StoreScene.ts`, `LeaderboardScene.ts`, `PauseScene.ts`, `ScoreScene.ts`, `TexturePreviewScene.ts`.

- [ ] **Step 1: Add the zoom call as the first line of each scene's `create()`**

```ts
import { applyCameraZoom } from '../systems/displayMetrics';
// first line of create():
applyCameraZoom(this);
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: no TS errors.

- [ ] **Step 3: Commit**

```bash
git add src/scenes/MenuScene.ts src/scenes/HeapSelectScene.ts src/scenes/UpgradeScene.ts src/scenes/StoreScene.ts src/scenes/LeaderboardScene.ts src/scenes/PauseScene.ts src/scenes/ScoreScene.ts src/scenes/TexturePreviewScene.ts
git commit -m "feat(dpr): apply DPRcap camera zoom to UI scenes"
```

> After this task the UI scenes render zoomed but still lay out off physical `scale.width` → everything is shifted/clipped. That is expected and fixed by Tasks 4–8. Screenshots will look wrong until each scene is migrated; verify per-scene at the end of its task.

---

## Tasks 4–8: Migrate logical-layout reads (`scale.width/height` → helper)

**Mechanical rule (applies to every file in these tasks):**
- Replace `this.scale.width` → `logicalWidth(this)` and `this.scale.height` → `logicalHeight(this)` (and `scene.scale.width` → `logicalWidth(scene)` in non-scene helpers).
- **Do NOT replace** reads that feed the *renderer/camera viewport in physical px* — there are none in UI scenes, but watch for `cameras.resize(...)` (none currently in scenes).
- Add `import { logicalWidth, logicalHeight } from '<rel>/systems/displayMetrics';`
- Find every site in a file with: `grep -n "scale.width\|scale.height" <file>`

**Verification for every file:** `npm run build` (clean) + `npm run scene-preview -- <Scene> '<state json>' pixel7` and confirm the screenshot matches the pre-change layout. For non-scene UI helpers, screenshot a scene that uses them.

> **Sourcing the `<state json>`:** reuse the exact init payloads from prior scene-preview runs — invoke the `heap-scene-preview` skill, or grep the repo/git history for `scene-preview` invocations of that scene. Capture a baseline screenshot of each scene **before** migrating it (on the pre-change commit) so "matches pre-change layout" is a concrete pixel comparison, not a memory.

Representative diff (applies throughout):
```ts
// before
const cx = this.scale.width / 2;
const panelTop = this.scale.height - 120;
// after
const cx = logicalWidth(this) / 2;
const panelTop = logicalHeight(this) - 120;
```

### Task 4: MenuScene + HeapSelectScene
- [ ] Migrate `src/scenes/MenuScene.ts` (39 sites). Verify: `npm run scene-preview -- MenuScene '{}' pixel7`.
- [ ] Migrate `src/scenes/HeapSelectScene.ts` (13 sites). Verify: scene-preview HeapSelectScene.
- [ ] `npm run build` && commit: `git commit -am "refactor(dpr): MenuScene + HeapSelectScene logical layout"`

### Task 5: ScoreScene
- [ ] Migrate `src/scenes/ScoreScene.ts` (37 sites). Verify: `npm run scene-preview -- ScoreScene '<a representative score-state json>' pixel7`.
- [ ] `npm run build` && commit: `git commit -am "refactor(dpr): ScoreScene logical layout"`

### Task 6: UpgradeScene + StoreScene (incl. scroll camera math)
These scenes scroll the camera (`cam.scrollY` clamped to `maxScroll`) and read `scale.height` for the visible viewport. Migrate layout reads AND the scroll-bound math to logical, since the visible world height under `zoom = DPRcap` is `scale.height / DPRcap = logicalHeight`.
- [ ] Migrate `src/scenes/UpgradeScene.ts` (20 sites). Specifically convert `visBot = cam.scrollY + this.scale.height - FOOTER_HEIGHT` (line ~262) → `cam.scrollY + logicalHeight(this) - FOOTER_HEIGHT`, and any `maxScroll = contentHeight - this.scale.height` → `... - logicalHeight(this)`. Verify scroll: scene-preview + confirm top and bottom rows reachable.
- [ ] Migrate `src/scenes/StoreScene.ts` (18 sites + its `maxScroll`/viewport math, line ~299). Verify scroll reaches last row.
- [ ] `npm run build` && commit: `git commit -am "refactor(dpr): Upgrade/Store logical layout + scroll bounds"`

### Task 7: PauseScene + LeaderboardScene + TexturePreviewScene
- [ ] Migrate `src/scenes/PauseScene.ts` (12 sites). The full-screen suppression rect (line ~124) `{x:0,y:0,w:this.scale.width,h:this.scale.height}` → `{x:0,y:0,w:logicalWidth(this),h:logicalHeight(this)}` (it stays logical because Task 9 normalizes the transform). Verify: scene-preview PauseScene.
- [ ] Migrate `src/scenes/LeaderboardScene.ts` (2 sites) and `src/scenes/TexturePreviewScene.ts` (4 sites). Verify scene-preview each.
- [ ] `npm run build` && commit: `git commit -am "refactor(dpr): Pause/Leaderboard/TexturePreview logical layout"`

### Task 8: UI builders + HUD + PlaceableManager
- [ ] Migrate `src/ui/buildVolumePanel.ts` (5), `src/ui/buildControlsOverlay.ts` (4) — both take a `scene` param; use `logicalWidth(scene)`/`logicalHeight(scene)`. Verify via MenuScene settings + GameScene pause controls scene-preview.
- [ ] Migrate `src/ui/HUD.ts` (2) and `src/systems/PlaceableManager.ts` (2). Verify GameScene scene-preview.
- [ ] `npm run build` && commit: `git commit -am "refactor(dpr): UI builders + HUD + PlaceableManager logical layout"`

---

## Task 9: Normalize `InputManager` touch transform by DPRcap (TDD)

After Task 2, `ScaleManager.transformX/Y` returns **physical** game coords, but suppression rects are authored in **logical** coords (Tasks 7/10). Normalize once here instead of scaling every rect.

**Files:**
- Modify: `src/systems/InputManager.ts` (`isInSuppressionZone`, ~line 173-181)
- Modify: `src/systems/__tests__/InputManager.test.ts`

- [ ] **Step 1: Add a failing test for DPR-normalized hit-testing**

Add to `InputManager.test.ts` (mirror the existing suppression-zone setup ~line 588+; the existing `ScreenTransform` mock returns physical coords, so simulate DPR 2 by having `transformX/Y` scale page→physical and a logical rect):

```ts
// Ensure `vi` is imported at the top of the file (it likely already is):
//   import { describe, it, expect, vi } from 'vitest';
it('hit-tests suppression zones in logical space when transform returns physical coords', () => {
  // Simulate DPRcap = 2: page (logical) -> physical game coords.
  // Use vi.stubGlobal so jsdom's real window is restored after (no global leak).
  vi.stubGlobal('window', { devicePixelRatio: 2, location: { search: '' } });
  try {
    const im = InputManager.getInstance();
    im.attachScreenTransform({
      transformX: (px: number) => px * 2,   // physical
      transformY: (py: number) => py * 2,
    } as any);
    // Logical button rect at logical (100..200, 100..150)
    im.setSuppressionRect('grab', { x: 100, y: 100, w: 100, h: 50 });
    // A touch at logical page (150,120) is inside the logical rect.
    expect((im as any).isInSuppressionZone(150, 120)).toBe(true);
    // A touch at logical (300,300) is outside.
    expect((im as any).isInSuppressionZone(300, 300)).toBe(false);
    im.setSuppressionRect('grab', null);
  } finally {
    vi.unstubAllGlobals();
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/systems/__tests__/InputManager.test.ts -t "logical space"`
Expected: FAIL — currently `transformX` output (300 physical) is compared to the logical rect (100..200) → returns false instead of true.

- [ ] **Step 3: Implement the normalization**

```ts
// src/systems/InputManager.ts — top imports
import { getDprCap } from './displayMetrics';

// isInSuppressionZone:
private isInSuppressionZone(pageX: number, pageY: number): boolean {
  if (!this.screenTransform || this.suppressRects.size === 0) return false;
  const dpr = getDprCap();
  const gx = this.screenTransform.transformX(pageX) / dpr; // back to logical
  const gy = this.screenTransform.transformY(pageY) / dpr;
  for (const r of this.suppressRects.values()) {
    if (gx >= r.x && gx <= r.x + r.w && gy >= r.y && gy <= r.y + r.h) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run the full InputManager suite**

Run: `npx vitest run src/systems/__tests__/InputManager.test.ts`
Expected: PASS — the new test plus all existing ones (existing tests run with `getDprCap()===1` since their mock window has no high dpr, so behaviour is unchanged).

- [ ] **Step 5: Build + commit**

```bash
npm run build
git add src/systems/InputManager.ts src/systems/__tests__/InputManager.test.ts
git commit -m "feat(dpr): normalize InputManager touch transform by DPRcap"
```

---

## Task 10 — REVISED (separate UI camera required)

> **Finding during execution (DPR-2.5 screenshot):** the gameplay world renders
> correctly under `zoom + centerOn(player) + follow`, but the **HUD/buttons/joystick
> (all `setScrollFactor(0)`) render off-screen**. A zoomed camera pivots zoom on its
> physical viewport centre; a *following* gameplay camera can't also centre on the
> logical UI origin (the trick that fixes static menu scenes). **User-approved fix:
> a dedicated UI camera for the 2 gameplay scenes only.**
>
> **Design:** create a 2nd camera (`zoom = DPRcap`, `centerOn(logicalW/2, logicalH/2)`,
> non-following) that renders ONLY the HUD layer; `mainCam.ignore(uiLayer)` and
> `uiCam.ignore(everything else)`. Put all HUD/button/joystick objects into a
> `Phaser.GameObjects.Layer`; main camera ignores that layer; the UI camera ignores
> all current scene-root children + hooks `ADDED_TO_SCENE` to ignore future world
> objects (enemies/pickups/chunks/placeables spawn dynamically).
>
> **Critical gotcha:** dynamically-created **UI** (grab button, place button, revive
> HUD badge, joystick parts) must be added to the UI layer too — otherwise the
> "ignore scene-root additions" hook makes them vanish from the UI camera. Each UI
> creator (HUD.ts, mountJoystick, PickupManager grab button, GameScene place/score/
> pause) must register its objects to the layer, including lazily-created ones.
> Verify on-canvas at DPR 2.5: score + ☰ + grab/place + joystick all visible and
> correctly placed; no world object double-rendered over the HUD.
>
> The original Task-10 steps below (logical layout + camera-space `worldView` math +
> joystick) still apply, plus this UI-camera wiring.

## Task 10 (original): Migrate gameplay scenes + their button/world-space reads

`GameScene` and `InfiniteGameScene` mix three classes: logical layout, suppression rects (logical, positioned via `scale.width`), and camera-space world math.

**Files:** `src/scenes/GameScene.ts`, `src/scenes/InfiniteGameScene.ts`, `src/systems/mountJoystick.ts`

- [ ] **Step 1: GameScene logical layout + suppression rect**
  - Migrate the 12 `scale.width/height` layout sites → logical helper.
  - The PLACE suppression rect (line ~491) `{ x: this.scale.width / 2 - 140, ... }` → `{ x: logicalWidth(this) / 2 - 140, ... }` (stays logical; Task 9 normalizes).

- [ ] **Step 2: GameScene camera-space world math** (invisible to screenshots — verify in live play)
  - Line ~406 `const halfW = this.cameras.main.width / 2;` → `const halfW = this.cameras.main.worldView.width / 2;` (visible world half-width for the wrap follow-offset).
  - Line ~428 `const camBottom = cam.scrollY + cam.height;` → `const camBottom = cam.worldView.bottom;`

- [ ] **Step 3: mountJoystick** — migrate `scene.scale.width/height` (lines ~33-34) → `logicalWidth(scene)`/`logicalHeight(scene)`. The stick/dash buttons are `setScrollFactor(0)` and now render through the zoomed camera; logical coords place them correctly. Their suppression rects stay logical (Task 9). InfiniteGameScene also mounts the joystick — covered here.

- [ ] **Step 4: InfiniteGameScene** — migrate its 1 `scale.width/height` site. Its camera-space reads (lines ~390-391) already use `cam.worldView` — leave them.

- [ ] **Step 5: Verify**
  - `npm run build` (clean).
  - `npm run scene-preview -- GameScene '<a representative game-state json>' pixel7` and InfiniteGameScene — layout + HUD + buttons correct.
  - **Live-play check (joystick mode on, mobile emulation):** drag the joystick and confirm it tracks the thumb; tap GRAB/PLACE/dash and confirm no leaked jump (the Task-9 normalization in action); confirm enemies/chunks below the screen still cull/spawn correctly (camBottom).

- [ ] **Step 6: Commit**

```bash
git commit -am "refactor(dpr): gameplay scenes logical layout + worldView camera math + joystick"
```

> **Interactive-input risk (verify, fix if needed):** Phaser pointer coords (`pointer.x/y`) are in physical game space after Task 2; `setInteractive` hit-areas on `setScrollFactor(0)` objects positioned in logical coords are resolved by Phaser through the camera, so they *should* line up — but the dash button `pointerdown` and joystick drag MUST be confirmed in the live-play check above. If a button's tap target is offset, use `pointer.worldX/worldY` or divide pointer coords by `getDprCap()` at the input site. Treat a miss here like the milestone gate: stop and fix before moving on.

---

## Task 11: Migrate remaining systems (layout + camera-space)

**Files:** `src/systems/ParallaxBackground.ts`, `src/systems/PickupManager.ts`, `src/systems/PortalManager.ts`, `src/entities/PlayerOutro.ts`

- [ ] **Step 1: ParallaxBackground** — migrate 8 `scale.width/height` sites → logical helper (`scene` is available). Verify GameScene scene-preview (sky/cloud bands fill width).
- [ ] **Step 2: PickupManager**
  - Migrate the 6 layout sites (incl. the GRAB button rect at line ~425 — stays logical).
  - Camera-space cull (line ~178): `this.cullBelow(scrollY + cam.height + CULL_MARGIN)` → `this.cullBelow(this.scene.cameras.main.worldView.bottom + CULL_MARGIN)`.
- [ ] **Step 3: PortalManager** — 1 site; its `camBottom` (line ~120) already uses `worldView.bottom` — only migrate any `scale.width/height` layout read if present (grep). 
- [ ] **Step 4: PlayerOutro** — migrate 4 `scale.width/height` sites → logical helper. Verify via a death/success outro scene-preview if available, else live-play.
- [ ] **Step 5: Verify + commit**
  - `npm run build` (clean); live-play GameScene — pickups beyond the bottom of screen still cull, parallax fills, outro overlay centered.
  - `git commit -am "refactor(dpr): parallax/pickup/portal/outro logical + worldView cull"`

---

## Task 12: Full-codebase sweep verification

- [ ] **Step 1: Confirm no stray physical-space layout reads remain**

Run: `grep -rn "scale.width\|scale.height" src --include="*.ts" | grep -v __tests__ | grep -v displayMetrics`
Expected: every remaining hit is either inside `displayMetrics.ts` or a deliberate physical-space use (none expected). Investigate any survivor.

- [ ] **Step 2: Confirm no raw camera-viewport world math remains**

Run: `grep -rn "cameras.main.height\|cameras.main.width\|\.scrollY + .*\.height\|\.scrollX + .*\.width" src --include="*.ts" | grep -v __tests__`
Expected: only `worldView`-based reads and intentional logical-height scroll math (Upgrade/Store) remain. Investigate any `cam.height`/`cam.width` still feeding world coordinates.

- [ ] **Step 3: Full test suite + build**

```bash
npm test
npm run build
```
Expected: all client tests green (≥787 + new displayMetrics/InputManager tests), build clean.

- [ ] **Step 4: Commit any fixes**

```bash
git commit -am "test(dpr): sweep verification fixes" || echo "nothing to commit"
```

---

## Task 13: Device + perf QA (manual gate before merge)

Cannot be done in headless/CI — this is the spec's real-device gate.

- [ ] **Step 1: DPR gate at multiple ratios.** Re-run `node scripts/dpr-gate.mjs` editing `deviceScaleFactor` to `2`, `2.5`, `3` — confirm `okBacking` tracks `min(dpr,2.5)` (so at 3 it caps at 2.5: `backingW ≈ cssW*2.5`) and the gate passes each time.
- [ ] **Step 2: Real device (Samsung S25, DPR ~2.6).** Build + deploy to device; confirm "How high can you climb?", "START RUN", heap-select labels, HUD, ScoreScene are now crisp (the originally-soft text). Confirm the heap composite is still soft (expected, out of scope). 
- [ ] **Step 3: Perf.** On-device, confirm frame rate holds during gameplay (fill cost ~DPRcap²; the 2.5 cap is the lever). If it regresses on lower-end hardware, lower `DPR_CAP` in `displayMetrics.ts` (single constant).
- [ ] **Step 4: Interaction smoke on device.** Joystick tracking, GRAB/PLACE/dash taps (no leaked jump), pause overlay swallows taps, Upgrade/Store scroll reach top+bottom rows.
- [ ] **Step 5: `roundPixels` watch.** Look for sub-pixel sprite jitter under the fractional 2.5 zoom during scrolling/movement; if present, evaluate toggling `render.roundPixels` and re-test.
- [ ] **Step 6:** Update `Todo/Bugs.md` item 7b → `[x]` with a one-line resolution, and finish the branch (PR) per `superpowers:finishing-a-development-branch`.

---

## Notes for the implementer

- **DRY:** `displayMetrics` is the only place `2.5` / `devicePixelRatio` / `?dev` logic lives. Never recompute DPR inline.
- **YAGNI:** no separate UI camera, no heap PNG re-authoring (out of scope, spec §6).
- **Commit cadence:** one commit per task as shown; keep the tree green (`npm run build`) at every commit.
- **The two stop-and-reassess gates** are Task 2 Step 7 (Scale.NONE mechanism) and Task 10 Step 6 note (interactive input under zoom). Do not paper over a failure at either — report and reconsider.

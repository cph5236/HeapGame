# Handoff: Resume DPR Physical-Resolution Canvas at Task 10

You are taking over an in-progress feature implementation in the **HeapGame** repo
(Phaser 3.90 + TypeScript 5.9 + Vite 6 + Vitest). Mobile-first 2D climbing game.
Work from `/home/connor/Documents/Repos/HeapGame`.

## Mission

Finish bug **#7b** (`Todo/Bugs.md` → Mobile → 7b): render the game canvas at physical
device pixels so mobile text is crisp. You are resuming at **Task 10** of a written
plan. Tasks 1–9 are DONE, committed, and verified.

- **Branch:** `feat/dpr-physical-canvas` (STAY ON IT — do NOT branch off or merge to main).
- **Spec:** `docs/superpowers/specs/2026-06-11-dpr-physical-resolution-canvas-design.md`
- **Plan:** `docs/superpowers/plans/2026-06-11-dpr-physical-resolution-canvas.md`
  — read the **"Task 10 — REVISED"** section first; it has the full UI-camera design.
- **Execution method:** subagent-driven-development (fresh subagent per task + spec
  & code-quality review), OR implement directly — but VERIFY VISUALLY (see below).
  The current HEAD is `74d0c91`.

## How the system works now (read before touching code)

Approach "A": the canvas backing store is sized to `cssSize × DPRcap` (crisp), CSS
display size stays logical, and every camera gets `zoom = DPRcap`.

- **`src/systems/displayMetrics.ts`** is the single source of truth. Exports:
  - `DPR_CAP = 2.5`, `getDprCap()` → `min(devicePixelRatio, 2.5)`; returns **1** under
    the scene-preview `?dev` flag.
  - `logicalWidth(scene)` / `logicalHeight(scene)` = `scene.scale.{width,height} / getDprCap()`.
    `scene.scale.width/height` now return **physical** px, so ALL UI layout uses these.
  - `applyCameraZoom(scene)` — zoom only (used by the resize loop; safe on a following camera).
  - `setupUiCamera(scene)` — zoom **+ `centerOn(logicalW/2, logicalH/2)`**. Static UI scenes
    need the centring or content renders off-frame.
- **`src/main.ts`**: `Scale.NONE` + `applyCanvasSize()` resize loop (physical backing
  store + logical CSS + `scale.refresh()`); cameras re-zoom on resize; the `add.text`
  factory uses `getDprCap()` for `resolution`. A **`?canvas`** URL flag forces the
  Canvas renderer WITHOUT forcing DPR=1 (headless WebGL has no framebuffer and never
  boots; `?dev` forces DPR=1 and is for scene-preview only).
- **`src/systems/CameraController.ts`**: `setup()` takes a `zoom` arg (default `getDprCap()`);
  gameplay scenes already get zoom + `centerOn(player)` + follow here.
- **`src/systems/InputManager.ts`**: `isInSuppressionZone` divides `transformX/Y` output
  by `getDprCap()`, so on-screen-button suppression rects stay authored in LOGICAL coords.

## CRITICAL: how to verify (this is what caught the real bugs)

Unit tests + code review are NOT enough here — two real bugs passed review and were
only caught by looking at the rendered canvas at high DPR. Use this:

1. The **user runs their own Vite dev server** at `http://localhost:3000`. **Do NOT
   start one and NEVER `pkill -f vite`** (it kills the user's server). `curl` it to
   confirm it's up; if down, ask the user.
2. Take DPR-2.5 screenshots via Playwright (installed) against **`http://localhost:3000/?canvas`**
   (Canvas renderer boots reliably headless; real DPR). Pattern:
   ```js
   import { chromium } from 'playwright';
   const b = await chromium.launch();
   const ctx = await b.newContext({ viewport:{width:411,height:891}, deviceScaleFactor:2.5 });
   const p = await ctx.newPage();
   await p.goto('http://localhost:3000/?canvas',{waitUntil:'networkidle'});
   await p.waitForFunction(()=>window.game?.isRunning,null,{timeout:25000});
   // navigate to the scene (keys: U=Upgrades S=Store H=Heap L=Leaderboard; click/Enter/Space to Start Run)
   await p.screenshot({ path:'/tmp/x.png' }); await b.close();
   ```
   Write such scripts INSIDE the repo dir (not /tmp) so `playwright` resolves. Read the
   PNG to eyeball layout. `window.game` is exposed in dev. You can probe camera state
   via `p.evaluate` (e.g. `game.scene.getScenes(true)`, `cam.zoom`, `cam.worldView`).
3. There is a regression gate: `node scripts/dpr-gate.mjs` (needs the dev server up) —
   asserts backing-store/CSS/transform at DPR 2.5. Keep it green.
4. `npm run build` after every task (catches TS errors tests miss). `npm test` must stay
   green (displayMetrics + InputManager suites were extended).

## What's DONE (Tasks 1–9, verified at DPR 2.5)

Commits `9717279`→`74d0c91`. All menu/UI scenes migrated to logical layout and
visually confirmed crisp & correctly laid out at DPR 2.5: MenuScene, HeapSelectScene,
ScoreScene, UpgradeScene (+scroll baseline), StoreScene (+scroll baseline), PauseScene,
LeaderboardScene, TexturePreviewScene, `src/ui/buildVolumePanel.ts`,
`src/ui/buildControlsOverlay.ts`, `src/ui/HUD.ts`, `src/systems/PlaceableManager.ts`,
`src/systems/InputManager.ts`. Scrolling scenes (Upgrade/Store) capture
`baseScrollY = cam.scrollY` after `setupUiCamera` and clamp scroll to
`[baseScrollY, baseScrollY+maxScroll]`, dividing scroll deltas by `cam.zoom`.

## TASK 10 — what you're implementing (the hard part)

**Problem (verified):** in GameScene the world renders perfectly under the zoomed
following camera, but the **HUD/buttons/joystick (all `setScrollFactor(0)`) render
off-screen**. A zoomed camera pivots zoom on its physical viewport centre; a
*following* gameplay camera can't also centre on the logical UI origin (the fix that
works for static menus). **User-approved solution: a dedicated UI camera for the 2
gameplay scenes only** (`GameScene`, `InfiniteGameScene`). Menu scenes are fine as-is.

**Design (see plan's "Task 10 — REVISED"):**
1. Put all HUD/button/joystick objects into a `Phaser.GameObjects.Layer` (uiLayer).
2. Add a 2nd camera: `zoom = getDprCap()`, `centerOn(logicalW/2, logicalH/2)`, non-following,
   rendering only the uiLayer.
3. `cameras.main.ignore(uiLayer)`; the UI camera ignores all current scene-root children
   AND hooks `ADDED_TO_SCENE` to ignore future **world** objects (enemies/pickups/chunks/
   placeables spawn dynamically and would otherwise double-render over the HUD).
4. **GOTCHA that will bite you:** dynamically-created **UI** (grab button, place button,
   revive HUD badge, joystick parts, score/pause) must be added to the uiLayer too —
   otherwise the "ignore scene-root additions" hook makes them vanish from the UI camera.
   Every UI creator (`src/ui/HUD.ts`, `src/systems/mountJoystick.ts`,
   `src/systems/PickupManager.ts` grab button, `GameScene` place/score/pause) must register
   its objects to the layer, including lazily-created ones.

**Also in Task 10 (the plan's original Task 10 steps still apply):**
- Migrate the remaining `this.scale.width/height` in `GameScene.ts` (~12) and
  `InfiniteGameScene.ts` (~1) to `logicalWidth/Height(this)`; convert `mountJoystick.ts`
  (`scene.scale.*` → `logicalWidth/Height(scene)`). Buttons positioned in logical coords;
  suppression rects stay logical (InputManager already normalizes).
- **Camera-space world math** (off-by-DPR otherwise; symptom is functional, not visual):
  - `GameScene.ts` ~L406 `const halfW = this.cameras.main.width / 2` → `cameras.main.worldView.width / 2`.
  - `GameScene.ts` ~L428 `const camBottom = cam.scrollY + cam.height` → `cam.worldView.bottom`.
  - `InfiniteGameScene` already uses `worldView` — leave it.

**Verify Task 10 at DPR 2.5 (`?canvas`, start a run):** score + ☰ pause + grab/place
buttons + joystick (set control mode to joystick in settings) all VISIBLE and correctly
placed; no world object double-rendered over the HUD; tapping a button doesn't leak a
jump (InputManager suppression); enemies/pickups below the screen still cull/spawn.

## Remaining after Task 10

- **Task 11:** `src/systems/ParallaxBackground.ts` (8), `src/systems/PickupManager.ts`
  (layout + `cullBelow(scrollY+cam.height)` → `worldView.bottom + CULL_MARGIN`),
  `src/systems/PortalManager.ts` (already `worldView`; check for layout sites),
  `src/entities/PlayerOutro.ts` (4). Migrate logical + fix camera-space cull.
- **Task 12:** full sweep — `grep -rn "scale.width\|scale.height" src --include="*.ts" | grep -v __tests__ | grep -v displayMetrics`
  must be empty of CODE (a few stale doc COMMENTS in `buildControlsOverlay.ts` are fine but
  worth updating); `grep` for `cameras.main.height/width` world-math survivors; `npm test`
  + `npm run build` green.
- **Task 13:** real-device QA (Samsung S25, DPR ~2.6) — crispness + frame rate (fill cost
  ~DPRcap²; cap is `DPR_CAP` in displayMetrics). Then flip `Todo/Bugs.md` 7b → `[x]` and
  finish the branch (PR).

## Constraints (hard)

- Stay on `feat/dpr-physical-canvas`. NO destructive/history-rewriting git (no reset/
  rebase/push/force/checkout-other-branch/branch-delete/clean). Commit per task.
- Do NOT start or kill the dev server. Use the user's `localhost:3000`.
- Commit messages: end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- If a subtle integration issue appears (like the HUD-camera one), STOP and verify with a
  screenshot before piling on fixes — that's how the real bugs here were found.

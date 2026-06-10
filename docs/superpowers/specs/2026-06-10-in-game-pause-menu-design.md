# In-game Pause Menu — Design

**Date:** 2026-06-10
**Status:** Approved (design), pending implementation plan
**Branch:** `feature/in-game-pause-menu` (based on `fix/controls-menu-overflow` / PR #45)

## Problem

The game scenes show a `?` info button (top-right) that opens a controls overlay
but cannot pause the game or reach other in-run actions. Players want a single
in-game menu that pauses play and offers Controls, Volume, and a way to quit to
the main menu.

## Goal

Replace the in-game `?` button in **GameScene** and **InfiniteGameScene** with a
**☰ Menu** button that pauses the game and opens a panel offering:

- **Resume** — unpause and close.
- **Controls** — show the responsive controls help.
- **Volume** — show the volume sliders.
- **Exit to Main Menu** — confirm, then return to the main menu (run abandoned).

On desktop, **Esc** and **P** also open/close the pause menu.

## UX

```
        ▌ PAUSED ▐
   ┌──────────────────┐
   │      Resume      │
   │     Controls     │
   │      Volume      │
   │ Exit to Main Menu│
   └──────────────────┘
```

- The ☰ button sits where the `?` button was (top-right, `scale.width - 22, 22`).
- Controls and Volume open as sub-views *within* the pause menu (a "← Back" returns
  to the button list); they are not separate scenes.
- Exit shows a confirm sub-view: "Quit run? This run's progress is lost." with
  Cancel / Quit. The run is abandoned — no score is saved.

## Architecture

### 1. `PauseScene` (new overlay scene — `src/scenes/PauseScene.ts`)

- Launched by a game scene via `this.scene.launch('PauseScene', { gameSceneKey, isMobile })`
  followed by `this.scene.pause()`. Mirrors the existing LeaderboardScene overlay
  pattern (`HeapSelectScene` launches `LeaderboardScene` + `this.scene.pause()`).
- Registered in the Phaser game config scene list (`src/main.ts`).
- Renders: dim full-screen background + panel + the button list. Holds three views:
  **menu** (buttons), **controls**, **volume**, plus the **exit-confirm** sub-view.
  Switching views toggles visibility of the relevant display objects.
- Actions:
  - **Resume:** `this.scene.resume(gameSceneKey); this.scene.stop();`
  - **Controls:** build via `buildControlsOverlay` (from PR #45) and show it; Back hides it.
  - **Volume:** build via `buildVolumePanel` (new, see below) and show it; Back hides it.
  - **Exit (confirmed):** `this.scene.stop(gameSceneKey); this.scene.stop(); this.scene.start('MenuScene');`
- Reads `isMobile` from launch data (passed from the game scene's InputManager) so
  the controls help shows the correct mode-aware copy.
- Esc/P inside PauseScene resumes (same as Resume), so the key toggles cleanly.

### 2. `src/ui/buildVolumePanel.ts` (new — extract & reuse)

- Extract the 5 volume sliders (`MASTER`, `Music`, `Player SFX`, `Enemy SFX`,
  `Environment`) and the `createVolumeSlider` logic out of `MenuScene` into a shared
  builder: `buildVolumePanel(scene, opts) → { parts, setOpen, relayout }` — same shape
  as `buildControlsOverlay` for consistency.
- Sliders read initial values from `AudioManager.getVolumes()` and write via
  `AudioManager.setCategoryVolume(cat, v)` (which persists through SaveData). No
  MenuScene-specific state is involved, so the move is mechanical.
- `MenuScene`'s Settings → Sounds tab is refactored to consume `buildVolumePanel`
  (single source of truth). The Controls/Player tabs of MenuScene's settings panel
  are **out of scope** — only the volume sliders are extracted.
- Panel is content-sized and viewport-clamped (consistent with `buildControlsOverlay`)
  so it also fits narrow 21:9 phones.

### 3. Game-scene wiring (`GameScene` + `InfiniteGameScene`)

- `createInfoButton(...)` → `createMenuButton(...)`: same position/size, draws a ☰
  glyph instead of `?`. On `pointerup` (and on Esc/P keydown) calls `openPauseMenu()`.
- `openPauseMenu()`: `this.scene.launch('PauseScene', { gameSceneKey: this.scene.key, isMobile }); this.scene.pause();`
- The standalone in-game controls overlay (`buildControlsOverlay` usage currently in
  GameScene, `infoOverlay`/`infoOpen`/`toggleInfoOverlay`) is **removed** from the game
  scenes — that content now lives in the pause menu. `buildControlsOverlay` itself is
  unchanged and reused by PauseScene.
- InfiniteGameScene currently has no info/menu button; it gains the ☰ button + the
  same `openPauseMenu()` wiring.

## Pause semantics

`scene.pause()` halts the paused scene's `update()`, Arcade physics step, scene
timers, and tweens, so the player, enemies, trash wall, bridges, and portals all
freeze. PauseScene runs on top with its own input plugin, so taps/keys do not leak
to the paused scene. Music continues playing (low risk; revisit later if desired).
On Resume, `scene.resume()` restores everything.

## Edge cases

- **Death while paused:** not possible — the game scene's `update()` is halted, so no
  death can fire while PauseScene is open.
- **Double-open:** the ☰ handler no-ops if PauseScene is already active
  (`this.scene.isActive('PauseScene')` guard) so rapid taps don't stack launches.
- **Scene shutdown on Exit:** game scenes already have a `shutdown()` that stops audio
  and clears input suppression; `scene.stop(gameSceneKey)` triggers it.
- **InputManager singleton:** PauseScene must not disturb the shared InputManager
  state; it uses plain Phaser input on its own scene, and the game scene's
  InputManager simply stops updating while paused.

## Testing

- **Unit:**
  - `buildVolumePanel`: each slider change calls `AudioManager.setCategoryVolume` with
    the right category and a clamped [0,1] value; initial positions reflect
    `getVolumes()`.
  - `PauseScene` view transitions and actions (resume/exit/controls/volume/back) using
    a mocked scene manager (`launch`/`resume`/`stop`/`start`/`isActive` spies), asserting
    the correct calls fire.
- **Visual (scene-preview):** PauseScene menu view, Controls sub-view, Volume sub-view,
  and exit-confirm at `iphone14` (390px) and `pixel7` — verifying nothing clips on
  narrow 21:9.
- **Regression:** full `npm test` + `npm run build` clean.

## Out of scope

- Pausing/ducking music (kept playing for now).
- Extracting MenuScene's Controls/Player settings tabs (only volume sliders extracted).
- A pause button for any non-gameplay scene.
- The deferred full-canvas DPR work (Bugs.md 7b).

## File changes (summary)

- **New:** `src/scenes/PauseScene.ts`, `src/ui/buildVolumePanel.ts`,
  tests under `src/scenes/__tests__/` and `src/ui/__tests__/`.
- **Edit:** `src/main.ts` (register PauseScene), `src/scenes/GameScene.ts`
  (menu button + openPauseMenu + remove in-scene info overlay),
  `src/scenes/InfiniteGameScene.ts` (menu button + openPauseMenu),
  `src/scenes/MenuScene.ts` (Sounds tab uses `buildVolumePanel`).

# Fullscreen RESIZE Viewport Design

**Date:** 2026-04-28
**Branch:** feature/mobile-controls

## Overview

Switch Phaser's scale mode from `FIT` (fixed 480×854 with letterbox bars) to `RESIZE` (canvas fills the `#game` container). On tall phones the camera viewport becomes taller, revealing more of the heap above/below the player. On desktop browsers a CSS `max-width: 480px` constraint keeps the canvas the same width as today.

## Goals

- Eliminate top/bottom black bars on tall phones (9:18+)
- Show more game world vertically on tall screens — the camera sees more heap, not a stretched/cropped image
- No regressions on desktop browser
- No landscape/rotation handling needed (portrait-locked mobile game)

## Out of Scope

- Heap geometry changes (heap stays 480px wide)
- Dynamic resize handling mid-session (portrait-locked; screen size is fixed at app start)
- Camera zoom tuning (zoom stays at 1.0; more world is visible simply because the viewport is taller)

---

## Changes

### 1. `index.html` — CSS container constraints

Replace the `#game` style block:

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

`width: min(100vw, 480px)` caps the canvas at 480px on wide desktop windows.
`height: 100dvh` uses the dynamic viewport height (accounts for mobile browser chrome).

### 2. `src/main.ts` — Scale config

Remove fixed `width` and `height` from the game config. Change the scale block:

```ts
scale: {
  mode: Phaser.Scale.RESIZE,
  autoCenter: Phaser.Scale.NO_CENTER,
},
```

Phaser will read `#game`'s rendered dimensions (capped by CSS) and size the canvas to match.

### 3. `src/constants.ts` — No change

`GAME_WIDTH = 480` and `GAME_HEIGHT = 854` remain. They are used exclusively for game-world geometry (heap width, physics bounds, tile layout). They are no longer used for UI edge positioning after this change.

### 4. Scene files — Dynamic W/H locals

All scenes that position UI elements must read actual screen dimensions instead of the constants. Pattern for every scene's `create()`:

```ts
const W = this.scale.width;
const H = this.scale.height;
```

Then use `W` and `H` in place of `GAME_WIDTH` and `GAME_HEIGHT` for UI layout throughout that scene.

**Module-level constants that must move inside `create()`:**
- `ScoreScene.ts`: `const CX = GAME_WIDTH / 2` → `const CX = W / 2`
- `StoreScene.ts`: `const COL_RIGHT = GAME_WIDTH - 16` → `const COL_RIGHT = W - 16`
- `UpgradeScene.ts`: `const COL_RIGHT = GAME_WIDTH - 16` → `const COL_RIGHT = W - 16`
- `HUD.ts`: `const HUD_Y = GAME_HEIGHT - 44` → local inside constructor/create

**Files to update:**
- `src/scenes/GameScene.ts`
- `src/scenes/MenuScene.ts`
- `src/scenes/ScoreScene.ts`
- `src/scenes/StoreScene.ts`
- `src/scenes/UpgradeScene.ts`
- `src/scenes/HeapSelectScene.ts`
- `src/scenes/InfiniteGameScene.ts`
- `src/ui/HUD.ts`

### 5. `src/systems/ParallaxBackground.ts` — Use scene dimensions

Replace the imported `GAME_WIDTH` / `GAME_HEIGHT` constants with reads from the scene reference that `ParallaxBackground` already holds:

- Cloud spawn X range: `Phaser.Math.Between(-80, this.scene.scale.width + 80)`
- Cloud zone check: `scrollY + this.scene.scale.height <= CLOUD_START_WORLD_Y`
- Cloud recycle Y: compare against `this.scene.scale.height`

### 6. `src/systems/PlaceableManager.ts` — Already dynamic

`PlaceableManager` already reads `scene.scale.width` / `scene.scale.height` at create time. No changes needed.

---

## Testing

- Build passes (`npm run build`)
- All existing tests pass (`npm run test`) — no logic changes, purely layout
- Manual smoke test in browser: game fills the browser window width-capped at 480px, no black bars visible on a tall mobile viewport (use browser devtools device emulation for a 9:21 phone like Samsung Galaxy S21)
- Menus, HUD, placement UI all appear correctly anchored at screen edges

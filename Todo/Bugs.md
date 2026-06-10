## BUGS

# Open
- [ ] **Infinite mode: world doesn't wrap properly.** In InfiniteGameScene the left/right
  edges don't wrap the player around the way the standard heap does (`applyWorldBoundsX`
  in [Player.ts](../src/entities/Player.ts) uses `worldWidth`; infinite mode sets
  `worldWidth = INFINITE_WORLD_WIDTH`). Reproduce: run far to one side in infinite mode —
  the wrap is missing/incorrect. Investigate the infinite world-width vs. wrap-inset math.


# Mobile
- [x] 7. Mobile blur — **partial.** Text now renders at devicePixelRatio (global `text` factory override in [main.ts](../src/main.ts)) so HUD/labels are crisp. _(device smoke)_
  - [ ] 7b. **Deferred:** full-canvas DPR rendering for sprites/heap art. Phaser 3 ties the canvas backing store to the logical coord system, so this needs a global UI-scale refactor + on-device QA. Own task.

# Scenes
- [x] **Controls menu oversized / runs off-screen on phone (21:9).** The CONTROLS
  overlay in MenuScene and the game scenes used a fixed 380×320 panel with text
  anchored at `width/2 − 160`. In Phaser's RESIZE scale mode `scale.width` tracks the
  real device width, so on narrow 21:9 phones the panel clipped horizontally, and the
  mobile control list (~15 lines) overflowed the 320px panel vertically. Fix: new
  shared [buildControlsOverlay](../src/ui/buildControlsOverlay.ts) — content-sized panel
  (sized to the wrapped help text + padding) clamped to the viewport with a margin, used
  by both MenuScene and GameScene. Verified via scene-preview at iphone14 (390px).

# Gameplay



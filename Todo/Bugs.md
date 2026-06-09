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

# Gameplay



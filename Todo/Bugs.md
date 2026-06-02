## BUGS

> Branch: `fix/playtest-bugs`. All fixes below are code-complete (build clean, 711 tests pass).
> Items marked _(smoke)_ still need an in-game / on-device check — see the batch smoke list at the bottom.

# Mobile
- [x] 7. Mobile blur — **partial.** Text now renders at devicePixelRatio (global `text` factory override in [main.ts](../src/main.ts)) so HUD/labels are crisp. _(device smoke)_
  - [ ] 7b. **Deferred:** full-canvas DPR rendering for sprites/heap art. Phaser 3 ties the canvas backing store to the logical coord system, so this needs a global UI-scale refactor + on-device QA. Own task.

# Scenes
- [x] 2. 2× button loading animation — cycling-dots + pulse while the rewarded ad loads ([ScoreScene.ts](../src/scenes/ScoreScene.ts)). _(smoke)_
- [x] 4. Settings volume sliders closing the menu — panel made interactive (absorbs in-panel clicks), track tappable-to-set with a 28px hit area ([MenuScene.ts](../src/scenes/MenuScene.ts)). _(interactive smoke)_
- [x] 5. Item description boxes — bigger panel (252×132), alpha 1.0, larger fonts, brighter/readable text ([PickupManager.ts](../src/systems/PickupManager.ts)). Verified in scene preview.
- [x] 6. High Score label — 14→18px, lifted off the panel for clean padding ([ScoreScene.ts](../src/scenes/ScoreScene.ts)). Verified in scene preview.
  - [x] 6b. Label was still overlapping the coin breakdown panel — widened the gap below the coins panel (40→68px) so the label clears it. Verified in scene preview.

# Gameplay
- [x] 1. Enemy + trash-wall sounds bleeding into the score screen — hush gameplay loops on scene `pause` ([GameScene.ts](../src/scenes/GameScene.ts)). _(smoke)_
- [x] 3. Items too good — `PICKUP_BONUS` rescaled ÷5 ([pickupScores.ts](../shared/pickupScores.ts)).
- [x] 8. Wall/slope sliding — player stuck, ejected, and animation flapped while sliding down walls (root cause: wall slabs had solid tops, so the player kept landing on slab lips, firing the slope-zone eject). **Fixed on device:**
  - Wall slabs now disable top *and* underside collision (block sides only) so the player slides cleanly down the face; overhang walls keep their underside solid ([HeapEdgeCollider.ts](../src/systems/HeapEdgeCollider.ts)).
  - Overhang rows now classify as walls (non-standable) even below the steepness threshold, so a jutting lip can't be stood on/refresh air jumps.
  - The obsolete slope-zone eject system (`handleWallCollision`/`inSlopeZone`) was removed; wall colliders are now plain.
  - 120ms WALL_SLIDE animation hysteresis in [PlayerAnimator.ts](../src/entities/PlayerAnimator.ts) smooths the on/off-wall contact on jagged faces.

# Batch smoke test (do before merge)
- [ ] #1 — reach a peak (success) and die; confirm no enemy/wall sound on the score screen.
- [ ] #2 — tap the 2× button; confirm the loading animation plays while the ad loads.
- [ ] #4 — open Settings, drag/tap the volume sliders; confirm the menu does NOT close, and tapping the track sets volume. Confirm tapping the backdrop still closes.
- [ ] #7 — on a real device, confirm text (HUD, score, labels) is noticeably crisper.

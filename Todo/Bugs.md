## BUGS

> Branch: `fix/playtest-bugs` (PR #36). All fixes below are code-complete and smoke-tested
> on device (build clean, 708 tests pass). Only #7b remains, intentionally deferred.

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
  - Follow-up: disabling wall-slab tops let the player sink through a slope's exposed top face. Added `depenetratePlayerFromWall` (overlap handler) to push them back out horizontally; `WALL_DEPENETRATION_FACTOR` (constants.ts, 0.5) tunes the push softness.

# Batch smoke test — ✅ all passed on device
- [x] #1 — peak/die → score screen silent of enemy + wall loops.
- [x] #2 — 2× button loading animation plays while the ad loads.
- [x] #4 — Settings sliders don't close the menu; track sets volume; backdrop closes.
- [x] #7 — text (HUD, score, labels) noticeably crisper on device.
- [x] #8 — wall/slope sliding smooth; no stuck/eject; no sinking into slopes.

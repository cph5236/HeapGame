## BUGS

# Open
- [x] **Infinite mode: world doesn't wrap properly.** Root cause: `applyWorldBoundsX`
  derived the off-edge wrap margin as `SKY_PAD * worldWidth` (a *fraction* of the world).
  Fine for the 960px standard heap (240px), but infinite mode sets
  `worldWidth = INFINITE_WORLD_WIDTH` (~3780px), blowing the margin up to ~945px so the
  player ran far off-screen before wrapping. Fix: `Player.wrapPadX` is now a fixed-pixel
  margin (default `SKY_PAD * WORLD_WIDTH`); InfiniteGameScene sets it to `INFINITE_EDGE_PAD`
  (100px). Also de-duplicated the ladder-path wrap to reuse `applyWorldBoundsX`. Covered by
  `Player — world wrap (X)` tests.
- [x] **Infinite mode: trash wall not rendered the full world width.** The rising trash
  wall cut off before the right edge of the infinite world. Cause: `TrashWallManager` was
  constructed with `worldWidth = INFINITE_WORLD_WIDTH` but `worldX` defaulted to
  `-SKY_PAD * WORLD_WIDTH` (−240, the standard-heap offset), so the wall spanned −240…3540
  and left a gap on the right. Fix: InfiniteGameScene now passes
  `worldWidth = INFINITE_WORLD_WIDTH + 2*INFINITE_EDGE_PAD`, `worldHeight`, and
  `worldX = -INFINITE_EDGE_PAD` — covering the full wrap-padded world (matching the camera
  bounds), so the wall and its sprite distribution span edge to edge.
- [x] **Infinite/wrap: standard-heap right-edge wrap now tested (from PR #44 review).**
  Added `standard heap: wraps to the left edge when past the right sky pad` to
  `Player — world wrap (X)`, covering the one previously-untested symmetric path (6 wrap
  tests total). (The same review also flagged the `wrapPadX` / camera-bounds comments
  running longer than CLAUDE.md's "one short line" — cosmetic, left as-is.)


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
- [x] **In-game pause menu + main-menu consolidation.** Replaced the in-game `?` button
  with a top-right ☰ that pauses the game and opens a `PauseScene` overlay
  (Resume / Controls / Volume / Exit to Main Menu, with an exit confirm); Esc/P also
  toggle it. Added to both GameScene and InfiniteGameScene. On the main menu, removed the
  standalone `?`, moved the settings button to the top-right as a ☰, and folded the
  mode-aware controls help into the settings Controls tab. Extracted a shared
  [buildVolumePanel](../src/ui/buildVolumePanel.ts) (volume sliders) reused by MenuScene +
  PauseScene. Spec/plan in docs/superpowers. _(needs device smoke: pause-freeze, sub-views,
  Controls-tab help fit on mobile)_

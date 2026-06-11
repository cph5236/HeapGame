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
  - [ ] 7b. **Physical-resolution canvas (DPR) — investigated 2026-06-11, worth doing; tackle in a focused session.**
    **Real driver = text still blurry on mobile** (confirmed on a Samsung S25, ~DPR 2.6 at 1080×2340 — body text like "How high can you climb?" / "START RUN" / heap-select labels is soft; the orange HEAP logo + stars stay crisp because they're large/simple).
    **Why #7 isn't enough:** every text object goes through the `add.text` factory (so all get `resolution = DPR`; no BitmapText/`new Text` bypass, no per-call `resolution: 1`). But in `Scale.RESIZE` the canvas backing store is sub-native (~411px wide), and the OS upscales it ~2.6× to 1080 — so the hi-res glyph texture is still composited onto a sub-native canvas and capped. A text-only fix can't beat the canvas resolution.
    **Phaser constraint (Context7, v3.90):** the Scale Manager has no working `resolution` flag (dropped in 3.16+). Crispness requires rendering the canvas at physical pixels.
    **Asset asymmetry:** sprites are authored 3–4× oversize (player 174×197 → 40×46 display) so they crisp up *for free* under a DPR canvas; the heap composite is exactly 1× (960px = `WORLD_WIDTH`) so it can't improve without re-authored higher-res PNGs (≈2 MB×4 → big download) — leave heap soft, that's acceptable.
    **Recommended approach (needs an on-branch prototype to confirm the fork):**
    (A) game size = `cssSize × DPR` + every camera `zoom = DPR` + a separate unzoomed UI camera (or `/DPR` on `scale.width`-based UI layout); cap DPR (~2) on low-end for the ~DPR² fill cost. _vs_
    (B) keep logical game size and override the canvas backing store on each resize (fights the Scale Manager).
    **Scope/risk:** touches every scene's cameras + all `scale.width` UI layout + the resize handler in [main.ts](../src/main.ts) + real-device QA. Plan it as brainstorm → prototype (A) → spec → implement.

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

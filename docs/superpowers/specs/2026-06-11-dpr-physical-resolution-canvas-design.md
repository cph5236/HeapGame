# #7b — Physical-Resolution (DPR) Canvas — Design

**Date:** 2026-06-11
**Bug:** `Todo/Bugs.md` → Mobile → 7b
**Branch context:** diagnosis banked on `docs/7b-dpr-diagnosis` (commit `4147431`)

## Problem

Body text is blurry on high-DPR phones (confirmed on a Samsung S25, DPR ~2.6 at
1080×2340 — "How high can you climb?", "START RUN", heap-select labels are soft;
the large/simple orange HEAP logo + stars stay crisp).

Root cause (diagnosed): in `Phaser.Scale.RESIZE` the canvas **backing store** is
sized to **CSS pixels** (~411px wide), and the OS upscales it ~2.6× to the
physical 1080px. The per-object text `resolution` fix from bug #7 (global
`add.text` factory override → `resolution = DPR`) makes the *glyph texture* dense,
but that texture is still composited onto a sub-native canvas and capped — a
text-only fix cannot beat the canvas resolution.

Phaser 3.90 constraint (confirmed via Context7): the Scale Manager has **no**
working `resolution` flag (dropped in 3.16+; `ScaleConfig` exposes only `zoom`,
modes, min/max/snap). Crispness requires rendering the canvas at physical pixels.

## Decisions (locked during brainstorming)

- **Approach A** — physical-pixel canvas + camera `zoom = DPR`. (Not approach B,
  which keeps logical size and overrides the backing store while fighting the
  Scale Manager.)
- **DPR cap = 2.5** — `DPRcap = min(window.devicePixelRatio, 2.5)`. Near-native on
  flagships (covers the 2.6 S25 almost fully) with a bounded ~DPR² fill cost.
- **UI strategy = single zoomed camera + logical-dimension helper** — one camera
  at `zoom = DPRcap` renders both world and UI; HUD/menus stay
  `setScrollFactor(0)` as today. No separate UI camera.
- **Sizing mode = `Scale.NONE` with a self-managed resize loop** — so Phaser does
  not fight our backing-store / CSS override. **(See "Items to double-check during
  spec review", #1 — this mechanism must be confirmed before the rest is built.)**

## Architecture

### 1. Core mechanism — physical backing store, logical CSS

Switch the game from `Scale.RESIZE` to `Scale.NONE` and own the resize loop in
`src/main.ts`:

- On window/parent resize (debounced as today): read `cssW`, `cssH` from the
  parent (`#game`) client size.
- `scale.resize(cssW * DPRcap, cssH * DPRcap)` → canvas **backing store** =
  physical pixels (crisp).
- Force `canvas.style.width = cssW + 'px'` and `canvas.style.height = cssH + 'px'`
  → the canvas still **displays** at logical size, 1:1 with the device, no OS
  upscaling.
- **Then call `scale.refresh()`** (re-caches `canvasBounds` + `displayScale`).
  This is mandatory and easy to miss: `scale.resize()` internally calls
  `refresh()` → `updateBounds()`, which caches `canvasBounds`
  (`getBoundingClientRect`) and `displayScale` from the canvas style *as it was
  before* our manual style override. `ScaleManager.transformX/Y` —
  `(pageX - canvasBounds.left) * displayScale.x`, used by `InputManager` for touch
  hit-testing — would otherwise keep using stale bounds, so the canvas looks
  correct while touch zones silently drift by the DPR factor. Re-running
  `refresh()` after the style change rebuilds both. (`node_modules/phaser/src/scale/ScaleManager.js`:
  `resize`→`refresh`→`updateBounds`/`updateScale`; `transformX/Y`.)

`DPRcap` resolves to `1` in dev-preview (headless Chromium, see §6), so tooling is
unaffected.

### 2. Cameras render logical content at physical resolution

Every camera gets `zoom = DPRcap`. World geometry stays authored in logical units
(`WORLD_WIDTH = 960`, etc.) — unchanged. `zoom = DPRcap` scales the logical world
to fill the now-physical canvas, preserving the same world-units-on-screen as
today while rendering at 2.5× resolution.

- `CameraController.setup()` gains a `zoom` argument (default `DPRcap`); it already
  owns bounds + follow + centerOn for the gameplay cameras.
- The `main.ts` resize handler updates `zoom` and viewport on live gameplay
  cameras (which are not restarted on resize — only UI scenes restart).
- Per the locked decision: **single camera** for world + UI. HUD/menu objects
  remain `setScrollFactor(0)`, rendered through the zoomed camera.

### 3. Logical-dimension helper — the ~190-site migration

With physical game size, `scene.scale.width` returns **physical** px (e.g. 1080,
not 411), which breaks every `width/2`-style layout. Introduce one module:

`src/systems/displayMetrics.ts`
```ts
export function getDprCap(): number          // min(devicePixelRatio, 2.5); 1 in dev-preview
export function logicalWidth(scene: Phaser.Scene): number   // scene.scale.width  / getDprCap()
export function logicalHeight(scene: Phaser.Scene): number  // scene.scale.height / getDprCap()
```

Mechanically replace the ~190 `this.scale.width` / `this.scale.height` reads
across the scenes + systems with `logicalWidth(this)` / `logicalHeight(this)`.
Layout logic and font sizes stay authored in logical px and render identically.

Approximate site counts (from `grep`, excluding tests) — exact list resolved in
the plan:

| File | sites |
|---|---|
| `src/scenes/MenuScene.ts` | 39 |
| `src/scenes/ScoreScene.ts` | 37 |
| `src/scenes/UpgradeScene.ts` | 20 |
| `src/scenes/StoreScene.ts` | 18 |
| `src/scenes/HeapSelectScene.ts` | 13 |
| `src/scenes/PauseScene.ts` | 12 |
| `src/scenes/GameScene.ts` | 12 |
| `src/systems/ParallaxBackground.ts` | 8 |
| `src/systems/PickupManager.ts` | 6 |
| `src/ui/buildVolumePanel.ts` | 5 |
| `src/ui/buildControlsOverlay.ts` | 4 |
| `src/scenes/TexturePreviewScene.ts` | 4 |
| `src/entities/PlayerOutro.ts` | 4 |
| `src/ui/HUD.ts` | 2 |
| `src/systems/PlaceableManager.ts` | 2 |
| `src/systems/mountJoystick.ts` | 2 |
| `src/scenes/LeaderboardScene.ts` | 2 |
| `src/systems/PortalManager.ts` | 1 |
| `src/scenes/InfiniteGameScene.ts` | 1 |

> Not every site is a literal `/2` centering read; the plan must inspect each (some
> are camera viewport resizes that should keep using physical/`scale.width`, e.g.
> `cameras.resize`). Migration is "find and adapt", not blind replace.

#### 3b. Second migration class — camera-space world math

Separate from `scale.width/height`: any code that reads **camera viewport
dimensions** (`cam.width` / `cam.height` / `scrollY + cam.height`) to compute
**world-space** values breaks once `cam.zoom = DPRcap`, because raw `cam.height`
is then physical viewport px, not visible world height (`= cam.height / cam.zoom`).
These must use the zoom-corrected **`cam.worldView`** rectangle (e.g.
`cam.worldView.bottom`) or divide by `cam.zoom`. Known sites (plan resolves the
full list):

- `src/scenes/GameScene.ts` — `camBottom = cam.scrollY + cam.height` (enemy/chunk
  culling). → `cam.worldView.bottom`.
- `src/systems/PickupManager.ts` — `cullBelow(scrollY + cam.height + CULL_MARGIN)`.
  → `cam.worldView.bottom + CULL_MARGIN`.

This class is easy to miss because it does not match a `scale.width` grep and the
symptom is functional (culling/spawn distance off by the DPR factor), not visual.

### 4. Text resolution override stays (complements #7, not replaced)

Keep the bug-#7 global `add.text` factory override in `main.ts`. With
`resolution = DPRcap`, a `zoom = DPRcap` camera maps the dense glyph texture 1:1
onto physical pixels → crisp. With default `resolution: 1`, text would be
re-blurred by the zoom. **Only change:** align its cap to **2.5** to match the
render cap (currently `min(dpr, 3)`).

### 5. Touch hit-testing (`InputManager`)

`InputManager.attachScreenTransform()` maps page → game coords via Phaser's
`ScaleManager.transformX/Y`, whose scale factor becomes `DPRcap` once the game
size is physical. **Suppression rects** (joystick / GRAB / PLACE / dash zones,
registered "in game coords" via `setSuppressionRect`) must therefore be registered
in the now-physical game space — i.e. the buttons' logical layout × `DPRcap` at
registration time. This is part of the migration and gets a smoke check (tap each
on-screen button → confirm no leaked jump/dash/dive).

### 6. Out of scope (per diagnosis)

- **Heap composite stays soft** — authored exactly 1× (`WORLD_WIDTH = 960`).
  Re-authoring 4× PNGs is a ~2 MB × 4 download hit. Accepted as soft.
- **Sprites (player / enemies / items)** are authored 3–4× oversize → crisp **for
  free** under the DPR canvas. No work.
- **Dev-preview / scene-preview** forces `Phaser.CANVAS` at fixed device sizes
  with effective DPR 1 (`getDprCap()` returns 1) — tooling unchanged.

## Components & boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| `displayMetrics.ts` (new) | Single source of truth for `DPRcap` + logical dims | `window.devicePixelRatio`, scene `scale` |
| `main.ts` resize loop | Physical backing store + logical CSS; update live camera zoom/viewport | `displayMetrics`, `game.scale`, `#game` parent |
| `CameraController.setup` | Apply `zoom` on gameplay cameras | `displayMetrics` |
| Scenes + UI systems | Lay out in logical px via the helper | `displayMetrics` |
| `InputManager` suppression | Register rects in physical game space | `displayMetrics`, `ScaleManager.transform*` |
| `add.text` factory (existing) | Dense glyph textures; cap aligned to 2.5 | `displayMetrics` cap |

## Testing & verification

Unit-test what's pure: `displayMetrics` (cap math, dev-preview → 1, logical
derivation from a mocked `scale`). The rendering/Scale-Manager behaviour is
inherently integration-level and verified by:

1. **Milestone-1 gate (blocking):** (a) read back `canvas.width === cssW · DPRcap`
   while `canvas.style.width === cssW + 'px'`; (b) **transform correctness** —
   after the `scale.refresh()`, assert `scale.transformX(knownPageX)` maps to the
   expected game-space coord (and tap an on-screen button to confirm suppression
   fires); (c) before/after screenshot of a known soft label. *All later
   milestones depend on this passing.* Note (b) specifically guards the stale-bounds
   trap — a canvas that looks crisp but whose touch mapping has drifted.
2. **Per-scene scene-preview screenshots** at phone sizes — confirm layouts are
   unchanged after the logical-dim migration.
3. **Touch smoke:** tap each on-screen button → no leaked action.
4. **Real-device QA (S25):** final crispness confirmation — cannot be done in
   headless. Also frame-rate check (fill cost ~DPRcap²).

## Risks / watch-items

- **`Scale.NONE` self-managed sizing** — see double-check #1 below.
- **`roundPixels: true` + fractional zoom (2.5)** — watch for sub-pixel sprite
  jitter; may need revisiting.
- **Perf** — fill cost ~`DPRcap²`; the cap (2.5) is the lever. Validate on-device.
- **Sweeping migration, two classes** — (a) ~190 `scale.width/height` layout reads
  (mitigated by per-scene screenshots), and (b) camera-space world math (§3b),
  whose symptom is *functional* (off-by-DPR culling/spawn distance) and invisible
  to screenshots — verify in live play / on-device, not by preview.

## Items to double-check during spec review

1. **`Scale.NONE` backing-store mechanism (PRIMARY).** Confirm that under
   `Scale.NONE`, `scale.resize(cssW·dpr, cssH·dpr)` + a forced logical
   `canvas.style.{width,height}` actually yields a physical backing store displayed
   at logical CSS size, and that Phaser does not re-overwrite the CSS on its own
   refresh cadence. If it does fight us, fall back to keeping `Scale.RESIZE` and
   overriding the backing store in the resize handler (approach-A/B hybrid). This
   is implementation milestone 1 and gates everything downstream.
2. Confirm which `scale.width`/`scale.height` sites are genuine logical-layout
   reads vs. camera-viewport reads that should stay physical.
3. Confirm the `InputManager` suppression-rect coordinate space after the size
   change (physical vs. logical) against `ScaleManager.transformX/Y` behaviour —
   *and* that `scale.refresh()` runs after the manual `canvas.style` override so
   `canvasBounds`/`displayScale` are not stale (§1).
4. Enumerate the full set of **camera-space world-math** reads (§3b) —
   `cam.width`/`cam.height`/`scrollY + cam.height` used for world coordinates — and
   confirm each is converted to `cam.worldView` / `÷ cam.zoom`.

## Out-of-scope / YAGNI

- No separate UI camera (decided against).
- No heap PNG re-authoring.
- No change to world units, physics, or gameplay tuning.

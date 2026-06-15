# In-Game UI Redesign — Design Spec

**Date:** 2026-06-15
**Status:** Approved (design), pending implementation plan
**Scope:** Full rework (option C) of the in-game UI for both gameplay scenes, all platforms.

---

## 1. Goals

1. **Fix the joystick/UI overlap bug.** In joystick mode the stick and its dash
   button live in the bottom corners at depth 40, on top of the ability HUD
   (bottom-right) and hotbar (bottom-left) at depth ~19–22, blocking those
   elements and taps. Whichever side the stick is on, it overlaps one cluster and
   the dash button overlaps the other.
2. **Production-quality visual design.** A cohesive "Clean Arcade" look: minimal
   translucent panels, rounded shapes, a single orange accent, consistent shape /
   elevation language, legible over the full blue→brown background gradient.
3. **One unified design across all platforms**, with mobile adding only the
   touch-specific controls (joystick, on-screen buttons). Desktop and mobile share
   the same top status strip and styling.

### Non-goals (out of scope)

- No drag-to-reposition / customizable-layout editor. A single well-designed fixed
  layout, with the existing **left/right-handed mirror kept as a setting**.
- No new gameplay information surfaced (no new meters/counters beyond what exists).
- No changes to input *behavior* (tilt/joystick/swipe mechanics stay as-is); this
  is layout + visuals + the dash-indicator display rule only.

---

## 2. Core layout principle

**Status on top, controls on the bottom.**

- **Top status strip** carries *all* persistent status. The thumb never rests
  here, so nothing it contains can be occluded by controls.
  - **Left:** ability tray (air-jumps, wall-jump, dash cooldown — see §4).
  - **Center:** score / height chip.
  - **Right:** pause button (☰).
- **Bottom control zone (mobile only):** joystick in one corner, action buttons
  (dash, place) in the opposite corner. Because status moved up, **nothing
  overlaps** down here.
- **Desktop:** identical top strip, no bottom controls (keyboard movement), with a
  small key-hint line near the bottom.

This is what resolves the overlap bug: the fix is structural (status vacates the
bottom corners), not a z-order patch.

---

## 3. Visual direction — "Clean Arcade"

- Translucent dark panels (`rgba(10,12,26,~0.45)`), 1px subtle light border
  (`rgba(255,255,255,0.10–0.14)`), soft drop shadow.
- Rounded radii: chips/pills ~16px, square-ish buttons ~12px, circular controls.
- Single accent: orange `#ff9922` (primary action), blue `#44aaff`/`#5cc8ff`
  (dash), red `#ff7755` (dash button stroke), cloud white-blue `#dce8ff`.
- **Elevation language:** action buttons get a soft outer shadow + inner top
  highlight (a "pressable" feel); the primary PLACE button additionally gets a
  bottom edge (`box-shadow` equivalent) and a glow so it pops on the warm lower
  background.
- **Legibility scrims:** a top scrim (dark→transparent, ~62px) and bottom scrim
  (transparent→dark, ~150px) so the UI stays readable across the entire
  blue→brown vertical gradient as the player climbs.

**Phaser note:** all gradients, shadows, and glows are **baked into cached
textures** (à la `HUD.ensureRadialTexture`) — **no live blur, no per-frame
fillCircle**. Scrims are single baked gradient quads on the UI camera.

---

## 4. Components

### 4.1 Ability tray (top-left)

A single vertical container (translucent panel) stacking, top→bottom:

1. **Air-jumps** — redesigned cloud glyph + a row of dot **pips** beneath it (one
   pip per air jump). Pips are bright when available, dimmed (~0.22 alpha) when
   used. Scales to any `maxAirJumpsCount`.
2. **Wall-jump** (only if `player.hasWallJump`) — wall-jump icon using the same
   treatment; brightens when `player.canWallJump`, dims otherwise. (Single charge,
   so an icon lit/dim state; pip optional.)
3. **Dash cooldown bar** (conditional, see §5) — a `»` icon + a slim horizontal
   loading bar (~46×8px, rounded). Glowing blue gradient fill when ready; dimmed
   partial fill while cooling, width = `1 - dashCooldownFraction`. A thin divider
   separates it from the indicators above.

Replaces today's horizontally-spread air-jump clouds + separate dash bar in the
bottom-right HUD.

### 4.2 Score / height chip (top-center)

A centered translucent pill. **Unifies the two scenes:**
- `GameScene`: "SCORE 1,240".
- `InfiniteGameScene`: height readout (e.g. "1,240 ft") — **moved from its current
  top-left position** (which now belongs to the ability tray) into this centered
  chip, using the same component/styling.

### 4.3 Pause button (top-right)

Restyled to the Clean Arcade language (rounded-square translucent panel, ☰ glyph),
shared by both scenes (today `createMenuButton` is duplicated). Respects a
top/right safe-area inset.

### 4.4 Revive badge

Today a top-left text badge at y≈64 — would collide with the ability tray. Moves to
an **alert chip just below the score chip (top-center)** so it remains prominent and
clear of the tray. Visible only while `player.isReviveArmed`.

### 4.5 PLACE button (mobile, GameScene only)

- Larger primary button (~72–80×52–60px) in the **action corner just above the
  dash button**, clear of the joystick. Icon + "PLACE" label, orange gradient,
  glow + bottom-edge shadow.
- Shown only in a live zone (current behavior). `InfiniteGameScene` has no
  placement, so it never appears there.
- Registers a suppression rect (existing mechanism) so its taps don't leak into
  jump/dash/dive gestures.

### 4.6 Joystick (mobile, joystick mode)

Visual polish only — behavior unchanged:
- Base: radial gradient fill + light border + soft outer shadow + inner highlight.
- A faint dashed 8-direction guide ring inside the base.
- Thumb: radial-gradient fill with highlight + shadow (feels raised).

### 4.7 Dash button (mobile, joystick mode)

- Restyled circular action button (~64–70px) matching the elevation language.
- **Owns its cooldown ring**: a depleting/refilling arc stroke driven each frame
  from `player.dashCooldownFraction`. This is why the tray's dash bar hides in this
  mode (§5).

---

## 5. Dash cooldown display rule

The dash cooldown must always be visible somewhere, but never twice.

| Platform / mode            | On-screen dash button? | Dash cooldown shown… |
|----------------------------|------------------------|----------------------|
| Desktop (keyboard)         | No                     | Tray bar (§4.1)      |
| Mobile — tilt mode         | No                     | Tray bar (§4.1)      |
| Mobile — joystick mode     | Yes                    | Dash button ring     |

**Rule:** show the tray dash bar when `!isMobile || controlMode !== 'joystick'`.
The scene passes this flag to the HUD; `mountJoystick`'s dash button drives its own
ring when present.

---

## 6. Handedness / mirroring

The **entire control zone mirrors left↔right as one unit** based on the existing
`getJoystickSide()` setting — joystick, dash button, and PLACE button all swap
together. Today only the stick moves (mountJoystick mirrors stick vs dash button,
but PLACE is hardcoded top-center). After: a single side parameter positions the
whole cluster.

---

## 7. Architecture & affected files

Both gameplay scenes currently duplicate HUD/score/menu/joystick wiring. As part of
this rework, consolidate the shared pieces so the "one unified UI" is literally one
implementation.

**New:**
- `src/ui/hudTheme.ts` — shared palette, radii, sizes, and texture-baking helpers
  (panel, scrim, glow, pressable button) so styling is defined once.
- `src/ui/AbilityTray.ts` — builds + updates the top-left tray (air-jump pips,
  wall-jump, conditional dash bar). Takes `player` + `showDashIndicator: boolean`.
- `src/ui/buildTopStrip.ts` (or fold into HUD) — score chip + pause button +
  scrims, shared by both scenes. Pause `onPress` injected per scene.

**Modified:**
- `src/ui/HUD.ts` — replace bottom-right ability cluster + bottom-left hotbar
  layout; delegate ability indicators to `AbilityTray`; add scrims; relocate
  revive badge; accept the dash-indicator flag.
- `src/scenes/GameScene.ts` — use shared top strip; restyle/reposition PLACE
  button into the action corner (handedness-aware); drop duplicated menu button;
  pass `showDashIndicator`.
- `src/scenes/InfiniteGameScene.ts` — move "ft" readout into the centered score
  chip; use shared top strip; parity with GameScene; pass `showDashIndicator`.
- `src/systems/mountJoystick.ts` — position the whole control cluster (stick +
  dash + place hook) by side as a unit; restyle dash button; drive its cooldown
  ring each frame; keep suppression rects.
- `src/systems/JoystickController.ts` — base/thumb visual polish (gradient,
  highlight, guide ring). Behavior unchanged.
- `src/constants.ts` — any new layout constants (safe-area insets, tray sizes,
  action-button sizes). Keep existing joystick constants.

**Unchanged:** `InputManager` (suppression-rect system already supports this),
`GameplayUiCamera` (UI camera registration via `addToGameplayUi`), input behavior.

---

## 8. Safe areas & DPR

- Add a small fixed inset constant for top/edge padding (pause not jammed in the
  corner). Canvas can't read `env(safe-area-inset-*)` directly; a constant inset is
  acceptable for the supported devices.
- All sizes authored in **logical** coordinates (the project renders at physical
  resolution via `Scale.NONE` + camera zoom; baked textures should be generated at
  DPR-appropriate scale, consistent with the existing `text` factory / HUD radial
  texture approach — see the DPR physical-canvas work, PR #51).

---

## 9. Testing

- **Unit:** pip count / dim logic, dash-bar fill fraction, dash-indicator display
  rule (`showDashIndicator(isMobile, mode)`), handedness positioning math (pure
  function: side → cluster coordinates). These mirror the existing
  `joystickMath` / `InputManager` test style.
- **Visual smoke:** `scene-preview` and the live dev server (Playwright, driving
  `window.game`) for GameScene + InfiniteGameScene, in: desktop, mobile-tilt,
  mobile-joystick (both handedness sides). Verify no overlap, legibility over the
  full background gradient, dash indicator in exactly one place per mode.
- **Build:** `npm run build` must be clean.

---

## 10. Risks / notes

- **Texture baking at DPR:** glows/gradients must bake at the right scale or they'll
  look soft on high-DPR devices. Follow the established HUD radial-texture pattern.
- **Both-scene parity:** the consolidation is the safeguard — if a piece is shared,
  it can't drift between scenes. Watch InfiniteGameScene's differing score
  semantics (height vs points) — same component, different text source.
- **Suppression rects** must move with the control cluster (handedness) so taps on
  relocated buttons still don't leak into gestures.
- **Performance:** UI already lives on the non-following `GameplayUiCamera`; keep
  per-frame work to attribute writes (alpha, scaleX, ring dashoffset), no
  per-frame graphics rebuilds (consistent with the prior perf overhaul, PR #12).

# Backpack UI Redesign — Design

**Date:** 2026-06-16
**Status:** Approved (design)
**Branch:** `claude/bugs-file-contents-8oqxrp`

## Problem

The in-game backpack / item picker (the "hotbar" tray shown when the player opens
their items to place or use them) was functional but visually unpolished. The
overflow bug — all 8 slots showing even when the player owned few items, pushing
the tray off-screen — was already fixed in commit `f2f7039` (filter to owned
items + scroll arrows).

What remains is **visual quality**: the tray has no title, uses an opaque dark
purple panel with sharp corners and blue slot outlines, and does not match the
polished "Clean Arcade" HUD theme shipped in the in-game UI redesign (PR #54).
It reads as a leftover from an earlier era of the UI.

## Goal

Restyle the backpack tray to match the Clean Arcade HUD theme and add a clear
title, so it looks intentional and cohesive. **This is a purely visual restyle** —
no changes to behavior, selection logic, scroll logic, item filtering, or layout
math beyond what's needed to fit a header.

Out of scope (explicitly decided with the user):
- No player-facing customization / theme picker / settings.
- No per-item icon art (none exists; items remain text + accent color).
- No new items, no behavior changes.

## Design — "Accent Cards" (direction B)

Selected from three mocked directions (A Clean Arcade Tray, B Accent Cards,
C Glow Tiles). B won for the clearest at-a-glance item identity while still
matching the HUD.

The tray remains a bottom-anchored horizontal row of slots, same position and
same dynamic layout/scroll behavior as today. Restyle only:

### Panel
- Translucent navy fill matching `HUD_THEME.panelFill` (`0x0a0c1a`), low alpha
  (around the HUD's `0.45`–`0.6` range; pick the value that stays readable over
  the bright sky — the tray sits low where the background is lighter).
- Rounded corners (radius ~14, matching `makePanel`).
- Hairline white border: `HUD_THEME.border` (`0xffffff`) at low alpha
  (`borderAlpha` `0.12`).
- Grows slightly taller than today's 100px to fit the header bar above the slot
  row (≈108–116px). It still sits above the PLACE/CANCEL button row and status
  label; verify no overlap at phone height.

### Header / title
- A centered **"BACKPACK"** label at the top of the panel, uppercase, letter-spaced,
  white (`HUD_THEME.textWhite`).
- A hairline divider below the title separating it from the slot row.

### Slots
- Each slot: rounded rect (~64×60), translucent light fill
  (`rgba(255,255,255,0.06)`-equivalent), hairline white border at low alpha.
- **Accent stripe:** a ~6px bar across the top of each slot, colored with that
  item's accent from `StoreScene`'s `ACCENT_COLORS` map (ladder green `0x44cc88`,
  i-beam blue `0x4488ff`, checkpoint orange `0xffaa22`, shield `0xcc44ff`,
  revive `0xff5577`, adrenaline `0xff7733`, pogo `0x33ddff`, stall `0xaa88ff`).
  This `ACCENT_COLORS` map should be promoted to a shared location so both
  `StoreScene` and `PlaceableManager` import it (single source of truth) rather
  than duplicating the literals.
- **Item name:** centered in the slot body, white with a thin dark stroke for
  legibility (as today). Word-wrap preserved for long names.
- **Quantity:** an amber pill badge in the **top-right corner** of the slot
  (`HUD_THEME.textAccent` text on a dark/amber pill), replacing today's centered
  `xN` text below the name.

### Selected state
- The currently selected slot gets an **orange ring + soft glow** using the HUD
  primary accent `HUD_THEME.accent` (`0xff9922`) — a 2px stroke plus a subtle
  glow. Phaser rectangles can't natively glow; approximate with either a baked
  texture, a slightly larger semi-transparent orange rect behind the slot, or a
  thicker stroke. Implementation picks the simplest that reads clearly.

### Scroll arrows
- Restyle the existing ◀ / ▶ buttons to match: translucent fill, hairline
  border, light-blue (`#aabbff`) glyph. Same show/hide logic and positions.

## Affected code

- `src/systems/PlaceableManager.ts` — `createUI()` (build the restyled panel,
  header text, slots with stripes, qty badges, scroll buttons) and
  `refreshHotbar()` (position the header, stripes, and qty badges; apply the
  selected-state styling). New game-object fields for the header text, divider,
  per-slot accent stripes, and qty badge backgrounds; register them with the
  gameplay UI camera via `addToGameplayUi`.
- `src/scenes/StoreScene.ts` — change to import `ACCENT_COLORS` from the new
  shared location instead of defining it locally.
- New small module (e.g. `src/data/itemAccents.ts`) — the shared
  `ACCENT_COLORS` map, so the tray and the store stay in sync.

## Theme constants

Reuse `HUD_THEME` from `src/ui/hudTheme.ts` for all colors (panel, border,
accent, text) rather than introducing new literals. Per-item colors come from the
shared `ACCENT_COLORS` map.

## Testing

- `npm run build` must pass (catches TS errors).
- Existing `PlaceableManager` tests must still pass (behavior unchanged); update
  any test that asserts on specific game-object structure if the restyle changes
  object counts/shapes. Selection, filtering, and scroll logic assertions must
  remain green.
- Visual verification with `heap-scene-preview` at phone size (`pixel7`):
  capture the tray with (a) a few items, (b) enough items to trigger scroll
  arrows, confirming the header, stripes, qty badges, selected ring, and no
  overlap with the PLACE/CANCEL row.

## Risks / watch-items

- **Vertical fit at phone height:** the taller panel must not overlap the status
  label / PLACE / CANCEL row. Verify in the scene preview.
- **DPR / baked textures:** if any new visual (glow, qty pill, stripe) is baked
  to a texture, follow the existing DPR pattern in `hudTheme.ts` (`getDprCap()`).
- **Camera registration:** every new game object must be added via
  `addToGameplayUi` or it will render on the wrong camera (known gotcha from the
  DPR work).

# Heap Texture Refinement — Depth & Grime

**Date:** 2026-05-29
**Branch:** `feature/heap-texture-grime` (off `feature/heap-visual-refinement` / PR #34)
**Status:** Design approved, pending spec review

## Problem

PR #34 refined the heap *outline* and edge shading (bevel, ambient occlusion, rim
light, removed band seams) but did **not** touch the texture interior. The
interior — a tiled collage of trash sprites (`composite-heap-*.png`) on a cold
navy background — still reads as:

1. **Flat / no depth** — items sit side-by-side with no shadows between them; it
   looks like a flat collage, not a 3D mound with crevices.
2. **Too clean / clip-art** — each item is a crisp, bright sticker floating on
   navy; nothing ties them together or grounds them as a grimy pile.

Palette variety and tile-repetition are explicitly **not** concerns.

Target intensity: **medium grunge** — clearly a dirty, layered pile, but items
stay readable and it still suits the game's clean cartoon art style.

## Key finding from live prototyping

Prototyped both halves on the real heap texture via the Playwright preview harness:

- **Small grime blobs / fine noise are useless** — they vanish into the already
  busy, dark texture (a subtle multiply overlay was indistinguishable from the
  original). Only **low-frequency** treatments read.
- **Per-item drop shadows + warm-dark gaps** (mimicked with canvas2d shadows)
  produce a strong, convincing depth/grounding effect — this is the primary fix.
- A **mild warm colour-grade** is one of the few things that visibly unifies the
  busy texture; approved as a gentle pass.

So the work splits cleanly into an **offline** half (depth, baked into the tiles)
and a **runtime** half (grime cohesion, layered per chunk).

## Part 1 — Offline bake

Files: `scripts/gen-heap-texture.mjs`, `scripts/sprite-config.mjs` (new tunables),
regenerated `src/assets/composite-heap-{0..3}.png` (committed).

### 1a. Per-stamp contact shadow
When stamping each sprite onto the composite canvas, first composite a **softened,
slightly down/right-offset dark copy** of that sprite (its silhouette, tinted
near-black, blurred, partial opacity) *underneath* it. Result: every item casts a
soft shadow onto whatever it overlaps, producing depth between items and grounding
them so they stop reading as floating stickers.

Tunables (added to `sprite-config.mjs`):
- `SHADOW_COLOR` (default near-black, e.g. `{ r: 8, g: 6, b: 4 }`)
- `SHADOW_OPACITY` (~0.5)
- `SHADOW_BLUR_SIGMA` (~4)
- `SHADOW_OFFSET` (`{ x: 3, y: 5 }` px, applied at stamp scale)

Implementation note: build the shadow buffer per sprite (tint→blur→opacity) once
per unique sprite+scale and reuse, or accept the per-stamp cost (one-time offline).
Shadows are stamped in the same batched `composite` pass as the sprite so ordering
(shadow below, sprite above) is preserved.

### 1b. Warm-dark background
Change the base canvas background from cold navy `{ r: 18, g: 20, b: 35 }` to a
**warm dark brown** (~`{ r: 30, g: 24, b: 17 }`, final value tuned on regen) so the
gaps between items read as shadowed pile rather than cold void. Promote to a named
constant in `sprite-config.mjs` (`BACKGROUND_COLOR`).

Grime is **not** baked here — it stays at runtime for flexibility and to decouple
it from the 4 frozen tiles.

## Part 2 — Runtime grime layer

File: `src/systems/HeapChunkRenderer.ts` (`renderPolygon`), layered **after** the
tile fill and **before** the existing AO / outline / rim passes from PR #34, inside
the existing polygon clip.

### 2a. Grime overlay (multiply)
A set of **world-aligned, tileable grime tiles** generated once (lazily, cached as
a static on the renderer or in `TextureGenerators`), cycled by world-Y exactly like
the fill tiles so the pattern is **continuous across band boundaries** (no seam).
Each grime tile is white-based (1.0 = no change) with darker marks, drawn with
`globalCompositeOperation = 'multiply'`:
- **Low-frequency dark pockets** — large soft radial darkenings for value variation
  / fake lumps.
- **Gentle vertical dirt streaks** — soft dark vertical gradients.
- *No* high-frequency noise/small blobs (proven invisible).

Generated procedurally with a seeded PRNG; a small number of variants (e.g. 2–4,
matching `HEAP_TILE_COUNT`) keep it from looking obviously repeated.

### 2b. Mild warm colour-grade
A gentle palette unification over the clipped fill. Implemented as a **composite
pass, not per-pixel `getImageData`** (for bake cost): e.g. a low-alpha warm-grey
fill with `globalCompositeOperation = 'saturation'`/`'color'`/`'soft-light'` (exact
operator chosen during implementation to match the approved "mild" look — clearly
gentler than the strong prototype sample). Goal: take the edge off the rainbow,
not desaturate to grey.

### Seam safety
Both 2a and 2b must be **continuous across the 500px band boundaries**. The grime
tiles are offset by world-Y (like the fill), and the grade is uniform, so neither
introduces per-band banding. This preserves the seamless stacking from PR #34.

## Ordering in `renderPolygon`
1. Grounding halo (existing)
2. Clip to polygon
3. Fill tiles (existing)
4. **Colour-grade (new, 2b)**
5. **Grime multiply (new, 2a)**
6. Inner ambient-occlusion (existing)
7. Unclip
8. Bevel outline + rim light (existing)

## Performance
- Offline: zero runtime cost.
- Runtime: grime tiles generated once and cached. Per chunk bake adds one tiled
  multiply pass + one grade composite — same order of cost as the existing fill
  draw, paid once per chunk (not per frame). No new per-frame work.

## Testing & verification
- `HeapChunkRenderer` rendering is canvas/DOM and has no unit tests; verify the
  runtime layer **visually** via the preview harness (both `GameScene` and
  `InfiniteGameScene`) — confirm grime reads, no band seams, items still readable.
- Any extracted pure logic (e.g. grime-tile index selection by world-Y) gets a
  Vitest unit test.
- Offline: regenerate, eyeball the 4 tiles, confirm `npm run build` + full suite
  still pass and the in-game heap shows depth + grime together.

## Out of scope
- Changing the sprite set, palette, or tile count.
- De-tiling / increasing tile variety beyond what grime variants provide.
- Any gameplay or collision change (purely visual).

## File touchpoints
- `scripts/sprite-config.mjs` — new shadow + background constants.
- `scripts/gen-heap-texture.mjs` — per-stamp shadow + bg colour.
- `src/assets/composite-heap-{0..3}.png` — regenerated (committed).
- `src/systems/HeapChunkRenderer.ts` — grime + grade passes, grime-tile generator.

# Heap Texture Refinement (Depth + Grime) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the heap texture interior read as a grimy, 3D pile — baked per-item contact shadows + warm-dark gaps for depth, plus a runtime grime + mild colour-grade layer for cohesion.

**Architecture:** Two halves. (1) Offline: `gen-heap-texture.mjs` stamps a soft drop-shadow under each sprite and uses a warm-dark background, regenerating the committed `composite-heap-*.png` tiles. (2) Runtime: a new `heapGrime.ts` module supplies a seeded PRNG, a pure per-pixel colour-grade, a vertically-seamless procedural grime tile, and a grade helper; `HeapChunkRenderer.renderPolygon` applies the grade + a world-aligned multiply grime pass between the fill and the existing ambient-occlusion pass (so it stays inside the polygon clip and continuous across band boundaries — no seams).

**Tech Stack:** Node + `sharp` (offline image pipeline), TypeScript, Canvas2D, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-29-heap-texture-grime-design.md`

**Branch:** `feature/heap-visual-refinement` (this work is folded into PR #34).

---

## File Structure

- `scripts/sprite-config.mjs` — **modify**: add background + shadow tunable constants.
- `scripts/gen-heap-texture.mjs` — **modify**: warm-dark background + per-stamp drop shadow.
- `src/assets/composite-heap-{0,1,2,3}.png` — **regenerate & commit** (output of the script).
- `src/systems/heapGrime.ts` — **create**: `makeGrimeRng`, `gradePixel`, `createGrimeTile`, `applyColourGrade`.
- `src/systems/__tests__/heapGrime.test.ts` — **create**: unit tests for the pure functions (`makeGrimeRng`, `gradePixel`).
- `src/systems/HeapChunkRenderer.ts` — **modify**: build a grime tile per renderer; apply grade + grime in `renderPolygon`.

Pure logic (`makeGrimeRng`, `gradePixel`) is unit-tested. Canvas/DOM code (`createGrimeTile`, `applyColourGrade`, the renderer) is verified visually via the preview harness, consistent with the codebase (no existing tests touch `HeapChunkRenderer`).

---

## Task 1: Offline bake — per-item shadows + warm-dark gaps

**Files:**
- Modify: `scripts/sprite-config.mjs`
- Modify: `scripts/gen-heap-texture.mjs`
- Regenerate: `src/assets/composite-heap-{0,1,2,3}.png`

- [ ] **Step 1: Add tunables to `scripts/sprite-config.mjs`**

Append these exports to the end of the file:

```js
/**
 * Background colour for the composite canvas. Warm-dark brown so the gaps
 * between stamped items read as shadowed pile rather than cold void.
 */
export const BACKGROUND_COLOR = { r: 30, g: 24, b: 17 };

/**
 * Per-stamp drop shadow — composited under each sprite to ground items and
 * create depth/crevices between them.
 */
export const SHADOW_COLOR      = { r: 8, g: 6, b: 4 };
export const SHADOW_OPACITY    = 0.5;   // 0..1 multiplier on the sprite's alpha
export const SHADOW_BLUR_SIGMA = 4;     // gaussian blur sigma (px)
export const SHADOW_OFFSET     = { x: 3, y: 5 }; // px, down/right
```

- [ ] **Step 2: Use the new constants in `scripts/gen-heap-texture.mjs`**

Update the import line that currently reads:

```js
import { FOLDER_RARITY, FOLDER_SCALE, SPRITES_SUBDIR, TILE_COUNT, STAMPS_PER_TILE } from './sprite-config.mjs';
```

to:

```js
import {
  FOLDER_RARITY, FOLDER_SCALE, SPRITES_SUBDIR, TILE_COUNT, STAMPS_PER_TILE,
  BACKGROUND_COLOR, SHADOW_COLOR, SHADOW_OPACITY, SHADOW_BLUR_SIGMA, SHADOW_OFFSET,
} from './sprite-config.mjs';
```

Replace the canvas-creation block:

```js
let canvas = await sharp({
  create: {
    width:    CANVAS_W,
    height:   CANVAS_H,
    channels: 4,
    background: { r: 18, g: 20, b: 35, alpha: 1 },
  },
}).png().toBuffer();
```

with:

```js
let canvas = await sharp({
  create: {
    width:    CANVAS_W,
    height:   CANVAS_H,
    channels: 4,
    background: { ...BACKGROUND_COLOR, alpha: 1 },
  },
}).png().toBuffer();
```

- [ ] **Step 3: Stamp a drop shadow under each sprite**

In the stamping loop, the current body builds `rotated`, computes `clampedLeft`/`clampedTop`, and pushes a single composite:

```js
  composites.push({ input: rotated, left: clampedLeft, top: clampedTop, blend: 'over' });
```

Replace that single `push` with shadow-then-sprite. Insert the shadow construction just before it and push both (shadow first so the sprite sits on top of its own shadow, and later stamps' shadows fall onto earlier items):

```js
  // Build a soft drop shadow from the sprite's alpha, tinted SHADOW_COLOR.
  const shadowAlpha = await sharp(rotated)
    .ensureAlpha()
    .extractChannel(3)
    .linear(SHADOW_OPACITY, 0)        // scale alpha by opacity
    .raw()
    .toBuffer();
  const shadowBuf = await sharp({
    create: { width: rw, height: rh, channels: 3, background: SHADOW_COLOR },
  })
    .joinChannel(shadowAlpha, { raw: { width: rw, height: rh, channels: 1 } })
    .blur(SHADOW_BLUR_SIGMA)
    .png()
    .toBuffer();

  const shLeft = Math.max(0, Math.min(clampedLeft + SHADOW_OFFSET.x, CANVAS_W - 1));
  const shTop  = Math.max(0, Math.min(clampedTop  + SHADOW_OFFSET.y, CANVAS_H - 1));

  composites.push({ input: shadowBuf, left: shLeft,      top: shTop,      blend: 'over' });
  composites.push({ input: rotated,   left: clampedLeft, top: clampedTop, blend: 'over' });
```

Then change the batch-flush condition so it never overshoots now that each stamp pushes two entries. Find:

```js
  if (composites.length === 100 || i === STAMP_COUNT - 1) {
```

and change to:

```js
  if (composites.length >= 100 || i === STAMP_COUNT - 1) {
```

- [ ] **Step 4: Regenerate the tiles**

Run: `node scripts/gen-heap-texture.mjs`
Expected: prints folder/stamp progress, then `✅ composite-heap-0.png … composite-heap-3.png` and `✅ Wrote …/heapTileUrls.ts`. May take a few minutes (per-stamp shadow doubles the composite work). No errors.

- [ ] **Step 5: Visually verify a tile**

Open `src/assets/composite-heap-0.png` (Read tool / image viewer).
Expected: warm dark-brown gaps (not navy); each item has a soft shadow to its lower-right, so the pile looks layered/3D rather than flat stickers.

If the shadows look too heavy/dark or the background too light/dark, adjust `SHADOW_OPACITY` / `SHADOW_BLUR_SIGMA` / `BACKGROUND_COLOR` in `sprite-config.mjs` and re-run Step 4 before continuing.

- [ ] **Step 6: Commit**

```bash
git add scripts/sprite-config.mjs scripts/gen-heap-texture.mjs src/assets/composite-heap-0.png src/assets/composite-heap-1.png src/assets/composite-heap-2.png src/assets/composite-heap-3.png
git commit -m "feat(heap): bake per-item contact shadows + warm-dark gaps into heap tiles"
```

---

## Task 2: heapGrime — seeded PRNG (pure)

**Files:**
- Create: `src/systems/heapGrime.ts`
- Test: `src/systems/__tests__/heapGrime.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/systems/__tests__/heapGrime.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeGrimeRng } from '../heapGrime';

describe('makeGrimeRng', () => {
  it('is deterministic for a given seed', () => {
    const a = makeGrimeRng(42);
    const b = makeGrimeRng(42);
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = makeGrimeRng(1);
    const b = makeGrimeRng(2);
    expect(a()).not.toBe(b());
  });

  it('returns values in [0, 1)', () => {
    const r = makeGrimeRng(7);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/systems/__tests__/heapGrime.test.ts`
Expected: FAIL — cannot resolve `../heapGrime` (module does not exist).

- [ ] **Step 3: Create `src/systems/heapGrime.ts` with the PRNG**

```ts
// src/systems/heapGrime.ts
//
// Procedural grime overlay for the heap texture: a seeded PRNG, a pure
// per-pixel colour grade, and a vertically-seamless grime tile. The grime is
// multiplied over the heap fill at chunk-bake time to add dirt cohesion; the
// grade lightly unifies the busy palette. Both are kept low-frequency — small
// noise is invisible against the busy trash texture.

/** Deterministic mulberry32 PRNG. Same seed → same sequence; values in [0, 1). */
export function makeGrimeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/systems/__tests__/heapGrime.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/systems/heapGrime.ts src/systems/__tests__/heapGrime.test.ts
git commit -m "feat(heap): add seeded PRNG for grime generation"
```

---

## Task 3: heapGrime — mild warm colour-grade (pure)

**Files:**
- Modify: `src/systems/heapGrime.ts`
- Test: `src/systems/__tests__/heapGrime.test.ts`

- [ ] **Step 1: Add the failing tests**

First update the top import of `src/systems/__tests__/heapGrime.test.ts` from:

```ts
import { makeGrimeRng } from '../heapGrime';
```

to:

```ts
import { makeGrimeRng, gradePixel } from '../heapGrime';
```

Then append this describe block to the end of the file:

```ts
describe('gradePixel', () => {
  it('warm-shifts a neutral grey (r > g > b) without large movement', () => {
    const [r, g, b] = gradePixel(128, 128, 128);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(Math.abs(r - 128)).toBeLessThan(20);
  });

  it('desaturates a saturated colour toward its luma', () => {
    const [r, g, b] = gradePixel(255, 0, 0);
    expect(r).toBeLessThan(255); // pulled down toward luma
    expect(g).toBeGreaterThan(0); // pulled up toward luma
    expect(b).toBeGreaterThanOrEqual(0);
  });

  it('clamps to the 0..255 range', () => {
    const [r, g, b] = gradePixel(255, 255, 255);
    expect(r).toBe(255);
    expect(g).toBeLessThanOrEqual(255);
    expect(b).toBeLessThanOrEqual(255);
    const [r2, g2, b2] = gradePixel(0, 0, 0);
    expect(r2).toBeGreaterThanOrEqual(0);
    expect(g2).toBeGreaterThanOrEqual(0);
    expect(b2).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/systems/__tests__/heapGrime.test.ts`
Expected: FAIL — `gradePixel` is not exported.

- [ ] **Step 3: Implement `gradePixel`**

Append to `src/systems/heapGrime.ts`:

```ts
/** Mix factor toward luma (0 = no change, 1 = greyscale). "Mild" grade. */
const GRADE_MIX = 0.22;
/** Warm tint added after the luma mix (R up, B down). */
const GRADE_WARM = { r: 10, g: 2, b: -8 };

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Mild warm colour-grade for one RGB pixel: pull each channel partway toward
 * the pixel's luma (desaturate) then add a small warm tint. Pure + clamped.
 */
export function gradePixel(r: number, g: number, b: number): [number, number, number] {
  const L = 0.3 * r + 0.59 * g + 0.11 * b;
  const k = GRADE_MIX;
  return [
    clamp255(r * (1 - k) + L * k + GRADE_WARM.r),
    clamp255(g * (1 - k) + L * k + GRADE_WARM.g),
    clamp255(b * (1 - k) + L * k + GRADE_WARM.b),
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/systems/__tests__/heapGrime.test.ts`
Expected: PASS (6 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/systems/heapGrime.ts src/systems/__tests__/heapGrime.test.ts
git commit -m "feat(heap): add mild warm colour-grade for heap fill"
```

---

## Task 4: heapGrime — grime tile + grade applicator (canvas)

**Files:**
- Modify: `src/systems/heapGrime.ts`

These touch Canvas2D/DOM and are verified visually in Task 5 (no unit test).

- [ ] **Step 1: Implement `createGrimeTile`**

Append to `src/systems/heapGrime.ts`:

```ts
/**
 * Build a vertically-seamless grime tile (white-based, for `multiply`):
 * low-frequency dark pockets + gentle vertical dirt streaks. Features that
 * cross the top/bottom edge are drawn wrapped, so the tile repeats in Y with
 * no seam — required because the renderer tiles it by world-Y across bands.
 * No high-frequency noise (it vanishes against the busy heap texture).
 */
export function createGrimeTile(width: number, height: number, seed: number): HTMLCanvasElement {
  const rnd = makeGrimeRng(seed);
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Low-frequency dark pockets (value variation / fake lumps). Draw each at y
  // and at y±height so any pocket near an edge wraps seamlessly.
  const POCKETS = 12;
  for (let i = 0; i < POCKETS; i++) {
    const x = rnd() * width;
    const y = rnd() * height;
    const r = 140 + rnd() * 220;
    const a = 0.16 + rnd() * 0.14; // medium
    for (const dy of [-height, 0, height]) {
      const grad = ctx.createRadialGradient(x, y + dy, 0, x, y + dy, r);
      grad.addColorStop(0, `rgba(20,14,8,${a})`);
      grad.addColorStop(1, 'rgba(20,14,8,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y + dy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Gentle vertical dirt streaks, wrapped in Y the same way.
  const STREAKS = 30;
  for (let i = 0; i < STREAKS; i++) {
    const x = rnd() * width;
    const len = 90 + rnd() * 260;
    const y = rnd() * height;
    const a = 0.05 + rnd() * 0.09;
    const w = 2 + rnd() * 6;
    for (const dy of [-height, 0, height]) {
      const grad = ctx.createLinearGradient(x, y + dy, x, y + dy + len);
      grad.addColorStop(0, 'rgba(18,12,6,0)');
      grad.addColorStop(0.25, `rgba(18,12,6,${a})`);
      grad.addColorStop(1, 'rgba(18,12,6,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y + dy, w, len);
    }
  }

  return cv;
}
```

- [ ] **Step 2: Implement `applyColourGrade`**

Append to `src/systems/heapGrime.ts`:

```ts
/**
 * Apply the mild warm grade in-place to the opaque pixels of a canvas region.
 * Skips fully-transparent pixels so it only touches the drawn heap fill
 * (putImageData ignores clipping, so the alpha check is what scopes it).
 */
export function applyColourGrade(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const img = ctx.getImageData(x, y, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const [nr, ng, nb] = gradePixel(d[i], d[i + 1], d[i + 2]);
    d[i] = nr; d[i + 1] = ng; d[i + 2] = nb;
  }
  ctx.putImageData(img, x, y);
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/systems/heapGrime.ts
git commit -m "feat(heap): add seamless grime tile + colour-grade applicator"
```

---

## Task 5: Integrate grime + grade into HeapChunkRenderer

**Files:**
- Modify: `src/systems/HeapChunkRenderer.ts`

- [ ] **Step 1: Import the grime helpers**

At the top of `src/systems/HeapChunkRenderer.ts`, add to the imports:

```ts
import { createGrimeTile, applyColourGrade } from './heapGrime';
```

- [ ] **Step 2: Build a grime tile per renderer**

Add a field and initialise it in the constructor. The class currently has:

```ts
  private readonly scene: Phaser.Scene;
  private readonly xOffset: number;
  private readonly colWidth: number;
```

Add after them:

```ts
  /** Vertically-seamless grime overlay, sized to this column; built once. */
  private readonly grimeTile: HTMLCanvasElement;
```

The constructor currently ends with:

```ts
  constructor(scene: Phaser.Scene, xOffset = 0, colWidth = WORLD_WIDTH) {
    this.scene    = scene;
    this.xOffset  = xOffset;
    this.colWidth = colWidth;
  }
```

Change it to:

```ts
  constructor(scene: Phaser.Scene, xOffset = 0, colWidth = WORLD_WIDTH) {
    this.scene    = scene;
    this.xOffset  = xOffset;
    this.colWidth = colWidth;
    // Seed off the column offset so adjacent columns differ slightly.
    this.grimeTile = createGrimeTile(colWidth, TEX_H, Math.floor(xOffset) + 1);
  }
```

- [ ] **Step 3: Apply grade + grime in `renderPolygon`**

In `renderPolygon`, the fill is drawn inside the clip, immediately followed by the ambient-occlusion loop. It currently reads:

```ts
    ctx.save();
    tracePath();
    ctx.clip();
    const tileOffsetY = -(bandTop % TEX_H);
    for (let ty = tileOffsetY; ty < H; ty += TEX_H) {
      const worldTile = Math.floor((bandTop + ty) / TEX_H);
      const tileKey   = `${HEAP_FILL_TEXTURE}-${worldTile % HEAP_TILE_COUNT}`;
      const tileSrc   = this.scene.textures.get(tileKey).getSourceImage() as CanvasImageSource;
      ctx.drawImage(tileSrc, 0, ty);
    }
    for (const [w, a] of HEAP_AO_PASSES) strokeRuns(w, `rgba(${HEAP_AO_COLOR},${a})`);
    ctx.restore();
```

Insert the grade + grime passes between the fill loop and the AO loop:

```ts
    ctx.save();
    tracePath();
    ctx.clip();
    const tileOffsetY = -(bandTop % TEX_H);
    for (let ty = tileOffsetY; ty < H; ty += TEX_H) {
      const worldTile = Math.floor((bandTop + ty) / TEX_H);
      const tileKey   = `${HEAP_FILL_TEXTURE}-${worldTile % HEAP_TILE_COUNT}`;
      const tileSrc   = this.scene.textures.get(tileKey).getSourceImage() as CanvasImageSource;
      ctx.drawImage(tileSrc, 0, ty);
    }

    // Mild warm colour-grade over the filled pixels (alpha-scoped, so the
    // surrounding halo/sky is untouched aside from negligible dark pixels).
    applyColourGrade(ctx, 0, 0, W, H);

    // Grime overlay — multiply, world-Y aligned (reusing tileOffsetY) and
    // seamless, so it is continuous across band boundaries (no horizontal seam).
    ctx.globalCompositeOperation = 'multiply';
    for (let ty = tileOffsetY; ty < H; ty += TEX_H) {
      ctx.drawImage(this.grimeTile, 0, ty);
    }
    ctx.globalCompositeOperation = 'source-over';

    for (const [w, a] of HEAP_AO_PASSES) strokeRuns(w, `rgba(${HEAP_AO_COLOR},${a})`);
    ctx.restore();
```

- [ ] **Step 4: Verify build + existing tests pass**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: tsc exit 0; all tests pass (existing suite + the 6 new `heapGrime` tests).

- [ ] **Step 5: Commit**

```bash
git add src/systems/HeapChunkRenderer.ts
git commit -m "feat(heap): apply runtime grime + colour-grade in chunk renderer"
```

---

## Task 6: Visual verification (both scenes)

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server (if not running)**

Run (background terminal): `npm run dev`

- [ ] **Step 2: Preview InfiniteGameScene**

Drive the live scene via the preview harness / Playwright (per the `heap-scene-preview` workflow and the technique recorded in the `heap-visual-refinement` memory): load `?dev=InfiniteGameScene`, freeze the trash wall, place the player on a column, and screenshot the heap.
Expected: warm grimy texture with visible depth (baked shadows) + grime cohesion; **no horizontal band seams**; items still readable; the player sits correctly on the surface.

- [ ] **Step 3: Preview GameScene**

Start the local worker (`cd server && npx wrangler dev --port 8787`) so a real heap loads, then load `?dev=GameScene` and screenshot near the base.
Expected: same — depth + grime read together, no seams, no regression in the PR #34 outline/AO/rim.

- [ ] **Step 4: Full build + test**

Run: `npm run build && npx vitest run`
Expected: build clean; all tests pass.

- [ ] **Step 5: If anything looks off**

Tune and re-verify (no new commit needed until happy):
- Grime too strong/weak → adjust `POCKETS`/`STREAKS` counts and alpha ranges in `createGrimeTile`.
- Grade too muted/strong → adjust `GRADE_MIX` / `GRADE_WARM` in `heapGrime.ts`.
- Baked shadows/gaps off → re-tune `sprite-config.mjs` and re-run `node scripts/gen-heap-texture.mjs` (Task 1).

- [ ] **Step 6: Push the branch to update PR #34**

```bash
git push origin feature/heap-visual-refinement
```

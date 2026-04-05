# Heap Polygon Band Clipping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Y-range filter in `applyPolygonToGenerator` with Sutherland-Hodgman polygon clipping so that per-band polygons have vertices at exact band boundaries, eliminating horizontal gap lines in the rendered heap.

**Architecture:** Three pure helper functions (`interpolateAtY`, `clipToHalfPlane`, `clipPolygonToBand`) replace the broken `polygon.filter()` call in `HeapPolygonLoader.ts`. `clipPolygonToBand` is exported for unit testing. No other files change.

**Tech Stack:** TypeScript, Vite 6, Vitest 2 (added to root for client-side unit tests), Phaser 3.90

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `package.json` | Modify | Add `vitest ^2.0.0` dev dep + `"test": "vitest run"` script |
| `vite.config.ts` | Modify | Add `test: { environment: 'node' }` block for Vitest |
| `src/systems/__tests__/HeapPolygonLoader.test.ts` | Create | Unit tests for `clipPolygonToBand` |
| `src/systems/HeapPolygonLoader.ts` | Modify | Add clipping helpers, export `clipPolygonToBand`, update `applyPolygonToGenerator` |

---

## Task 1: Add Vitest to root project

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`

- [ ] **Step 1: Add vitest to package.json**

Open `package.json`. Add `"test": "vitest run"` to `scripts` and `"vitest": "^2.0.0"` to `devDependencies`:

```json
{
  "name": "heap-game",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "cap:sync": "cap sync",
    "cap:android": "cap open android",
    "gen-assets": "node scripts/gen-heap-defs.mjs && node scripts/gen-heap-texture.mjs",
    "seed": "npx tsx scripts/seed-heap.ts"
  },
  "dependencies": {
    "@capacitor/android": "8.2.0",
    "@capacitor/core": "8.2.0",
    "phaser": "3.90.0"
  },
  "devDependencies": {
    "@capacitor/cli": "8.2.0",
    "@types/node": "25.5.0",
    "sharp": "^0.34.5",
    "tsx": "^4.19.2",
    "typescript": "5.9.3",
    "vite": "^6.3.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Add test block to vite.config.ts**

Open `vite.config.ts` and add `/// <reference types="vitest" />` at the top plus a `test` block:

```ts
/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 3: Install dependencies**

```bash
npm install
```

Expected: vitest 2.x added to `node_modules`.

- [ ] **Step 4: Verify test runner works**

```bash
npm test
```

Expected output contains:
```
No test files found
```
or exits 0 with "0 tests". The runner starts successfully.

---

## Task 2: Write failing tests for `clipPolygonToBand`

**Files:**
- Create: `src/systems/__tests__/HeapPolygonLoader.test.ts`

- [ ] **Step 1: Create test file**

Create `src/systems/__tests__/HeapPolygonLoader.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { clipPolygonToBand } from '../HeapPolygonLoader';

// Vertex type: { x: number; y: number }
// Y increases downward (Phaser world coords).
// bandTop < bandBottom.

describe('clipPolygonToBand', () => {
  it('clips a tall rectangle to the band, inserting vertices at band boundaries', () => {
    // Rectangle from y=0 to y=1000, x=100-200. Band [500, 1000].
    // Expected: bottom half of the rectangle with vertices at exactly y=500 and y=1000.
    const poly = [
      { x: 100, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 1000 },
      { x: 100, y: 1000 },
    ];
    const result = clipPolygonToBand(poly, 500, 1000);

    expect(result.length).toBeGreaterThanOrEqual(3);
    const ys = result.map(v => v.y);
    expect(Math.min(...ys)).toBeCloseTo(500);
    expect(Math.max(...ys)).toBeCloseTo(1000);
  });

  it('returns polygon unchanged when fully inside band', () => {
    const poly = [
      { x: 0, y: 600 },
      { x: 100, y: 600 },
      { x: 100, y: 900 },
      { x: 0, y: 900 },
    ];
    const result = clipPolygonToBand(poly, 500, 1000);

    expect(result.length).toBe(4);
    result.forEach(v => {
      expect(v.y).toBeGreaterThanOrEqual(500);
      expect(v.y).toBeLessThanOrEqual(1000);
    });
  });

  it('returns empty array when polygon is entirely above band', () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 400 },
      { x: 0, y: 400 },
    ];
    const result = clipPolygonToBand(poly, 500, 1000);
    expect(result).toHaveLength(0);
  });

  it('returns empty array when polygon is entirely below band', () => {
    const poly = [
      { x: 0, y: 1100 },
      { x: 100, y: 1100 },
      { x: 100, y: 1500 },
      { x: 0, y: 1500 },
    ];
    const result = clipPolygonToBand(poly, 500, 1000);
    expect(result).toHaveLength(0);
  });

  it('clips a partial overlap, producing boundary vertices at bandTop', () => {
    // Rectangle from y=200 to y=700, x=100-200. Band [500, 1000].
    // Overlap is y=500..700. Boundary vertex should appear at y=500.
    const poly = [
      { x: 100, y: 200 },
      { x: 200, y: 200 },
      { x: 200, y: 700 },
      { x: 100, y: 700 },
    ];
    const result = clipPolygonToBand(poly, 500, 1000);

    expect(result.length).toBeGreaterThanOrEqual(3);
    const ys = result.map(v => v.y);
    expect(Math.min(...ys)).toBeCloseTo(500);
    expect(Math.max(...ys)).toBeCloseTo(700);
  });

  it('interpolates X correctly at the band boundary', () => {
    // Diagonal edge from (0, 400) to (100, 600). Band [500, 1000].
    // At y=500: t=(500-400)/(600-400)=0.5, x=0+0.5*100=50
    const poly = [
      { x: 0, y: 400 },
      { x: 100, y: 600 },
      { x: 0, y: 600 },
    ];
    const result = clipPolygonToBand(poly, 500, 1000);

    const boundaryVertex = result.find(v => Math.abs(v.y - 500) < 0.01);
    expect(boundaryVertex).toBeDefined();
    expect(boundaryVertex!.x).toBeCloseTo(50);
  });

  it('returns empty array for an empty polygon', () => {
    expect(clipPolygonToBand([], 500, 1000)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test
```

Expected: Tests fail because `clipPolygonToBand` is not exported from `HeapPolygonLoader.ts` yet. Error will be something like `"clipPolygonToBand" is not exported`.

---

## Task 3: Implement clipping helpers and export `clipPolygonToBand`

**Files:**
- Modify: `src/systems/HeapPolygonLoader.ts`

- [ ] **Step 1: Add helpers before `applyPolygonToGenerator`**

Open `src/systems/HeapPolygonLoader.ts`. Add these three functions after the import block and before the existing `applyPolygonToGenerator` function. The existing `applyPolygonToGenerator` function is NOT changed yet in this step.

```ts
function interpolateAtY(a: Vertex, b: Vertex, targetY: number): Vertex {
  const t = (targetY - a.y) / (b.y - a.y);
  return { x: a.x + t * (b.x - a.x), y: targetY };
}

function clipToHalfPlane(
  polygon: Vertex[],
  inside: (v: Vertex) => boolean,
  intersect: (a: Vertex, b: Vertex) => Vertex,
): Vertex[] {
  if (polygon.length === 0) return [];
  const output: Vertex[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const aIn = inside(a);
    const bIn = inside(b);
    if (aIn) output.push(a);
    if (aIn !== bIn) output.push(intersect(a, b));
  }
  return output;
}

export function clipPolygonToBand(polygon: Vertex[], bandTop: number, bandBottom: number): Vertex[] {
  // Pass 1: discard vertices above the band (y < bandTop)
  let clipped = clipToHalfPlane(
    polygon,
    (v) => v.y >= bandTop,
    (a, b) => interpolateAtY(a, b, bandTop),
  );
  // Pass 2: discard vertices below the band (y > bandBottom)
  clipped = clipToHalfPlane(
    clipped,
    (v) => v.y <= bandBottom,
    (a, b) => interpolateAtY(a, b, bandBottom),
  );
  return clipped;
}
```

- [ ] **Step 2: Run tests — verify they pass**

```bash
npm test
```

Expected output:
```
✓ src/systems/__tests__/HeapPolygonLoader.test.ts (6)
  ✓ clipPolygonToBand > clips a tall rectangle to the band, inserting vertices at band boundaries
  ✓ clipPolygonToBand > returns polygon unchanged when fully inside band
  ✓ clipPolygonToBand > returns empty array when polygon is entirely above band
  ✓ clipPolygonToBand > returns empty array when polygon is entirely below band
  ✓ clipPolygonToBand > clips a partial overlap, producing boundary vertices at bandTop
  ✓ clipPolygonToBand > interpolates X correctly at the band boundary
  ✓ clipPolygonToBand > returns empty array for an empty polygon

Test Files  1 passed (1)
Tests       6 passed (6)
```

- [ ] **Step 3: Commit**

```bash
git add src/systems/HeapPolygonLoader.ts src/systems/__tests__/HeapPolygonLoader.test.ts package.json vite.config.ts package-lock.json
git commit -m "test: add vitest + unit tests for clipPolygonToBand"
```

---

## Task 4: Wire `clipPolygonToBand` into `applyPolygonToGenerator`

**Files:**
- Modify: `src/systems/HeapPolygonLoader.ts`

- [ ] **Step 1: Replace the Y-filter with the clip call**

In `src/systems/HeapPolygonLoader.ts`, find `applyPolygonToGenerator` and replace the existing `polygon.filter()` line. The full updated function:

```ts
export function applyPolygonToGenerator(polygon: Vertex[], generator: HeapGenerator): void {
  if (polygon.length === 0) return;

  let minY = MOCK_HEAP_HEIGHT_PX;
  let maxY = 0;
  for (const v of polygon) {
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }

  const firstBand = Math.floor(minY / CHUNK_BAND_HEIGHT) * CHUNK_BAND_HEIGHT;

  for (let bandTop = firstBand; bandTop <= maxY; bandTop += CHUNK_BAND_HEIGHT) {
    const bandBottom = bandTop + CHUNK_BAND_HEIGHT;
    const bandVertices = clipPolygonToBand(polygon, bandTop, bandBottom);
    if (bandVertices.length >= 3) {
      generator.applyBandPolygon(bandTop, bandVertices);
    }
  }
}
```

- [ ] **Step 2: Run tests to confirm nothing regressed**

```bash
npm test
```

Expected: All 6 tests still pass.

- [ ] **Step 3: Commit**

```bash
git add src/systems/HeapPolygonLoader.ts
git commit -m "fix: replace Y-filter with SH clipping in applyPolygonToGenerator

Eliminates horizontal gap lines at CHUNK_BAND_HEIGHT seams by inserting
interpolated vertices at exact band boundaries instead of only keeping
vertices already within the band's Y range."
```

---

## Task 5: Visual verification and production deploy

**Files:** None (runtime verification + deployment)

- [ ] **Step 1: Start the local server**

In a separate terminal (from the `server/` directory):
```bash
cd server && npm run dev
```

Expected: `wrangler dev` starts on `http://localhost:8787`.

- [ ] **Step 2: Seed the local heap**

From the project root:
```bash
OVERWRITE=true VERBOSE=true npm run seed
```

Expected output ends with something like:
```
✓ Seeded! version=1, vertexCount=NNN, hash=...
```

- [ ] **Step 3: Run the game locally**

```bash
npm run dev
```

Open `http://localhost:3000` in a browser. Visually inspect the heap:
- No horizontal gap lines should be visible across the heap surface
- The heap silhouette should be continuous with no transparent horizontal bands

- [ ] **Step 4: Check band seams**

Walk the player up the heap to scroll past Y-multiples of 500 (e.g. y=13000, y=13500 — the exact values depend on the generated heap). The heap should be solid and continuous across every band transition. The player should not fall through or catch on invisible ledges at band seams.

- [ ] **Step 5: Deploy to production (only after local verification passes)**

```bash
cd server && npx wrangler deploy
```

Expected:
```
 ⛅️ wrangler ...
 Uploaded heap-server (...)
 Published heap-server (...)
```

- [ ] **Step 6: Seed production**

```bash
HEAP_SERVER_URL=https://heap-server.workers.dev OVERWRITE=true npm run seed
```

Expected:
```
✓ Seeded! version=1, vertexCount=NNN, hash=...
```

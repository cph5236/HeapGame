# Polygon Reconstruction from Server Points Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the heap polygon rendering so that server-fetched placed points are reconstructed into a proper left-edge/right-edge boundary polygon before being passed to the game's generator.

**Architecture:** Add a pure `reconstructPolygonFromPoints(points: Vertex[]): Vertex[]` function to `HeapPolygonLoader.ts` that buckets a flat Y-sorted point cloud into `CHUNK_BAND_HEIGHT` bands, finds min/max X per band with forward-fill, simplifies each edge, and stitches them into the left-ascending/right-descending format `applyPolygonToGenerator` expects. `HeapClient.load()` pipes its raw polygon through this function before returning.

**Tech Stack:** TypeScript, Phaser 3, Vitest

---

## File Map

| File | Change |
|---|---|
| `src/systems/HeapPolygonLoader.ts` | Add `reconstructPolygonFromPoints` (export) |
| `src/systems/HeapClient.ts` | Import and call `reconstructPolygonFromPoints` in `load()` |
| `src/systems/__tests__/HeapPolygonLoader.test.ts` | Add `describe('reconstructPolygonFromPoints', ...)` block |

---

### Task 1: Write failing tests for `reconstructPolygonFromPoints`

**Files:**
- Modify: `src/systems/__tests__/HeapPolygonLoader.test.ts`

Context: `CHUNK_BAND_HEIGHT = 500`. World Y increases downward. The output polygon must be structured as left-edge vertices (Y ascending) followed by right-edge vertices (Y descending) — that is what `applyPolygonToGenerator` requires.

- [ ] **Step 1: Add the test block**

First, update the existing import on line 2 of `src/systems/__tests__/HeapPolygonLoader.test.ts` from:
```typescript
import { clipPolygonToBand } from '../HeapPolygonLoader';
```
to:
```typescript
import { clipPolygonToBand, reconstructPolygonFromPoints } from '../HeapPolygonLoader';
```

Then append the following describe block at the end of the file:

```typescript
describe('reconstructPolygonFromPoints', () => {
  it('returns [] for empty input', () => {
    expect(reconstructPolygonFromPoints([])).toHaveLength(0);
  });

  it('returns [] for a single point', () => {
    expect(reconstructPolygonFromPoints([{ x: 100, y: 500 }])).toHaveLength(0);
  });

  it('produces a polygon with left-edge Y ascending then right-edge Y descending', () => {
    // Two bands: band 0 (y=0..500), band 1 (y=500..1000)
    // Band 0: points at x=200,y=100 and x=700,y=300 → minX=200, maxX=700
    // Band 1: points at x=150,y=600 and x=750,y=800 → minX=150, maxX=750
    const points = [
      { x: 200, y: 100 },
      { x: 700, y: 300 },
      { x: 150, y: 600 },
      { x: 750, y: 800 },
    ];
    const result = reconstructPolygonFromPoints(points);
    expect(result.length).toBeGreaterThanOrEqual(4);

    // Left edge: first half, Y must be ascending
    const half = result.length / 2;
    const leftEdge = result.slice(0, half);
    const rightEdge = result.slice(half);

    for (let i = 1; i < leftEdge.length; i++) {
      expect(leftEdge[i].y).toBeGreaterThanOrEqual(leftEdge[i - 1].y);
    }
    // Right edge: Y must be descending
    for (let i = 1; i < rightEdge.length; i++) {
      expect(rightEdge[i].y).toBeLessThanOrEqual(rightEdge[i - 1].y);
    }
  });

  it('preserves a concave left side', () => {
    // Band 0 (y=0..500): left point jutting out at x=50
    // Band 1 (y=500..1000): left point at x=200 (narrower)
    // The left edge should contain a vertex with x ≈ 50
    const points = [
      { x: 50, y: 200 },   // leftmost in band 0
      { x: 700, y: 300 },  // rightmost in band 0
      { x: 200, y: 600 },  // left in band 1
      { x: 750, y: 800 },  // right in band 1
    ];
    const result = reconstructPolygonFromPoints(points);
    const half = Math.ceil(result.length / 2);
    const leftEdge = result.slice(0, half);
    // Some left-edge vertex should be near x=50
    const hasJut = leftEdge.some(v => v.x <= 60);
    expect(hasJut).toBe(true);
  });

  it('forward-fills an empty band from the band above', () => {
    // Band 0 (y=0..500): points at x=200,y=100 and x=700,y=300
    // Band 1 (y=500..1000): no points
    // Band 2 (y=1000..1500): points at x=250,y=1100 and x=680,y=1200
    // Band 1 should inherit minX=200, maxX=700 from band 0
    const points = [
      { x: 200, y: 100 },
      { x: 700, y: 300 },
      { x: 250, y: 1100 },
      { x: 680, y: 1200 },
    ];
    const result = reconstructPolygonFromPoints(points);
    // Should have entries for all 3 bands → at least 6 vertices total (3 left + 3 right)
    expect(result.length).toBeGreaterThanOrEqual(6);
  });

  it('output left-edge x values respect min-X of each band', () => {
    // Band 0 (y=0..500): x=300,y=200 and x=600,y=400 → minX=300
    // Band 1 (y=500..1000): x=100,y=700 and x=800,y=900 → minX=100
    const points = [
      { x: 300, y: 200 },
      { x: 600, y: 400 },
      { x: 100, y: 700 },
      { x: 800, y: 900 },
    ];
    const result = reconstructPolygonFromPoints(points);
    const half = Math.ceil(result.length / 2);
    const leftEdge = result.slice(0, half);
    // Minimum x across left edge should be ≤ 100 (the minX of band 1)
    const minLeftX = Math.min(...leftEdge.map(v => v.x));
    expect(minLeftX).toBeLessThanOrEqual(110); // small tolerance for simplification
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/connor/Documents/Repos/HeapGame && npm run test -- HeapPolygonLoader
```

Expected: fails with `reconstructPolygonFromPoints is not a function` (or similar import error).

---

### Task 2: Implement `reconstructPolygonFromPoints`

**Files:**
- Modify: `src/systems/HeapPolygonLoader.ts`

- [ ] **Step 1: Add the import for CHUNK_BAND_HEIGHT** (already imported — verify line 1)

Check that `CHUNK_BAND_HEIGHT` is already imported at the top of `src/systems/HeapPolygonLoader.ts`:
```typescript
import { CHUNK_BAND_HEIGHT, MOCK_HEAP_HEIGHT_PX } from '../constants';
```
It is — no change needed.

- [ ] **Step 2: Add `reconstructPolygonFromPoints` to `HeapPolygonLoader.ts`**

Append after the `polygonTopY` function and before `findSurfaceYFromPolygon` (line 91):

```typescript
/**
 * Reconstruct a proper boundary polygon from a flat list of placed points.
 *
 * The server stores placed points sorted by Y — not as a boundary polygon.
 * This function buckets points into CHUNK_BAND_HEIGHT bands, finds the leftmost
 * and rightmost X per band (with forward-fill for empty bands), and stitches
 * them into the left-edge-ascending / right-edge-descending format required by
 * applyPolygonToGenerator.
 *
 * Returns [] if fewer than 2 points are provided.
 */
export function reconstructPolygonFromPoints(points: Vertex[]): Vertex[] {
  if (points.length < 2) return [];

  const sorted = [...points].sort((a, b) => a.y - b.y);
  const minY = sorted[0].y;
  const maxY = sorted[sorted.length - 1].y;

  const firstBand = Math.floor(minY / CHUNK_BAND_HEIGHT) * CHUNK_BAND_HEIGHT;

  const leftEdge: Vertex[] = [];
  const rightEdge: Vertex[] = [];

  let lastMinX = sorted[0].x;
  let lastMaxX = sorted[0].x;

  for (let bandTop = firstBand; bandTop <= maxY; bandTop += CHUNK_BAND_HEIGHT) {
    const bandBottom = bandTop + CHUNK_BAND_HEIGHT;
    const bandMidY = bandTop + CHUNK_BAND_HEIGHT / 2;

    let bandMinX = Infinity;
    let bandMaxX = -Infinity;

    for (const v of sorted) {
      if (v.y >= bandTop && v.y < bandBottom) {
        if (v.x < bandMinX) bandMinX = v.x;
        if (v.x > bandMaxX) bandMaxX = v.x;
      }
    }

    if (bandMinX !== Infinity) {
      lastMinX = bandMinX;
      lastMaxX = bandMaxX;
    }
    // Forward-fill: use last known min/max if band is empty

    leftEdge.push({ x: lastMinX, y: bandMidY });
    rightEdge.push({ x: lastMaxX, y: bandMidY });
  }

  const simplifiedLeft = simplifyPolygon(leftEdge, 2);
  const simplifiedRight = simplifyPolygon(rightEdge, 2);

  // Stitch: left edge ascending Y, right edge descending Y
  return [...simplifiedLeft, ...[...simplifiedRight].reverse()];
}
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
cd /home/connor/Documents/Repos/HeapGame && npm run test -- HeapPolygonLoader
```

Expected: all `reconstructPolygonFromPoints` tests pass; existing `clipPolygonToBand` tests still pass.

- [ ] **Step 4: Commit**

```bash
cd /home/connor/Documents/Repos/HeapGame && git add src/systems/HeapPolygonLoader.ts src/systems/__tests__/HeapPolygonLoader.test.ts
git commit -m "feat: add reconstructPolygonFromPoints to HeapPolygonLoader"
```

---

### Task 3: Wire `reconstructPolygonFromPoints` into `HeapClient.load()`

**Files:**
- Modify: `src/systems/HeapClient.ts`

- [ ] **Step 1: Add the import**

At the top of `src/systems/HeapClient.ts`, after the existing imports, add:

```typescript
import { reconstructPolygonFromPoints } from './HeapPolygonLoader';
```

- [ ] **Step 2: Wrap `buildPolygon` calls in `load()` with reconstruction**

`HeapClient.load()` calls `buildPolygon` in three places. Wrap each with `reconstructPolygonFromPoints(...)`:

Replace the three `return buildPolygon(...)` / `return await buildPolygon(...)` patterns in `load()`:

```typescript
static async load(heapId: string): Promise<Vertex[]> {
  const cache = loadCache(heapId);
  const version = cache?.version ?? 0;

  try {
    const res = await fetch(`${SERVER_URL}/heaps/${heapId}?version=${version}`);
    if (!res.ok) throw new Error(`heap fetch failed: ${res.status}`);
    const data = (await res.json()) as GetHeapResponse;

    if (!data.changed && cache) {
      return reconstructPolygonFromPoints(await buildPolygon(heapId, cache));
    }

    if (data.changed) {
      const newCache: HeapCache = {
        version: data.version,
        baseId: data.baseId,
        liveZone: data.liveZone,
      };
      saveCache(heapId, newCache);
      return reconstructPolygonFromPoints(await buildPolygon(heapId, newCache));
    }

    return [];
  } catch {
    if (cache) {
      try {
        return reconstructPolygonFromPoints(await buildPolygon(heapId, cache));
      } catch {
        return reconstructPolygonFromPoints(cache.liveZone);
      }
    }
    return [];
  }
}
```

- [ ] **Step 3: Run the full test suite**

```bash
cd /home/connor/Documents/Repos/HeapGame && npm run test
```

Expected: all tests pass (56+ tests). No regressions.

- [ ] **Step 4: Commit**

```bash
cd /home/connor/Documents/Repos/HeapGame && git add src/systems/HeapClient.ts
git commit -m "feat: pipe HeapClient.load() through reconstructPolygonFromPoints"
```

---

### Task 4: Smoke test in browser

**Files:** none changed

- [ ] **Step 1: Start dev server**

```bash
cd /home/connor/Documents/Repos/HeapGame && npm run dev
```

Open `http://localhost:3000` in a browser.

- [ ] **Step 2: Verify polygon renders correctly**

Load the game. The heap polygon outline should show a clean silhouette — left and right edges follow the actual shape of placed blocks with no interior crossing lines. The shape in the screenshot (the "4" shape) should render with clean boundary edges, not random cross-connections.

- [ ] **Step 3: Verify placement still works**

Place a block (hold SPACE / PLACE BLOCK button for 1s at the top). After placement, the polygon should update and still render cleanly.

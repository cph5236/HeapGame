# Heap Polygon Band Clipping — Design Spec

**Date:** 2026-04-02
**Status:** Approved

---

## Problem

Visible horizontal gap lines appear across the rendered heap because `applyPolygonToGenerator` in
`src/systems/HeapPolygonLoader.ts` uses a simple Y-range filter to split the global polygon into
per-band polygons. The filter only keeps vertices whose Y coordinates already fall within
`[bandTop, bandBottom)`. It does not insert interpolated vertices at the band boundaries, so each
per-band polygon starts and ends at the first/last actual vertex Y inside the band — not at the
exact band edge. With `CHUNK_BAND_HEIGHT = 500` and ~26 bands across the heap, each band seam has a
~20–30 px uncovered strip where the geometry mask does not reach. These strips render as transparent
gaps in the heap visual.

---

## Architecture

Only **`src/systems/HeapPolygonLoader.ts`** changes. No server, API, schema, `HeapClient`,
`GameScene`, `HeapChunkRenderer`, or `HeapEdgeCollider` changes are required.

The global `Vertex[]` polygon is still produced by the server seed script
(`scripts/seed-heap.ts`) and delivered to `GameScene` via `HeapClient.load()`, unchanged. The only
difference is how `applyPolygonToGenerator` slices that polygon into per-band polygons.

---

## Algorithm — Sutherland-Hodgman Horizontal Strip Clipping

Replace the Y-filter with a two-pass clip against the horizontal strip `[bandTop, bandBottom]`.

**Pass 1 — clip to `y >= bandTop`** (discard everything above the band):
For each edge `(A → B)` of the input polygon:
- If A is inside (`A.y >= bandTop`) and B is inside: keep B.
- If A is inside and B is outside: insert interpolated vertex at `y = bandTop`, keep it.
- If A is outside and B is inside: insert interpolated vertex at `y = bandTop`, then keep B.
- If both outside: keep nothing.

**Pass 2 — clip to `y <= bandBottom`** (discard everything below the band):
Same logic, substituting `bandBottom` and `<=`.

**Interpolation** for an edge `(A, B)` at a target Y:
```
t = (targetY - A.y) / (B.y - A.y)
x = A.x + t * (B.x - A.x)
```

Result: every band polygon that intersects the band at all will have vertices precisely at
`y = bandTop` and `y = bandBottom`, fully covering the seam.

---

## File Changes — `src/systems/HeapPolygonLoader.ts`

### New helpers (add before `applyPolygonToGenerator`)

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

function clipPolygonToBand(polygon: Vertex[], bandTop: number, bandBottom: number): Vertex[] {
  // Pass 1: keep y >= bandTop
  let clipped = clipToHalfPlane(
    polygon,
    (v) => v.y >= bandTop,
    (a, b) => interpolateAtY(a, b, bandTop),
  );
  // Pass 2: keep y <= bandBottom
  clipped = clipToHalfPlane(
    clipped,
    (v) => v.y <= bandBottom,
    (a, b) => interpolateAtY(a, b, bandBottom),
  );
  return clipped;
}
```

### Updated `applyPolygonToGenerator`

Replace the `polygon.filter(...)` line with a call to `clipPolygonToBand`:

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

No other functions in the file (`polygonTopY`, `findSurfaceYFromPolygon`) change.

---

## Testing

1. **Re-seed the heap** (local):
   ```
   OVERWRITE=true VERBOSE=true npm run seed
   ```
2. **Run the game locally** and visually inspect the heap. There should be no horizontal gap lines.
3. **Check band seams** specifically at Y multiples of 500 (e.g. y=500, y=1000, y=1500). The heap
   surface should be continuous across each seam.
4. **Verify physics** by walking the player across band seams — no invisible ledges or fall-through.

---

## Deployment (after local verification)

```bash
# Deploy worker
npx wrangler deploy

# Re-seed production DB
HEAP_SERVER_URL=https://heap-server.workers.dev OVERWRITE=true npm run seed
```

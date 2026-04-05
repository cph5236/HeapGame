# Polygon Reconstruction from Server Points

**Date:** 2026-04-03  
**Branch:** feature/HeapServer  
**Scope:** Client-side only — no server changes

---

## Problem

The server's `/place` endpoint stores placed points as a flat list sorted by Y value. When the client fetches this list and passes it to `applyPolygonToGenerator`, Phaser connects vertices in array order — which is Y-depth order, not boundary order. The result is interior crossing edges instead of a clean silhouette outline.

`applyPolygonToGenerator` requires vertices structured as:
- left-edge vertices, Y ascending (top → bottom)
- right-edge vertices, Y descending (bottom → top)

The server returns neither of these — it returns a flat scatter of placed-point coordinates sorted by Y.

---

## Solution

Add a pure function `reconstructPolygonFromPoints(points: Vertex[]): Vertex[]` to `HeapPolygonLoader.ts`. Call it inside `HeapClient.load()` before returning the polygon to the game.

No server changes. No changes to `applyPolygonToGenerator`, `clipPolygonToBand`, or the generator.

---

## Architecture

### New function: `reconstructPolygonFromPoints`

**Location:** `src/systems/HeapPolygonLoader.ts`

**Algorithm:**

1. Sort input points by Y ascending (defensive — server already does this)
2. Compute Y range: `minY` to `maxY` across all points
3. Divide into bands of height `CHUNK_BAND_HEIGHT` (same resolution as the rest of the polygon system)
4. For each band, find `minX` (left edge) and `maxX` (right edge) among points whose Y falls in the band
5. Forward-fill empty bands from the last known `minX`/`maxX` (same pattern as `computeBandScanlines`)
6. Run `simplifyPolygon` (existing RDP) on the left-edge and right-edge arrays independently to reduce vertex count
7. Stitch: left-edge (ascending Y) + right-edge (descending Y) → return as closed polygon

**Returns:** `[]` if fewer than 2 points are provided.

### Updated: `HeapClient.load()`

**Location:** `src/systems/HeapClient.ts`

Pipe the raw vertex array from the server response through `reconstructPolygonFromPoints` before returning. The rest of the game (GameScene, applyPolygonToGenerator) is unchanged.

---

## Data Flow

```
Server /heaps/:id
  → HeapClient.load()
      raw Vertex[] (Y-sorted placed points)
  → reconstructPolygonFromPoints()
      sort by Y
      bucket into CHUNK_BAND_HEIGHT bands
      min/max X per band + forward-fill empty bands
      simplifyPolygon() on left and right edges
      stitch: left-edge (asc Y) + right-edge (desc Y)
  → proper boundary Vertex[]
  → applyPolygonToGenerator()   [unchanged]
  → HeapGenerator               [unchanged]
```

---

## Error Handling

- Fewer than 2 input points → return `[]`. `applyPolygonToGenerator` handles empty polygon gracefully (world-floor fallback).
- Empty bands at top or bottom are forward-filled (or back-filled for leading empty bands) so the polygon stays closed.
- Single-point bands produce a degenerate left==right edge; this is valid — the band becomes a vertical line segment, which clips correctly.

---

## Testing

**File:** `src/systems/__tests__/HeapPolygonLoader.test.ts`

| Test | What it checks |
|---|---|
| Basic reconstruction | Given symmetric Y-sorted points, output is left-edge-asc + right-edge-desc |
| Concave left side preserved | A point jutting further left than its neighbours appears in the left edge |
| Concave right side preserved | A point jutting further right than its neighbours appears in the right edge |
| Forward-fill | A band with no points inherits minX/maxX from the band above |
| Empty input | `[]` returned for 0 or 1 points |
| Integration | `applyPolygonToGenerator` receives the reconstructed polygon without error |

Existing tests for `clipPolygonToBand` and `applyPolygonToGenerator` are unaffected.

---

## Files Changed

| File | Change |
|---|---|
| `src/systems/HeapPolygonLoader.ts` | Add `reconstructPolygonFromPoints` |
| `src/systems/HeapClient.ts` | Pipe load result through `reconstructPolygonFromPoints` |
| `src/systems/__tests__/HeapPolygonLoader.test.ts` | New unit tests |

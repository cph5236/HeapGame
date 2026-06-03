# Tighten Rat Patrol (Inset From Edge Ends) — Design

**Date:** 2026-06-03
**Branch:** `feat/rat-patrol-inset`
**Playtest item:** #7 from `Todo/Todo_Playtest_Feedback.md` (2026-06-01 feedback) —
"Rats patrol too far and can move inside the heap, making them hard to see —
tighten patrol range / keep them on visible surfaces."

## Problem

Rat (percher) patrol bounds are set to the **full extent of the polygon edge** the
rat spawned on:

- `onBandLoaded` ([EnemyManager.ts:133-139](../src/systems/EnemyManager.ts#L133))
  sets `minX = leftV.x`, `maxX = rightV.x`, `minY = leftV.y`, `maxY = rightV.y` —
  the edge's two vertices.
- `update()`'s percher branch walks the rat across `[minX, maxX]`, interpolating its
  Y between `[minY, maxY]`, flipping direction at each bound.

Only the edge **midpoint** is validated as exterior/visible at spawn
([trySpawn:308](../src/systems/EnemyManager.ts#L308)). So a long edge lets the rat
walk all the way to its corners, where the silhouette turns down into the heap or
into a concave pocket — producing both reported symptoms: it ranges too far, and at
the ends it appears to walk inside the heap.

## Approach (decided)

**Inset the patrol from the edge's ends by a fixed margin** so the rat turns around
shortly before each corner. No max-range cap — on a long surface the rat patrols
most of it (minus the end margins), which reads as "this rat owns this ledge."

This is the user's stated model: *"patrol most of the surface it spawns on, just
stopping shy of the very ends."*

### Pure helper

Add to `src/systems/EnemySpawnMath.ts` (home of the other pure spawn helpers):

```ts
export interface PatrolBounds { minX: number; maxX: number; minY: number; maxY: number; }

/**
 * Patrol bounds for a rat on the surface edge leftV→rightV, inset from each end by
 * `margin` so the rat turns around before its body overhangs the corner. minY/maxY
 * are the edge's Y at the inset X's (linear along the edge), keeping the rat on the
 * surface. If the edge is too short to inset both ends (width <= 2*margin), the
 * bounds collapse to the edge midpoint and the rat idles in place.
 *
 * Precondition: leftV.x <= rightV.x (caller orders the vertices).
 */
export function insetPatrolBounds(
  leftV: { x: number; y: number },
  rightV: { x: number; y: number },
  margin: number,
): PatrolBounds
```

Behaviour:
- `width = rightV.x − leftV.x`.
- If `width <= 2 * margin`: `midX = (leftV.x + rightV.x) / 2`; return
  `{ minX: midX, maxX: midX, minY: edgeY(midX), maxY: edgeY(midX) }` (collapsed → idle).
- Else: `minX = leftV.x + margin`, `maxX = rightV.x − margin`,
  `minY = edgeY(minX)`, `maxY = edgeY(maxX)`.
- `edgeY(x)` = linear interpolation of Y along the edge:
  `leftV.y + (x − leftV.x) / width * (rightV.y − leftV.y)` (for `width > 0`;
  the collapsed branch already covers `width <= 2*margin`, which includes
  the degenerate `width == 0` case).

### Margin constant

Add to `src/constants.ts`:

```ts
export const RAT_PATROL_END_MARGIN_PX = 24; // ≈ rat half-width; rat turns before its body overhangs a corner
```

Designer-tunable. 24px ≈ half the 48px rat sprite, so the visible sprite stops shy
of the corner.

### Wiring

Both spawn paths build `leftV`/`rightV` and call `insetPatrolBounds`, passing the
result's `minX/maxX/minY/maxY` into `trySpawn` (signature unchanged):

- **`onBandLoaded`** — replace the raw `minX/maxX/minY/maxY` assignment with the
  inset bounds. (`leftV`/`rightV` already computed there.)
- **`onPlatformSpawned`** — rats on placed objects (e.g. I-beam). Build a flat edge
  from the object extents (`leftV = {x: entry.x − w/2, y: platformTopY}`,
  `rightV = {x: entry.x + w/2, y: platformTopY}`) and inset the same way. Flat top
  → `minY == maxY` unchanged; the rat just stops shy of the object's ends. Narrow
  objects collapse to idle.

`update()`'s percher branch is **unchanged** — it already consumes `minX/maxX` and
interpolates Y across `[minY, maxY]`, so inset bounds flow through with no logic
change.

## What the player sees

- Long flat top (~500px): rat paces ~450px, never reaching the down-turning ends.
- Medium ledge (~200px): paces the middle ~150px.
- Short perch (~80px): tight shuffle in the middle ~30px.
- Tiny edge (< ~48px): rat idles in place (collapsed bounds).

Rats stay on top of their surface and turn before the corners — no more walking
into the heap. Roam distance scales with the ledge, which reads naturally.

## Edge cases

- **Degenerate / very short edges:** handled by the collapse branch (idle).
- **Sloped surfaces (up to the 30° surface threshold):** Y interpolated at the
  inset X's keeps the rat on the slope.
- **Spawn position:** rats still spawn at the edge midpoint, which lies within the
  inset bounds (or equals them when collapsed) — no spawn-outside-bounds risk.

## Testing

- **TDD the helper** in `src/systems/__tests__/EnemySpawnMath.test.ts`:
  - long flat edge → both ends inset by `margin`, `minY == maxY`.
  - sloped edge → `minY`/`maxY` equal the edge's Y at the inset X's.
  - short edge (`width <= 2*margin`) → collapses to midpoint (`minX == maxX`).
  - asymmetric inset sanity (e.g. `minX − leftV.x == margin`, `rightV.x − maxX == margin`).
- **Build** (`npm run build`) for the wiring.
- **Device / browser check:** confirm rats pace their ledges and turn shy of the
  corners (no walking into the heap). Patrol-movement is time-based, so this is a
  manual smoke test, not a unit test.

## Out of scope

- Changing which surfaces rats spawn on (the 30° threshold, spawn rates).
- The ghost/vulture flight bounds (unrelated; uses `computeGhostFlip`).
- Any max-range cap (explicitly declined — inset only).

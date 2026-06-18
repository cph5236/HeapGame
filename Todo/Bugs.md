## BUGS


# Mobile

# Scenes

# Gameplay

## Flat plateau top misclassified as a vertical wall (player ejected)

**Symptom:** On a hand-authored heap, a wide flat surface whose vertices all share
the exact same Y (e.g. the tutorial mound's plateau at `y = H-590`) behaves like a
slope — standing on it ejects/slides the player instead of letting them stand.

**Known workaround:** Move a *single* one of the otherwise-coincident top vertices by
1px (e.g. `H-590` → `H-591`). Just one is enough; the whole surface then collides
correctly. (Do not want to ship this — it's a band-aid.)

**Root-cause hypothesis (quick dive, not fully confirmed):**
`verticesToScanlines` (`shared/heapPolygon/polygon.ts`) rasterizes the polygon into
rows stepping `y` from `minY` by `SCAN_STEP=4`, and stores only ONE span per row:
`leftX = min(crossings)`, `rightX = max(crossings)` — i.e. the *outer silhouette*,
not the local surface. `computeRowSlopeAngleDeg` then derives slope from
`atan2(SCAN_STEP, |row[i].leftX − row[i+1].leftX|)`.

For a plateau, the outer left/right boundaries at the top are the *vertical wall
faces*. Between the top row and the next row those outer x-values are identical
(walls are vertical there), so `deltaX = 0 → atan2(4,0) = 90°`. The top row of the
flat plateau is classified as a wall, its top collision is disabled in
`HeapEdgeCollider.createSpan` (`body.checkCollision.up = false`), and the player
can't stand. Nudging one vertex by 1px moves the flat edge off the scanline grid /
off `minY`, so the top row's crossings differ from the row below → `deltaX ≠ 0` →
it reads flat again. This matches the 1px workaround exactly.

**Likely deeper limitation (related):** one min/max span per row also can't represent
interior gaps — the crevasses in the same heap get filled in by the collision model
because only `[minX, maxX]` is kept per scanline.

**Status:** Deferred. Idea captured; not fixed. Touch points:
`shared/heapPolygon/polygon.ts` (`verticesToScanlines`, `computeRowSlopeAngleDeg`),
`src/systems/HeapEdgeCollider.ts` (`classifyRow`, `createSpan`).

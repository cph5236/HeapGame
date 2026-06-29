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

**Status:** RESOLVED (PR #80, branch `claude/plateau-wall-collision-bug-mxj1jx`).

**Fix:** `HeapEdgeCollider.classifyRow` now takes `bandTop`. The topmost scanline row of
a band whose Y is *strictly below* `bandTop` is a genuine exposed summit (nothing above
it), so its top is forced walkable regardless of side-face slope — a flat plateau on
vertical walls is standable instead of being ejected. A wall threading down from the
band above is clipped at exactly `y === bandTop`, so it is NOT treated as a summit and
keeps its wall classification: the override can only relax a wall to walkable for a true
top, never turn a real mid-wall into a standable (air-jump-refreshing) ledge. The
tutorial fixture's summit was reverted from the dome workaround back to a true flat
plateau (`src/data/tutorialFixture.ts`, constant `y = H-590`). Verified end-to-end
(`src/data/__tests__/tutorialFixtureCollision.test.ts`) plus unit tests in
`src/systems/__tests__/HeapEdgeCollider.test.ts`.

**Residual limitations (accepted — false-negative only, not fixed):** the `bandTop`
heuristic doesn't cover two edge cases. Neither affects authored or procedural heaps
today (we don't hand-author flat tops on band boundaries, and procedural heaps don't
produce them), so they are left documented rather than fixed:
  (a) A flat plateau authored *exactly* on a `CHUNK_BAND_HEIGHT` (500px) boundary gives
      `rows[0].y === bandTop`, so the summit rule won't fire and it reads as a wall.
      Workaround: author the plateau Y off the boundary (the original 1px nudge).
  (b) A "mixed" band that is part-summit / part-wall-from-above can't be represented at
      all by the single `[minX, maxX]`-span-per-row scanline model (the deeper limitation
      above), so per-row summit detection can't distinguish it.
The clean full fix is a per-row "top-exposed" flag computed from the FULL polygon before
banding (threaded through the `ScanlineRow` type, `HeapGenerator.applyBandPolygon`, and
`buildFromScanlines`/`buildFromVertices`). Deferred until authored flat-top heaps make
it worthwhile. Touch points: `shared/heapPolygon/polygon.ts`,
`src/systems/HeapEdgeCollider.ts` (`classifyRow`, `createSpan`), `src/systems/HeapPolygonLoader.ts`.

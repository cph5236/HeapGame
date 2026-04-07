# Heap Collision Rework — Design Spec

**Date:** 2026-04-07  
**Status:** Approved  
**Scope:** Fix player phasing through heap walls; prevent standing on steep/vertical surfaces.

---

## Problem

`HeapEdgeCollider.buildAlongEdges()` walks the polygon outline and places 8×8 square static bodies every 8px along each edge. On steep diagonal sections the X shift between adjacent polygon vertices can exceed 8px — leaving a gap that fast-moving players (dash=500px/s, dive=1200px/s) can tunnel through. The polygon itself faithfully captures the heap shape, but the body placement strategy doesn't guarantee coverage.

Secondary issue: nothing prevents the player from standing on a nearly-vertical surface (1px ledge on a wall face), which looks broken and is unintended.

---

## Constraints

- Arcade Physics only — no Matter.js rewrite.
- Full heap shape fidelity preserved. No polygon simplification.
- Scanline resolution (SCAN_STEP=4px) is already fine enough to represent every nook and jutting section; the player body (40×46px) cannot meaningfully interact with sub-4px geometry.
- Player movement, wall jump, wall slide, enemy collisions — unchanged.

---

## Solution Overview

Replace the polygon-edge-walk body placement with a **scanline-row-derived slab** approach. Instead of walking vertices and placing squares, place one tall narrow body per scanline row at the left boundary and one at the right boundary.

**Key guarantee:** Bodies are 20px tall placed every 4px in Y → 16px of Y overlap between adjacent bodies. No diagonal can create a gap because coverage is a function of the Y grid, not body-to-body adjacency on a diagonal.

Simultaneously, classify each row's surface by slope angle and separate bodies into walkable and wall groups. Steep-surface bodies block horizontal movement but actively prevent the player from resting on them.

---

## Part 1 — Scanline Slab Bodies

### New constants (`constants.ts`)

```ts
export const WALL_BODY_WIDTH         = 10;  // px, narrow in X
export const WALL_BODY_HEIGHT        = 20;  // px, tall in Y (SCAN_STEP × 5)
export const MAX_WALKABLE_SLOPE_DEG  = 60;  // degrees from horizontal; configurable
```

### Body placement

For each `ScanlineRow` in a band, place two bodies:
- Left wall: centered at `(row.leftX, row.y)`, size `WALL_BODY_WIDTH × WALL_BODY_HEIGHT`
- Right wall: centered at `(row.rightX, row.y)`, size `WALL_BODY_WIDTH × WALL_BODY_HEIGHT`

Bodies are placed into either `heapWalkableGroup` or `heapWallGroup` depending on slope classification (see Part 2).

### `buildAlongEdges()` is removed

The two entry points become:

**`buildFromScanlines()`** — already receives `ScanlineRow[]`; directly loops rows to place slab bodies. No intermediate polygon needed for collision (polygon still used for rendering).

**`buildFromVertices()`** (server path) — currently receives pre-computed `Vertex[]`. Must be updated: derive scanline rows from vertices using a vertical scan, then call the same slab placement logic. The simplest approach is to rasterize the vertex polygon back to `ScanlineRow[]` at SCAN_STEP resolution.

### `HeapEdgeCollider` internal changes

- Remove `buildAlongEdges()` private method
- Remove `createBody()` (single-body helper) — replace with `createSlab(group, x, y)` using `WALL_BODY_WIDTH` / `WALL_BODY_HEIGHT`
- `bandBodies` map remains; keyed by bandTop as before
- `destroyBand()`, `cullBands()` — unchanged

---

## Part 2 — Steep Surface Classification

### Slope computation (`HeapPolygon.ts`)

Add a helper:

```ts
export function computeRowSlopeAngleDeg(rows: ScanlineRow[], i: number): number
```

Compares `rows[i].leftX` to `rows[i+1].leftX` (or rightX for right edge). Angle from horizontal = `atan2(SCAN_STEP, |deltaX|) * (180 / Math.PI)`. Returns 90° for a perfectly vertical surface, 0° for a flat floor.

For the last row (no `i+1`), use the previous row's delta.

### Two static groups (`GameScene`)

Replace the single `platforms: StaticGroup` heap group with two groups:

```ts
private heapWalkableGroup: Phaser.Physics.Arcade.StaticGroup;
private heapWallGroup:     Phaser.Physics.Arcade.StaticGroup;
```

`HeapEdgeCollider.buildFromScanlines()` receives both groups and places each row's bodies into the appropriate one based on slope angle vs `MAX_WALKABLE_SLOPE_DEG`.

### Two colliders (`GameScene`)

```ts
this.physics.add.collider(this.player.sprite, this.heapWalkableGroup);
this.physics.add.collider(this.player.sprite, this.heapWallGroup, undefined, this.onHeapWallCollide, this);
```

`onHeapWallCollide` process callback: if the player's `body.blocked.down` is true (they landed on the top edge of a wall slab), apply a downward velocity nudge (e.g. +60px/s) to slide them off. Horizontal direction of nudge is determined by `body.blocked.left` / `body.blocked.right` — push away from whichever wall face is in contact.

This works with the existing `onGround` filter in `Player.ts` which already suppresses spurious `blocked.down` signals from wall bodies while sliding.

### Signature update

`HeapEdgeCollider` method signatures change from one group to two:

```ts
buildFromScanlines(bandTop, rows, walkableGroup, wallGroup): void
buildFromVertices(bandTop, vertices, walkableGroup, wallGroup): void
rebuildBand(bandTop, entries, walkableGroup, wallGroup): void
```

`bandBodies` stores all bodies for a band regardless of group; destruction is unchanged.

---

## Part 3 — Files Changed

| File | Change |
|---|---|
| `constants.ts` | Add `WALL_BODY_WIDTH`, `WALL_BODY_HEIGHT`, `MAX_WALKABLE_SLOPE_DEG` |
| `src/systems/HeapEdgeCollider.ts` | Remove `buildAlongEdges` / `createBody`; add slab placement loop; accept two groups |
| `src/systems/HeapPolygon.ts` | Add `computeRowSlopeAngleDeg()` helper |
| `src/scenes/GameScene.ts` | Replace single `platforms` group with two groups; add `onHeapWallCollide` callback; pass two groups to edge collider |

**Not changed:** `HeapPolygon.ts` scanline/polygon computation, `HeapChunkRenderer.ts`, `HeapPolygonLoader.ts`, `Player.ts`, `Enemy.ts`, `EnemyManager.ts` (logic unchanged, collider wiring updated in GameScene).

### Enemy collision groups

Enemies do not register their own colliders against the heap group — all heap colliders are set up in `GameScene`. Enemy colliders need to be added against **both** groups so enemies still land on walkable surfaces and are blocked by walls:

```ts
this.physics.add.collider(this.enemyManager.group, this.heapWalkableGroup);
this.physics.add.collider(this.enemyManager.group, this.heapWallGroup);
```

This is currently implicit (a single `platforms` group catches everything). The split makes it explicit.

---

## Part 4 — Testing

- Existing tests for `HeapPolygonLoader` and `HeapClient` are unaffected.
- Add unit tests for `computeRowSlopeAngleDeg()` — flat row = 0°, vertical step = 90°, 45° step.
- Manual test matrix:
  - Player dashing horizontally into steep wall — no phasing
  - Player diving downward beside the heap wall — no phasing
  - Player cannot rest on a surface steeper than 60°
  - Player can stand normally on gentle slopes and flat tops
  - Nooks and overhangs still block correctly

---

## Open Questions / Non-Issues

- **Body count per band:** At SCAN_STEP=4, a 500px band = 125 rows × 2 bodies = 250 bodies. Current approach (vertices × steps) is similar. No meaningful performance change.
- **Right wall slope:** Right-edge slope uses `rows[i].rightX` delta — same logic, mirrored. Both edges classified independently.
- **Server path vertex→scanline rasterization:** Acceptable to use a simple vertical scan over the vertex polygon bounding box at SCAN_STEP resolution. Does not need to be the full `computeBandScanlines()` path (no heap entries available server-side at collider build time).

# Heap Collision Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the polygon-edge-walk square body placement in `HeapEdgeCollider` with scanline-row-derived slab bodies, and split the single static group into walkable/wall groups so players cannot phase through steep walls or stand on vertical surfaces.

**Architecture:** One 10×20px static body is placed per `ScanlineRow` at each edge (leftX, rightX); 16px of Y-overlap between adjacent slabs eliminates diagonal gaps. Slope angle (`atan2`) classifies each slab as walkable (≤60°) or wall (>60°); a process callback nudges the player off wall-tops. `HeapGenerator` threads two groups through to `HeapEdgeCollider`; `GameScene` wires all colliders.

**Tech Stack:** Phaser 3.90 Arcade Physics, TypeScript 5.9, Vitest

---

## File Map

| File | Change |
|---|---|
| `src/constants.ts` | Add `WALL_BODY_WIDTH`, `WALL_BODY_HEIGHT`, `MAX_WALKABLE_SLOPE_DEG` |
| `src/systems/HeapPolygon.ts` | Add `computeRowSlopeAngleDeg()` export |
| `src/systems/__tests__/HeapPolygon.test.ts` | Create — unit tests for `computeRowSlopeAngleDeg` |
| `src/systems/HeapEdgeCollider.ts` | Full replacement: scanline slabs, two groups, vertex rasterization |
| `src/systems/HeapGenerator.ts` | Accept two groups, update all `edgeCollider` call sites |
| `src/scenes/GameScene.ts` | Split `platforms`, wire two-group colliders, add `onHeapWallCollide` |

---

## Task 1: Add constants

**Files:**
- Modify: `src/constants.ts`

- [ ] **Step 1: Add the three new constants at the bottom of `src/constants.ts`**

Append after the last line in the file (after `PLAYER_INVINCIBLE_MS`):

```ts
// Heap edge collider slabs
export const WALL_BODY_WIDTH         = 10;  // px, narrow in X — wall thickness
export const WALL_BODY_HEIGHT        = 20;  // px, tall in Y — spans 5 scanlines (SCAN_STEP×5)
export const MAX_WALKABLE_SLOPE_DEG  = 60;  // surfaces steeper than this are treated as walls
```

- [ ] **Step 2: Commit**

```bash
git add src/constants.ts
git commit -m "feat: add WALL_BODY_WIDTH/HEIGHT and MAX_WALKABLE_SLOPE_DEG constants"
```

---

## Task 2: Add `computeRowSlopeAngleDeg()` to HeapPolygon

**Files:**
- Modify: `src/systems/HeapPolygon.ts`
- Create: `src/systems/__tests__/HeapPolygon.test.ts`

The helper measures how steep a given edge is at scanline row `i`. It computes
`atan2(SCAN_STEP, |deltaX|)` in degrees: 90° for a vertical wall (deltaX=0), 0° for a flat
floor (deltaX→∞), 45° when deltaX equals SCAN_STEP.

- [ ] **Step 1: Write the failing test**

Create `src/systems/__tests__/HeapPolygon.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeRowSlopeAngleDeg, ScanlineRow } from '../HeapPolygon';

// SCAN_STEP = 4 — each row is 4px apart in Y.

describe('computeRowSlopeAngleDeg', () => {
  it('returns 90° for a perfectly vertical left edge (no horizontal movement)', () => {
    const rows: ScanlineRow[] = [
      { y: 0, leftX: 100, rightX: 200 },
      { y: 4, leftX: 100, rightX: 200 }, // deltaX = 0 → vertical
    ];
    expect(computeRowSlopeAngleDeg(rows, 0, 'left')).toBeCloseTo(90, 1);
  });

  it('returns 45° for a left edge where deltaX equals SCAN_STEP (4px)', () => {
    const rows: ScanlineRow[] = [
      { y: 0, leftX: 100, rightX: 200 },
      { y: 4, leftX: 104, rightX: 200 }, // deltaX = 4 = SCAN_STEP
    ];
    expect(computeRowSlopeAngleDeg(rows, 0, 'left')).toBeCloseTo(45, 1);
  });

  it('returns a shallow angle for a nearly-flat left edge', () => {
    const rows: ScanlineRow[] = [
      { y: 0, leftX: 100, rightX: 200 },
      { y: 4, leftX: 140, rightX: 200 }, // deltaX = 40 — far flatter than 60°
    ];
    const angle = computeRowSlopeAngleDeg(rows, 0, 'left');
    expect(angle).toBeLessThan(10);
  });

  it('returns 90° for a perfectly vertical right edge', () => {
    const rows: ScanlineRow[] = [
      { y: 0, leftX: 100, rightX: 200 },
      { y: 4, leftX: 100, rightX: 200 }, // deltaX = 0 on right
    ];
    expect(computeRowSlopeAngleDeg(rows, 0, 'right')).toBeCloseTo(90, 1);
  });

  it('uses the previous row delta for the last row', () => {
    // i = last index → falls back to rows[i-1]
    const rows: ScanlineRow[] = [
      { y: 0, leftX: 100, rightX: 200 },
      { y: 4, leftX: 104, rightX: 200 }, // deltaX = 4 on the only pair
    ];
    expect(computeRowSlopeAngleDeg(rows, 1, 'left')).toBeCloseTo(45, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- src/systems/__tests__/HeapPolygon.test.ts
```

Expected: FAIL — `computeRowSlopeAngleDeg is not a function`

- [ ] **Step 3: Add the export to `src/systems/HeapPolygon.ts`**

Append after the `simplifyPolygon` export (end of file):

```ts
/**
 * Angle (degrees from horizontal) of the heap edge at scanline row i.
 * 90° = vertical wall, 0° = flat floor, 45° = 45° diagonal.
 *
 * Uses rows[i+1] for the delta; falls back to rows[i-1] for the last row.
 */
export function computeRowSlopeAngleDeg(
  rows: ScanlineRow[],
  i: number,
  side: 'left' | 'right',
): number {
  const next = i < rows.length - 1 ? i + 1 : i - 1;
  const deltaX = side === 'left'
    ? Math.abs(rows[next].leftX  - rows[i].leftX)
    : Math.abs(rows[next].rightX - rows[i].rightX);
  return Math.atan2(SCAN_STEP, deltaX) * (180 / Math.PI);
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
npm run test -- src/systems/__tests__/HeapPolygon.test.ts
```

Expected: 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/systems/HeapPolygon.ts src/systems/__tests__/HeapPolygon.test.ts
git commit -m "feat: add computeRowSlopeAngleDeg helper + tests"
```

---

## Task 3: Rework HeapEdgeCollider

**Files:**
- Modify: `src/systems/HeapEdgeCollider.ts`

Replace the entire file. Key changes:
- Remove `buildAlongEdges()` and `createBody()`
- Add private `createSlab(group, x, y)` using `WALL_BODY_WIDTH` / `WALL_BODY_HEIGHT`
- Add private `verticesToScanlines(vertices)` — polygon → ScanlineRow[] via scanline scan
- All public methods accept `walkableGroup` and `wallGroup` instead of a single `group`
- `buildFromScanlines()` loops rows, classifies each edge independently, places slabs
- `buildFromVertices()` rasterizes vertices → scanlines then delegates to slab loop

- [ ] **Step 1: Write the new `HeapEdgeCollider.ts`**

Replace `src/systems/HeapEdgeCollider.ts` in full:

```ts
import Phaser from 'phaser';
import { HeapEntry } from '../data/heapTypes';
import {
  CHUNK_BAND_HEIGHT,
  WALL_BODY_WIDTH,
  WALL_BODY_HEIGHT,
  MAX_WALKABLE_SLOPE_DEG,
} from '../constants';
import {
  computeBandScanlines,
  computeRowSlopeAngleDeg,
  ScanlineRow,
  Vertex,
  SCAN_STEP,
} from './HeapPolygon';

/**
 * Manages static-body slabs placed along the left/right boundaries of each
 * heap chunk band. One 10×20px slab per ScanlineRow per edge → 16px Y overlap
 * between adjacent slabs, making diagonal gaps impossible.
 *
 * Slabs are classified as walkable (slope ≤ MAX_WALKABLE_SLOPE_DEG) or wall
 * (steeper) and placed into the appropriate StaticGroup so GameScene can wire
 * different collision responses for each.
 *
 * Two input paths:
 *  - buildFromScanlines() — local path; directly receives ScanlineRow[]
 *  - buildFromVertices()  — server path; rasterizes the polygon to ScanlineRow[]
 */
export class HeapEdgeCollider {
  /** All edge bodies per band, keyed by bandTop. */
  private readonly bandBodies: Map<number, Phaser.Physics.Arcade.Image[]> = new Map();

  constructor(_scene: Phaser.Scene) {}

  // ── Local path ─────────────────────────────────────────────────────────────

  buildFromScanlines(
    bandTop: number,
    rows: ScanlineRow[],
    walkableGroup: Phaser.Physics.Arcade.StaticGroup,
    wallGroup: Phaser.Physics.Arcade.StaticGroup,
  ): void {
    if (rows.length === 0) { this.destroyBand(bandTop); return; }
    this.buildSlabs(bandTop, rows, walkableGroup, wallGroup);
  }

  // ── Server path ────────────────────────────────────────────────────────────

  buildFromVertices(
    bandTop: number,
    vertices: Vertex[],
    walkableGroup: Phaser.Physics.Arcade.StaticGroup,
    wallGroup: Phaser.Physics.Arcade.StaticGroup,
  ): void {
    const rows = HeapEdgeCollider.verticesToScanlines(vertices);
    if (rows.length === 0) { this.destroyBand(bandTop); return; }
    this.buildSlabs(bandTop, rows, walkableGroup, wallGroup);
  }

  // ── Convenience: rebuild a band from raw entries ───────────────────────────

  rebuildBand(
    bandTop: number,
    entries: HeapEntry[],
    walkableGroup: Phaser.Physics.Arcade.StaticGroup,
    wallGroup: Phaser.Physics.Arcade.StaticGroup,
  ): void {
    const rows = computeBandScanlines(entries, bandTop, bandTop + CHUNK_BAND_HEIGHT);
    this.buildFromScanlines(bandTop, rows, walkableGroup, wallGroup);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  destroyBand(bandTop: number): void {
    const bodies = this.bandBodies.get(bandTop);
    if (bodies) {
      for (const body of bodies) body.destroy();
      this.bandBodies.delete(bandTop);
    }
  }

  cullBands(camBottom: number, cullDistance: number): void {
    const threshold = camBottom + cullDistance;
    for (const [bandTop] of this.bandBodies) {
      if (bandTop > threshold) this.destroyBand(bandTop);
    }
  }

  // ── Core: place one tall narrow slab per scanline row, per edge ────────────

  private buildSlabs(
    bandTop: number,
    rows: ScanlineRow[],
    walkableGroup: Phaser.Physics.Arcade.StaticGroup,
    wallGroup: Phaser.Physics.Arcade.StaticGroup,
  ): void {
    this.destroyBand(bandTop);
    const bodies: Phaser.Physics.Arcade.Image[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      const leftAngle  = computeRowSlopeAngleDeg(rows, i, 'left');
      const rightAngle = computeRowSlopeAngleDeg(rows, i, 'right');

      const leftGroup  = leftAngle  > MAX_WALKABLE_SLOPE_DEG ? wallGroup : walkableGroup;
      const rightGroup = rightAngle > MAX_WALKABLE_SLOPE_DEG ? wallGroup : walkableGroup;

      bodies.push(this.createSlab(leftGroup,  row.leftX,  row.y));
      bodies.push(this.createSlab(rightGroup, row.rightX, row.y));
    }

    this.bandBodies.set(bandTop, bodies);
  }

  private createSlab(
    group: Phaser.Physics.Arcade.StaticGroup,
    x: number,
    y: number,
  ): Phaser.Physics.Arcade.Image {
    const img = group.create(x, y) as Phaser.Types.Physics.Arcade.ImageWithStaticBody;
    img.setVisible(false);
    img.setDisplaySize(WALL_BODY_WIDTH, WALL_BODY_HEIGHT);
    img.refreshBody();
    return img as unknown as Phaser.Physics.Arcade.Image;
  }

  // ── Vertex → ScanlineRow[] rasterization (server path) ────────────────────

  /**
   * Convert a closed polygon to ScanlineRow[] using a standard scanline scan.
   * Works for any convex or concave polygon.
   */
  private static verticesToScanlines(vertices: Vertex[]): ScanlineRow[] {
    if (vertices.length < 3) return [];

    const ys = vertices.map(v => v.y);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const rows: ScanlineRow[] = [];
    const n = vertices.length;

    for (let y = minY; y <= maxY; y += SCAN_STEP) {
      const xs: number[] = [];
      for (let i = 0; i < n; i++) {
        const a = vertices[i];
        const b = vertices[(i + 1) % n];
        // Edge crosses the horizontal scanline at y
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
          const t = (y - a.y) / (b.y - a.y);
          xs.push(a.x + t * (b.x - a.x));
        }
      }
      if (xs.length >= 2) {
        rows.push({ y, leftX: Math.min(...xs), rightX: Math.max(...xs) });
      }
    }

    return rows;
  }
}
```

- [ ] **Step 2: Run all tests to confirm nothing broke**

```bash
npm run test
```

Expected: all existing tests pass (HeapPolygonLoader, HeapClient, InputManager, EnemyManager tests are unaffected — they don't import HeapEdgeCollider)

- [ ] **Step 3: Commit**

```bash
git add src/systems/HeapEdgeCollider.ts
git commit -m "feat: replace edge-walk square bodies with scanline slab colliders, split into walkable/wall groups"
```

---

## Task 4: Update HeapGenerator to thread two groups

**Files:**
- Modify: `src/systems/HeapGenerator.ts`

`HeapGenerator` stores one `group` field and passes it to every `edgeCollider` call. Change it to store `walkableGroup` and `wallGroup` and update the three call sites.

- [ ] **Step 1: Update the `group` field and constructor**

In `src/systems/HeapGenerator.ts`, replace:

```ts
  private readonly group: Phaser.Physics.Arcade.StaticGroup;
```

with:

```ts
  private readonly walkableGroup: Phaser.Physics.Arcade.StaticGroup;
  private readonly wallGroup:     Phaser.Physics.Arcade.StaticGroup;
```

Replace the constructor signature and body (lines ~44–73):

```ts
  constructor(
    _scene: Phaser.Scene,
    walkableGroup: Phaser.Physics.Arcade.StaticGroup,
    wallGroup: Phaser.Physics.Arcade.StaticGroup,
    data: HeapEntry[],
    chunkRenderer?: HeapChunkRenderer,
    edgeCollider?: HeapEdgeCollider,
  ) {
    this.walkableGroup = walkableGroup;
    this.wallGroup     = wallGroup;
    this.chunkRenderer = chunkRenderer;
    this.edgeCollider = edgeCollider;
    this.data = [...data].sort((a, b) => b.y - a.y);

    this.worker = new Worker(
      new URL('../workers/heapWorker.ts', import.meta.url),
      { type: 'module' },
    );

    this.worker.onmessage = (e: MessageEvent<WorkerResponse>): void => {
      this.pendingBandResults.push(e.data);
      this.workerBusy = false;
      if (this.pendingToY !== null) {
        const toY = this.pendingToY;
        this.pendingToY = null;
        this._sendBatch(toY);
      }
    };
  }
```

- [ ] **Step 2: Update the three `edgeCollider` call sites**

In `generateUpToSync()` (around line 125), replace:
```ts
          this.edgeCollider.rebuildBand(bandTop, bucket, this.group);
```
with:
```ts
          this.edgeCollider.rebuildBand(bandTop, bucket, this.walkableGroup, this.wallGroup);
```

In `addEntry()` (around line 209), replace:
```ts
          this.edgeCollider.rebuildBand(bandTop, bucket, this.group);
```
with:
```ts
          this.edgeCollider.rebuildBand(bandTop, bucket, this.walkableGroup, this.wallGroup);
```

In `applyBandPolygon()` (around line 221), replace:
```ts
    this.edgeCollider?.buildFromVertices(bandTop, vertices, this.group);
```
with:
```ts
    this.edgeCollider?.buildFromVertices(bandTop, vertices, this.walkableGroup, this.wallGroup);
```

- [ ] **Step 3: Run all tests**

```bash
npm run test
```

Expected: all tests pass (TypeScript will catch any missed call site at compile time)

- [ ] **Step 4: Commit**

```bash
git add src/systems/HeapGenerator.ts
git commit -m "feat: thread walkableGroup and wallGroup through HeapGenerator"
```

---

## Task 5: Update GameScene — split groups, wire colliders, add wall callback

**Files:**
- Modify: `src/scenes/GameScene.ts`

This is the final wiring task. Four sub-changes:
1. Replace `platforms` with two groups
2. Pass both to `HeapGenerator`
3. Add `onHeapWallCollide` process callback
4. Wire all four colliders (player×walkable, player×wall, enemy×walkable, enemy×wall)

- [ ] **Step 1: Replace the `platforms` field with two group fields**

In the class body, replace:
```ts
  private platforms!: Phaser.Physics.Arcade.StaticGroup;
```
with:
```ts
  private heapWalkableGroup!: Phaser.Physics.Arcade.StaticGroup;
  private heapWallGroup!:     Phaser.Physics.Arcade.StaticGroup;
```

- [ ] **Step 2: Update `create()` — construct both groups**

In `create()`, replace:
```ts
    this.platforms = this.physics.add.staticGroup();
```
with:
```ts
    this.heapWalkableGroup = this.physics.add.staticGroup();
    this.heapWallGroup     = this.physics.add.staticGroup();
```

- [ ] **Step 3: Update `create()` — pass both groups to HeapGenerator**

Replace:
```ts
    this.heapGenerator = new HeapGenerator(
      this, this.platforms, [], this.chunkRenderer, this.edgeCollider,
    );
```
with:
```ts
    this.heapGenerator = new HeapGenerator(
      this, this.heapWalkableGroup, this.heapWallGroup, [], this.chunkRenderer, this.edgeCollider,
    );
```

- [ ] **Step 4: Replace the single platform collider with four colliders**

Replace:
```ts
    // Collider: player lands on top of platforms
    this.physics.add.collider(this.player.sprite, this.platforms);
```
with:
```ts
    // Heap colliders — walkable surfaces resolve normally; wall surfaces use callback to prevent resting
    type ArcadeProcess = Phaser.Types.Physics.Arcade.ArcadePhysicsCallback;
    this.physics.add.collider(this.player.sprite, this.heapWalkableGroup);
    this.physics.add.collider(
      this.player.sprite, this.heapWallGroup,
      undefined, this.onHeapWallCollide as unknown as ArcadeProcess, this,
    );
    // Enemies land on both surface types
    this.physics.add.collider(this.enemyManager.group, this.heapWalkableGroup);
    this.physics.add.collider(this.enemyManager.group, this.heapWallGroup);
```

Note: the `type ArcadeCB` alias already exists below this block in the file — no conflict.

- [ ] **Step 5: Add the `onHeapWallCollide` process callback**

Add this private readonly arrow function anywhere in the class's private section (e.g., after `handleEnemyDamage`):

```ts
  /**
   * Process callback for player vs heapWallGroup collisions.
   * Returning true lets the collision resolve (wall blocks horizontal movement).
   * When the player somehow lands on the top of a wall slab (body.blocked.down),
   * a small downward + lateral nudge slides them off so they cannot stand there.
   */
  private readonly onHeapWallCollide = (
    playerObj: Phaser.GameObjects.GameObject,
  ): boolean => {
    const body = (playerObj as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody).body;
    if (body.blocked.down) {
      body.velocity.y = 60;
      if      (body.blocked.left)  body.velocity.x =  60;
      else if (body.blocked.right) body.velocity.x = -60;
    }
    return true;
  };
```

- [ ] **Step 6: Run all tests**

```bash
npm run test
```

Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/scenes/GameScene.ts
git commit -m "feat: split heap into walkable/wall groups, wire onHeapWallCollide callback"
```

---

## Task 6: Smoke test in browser

- [ ] **Step 1: Build and run dev server**

```bash
npm run dev
```

Open `http://localhost:3000` in a browser.

- [ ] **Step 2: Enable debug overlay**

Press `F2` to show physics debug outlines. Verify:
- Green outlines appear along both edges of the heap silhouette
- Bodies are tall and narrow (not square), overlapping each other vertically

- [ ] **Step 3: Test walkable surface — player can stand normally**

Walk the player onto a gently sloped (< 60°) section of the heap. Verify:
- Player lands and stands without sliding off

- [ ] **Step 4: Test wall blocking — player cannot phase through**

Use the dash (SHIFT) horizontally into a steep section of the heap wall. Verify:
- Player is stopped by the wall at all speeds

Use the dive (down + jump) beside the heap wall. Verify:
- Player does not clip through

- [ ] **Step 5: Test wall surface — player cannot stand on steep face**

Try to land on the top of a near-vertical wall section. Verify:
- Player slides off within a frame or two rather than resting there

- [ ] **Step 6: Test nooks and overhangs**

Navigate into concave nooks and under any overhanging geometry. Verify:
- Collision is solid from all directions in tight geometry

- [ ] **Step 7: Final commit (if any minor fixes were needed)**

```bash
git add -p
git commit -m "fix: <describe any tweaks found during smoke test>"
```

If no fixes were needed, skip this step.

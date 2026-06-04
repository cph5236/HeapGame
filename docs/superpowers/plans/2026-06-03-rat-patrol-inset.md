# Tighten Rat Patrol (Inset From Edge Ends) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop rats from patrolling to the ends of their spawn edge (where they walk into the heap) by insetting their patrol bounds from each end of the edge.

**Architecture:** A pure helper `insetPatrolBounds` computes inset patrol bounds (X trimmed by a margin, Y re-interpolated on the edge, collapsing to the midpoint on too-short edges). Both rat spawn paths in `EnemyManager` call it; the per-frame `update()` patrol loop is unchanged.

**Tech Stack:** TypeScript, Vitest. Pure geometry lives in `EnemySpawnMath.ts` and is unit-tested in `EnemySpawnMath.test.ts` (established pattern). The `EnemyManager` wiring is verified by `npm run build` + a manual device check (patrol movement is time-based, not unit-tested).

Spec: `docs/superpowers/specs/2026-06-03-rat-patrol-inset-design.md`

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/systems/EnemySpawnMath.ts` | Pure spawn/patrol geometry helpers | Add `PatrolBounds` interface + `insetPatrolBounds()`. |
| `src/systems/__tests__/EnemySpawnMath.test.ts` | Unit tests for the above | Add a `describe('insetPatrolBounds')` block. |
| `src/constants.ts` | Tunable constants | Add `RAT_PATROL_END_MARGIN_PX`. |
| `src/systems/EnemyManager.ts` | Enemy spawn + per-frame AI | Import + re-export the helper and constant; apply inset in `onBandLoaded` and `onPlatformSpawned`. |

---

## Task 1: Add the `insetPatrolBounds` helper (TDD)

**Files:**
- Modify: `src/systems/EnemySpawnMath.ts`
- Test: `src/systems/__tests__/EnemySpawnMath.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/systems/__tests__/EnemySpawnMath.test.ts`:

```typescript
// ---------------------------------------------------------------------------
// insetPatrolBounds
// ---------------------------------------------------------------------------

describe('insetPatrolBounds', () => {
  it('insets both ends of a long flat edge by the margin', () => {
    const b = insetPatrolBounds({ x: 0, y: 100 }, { x: 500, y: 100 }, 24);
    expect(b.minX).toBe(24);
    expect(b.maxX).toBe(476);
    expect(b.minY).toBe(100);
    expect(b.maxY).toBe(100);
  });

  it('interpolates Y at the inset X on a sloped edge', () => {
    // Edge (0,100) → (200,300): slope 1 (Δy 200 over Δx 200).
    const b = insetPatrolBounds({ x: 0, y: 100 }, { x: 200, y: 300 }, 20);
    expect(b.minX).toBe(20);
    expect(b.maxX).toBe(180);
    expect(b.minY).toBe(120); // 100 + 20*1
    expect(b.maxY).toBe(280); // 100 + 180*1
  });

  it('collapses to the midpoint when the edge is too short to inset both ends', () => {
    // width 40 <= 2*24 → collapse
    const b = insetPatrolBounds({ x: 100, y: 50 }, { x: 140, y: 50 }, 24);
    expect(b.minX).toBe(120);
    expect(b.maxX).toBe(120);
    expect(b.minX).toBe(b.maxX);
    expect(b.minY).toBe(50);
    expect(b.maxY).toBe(50);
  });

  it('collapses a degenerate zero-width edge without dividing by zero', () => {
    const b = insetPatrolBounds({ x: 80, y: 200 }, { x: 80, y: 260 }, 24);
    expect(b.minX).toBe(80);
    expect(b.maxX).toBe(80);
    expect(b.minY).toBe(230); // midpoint Y, not NaN
    expect(b.maxY).toBe(230);
  });
});
```

Then add `insetPatrolBounds` to the import block at the top of the same file:

```typescript
import {
  isPointInsidePolygon,
  computeSurfaceAngle,
  spawnChance,
  scaleSpawnChance,
  computeGhostFlip,
  insetPatrolBounds,
} from '../EnemySpawnMath';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/systems/__tests__/EnemySpawnMath.test.ts`
Expected: FAIL — `insetPatrolBounds` is not exported (import error / "not a function").

- [ ] **Step 3: Implement the helper**

Append to `src/systems/EnemySpawnMath.ts`:

```typescript
export interface PatrolBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Patrol bounds for a rat on the surface edge leftV→rightV, inset from each end
 * by `margin` so the rat turns around before its body overhangs the corner.
 * minY/maxY are the edge's Y at the inset X's (linear along the edge), keeping the
 * rat on the surface. If the edge is too short to inset both ends
 * (width <= 2*margin), the bounds collapse to the edge midpoint so the rat idles
 * in place rather than getting inverted bounds.
 *
 * Precondition: leftV.x <= rightV.x (caller orders the vertices).
 */
export function insetPatrolBounds(
  leftV: { x: number; y: number },
  rightV: { x: number; y: number },
  margin: number,
): PatrolBounds {
  const width = rightV.x - leftV.x;

  if (width <= 2 * margin) {
    // Too short (or degenerate): collapse to the midpoint. Midpoint Y equals the
    // edge's Y there for a straight edge, and avoids a divide-by-zero when width=0.
    const midX = (leftV.x + rightV.x) / 2;
    const midY = (leftV.y + rightV.y) / 2;
    return { minX: midX, maxX: midX, minY: midY, maxY: midY };
  }

  const minX = leftV.x + margin;
  const maxX = rightV.x - margin;
  const edgeY = (x: number): number =>
    leftV.y + ((x - leftV.x) / width) * (rightV.y - leftV.y);
  return { minX, maxX, minY: edgeY(minX), maxY: edgeY(maxX) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/systems/__tests__/EnemySpawnMath.test.ts`
Expected: PASS — all `insetPatrolBounds` cases green, existing tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/systems/EnemySpawnMath.ts src/systems/__tests__/EnemySpawnMath.test.ts
git commit -m "feat(enemies): add insetPatrolBounds helper

Pure helper that insets rat patrol bounds from an edge's ends (Y re-interpolated
on the edge), collapsing to the midpoint on edges too short to inset."
```

---

## Task 2: Add the margin constant and wire `onBandLoaded`

**Files:**
- Modify: `src/constants.ts`
- Modify: `src/systems/EnemyManager.ts`

- [ ] **Step 1: Add the tunable margin constant**

In `src/constants.ts`, find:

```typescript
export const ENEMY_CULL_DISTANCE = 2000; // px below camera before destroy
```

Add immediately after it:

```typescript
export const RAT_PATROL_END_MARGIN_PX = 24; // ≈ rat half-width; rat turns before its body overhangs a surface end
```

- [ ] **Step 2: Import the helper and constant into EnemyManager (and re-export the helper)**

In `src/systems/EnemyManager.ts`, find the constants import:

```typescript
import { CHUNK_BAND_HEIGHT, ENEMY_CULL_DISTANCE, MOCK_HEAP_HEIGHT_PX, WORLD_WIDTH } from '../constants';
```

Replace with:

```typescript
import { CHUNK_BAND_HEIGHT, ENEMY_CULL_DISTANCE, MOCK_HEAP_HEIGHT_PX, RAT_PATROL_END_MARGIN_PX, WORLD_WIDTH } from '../constants';
```

Then find the `EnemySpawnMath` import block:

```typescript
import {
  isPointInsidePolygon,
  computeSurfaceAngle,
  spawnChance,
  scaleSpawnChance,
  computeGhostFlip,
} from './EnemySpawnMath';

export { isPointInsidePolygon, computeSurfaceAngle, spawnChance, scaleSpawnChance, computeGhostFlip };
```

Replace with:

```typescript
import {
  isPointInsidePolygon,
  computeSurfaceAngle,
  spawnChance,
  scaleSpawnChance,
  computeGhostFlip,
  insetPatrolBounds,
} from './EnemySpawnMath';

export { isPointInsidePolygon, computeSurfaceAngle, spawnChance, scaleSpawnChance, computeGhostFlip, insetPatrolBounds };
```

- [ ] **Step 3: Apply the inset in `onBandLoaded`**

In `src/systems/EnemyManager.ts`, find:

```typescript
      // Use the edge extents as patrol bounds for rats
      const leftV  = v1.x <= v2.x ? v1 : v2;
      const rightV = v1.x <= v2.x ? v2 : v1;
      const minX = leftV.x;
      const maxX = rightV.x;
      const minY = leftV.y;
      const maxY = rightV.y;
```

Replace with:

```typescript
      // Patrol bounds: inset from the edge ends so the rat turns shy of the
      // corners (stays on the visible surface, never walks into the heap).
      const leftV  = v1.x <= v2.x ? v1 : v2;
      const rightV = v1.x <= v2.x ? v2 : v1;
      const { minX, maxX, minY, maxY } = insetPatrolBounds(leftV, rightV, RAT_PATROL_END_MARGIN_PX);
```

- [ ] **Step 4: Build to verify it compiles**

Run: `npm run build`
Expected: build succeeds, no TS errors (note `minX/maxX/minY/maxY` are still consumed by the `trySpawn` call just below).

- [ ] **Step 5: Run the test suite**

Run: `npm test`
Expected: all tests pass (the helper's tests + everything else).

- [ ] **Step 6: Commit**

```bash
git add src/constants.ts src/systems/EnemyManager.ts
git commit -m "feat(enemies): inset rat patrol from heap-edge ends

onBandLoaded now derives patrol bounds via insetPatrolBounds + the tunable
RAT_PATROL_END_MARGIN_PX, so rats turn shy of edge corners instead of walking
into the heap."
```

---

## Task 3: Wire `onPlatformSpawned` (rats on placed objects)

**Files:**
- Modify: `src/systems/EnemyManager.ts`

- [ ] **Step 1: Apply the inset to placed-object patrol bounds**

In `src/systems/EnemyManager.ts`, find (inside `onPlatformSpawned`):

```typescript
    let minX: number | undefined;
    let maxX: number | undefined;
    if (entry) {
      const def = OBJECT_DEFS[entry.keyid];
      if (def) {
        minX = entry.x - def.width / 2;
        maxX = entry.x + def.width / 2;
      }
    }
```

Replace with:

```typescript
    let minX: number | undefined;
    let maxX: number | undefined;
    if (entry) {
      const def = OBJECT_DEFS[entry.keyid];
      if (def) {
        // Inset from the object's ends too, so rats stop shy of the edges.
        // Flat top → minY/maxY stay platformTopY (passed below).
        const b = insetPatrolBounds(
          { x: entry.x - def.width / 2, y: platformTopY },
          { x: entry.x + def.width / 2, y: platformTopY },
          RAT_PATROL_END_MARGIN_PX,
        );
        minX = b.minX;
        maxX = b.maxX;
      }
    }
```

(The existing `trySpawn(def, x, platformTopY, 0, minX, maxX, platformTopY, platformTopY)` call below is unchanged — `minY`/`maxY` remain `platformTopY`.)

- [ ] **Step 2: Build to verify it compiles**

Run: `npm run build`
Expected: build succeeds, no TS errors.

- [ ] **Step 3: Commit**

```bash
git add src/systems/EnemyManager.ts
git commit -m "feat(enemies): inset rat patrol on placed objects too

onPlatformSpawned insets patrol bounds via the same helper so rats on placed
objects (e.g. I-beam) stop shy of the object's ends; narrow objects collapse
to idle."
```

---

## Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the 4 new `insetPatrolBounds` cases.

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: build succeeds, no TS errors.

- [ ] **Step 3: Device / browser smoke test (manual checklist)**

Launch (`npm run dev`) and play far enough to encounter rats, then confirm:
- Rats pace back and forth along their ledge and **turn around shy of the ends** (do not reach the corners).
- Rats no longer appear to walk down into / behind the heap at edge corners.
- Rats on long flat tops still patrol most of the surface (not stuck in one spot).
- Rats on very short perches idle/shuffle in place rather than glitching at inverted bounds.
- (If reachable) a rat on a placed I-beam stays within the object and turns shy of its ends.

- [ ] **Step 4: Final commit if the smoke test surfaced fixes**

(Only if Step 3 required changes — otherwise nothing to commit.)

---

## Self-Review

**Spec coverage:**
- Pure helper `insetPatrolBounds` (inset X, interpolate Y, collapse on short edge) → Task 1. ✓
- `RAT_PATROL_END_MARGIN_PX = 24` constant → Task 2 Step 1. ✓
- Wire `onBandLoaded` → Task 2 Step 3. ✓
- Wire `onPlatformSpawned` (placed objects, flat top) → Task 3. ✓
- `update()` unchanged → not touched (confirmed: no task modifies the percher loop). ✓
- Testing (TDD helper: long/sloped/short/degenerate; build; manual device) → Task 1 + Task 4. ✓
- Edge cases (degenerate/short → collapse; sloped → interpolated; spawn within bounds) → covered by helper + tests. ✓

**Placeholder scan:** none — every code step shows complete code and exact commands.

**Type/name consistency:** `insetPatrolBounds(leftV, rightV, margin) → PatrolBounds {minX,maxX,minY,maxY}` used identically in Tasks 1–3; `RAT_PATROL_END_MARGIN_PX` defined in Task 2 Step 1 and consumed in Tasks 2–3; import + re-export updated together in Task 2 Step 2. The `trySpawn` signature is unchanged; the destructured `{minX,maxX,minY,maxY}` in `onBandLoaded` matches the names it already passed.

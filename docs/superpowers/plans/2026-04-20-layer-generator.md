# LayerGenerator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rectangle-based `InfiniteColumnGenerator` with a noise-driven `LayerGenerator` that produces `ScanlineRow[]` directly from three simplex noise channels, giving the infinite heap a smooth organic shape that grows, contracts, and drifts as the player climbs.

**Architecture:** `LayerGenerator` uses `simplex-noise` with three independent noise channels (center drift, left halfwidth, right halfwidth) keyed by world Y. Chunks of 500px are generated on the main thread (pure math) and sent to the existing `heapWorker` via a new `'layers'` message type that bypasses `computeBandScanlines` and goes straight to `computeBandPolygon` → `simplifyPolygon`. `HeapGenerator.applyBandPolygon` applies results to Phaser — no Phaser layer changes needed. `columnWorker.ts` and `InfiniteColumnGenerator.ts` are deleted.

**Tech Stack:** `simplex-noise` (npm), TypeScript, Vitest, Phaser 3, existing `HeapPolygon`, `heapWorker`, `HeapGenerator`.

---

## File Map

| Action | File | What changes |
|---|---|---|
| Install | `package.json` | `simplex-noise` dependency added |
| Modify | `src/constants.ts` | 7 new infinite-layer constants |
| Create | `src/systems/LayerGenerator.ts` | new class |
| Create | `src/systems/__tests__/LayerGenerator.test.ts` | TDD tests |
| Modify | `src/workers/heapWorker.ts` | add `'layers'` message type |
| Modify | `src/systems/HeapGenerator.ts` | add `sendLayerBatch` method |
| Modify | `src/scenes/InfiniteGameScene.ts` | replace columnWorker with LayerGenerator |
| Delete | `src/workers/columnWorker.ts` | replaced |
| Delete | `src/systems/InfiniteColumnGenerator.ts` | replaced |
| Delete | `src/systems/__tests__/InfiniteColumnGenerator.test.ts` | tests no longer relevant |

---

## Task 1: Install simplex-noise and add constants

**Files:**
- Modify: `package.json` (via npm)
- Modify: `src/constants.ts`

- [ ] **Step 1: Install simplex-noise**

```bash
cd /home/connor/Documents/Repos/HeapGame
npm install simplex-noise
```

Expected: `added 1 package` (or similar). No errors.

- [ ] **Step 2: Add new constants to `src/constants.ts`**

Add these lines after the existing `CHUNK_BAND_HEIGHT` line (~line 58):

```ts
export const LAYER_STEP                  = 4;       // px between layer lines — matches SCAN_STEP
export const INFINITE_LOOKAHEAD_CHUNKS   = 10;      // chunks generated ahead of player
export const INFINITE_MIN_WIDTH          = 150;     // tightest squeeze (~4× player width)
export const INFINITE_MAX_WIDTH          = 900;     // widest open section
export const INFINITE_CENTER_DRIFT_MAX   = 200;     // max px center shifts from column midpoint
export const INFINITE_NOISE_SCALE        = 800;     // Y pixels per noise wave (at start)
export const INFINITE_DIFFICULTY_RANGE   = 40_000;  // Y pixels for easy→hard ramp
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/constants.ts package.json package-lock.json
git commit -m "feat: install simplex-noise, add LayerGenerator constants"
```

---

## Task 2: LayerGenerator — TDD

**Files:**
- Create: `src/systems/__tests__/LayerGenerator.test.ts`
- Create: `src/systems/LayerGenerator.ts`

- [ ] **Step 1: Write failing tests**

Create `src/systems/__tests__/LayerGenerator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { LayerGenerator } from '../LayerGenerator';
import {
  CHUNK_BAND_HEIGHT,
  INFINITE_MIN_WIDTH,
  MOCK_HEAP_HEIGHT_PX,
} from '../../constants';

const COL_LEFT  = 100;
const COL_RIGHT = 1060;
const START_Y   = MOCK_HEAP_HEIGHT_PX; // world floor — heap starts here

describe('LayerGenerator', () => {
  it('rowsForBand: leftX < rightX for every row', () => {
    const gen = new LayerGenerator(42, COL_LEFT, COL_RIGHT, START_Y);
    const rows = gen.rowsForBand(MOCK_HEAP_HEIGHT_PX - CHUNK_BAND_HEIGHT);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.leftX).toBeLessThan(r.rightX);
    }
  });

  it('rowsForBand: all rows respect column bounds', () => {
    const gen = new LayerGenerator(99, COL_LEFT, COL_RIGHT, START_Y);
    const rows = gen.rowsForBand(MOCK_HEAP_HEIGHT_PX - CHUNK_BAND_HEIGHT);
    for (const r of rows) {
      expect(r.leftX).toBeGreaterThanOrEqual(COL_LEFT);
      expect(r.rightX).toBeLessThanOrEqual(COL_RIGHT);
    }
  });

  it('rowsForBand: width never falls below INFINITE_MIN_WIDTH at t=0', () => {
    // t=0 means y ≈ START_Y (bottom of heap — easiest section)
    const gen = new LayerGenerator(7, COL_LEFT, COL_RIGHT, START_Y);
    const rows = gen.rowsForBand(MOCK_HEAP_HEIGHT_PX - CHUNK_BAND_HEIGHT);
    for (const r of rows) {
      expect(r.rightX - r.leftX).toBeGreaterThanOrEqual(INFINITE_MIN_WIDTH - 1);
    }
  });

  it('rowsForBand: rows are ordered top-to-bottom (increasing y)', () => {
    const gen = new LayerGenerator(1, COL_LEFT, COL_RIGHT, START_Y);
    const rows = gen.rowsForBand(MOCK_HEAP_HEIGHT_PX - CHUNK_BAND_HEIGHT);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].y).toBeGreaterThan(rows[i - 1].y);
    }
  });

  it('rowsForBand: deterministic for same seed and band', () => {
    const a = new LayerGenerator(42, COL_LEFT, COL_RIGHT, START_Y);
    const b = new LayerGenerator(42, COL_LEFT, COL_RIGHT, START_Y);
    const bandTop = MOCK_HEAP_HEIGHT_PX - CHUNK_BAND_HEIGHT;
    expect(a.rowsForBand(bandTop)).toEqual(b.rowsForBand(bandTop));
  });

  it('rowsForBand: different seeds produce different rows', () => {
    const a = new LayerGenerator(1, COL_LEFT, COL_RIGHT, START_Y);
    const b = new LayerGenerator(2, COL_LEFT, COL_RIGHT, START_Y);
    const bandTop = MOCK_HEAP_HEIGHT_PX - CHUNK_BAND_HEIGHT;
    const rowsA = a.rowsForBand(bandTop);
    const rowsB = b.rowsForBand(bandTop);
    expect(rowsA[0].leftX).not.toBeCloseTo(rowsB[0].leftX, 0);
  });

  it('nextChunk: advances nextBandTop by CHUNK_BAND_HEIGHT each call', () => {
    const gen = new LayerGenerator(42, COL_LEFT, COL_RIGHT, START_Y);
    const initial = gen.nextBandTop;
    gen.nextChunk();
    expect(gen.nextBandTop).toBe(initial - CHUNK_BAND_HEIGHT);
    gen.nextChunk();
    expect(gen.nextBandTop).toBe(initial - CHUNK_BAND_HEIGHT * 2);
  });

  it('nextChunk: returns rows for the correct band', () => {
    const gen = new LayerGenerator(42, COL_LEFT, COL_RIGHT, START_Y);
    const { bandTop, rows } = gen.nextChunk();
    // All rows should fall within [bandTop, bandTop + CHUNK_BAND_HEIGHT]
    for (const r of rows) {
      expect(r.y).toBeGreaterThanOrEqual(bandTop);
      expect(r.y).toBeLessThanOrEqual(bandTop + CHUNK_BAND_HEIGHT);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --reporter=verbose src/systems/__tests__/LayerGenerator.test.ts
```

Expected: FAIL — `Cannot find module '../LayerGenerator'`

- [ ] **Step 3: Create `src/systems/LayerGenerator.ts`**

```ts
import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import type { ScanlineRow } from './HeapPolygon';
import {
  CHUNK_BAND_HEIGHT,
  LAYER_STEP,
  INFINITE_MIN_WIDTH,
  INFINITE_MAX_WIDTH,
  INFINITE_CENTER_DRIFT_MAX,
  INFINITE_NOISE_SCALE,
  INFINITE_DIFFICULTY_RANGE,
} from '../constants';

export class LayerGenerator {
  private readonly noise: NoiseFunction2D;
  private readonly colLeft:  number;
  private readonly colRight: number;
  private readonly startY:   number;

  /** Next band top Y to generate (decrements each chunk — heap grows upward). */
  nextBandTop: number;

  constructor(seed: number, colLeft: number, colRight: number, startY: number) {
    this.noise    = createNoise2D(seededPRNG(seed));
    this.colLeft  = colLeft;
    this.colRight = colRight;
    this.startY   = startY;
    this.nextBandTop = Math.ceil(startY / CHUNK_BAND_HEIGHT) * CHUNK_BAND_HEIGHT;
  }

  /** Advance state and return the next 500px chunk upward. */
  nextChunk(): { bandTop: number; rows: ScanlineRow[] } {
    const bandTop    = this.nextBandTop - CHUNK_BAND_HEIGHT;
    this.nextBandTop = bandTop;
    return { bandTop, rows: this.rowsForBand(bandTop) };
  }

  /** Pure — generate rows for any band without advancing state. */
  rowsForBand(bandTop: number): ScanlineRow[] {
    const bandBottom = bandTop + CHUNK_BAND_HEIGHT;
    const rows: ScanlineRow[] = [];
    const colMid = (this.colLeft + this.colRight) / 2;

    for (let y = bandTop; y <= bandBottom; y += LAYER_STEP) {
      const t         = clamp01((this.startY - y) / INFINITE_DIFFICULTY_RANGE);
      const scale     = lerp(INFINITE_NOISE_SCALE, 300, t);
      const minW      = lerp(INFINITE_MIN_WIDTH, 80, t);
      const driftMax  = lerp(INFINITE_CENTER_DRIFT_MAX, 350, t);

      const ny        = y / scale;
      const centerX   = colMid + this.noise(0, ny) * driftMax;
      const leftHalf  = lerp(minW / 2, INFINITE_MAX_WIDTH / 2, (this.noise(1, ny) + 1) / 2);
      const rightHalf = lerp(minW / 2, INFINITE_MAX_WIDTH / 2, (this.noise(2, ny) + 1) / 2);

      let leftX  = Math.max(this.colLeft,  centerX - leftHalf);
      let rightX = Math.min(this.colRight, centerX + rightHalf);

      if (rightX - leftX < minW) {
        const mid = (leftX + rightX) / 2;
        leftX  = Math.max(this.colLeft,  mid - minW / 2);
        rightX = Math.min(this.colRight, mid + minW / 2);
      }

      rows.push({ y, leftX, rightX });
    }

    return rows;
  }
}

function seededPRNG(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

function clamp01(t: number): number { return Math.max(0, Math.min(1, t)); }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --reporter=verbose src/systems/__tests__/LayerGenerator.test.ts
```

Expected: 8 tests PASS, 0 failures.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/systems/LayerGenerator.ts src/systems/__tests__/LayerGenerator.test.ts
git commit -m "feat: add LayerGenerator with simplex noise (TDD)"
```

---

## Task 3: heapWorker 'layers' path + HeapGenerator.sendLayerBatch

**Files:**
- Modify: `src/workers/heapWorker.ts`
- Modify: `src/systems/HeapGenerator.ts`

### Part A — heapWorker

- [ ] **Step 1: Add the `'layers'` message type to `src/workers/heapWorker.ts`**

The current file starts at line 1 with imports and the `WorkerRequest` type. Make these changes:

Add a new export interface after the existing `WorkerResponse` type (around line 32):

```ts
export interface LayersWorkerRequest {
  type: 'layers';
  bands: { bandTop: number; rows: ScanlineRow[] }[];
}
```

Add `ScanlineRow` to the import at the top:

```ts
import { computeBandScanlines, computeBandPolygon, simplifyPolygon, Vertex, ScanlineRow } from '../systems/HeapPolygon';
```

Replace the `self.onmessage` handler (currently line 34–54) with:

```ts
self.onmessage = (e: MessageEvent<WorkerRequest | LayersWorkerRequest>): void => {
  const msg = e.data;

  // Pre-computed scanlines path — skip computeBandScanlines entirely
  if ((msg as LayersWorkerRequest).type === 'layers') {
    const req = msg as LayersWorkerRequest;
    const resultBands: WorkerBandResult[] = [];
    for (const { bandTop, rows } of req.bands) {
      const polygon = simplifyPolygon(computeBandPolygon(rows), 2);
      if (polygon.length >= 3) resultBands.push({ bandTop, polygon });
    }
    (self as unknown as Worker).postMessage({
      bands: resultBands,
      entries: [],
      processedCount: 0,
    } satisfies WorkerResponse);
    return;
  }

  // Existing entries path (no type field on legacy messages)
  const { bands, newEntries } = e.data as WorkerRequest;
  const resultBands: WorkerBandResult[] = [];
  for (const { bandTop, entries } of bands) {
    const rows = computeBandScanlines(
      entries as Parameters<typeof computeBandScanlines>[0],
      bandTop,
      bandTop + CHUNK_BAND_HEIGHT,
    );
    const polygon = simplifyPolygon(computeBandPolygon(rows), 2);
    if (polygon.length >= 3) resultBands.push({ bandTop, polygon });
  }

  const response: WorkerResponse = {
    bands: resultBands,
    entries: newEntries,
    processedCount: newEntries.length,
  };

  (self as unknown as Worker).postMessage(response);
};
```

- [ ] **Step 2: Type-check the worker**

```bash
npx tsc --noEmit
```

Expected: no errors.

### Part B — HeapGenerator.sendLayerBatch

- [ ] **Step 3: Add `sendLayerBatch` to `src/systems/HeapGenerator.ts`**

Add this import at the top of HeapGenerator.ts alongside the existing `Vertex` import:

```ts
import { Vertex, ScanlineRow } from './HeapPolygon';
```

Add this public method after the existing `applyBandPolygon` method (~line 253):

```ts
/**
 * Send pre-computed scanline rows to the worker for polygon simplification.
 * Used by LayerGenerator path (infinite mode) — bypasses entry-based generation.
 */
sendLayerBatch(bandTop: number, rows: ScanlineRow[]): void {
  this.worker.postMessage({ type: 'layers', bands: [{ bandTop, rows }] });
}
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all existing tests pass (no regressions).

- [ ] **Step 6: Commit**

```bash
git add src/workers/heapWorker.ts src/systems/HeapGenerator.ts
git commit -m "feat: add heapWorker 'layers' path and HeapGenerator.sendLayerBatch"
```

---

## Task 4: Wire InfiniteGameScene + remove old files

**Files:**
- Modify: `src/scenes/InfiniteGameScene.ts`
- Delete: `src/workers/columnWorker.ts`
- Delete: `src/systems/InfiniteColumnGenerator.ts`
- Delete: `src/systems/__tests__/InfiniteColumnGenerator.test.ts`

### Part A — Rewrite InfiniteGameScene

The goal: remove all `columnWorker`, `buildColumnEntries`, `appendColumnEntries` usage. Add `LayerGenerator` per column. Drive generation from `update()`.

- [ ] **Step 1: Update imports at top of `src/scenes/InfiniteGameScene.ts`**

Remove:
```ts
import { buildColumnEntries } from '../systems/InfiniteColumnGenerator';
import type { ColumnExtendResponse } from '../workers/columnWorker';
```

Add:
```ts
import { LayerGenerator } from '../systems/LayerGenerator';
import { computeBandPolygon, simplifyPolygon } from '../systems/HeapPolygon';
```

Add to the constants import block:
```ts
import {
  WORLD_WIDTH,
  MOCK_HEAP_HEIGHT_PX,
  GEN_LOOKAHEAD,
  INFINITE_WORLD_WIDTH,
  INFINITE_GAP_WIDTH,
  INFINITE_EDGE_PAD,
  PLAYER_HEIGHT,
  PLAYER_JUMP_VELOCITY,
  PLAYER_INVINCIBLE_MS,
  CHUNK_BAND_HEIGHT,
  INFINITE_LOOKAHEAD_CHUNKS,
} from '../constants';
```

- [ ] **Step 2: Replace field declarations**

Remove these field declarations from the class body:
```ts
private colBlockCounts:   number[] = [];
private colExtending:     boolean[] = [];
private columnWorker!:    Worker;
```

Add:
```ts
private layerGenerators: LayerGenerator[] = [];
```

The existing `colSeeds` field stays (we still need the seed per column).

- [ ] **Step 3: Rewrite `create()` — remove columnWorker setup**

Remove the entire `columnWorker` block (lines 105–113):
```ts
// DELETE THIS BLOCK:
this.columnWorker = new Worker(
  new URL('../workers/columnWorker.ts', import.meta.url),
  { type: 'module' },
);
this.columnWorker.onmessage = (e: MessageEvent<ColumnExtendResponse>) => {
  const { colIndex, newEntries } = e.data;
  this.generators[colIndex].appendEntries(newEntries);
  this.colExtending[colIndex] = false;
};
```

Also remove these two lines from the field resets at the top of `create()`:
```ts
// DELETE:
this.colExtending   = [false, false, false];
```

- [ ] **Step 4: Rewrite the heap column creation loop in `create()`**

Replace the existing column loop body (lines 124–155) with:

```ts
for (let i = 0; i < 3; i++) {
  const seed = Math.floor(Math.random() * 1_000_000);
  this.colSeeds.push(seed);
  const [xMin, xMax] = this.colBounds[i];
  const walkable = this.physics.add.staticGroup();
  const wall     = this.physics.add.staticGroup();
  const renderer = new HeapChunkRenderer(this, xMin, xMax - xMin);
  const edge     = new HeapEdgeCollider(this, this.playerConfig.maxWalkableSlopeDeg);

  // Empty entries — LayerGenerator drives all geometry
  const gen = new HeapGenerator(this, walkable, wall, [], renderer, edge);
  const layerGen = new LayerGenerator(seed, xMin, xMax, MOCK_HEAP_HEIGHT_PX);

  const em = new EnemyManager(this, 1.0, xMin, xMax);

  const colIdx = i;
  gen.onBandLoaded = (bandTopY, vertices) => {
    em.setPolygon(vertices);
    if (!this.spawnedBands[colIdx].has(bandTopY)) {
      this.spawnedBands[colIdx].add(bandTopY);
      em.onBandLoaded(bandTopY, vertices);
    }
    if (colIdx === 0) {
      this.bridgeSpawner?.onBandLoaded(bandTopY);
      this.portalManager?.onBandLoaded(bandTopY);
    }
  };

  this.walkableGroups.push(walkable);
  this.wallGroups.push(wall);
  this.generators.push(gen);
  this.layerGenerators.push(layerGen);
  this.enemyManagers.push(em);
}
```

- [ ] **Step 5: Replace the sync initial generation at the bottom of `create()`**

Remove:
```ts
for (const gen of this.generators) {
  gen.generateUpToSync(this.spawnY - GEN_LOOKAHEAD);
}
```

Replace with synchronous layer generation (no worker — runs polygon math directly on main thread so collision is ready frame 1):

```ts
for (let i = 0; i < 3; i++) {
  const gen      = this.generators[i];
  const layerGen = this.layerGenerators[i];
  const targetY  = this.spawnY - GEN_LOOKAHEAD;
  while (layerGen.nextBandTop > targetY) {
    const { bandTop, rows } = layerGen.nextChunk();
    const polygon = simplifyPolygon(computeBandPolygon(rows), 2);
    if (polygon.length >= 3) gen.applyBandPolygon(bandTop, polygon);
  }
}
```

- [ ] **Step 6: Rewrite the `update()` heap generation section**

Remove the existing heap generation + extension blocks from `update()`:

```ts
// DELETE — entry-based generation:
for (const gen of this.generators) {
  gen.generateUpTo(camTop - GEN_LOOKAHEAD);
  gen.flushWorkerResults();
}

// DELETE — column extension:
for (let i = 0; i < this.generators.length; i++) {
  const gen = this.generators[i];
  if (!this.colExtending[i] && this.player.sprite.y - EXTEND_THRESHOLD_PX < gen.topY) {
    this.colExtending[i] = true;
    const [xMin, xMax] = this.colBounds[i];
    this.columnWorker.postMessage({ ... });
    this.colBlockCounts[i] += EXTEND_BLOCKS;
  }
}
```

Replace with:

```ts
// Layer generation — drive each column ahead of the player
const targetY = this.player.sprite.y - INFINITE_LOOKAHEAD_CHUNKS * CHUNK_BAND_HEIGHT;
for (let i = 0; i < 3; i++) {
  const gen      = this.generators[i];
  const layerGen = this.layerGenerators[i];
  while (layerGen.nextBandTop > targetY) {
    const { bandTop, rows } = layerGen.nextChunk();
    gen.sendLayerBatch(bandTop, rows);
  }
  gen.flushWorkerResults();
}
```

- [ ] **Step 7: Update PlaceableManager surface check**

The old lambda used `findSurfaceY` against entries. With LayerGenerator, entries are always empty. Update the lambda to always return `false` (no placeable restoration in infinite mode):

```ts
this.placeableManager = new PlaceableManager(
  this, this.player, this.walkableGroups[0], this.wallGroups[0],
  INFINITE_HEAP_ID,
  (_x, _savedY) => false,  // no surface restoration — no entries in LayerGenerator mode
  true, // excludeCheckpoint
);
```

Also remove the `findSurfaceY` import from the top of the file since it's no longer used:
```ts
// DELETE:
import { findSurfaceY } from '../systems/HeapSurface';
```

- [ ] **Step 8: Remove unused constants from the class body**

Remove:
```ts
const BLOCKS_PER_COLUMN  = 300;
const EXTEND_BLOCKS      = 200;
const EXTEND_THRESHOLD_PX = 3000;
```

These are module-level constants at the top of the file — delete them.

- [ ] **Step 9: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

### Part B — Delete old files

- [ ] **Step 10: Delete the replaced files**

```bash
rm src/workers/columnWorker.ts
rm src/systems/InfiniteColumnGenerator.ts
rm src/systems/__tests__/InfiniteColumnGenerator.test.ts
```

- [ ] **Step 11: Type-check after deletion**

```bash
npx tsc --noEmit
```

Expected: no errors (nothing should import the deleted files anymore).

- [ ] **Step 12: Run full test suite**

```bash
npm test
```

Expected: all remaining tests pass. InfiniteColumnGenerator tests are gone; everything else green.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat: wire InfiniteGameScene to LayerGenerator, remove InfiniteColumnGenerator"
```

---

## Smoke Test

After all tasks complete:

1. `npm run dev` — open browser at `http://localhost:3000`
2. Select Infinite Heap mode
3. Verify:
   - Heap renders on all 3 columns at startup
   - Player spawns in the gap between columns
   - Heap shape is smooth and organic (not rectangular blocks)
   - As player climbs, new bands appear above (LayerGenerator extending ahead)
   - Heap gets narrower / more jagged at higher altitudes (difficulty ramp)
   - No console errors
4. Enable debug mode (F2) — verify physics colliders match visible heap edges

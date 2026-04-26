# LayerGenerator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rectangle-based `InfiniteColumnGenerator` with a noise-driven `LayerGenerator` that produces scanline rows directly, giving the infinite heap a smooth organic shape that grows, contracts, and drifts as the player climbs.

**Architecture:** Three independent simplex noise channels (center drift, left halfwidth, right halfwidth) key off world Y to produce `ScanlineRow[]` per chunk. Chunks (500px) are sent to the existing `heapWorker` via a new `'layers'` message type that skips rect-to-scanline conversion and goes straight to polygon simplification. `InfiniteGameScene` drives the generator, `HeapGenerator.applyBandPolygon` applies results — no changes to the Phaser layer.

**Tech Stack:** `simplex-noise` (npm), existing `HeapPolygon`, `heapWorker`, `HeapGenerator`.

---

## Parameters

| Constant | Value | Notes |
|---|---|---|
| `LAYER_STEP` | `4` | px between layer lines (matches current `SCAN_STEP`) |
| `CHUNK_BAND_HEIGHT` | `500` | unchanged — reuses existing band infrastructure |
| `LOOKAHEAD_CHUNKS` | `10` | chunks generated ahead of player (5000px) |
| `MIN_WIDTH` | `150` | tightest squeeze (~4× player width) |
| `MAX_WIDTH` | `900` | widest open section (~94% of column) |
| `CENTER_DRIFT_MAX` | `200` | max px center shifts from column midpoint |
| `NOISE_SCALE` | `800` | Y pixels per noise wave at full difficulty |
| `DIFFICULTY_RANGE` | `40_000` | Y pixels over which easy→hard ramp plays out |

Noise channel X addresses (in the 2D noise space):
- `0` — center drift
- `1` — left halfwidth
- `2` — right halfwidth

---

## Data Model

`LayerLine` is identical to the existing `ScanlineRow` — no new type needed:

```ts
// from HeapPolygon.ts — reused as-is
interface ScanlineRow { y: number; leftX: number; rightX: number; }
```

New `heapWorker` message union:

```ts
// existing
{ type: 'entries'; bands: WorkerBandInput[]; newEntries: WorkerEntry[] }

// new
{ type: 'layers'; bands: { bandTop: number; rows: ScanlineRow[] }[] }
```

Worker response shape is unchanged — both paths return `WorkerBandResult[]`.

---

## LayerGenerator Class

**File:** `src/systems/LayerGenerator.ts`

```ts
import { createNoise2D, NoiseFunction2D } from 'simplex-noise';
import { ScanlineRow } from './HeapPolygon';
import { CHUNK_BAND_HEIGHT, LAYER_STEP, MIN_WIDTH, MAX_WIDTH,
         CENTER_DRIFT_MAX, NOISE_SCALE, DIFFICULTY_RANGE } from '../constants';

export class LayerGenerator {
  private readonly noise: NoiseFunction2D;
  private readonly colLeft: number;
  private readonly colRight: number;
  private readonly startY: number;
  nextBandTop: number;           // public — InfiniteGameScene reads this

  constructor(seed: number, colLeft: number, colRight: number, startY: number) {
    // seeded PRNG feeds simplex-noise
    this.noise = createNoise2D(seededPRNG(seed));
    this.colLeft  = colLeft;
    this.colRight = colRight;
    this.startY   = startY;
    this.nextBandTop = Math.ceil(startY / CHUNK_BAND_HEIGHT) * CHUNK_BAND_HEIGHT;
  }

  /** Advance state and return the next chunk upward. */
  nextChunk(): { bandTop: number; rows: ScanlineRow[] } {
    const bandTop = this.nextBandTop - CHUNK_BAND_HEIGHT;
    this.nextBandTop = bandTop;
    return { bandTop, rows: this.rowsForBand(bandTop) };
  }

  /** Pure — generate rows for any band without advancing state. */
  rowsForBand(bandTop: number): ScanlineRow[] {
    const bandBottom = bandTop + CHUNK_BAND_HEIGHT;
    const rows: ScanlineRow[] = [];
    const colMid = (this.colLeft + this.colRight) / 2;

    for (let y = bandTop; y <= bandBottom; y += LAYER_STEP) {
      const t = clamp01((this.startY - y) / DIFFICULTY_RANGE);
      const scale     = lerp(NOISE_SCALE, 300, t);
      const minW      = lerp(MIN_WIDTH, 80, t);
      const driftMax  = lerp(CENTER_DRIFT_MAX, 350, t);

      const ny = y / scale;
      const centerX   = colMid + this.noise(0, ny) * driftMax;
      const leftHalf  = lerp(minW / 2, MAX_WIDTH / 2, (this.noise(1, ny) + 1) / 2);
      const rightHalf = lerp(minW / 2, MAX_WIDTH / 2, (this.noise(2, ny) + 1) / 2);

      let leftX  = Math.max(this.colLeft,  centerX - leftHalf);
      let rightX = Math.min(this.colRight, centerX + rightHalf);

      // enforce minimum width symmetrically
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

---

## Worker Integration

**File:** `src/workers/heapWorker.ts` — extend `onmessage`:

```ts
self.onmessage = (e: MessageEvent): void => {
  const msg = e.data;

  // New path: pre-computed scanlines (no type field = legacy entries path)
  if (msg.type === 'layers') {
    const resultBands: WorkerBandResult[] = [];
    for (const { bandTop, rows } of msg.bands) {
      const polygon = simplifyPolygon(computeBandPolygon(rows), 2);
      if (polygon.length >= 3) resultBands.push({ bandTop, polygon });
    }
    (self as unknown as Worker).postMessage({ bands: resultBands, entries: [], processedCount: 0 });
    return;
  }

  // existing entries path — no type field on legacy messages, falls through here
};
```

---

## InfiniteGameScene Wiring

- Construct one `LayerGenerator` per heap column in `create()`, using the column's `seed`, `colLeft`, `colRight`, `startY`
- In `update()`:
  ```ts
  while (generator.nextBandTop > playerY - LOOKAHEAD_CHUNKS * CHUNK_BAND_HEIGHT) {
    const { bandTop, rows } = generator.nextChunk();
    heapWorker.postMessage({ type: 'layers', bands: [{ bandTop, rows }] });
  }
  ```
- Remove all `columnWorker.ts` usage and `InfiniteColumnGenerator` imports

## Files Removed

- `src/workers/columnWorker.ts` — replaced by LayerGenerator + heapWorker `'layers'` path
- `src/systems/InfiniteColumnGenerator.ts` — replaced by `LayerGenerator`

## Files Modified

- `src/workers/heapWorker.ts` — add `'layers'` message type
- `src/scenes/InfiniteGameScene.ts` — swap generators, remove column worker
- `src/constants.ts` — add `LAYER_STEP`, `LOOKAHEAD_CHUNKS`, `MIN_WIDTH`, `MAX_WIDTH`, `CENTER_DRIFT_MAX`, `NOISE_SCALE`, `DIFFICULTY_RANGE`

## Files Created

- `src/systems/LayerGenerator.ts`
- `src/systems/__tests__/LayerGenerator.test.ts`

---

## Testing

Key test cases for `LayerGenerator`:

1. `rowsForBand` returns rows with `leftX < rightX` for every row
2. All rows respect `leftX >= colLeft` and `rightX <= colRight`
3. Width never falls below `MIN_WIDTH` (at `t=0`)
4. `nextChunk()` advances `nextBandTop` by `CHUNK_BAND_HEIGHT` each call
5. Same seed + same band produces identical rows (determinism)
6. Rows are ordered top-to-bottom within the band (or consistent ordering for polygon winding)

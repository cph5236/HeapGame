# Admin UI Expansion + Heap Height Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface heap heights in player + admin UIs, extract the polygon generator into a shared module, and ship a sectioned admin tool that can create/list/edit/delete heaps with the admin secret persisted to localStorage.

**Architecture:** Three sequential PRs. PR-1 exposes `topY` in `GET /heaps` and displays "X ft" on HeapSelectScene + raw `topY` in admin. PR-2 moves the polygon-generation pipeline into `shared/heapPolygon/`, parameterizes its dependency on item defs, and makes `vertices` optional in `POST /heaps` (server falls back to a deterministic default polygon). PR-3 adds a `PUT /heaps/:id/params` endpoint and reworks `admin/enemy-params.html` into a sectioned `admin/index.html` covering Settings, Heaps list, Edit Heap, and Create New Heap.

**Tech Stack:** TypeScript, Hono (server), Vitest (server + client tests), vanilla HTML+JS (admin UI), Phaser 3 (HeapSelectScene), Cloudflare D1.

**Spec:** `docs/superpowers/specs/2026-05-06-admin-ui-and-height-display-design.md`

---

## Phase 1 — PR-1: `topY` Exposure + Height Display

**Branch:** `feature/heap-height-display` off `main`.

### Task 1.1: Add `topY` to `HeapSummary` shared type

**Files:**
- Modify: `shared/heapTypes.ts:55-60`

- [ ] **Step 1: Add `topY` field to `HeapSummary`**

Replace the existing interface in `shared/heapTypes.ts`:

```ts
export interface HeapSummary {
  id: string;
  version: number;
  createdAt: string;
  /** Current heap summit y in world coords (smaller = taller heap). */
  topY: number;
  params: HeapParams;
}
```

- [ ] **Step 2: Compile-check**

Run: `cd server && npx tsc --noEmit`
Expected: A single error in `server/src/routes/heap.ts` near the `listHeaps` mapping (missing `topY` in the response object). This proves the type is wired.

---

### Task 1.2: Server — failing test for `topY` in list response

**Files:**
- Modify: `server/tests/routes.test.ts` (add a new `it` block inside the existing `describe('GET /heaps', …)`)
- Modify: `server/tests/helpers/mockDb.ts` (verify `setTopY` test helper exists — it does, see line 175)

- [ ] **Step 1: Add failing test**

Append to the `describe('GET /heaps', …)` block in `server/tests/routes.test.ts`:

```ts
it('list response includes topY for each heap', async () => {
  const db = new MockHeapDB();
  const app = createApp(db, new MockScoreDB());
  const created = await app.request('/heaps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vertices: VERTICES }),
  }).then(r => r.json()) as CreateHeapResponse;

  // Simulate a placed point that lowered top_y
  db.setTopY(created.id, 12345);

  const res = await app.request('/heaps');
  expect(res.status).toBe(200);
  const body = await res.json() as ListHeapsResponse;
  const found = body.heaps.find(h => h.id === created.id);
  expect(found).toBeDefined();
  expect(found!.topY).toBe(12345);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd server && npx vitest run tests/routes.test.ts -t "list response includes topY"`
Expected: FAIL — either a TS error on `topY` not present in response, or `found!.topY` is `undefined`.

---

### Task 1.3: Server — implement `topY` in list mapping

**Files:**
- Modify: `server/src/routes/heap.ts:124-141`

- [ ] **Step 1: Add `topY` to the mapping**

In the `GET /` (list) handler, update the `r => ({ … })` projection to include `topY: r.top_y`:

```ts
app.get('/', async (c) => {
  const rows = await db.listHeaps();
  return c.json({
    heaps: rows.map((r) => ({
      id: r.id,
      version: r.version,
      createdAt: r.created_at,
      topY: r.top_y,
      params: {
        name:          r.name,
        difficulty:    r.difficulty,
        spawnRateMult: r.spawn_rate_mult,
        coinMult:      r.coin_mult,
        scoreMult:     r.score_mult,
        worldHeight:   r.world_height,
      },
    })),
  } satisfies ListHeapsResponse);
});
```

- [ ] **Step 2: Verify `HeapSummaryRow` includes `top_y`**

Read `server/src/db.ts:21-32` (the `HeapSummaryRow` interface) and confirm `top_y: number` is present. If not, add it; otherwise no change needed. The `listHeaps` SQL at `server/src/db.ts:57-64` already SELECTs `top_y`.

- [ ] **Step 3: Run the test to verify it passes**

Run: `cd server && npx vitest run tests/routes.test.ts -t "list response includes topY"`
Expected: PASS.

- [ ] **Step 4: Run full server test suite to confirm no regressions**

Run: `cd server && npx vitest run`
Expected: All tests pass (123+ tests).

- [ ] **Step 5: Commit**

```bash
git add shared/heapTypes.ts server/src/routes/heap.ts server/tests/routes.test.ts
git commit -m "feat(server): expose topY in GET /heaps list response

Adds topY to the HeapSummary shared type and surfaces the existing
heap.top_y column through /heaps. Unblocks client + admin height display.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 1.4: Client — `heightFt` formatter + unit test

**Files:**
- Create: `src/util/format.ts`
- Create: `src/util/format.test.ts`

- [ ] **Step 1: Write failing test**

`src/util/format.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { heightFt } from './format';

describe('heightFt', () => {
  it('returns formatted feet when topY is finite', () => {
    expect(heightFt(50_000, 49_000)).toBe('100 FT');
    expect(heightFt(50_000, 0)).toBe('5000 FT');
  });

  it('floors fractional feet', () => {
    expect(heightFt(50_000, 49_995)).toBe('0 FT');  // 5px / 10 = 0.5 → floor 0
    expect(heightFt(50_000, 49_990)).toBe('1 FT');
  });

  it('returns ??? when topY is null/undefined/non-finite', () => {
    expect(heightFt(50_000, null)).toBe('???');
    expect(heightFt(50_000, undefined)).toBe('???');
    expect(heightFt(50_000, NaN)).toBe('???');
    expect(heightFt(50_000, Infinity)).toBe('???');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/util/format.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `heightFt`**

`src/util/format.ts`:

```ts
import { SCORE_DISPLAY_DIVISOR } from '../../shared/scoreConstants';

/**
 * Render heap height as "<N> FT" (px / SCORE_DISPLAY_DIVISOR, floored).
 * Returns "???" when topY is missing or non-finite (legacy heaps with
 * no recorded top_y, or a server response without the field).
 */
export function heightFt(
  worldHeight: number,
  topY: number | null | undefined,
): string {
  if (topY == null || !Number.isFinite(topY)) return '???';
  const px = worldHeight - topY;
  return `${Math.floor(px / SCORE_DISPLAY_DIVISOR)} FT`;
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run src/util/format.test.ts`
Expected: PASS (3 tests).

---

### Task 1.5: Wire `heightFt` into HeapSelectScene

**Files:**
- Modify: `src/scenes/HeapSelectScene.ts`

- [ ] **Step 1: Locate the heap card name rendering**

Open `src/scenes/HeapSelectScene.ts`. Find the block that renders the heap name (search for `nameMaxW` and the `this.add.text` call around line 122 that draws the name). The spec layout calls for the height to appear immediately right of the name as `Name - 1234 FT`.

- [ ] **Step 2: Import `heightFt`**

Add at the top of `src/scenes/HeapSelectScene.ts`:

```ts
import { heightFt } from '../util/format';
```

- [ ] **Step 3: Append the FT label after the name text**

Where the name text is added (the `this.add.text(...)` call rendering the heap name), build the display string from name + " - " + heightFt result. Adapt to the existing rendering pattern (the file currently sets a separate `Phaser.GameObjects.Text`). Concretely, change the name string to:

```ts
const heightLabel = heightFt(summary.params.worldHeight, summary.topY);
const nameText = `${summary.params.name} - ${heightLabel}`;
```

…and pass `nameText` to the existing `this.add.text(...)` call instead of the bare name. Preserve `nameMaxW` wrapping behavior unchanged.

(If the local variable for the row's summary is not literally `summary`, substitute the actual name used in that scope. Search for `params.name` to find where to splice in.)

- [ ] **Step 4: Run client test suite**

Run: `npx vitest run`
Expected: All client tests pass (existing 378 + the 3 new format tests = 381).

- [ ] **Step 5: Manual smoke check**

Run: `npm run dev`, open `http://localhost:3000`, click into the heap selector. Confirm each heap row shows `<name> - <N> FT` (or `<name> - ???` for legacy rows with null `top_y`).

- [ ] **Step 6: Commit**

```bash
git add src/util/format.ts src/util/format.test.ts src/scenes/HeapSelectScene.ts
git commit -m "feat(client): show heap height in FT on HeapSelectScene

Adds heightFt formatter (worldHeight - topY) / 10 = ft, with ??? for
legacy heaps with no recorded top_y. Renders inline with each heap's
name on the selector card.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 1.6: Phase-1 merge

- [ ] **Step 1: Push and open PR**

```bash
git push -u origin feature/heap-height-display
gh pr create --base main --title "feat: heap height display + topY in /heaps" \
  --body "Implements PR-1 of docs/superpowers/specs/2026-05-06-admin-ui-and-height-display-design.md."
```

- [ ] **Step 2: Merge after review**

After PR review and merge, return to `main` and pull:

```bash
git checkout main && git pull
```

---

## Phase 2 — PR-2: `shared/heapPolygon/` + Optional Vertices

**Branch:** `feature/shared-heap-polygon` off `main`.

**Architectural note:** `src/data/heapItemDefs.ts` is auto-generated from sprite assets and contains many items (textureKey, filename, etc. — all browser-coupled). The shared generator must NOT depend on it. Strategy: parameterize `findSurfaceY` and `computeBandScanlines` to accept a generic `defs: Record<number, { width: number; height: number }>` instead of importing `OBJECT_DEFS`. The shared module ships its own minimal `DEFAULT_HEAP_DEFS` snapshot covering keyids 0/1/2 (all the seed pipeline ever uses — `Math.floor(rng * 3)`). Existing src callers get zero-ripple via thin wrappers that pre-bind `OBJECT_DEFS`.

### Task 2.1: Create `shared/heapPolygon/types.ts`

**Files:**
- Create: `shared/heapPolygon/types.ts`

- [ ] **Step 1: Write the file**

```ts
// shared/heapPolygon/types.ts
//
// Pure types used by the polygon generator. Mirrors src/data/heapTypes.ts
// for the fields the polygon math actually reads (no Phaser-coupled fields).

export interface HeapEntry {
  x: number;
  y: number;
  keyid: number;
  w?: number;
  h?: number;
}

export interface ItemDef {
  width: number;
  height: number;
}

export type ItemDefs = Record<number, ItemDef>;

export interface Vertex {
  x: number;
  y: number;
}

export interface ScanlineRow {
  y: number;
  left: number;
  right: number;
}
```

- [ ] **Step 2: Compile-check**

Run: `npx tsc --noEmit`
Expected: PASS — pure type file, no imports.

---

### Task 2.2: Create `shared/heapPolygon/state.ts` (HeapState)

**Files:**
- Create: `shared/heapPolygon/state.ts`

- [ ] **Step 1: Copy HeapState verbatim**

```ts
// shared/heapPolygon/state.ts
//
// Deterministic seeded PRNG (Mulberry32). Moved here so server + seed
// script can produce identical default polygons.

export class HeapState {
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  /** Returns a deterministic value in [0, 1) for a given input integer. */
  seededRandom(n: number): number {
    let t = (n ^ this.seed) + 0x6d2b79f5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
```

- [ ] **Step 2: Replace `src/systems/HeapState.ts` with a re-export**

```ts
// src/systems/HeapState.ts
// Re-export from shared/ — class lives in shared/heapPolygon/state.ts.
export { HeapState } from '../../shared/heapPolygon/state';
```

- [ ] **Step 3: Run client test suite**

Run: `npx vitest run`
Expected: PASS — re-export preserves all import sites.

---

### Task 2.3: Create `shared/heapPolygon/polygon.ts`

**Files:**
- Create: `shared/heapPolygon/polygon.ts`

- [ ] **Step 1: Port the polygon math, parameterized by `ItemDefs`**

Copy contents from `src/systems/HeapPolygon.ts:1-183` into `shared/heapPolygon/polygon.ts` with these changes:

1. Replace the `import { HeapEntry } from '../data/heapTypes';` and `import { OBJECT_DEFS } from '../data/heapObjectDefs';` lines with: `import type { HeapEntry, ItemDefs, Vertex, ScanlineRow } from './types';` and remove the local `Vertex` / `ScanlineRow` re-declarations (they live in `types.ts` now).
2. Change `computeBandScanlines(entries: HeapEntry[], bandTop: number, bandBottom: number)` to take a fourth required param: `defs: ItemDefs`. Use `defs` everywhere `OBJECT_DEFS` was referenced.
3. `simplifyPolygon` and `computeBandPolygon` need no signature changes — they don't read OBJECT_DEFS.

The full new file looks like this (skeleton; preserve all existing math):

```ts
// shared/heapPolygon/polygon.ts
//
// Pure-math polygon pipeline: scanline → polygon → simplify.
// Parameterized over ItemDefs so it can run on the server (no auto-
// generated sprite defs) and in the browser (live OBJECT_DEFS).

import type { HeapEntry, ItemDefs, Vertex, ScanlineRow } from './types';

const SCAN_STEP = /* COPY existing constant from src/systems/HeapPolygon.ts */;

export function computeBandScanlines(
  entries: HeapEntry[],
  bandTop: number,
  bandBottom: number,
  defs: ItemDefs,
): ScanlineRow[] {
  const rects = entries.map(e => {
    const def = defs[e.keyid] ?? defs[0];
    const eW  = e.w ?? def.width;
    const eH  = e.h ?? def.height;
    return { left: e.x - eW / 2, right: e.x + eW / 2, top: e.y - eH / 2, bottom: e.y + eH / 2 };
  });
  /* COPY remaining body verbatim from src/systems/HeapPolygon.ts:27-onward,
     replacing OBJECT_DEFS lookups with `defs`. */
}

export function computeBandPolygon(rows: ScanlineRow[]): Vertex[] {
  /* COPY verbatim from src/systems/HeapPolygon.ts */
}

export function simplifyPolygon(vertices: Vertex[], epsilon: number): Vertex[] {
  /* COPY verbatim from src/systems/HeapPolygon.ts */
}
```

(The literal body lines are in the existing file; copy them exactly. Only the function signatures and import lines change.)

- [ ] **Step 2: Replace `src/systems/HeapPolygon.ts` with a thin wrapper**

```ts
// src/systems/HeapPolygon.ts
//
// Thin wrapper over shared/heapPolygon/* — pre-binds OBJECT_DEFS so existing
// call sites (heapWorker, InfiniteGameScene, etc.) keep their old signatures.

import { OBJECT_DEFS } from '../data/heapObjectDefs';
import type { HeapEntry } from '../data/heapTypes';
import {
  computeBandScanlines as _computeBandScanlines,
  computeBandPolygon,
  simplifyPolygon,
} from '../../shared/heapPolygon/polygon';
import type { ItemDefs, Vertex, ScanlineRow } from '../../shared/heapPolygon/types';

export type { Vertex, ScanlineRow };

export function computeBandScanlines(
  entries: HeapEntry[],
  bandTop: number,
  bandBottom: number,
): ScanlineRow[] {
  return _computeBandScanlines(entries, bandTop, bandBottom, OBJECT_DEFS as unknown as ItemDefs);
}

export { computeBandPolygon, simplifyPolygon };
```

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run` and `cd server && npx vitest run`
Expected: All tests pass — wrapper preserves the existing API.

---

### Task 2.4: Create `shared/heapPolygon/surface.ts`

**Files:**
- Create: `shared/heapPolygon/surface.ts`

- [ ] **Step 1: Port findSurfaceY parameterized by `floorY` + `defs`**

```ts
// shared/heapPolygon/surface.ts
//
// findSurfaceY — top-of-stack lookup for placing a new entry.
// Parameterized over floorY and item defs.

import type { HeapEntry, ItemDefs } from './types';

export function findSurfaceY(
  cx: number,
  width: number,
  entries: readonly HeapEntry[],
  floorY: number,
  defs: ItemDefs,
): number {
  const left  = cx - width / 2;
  const right = cx + width / 2;
  let surfaceY = floorY;

  for (const entry of entries) {
    const def    = defs[entry.keyid] ?? defs[0];
    const eW     = entry.w ?? def.width;
    const eH     = entry.h ?? def.height;
    const eLeft  = entry.x - eW / 2;
    const eRight = entry.x + eW / 2;

    if (eRight > left && eLeft < right) {
      const topEdge = entry.y - eH / 2;
      if (topEdge < surfaceY) surfaceY = topEdge;
    }
  }

  return surfaceY;
}
```

- [ ] **Step 2: Replace `src/systems/HeapSurface.ts` with a thin wrapper**

```ts
// src/systems/HeapSurface.ts
//
// Thin wrapper — pre-binds MOCK_HEAP_HEIGHT_PX and OBJECT_DEFS for existing
// call sites. Logic lives in shared/heapPolygon/surface.ts.

import type { HeapEntry } from '../data/heapTypes';
import { OBJECT_DEFS } from '../data/heapObjectDefs';
import { MOCK_HEAP_HEIGHT_PX } from '../constants';
import { findSurfaceY as _findSurfaceY } from '../../shared/heapPolygon/surface';
import type { ItemDefs } from '../../shared/heapPolygon/types';

export function findSurfaceY(
  cx: number,
  width: number,
  entries: readonly HeapEntry[],
): number {
  return _findSurfaceY(cx, width, entries, MOCK_HEAP_HEIGHT_PX, OBJECT_DEFS as unknown as ItemDefs);
}
```

- [ ] **Step 3: Run test suites**

Run: `npx vitest run` and `cd server && npx vitest run`
Expected: PASS.

---

### Task 2.5: Create `shared/heapPolygon/objectDefs.ts` (default snapshot)

**Files:**
- Create: `shared/heapPolygon/objectDefs.ts`

- [ ] **Step 1: Snapshot keyids 0/1/2 from `src/data/heapItemDefs.ts`**

The seed pipeline only ever picks keyids in `[0, 3)` (see `seed-heap.ts:50` — `Math.floor(rng * 3)`). Snapshot those three:

```ts
// shared/heapPolygon/objectDefs.ts
//
// Minimal item-def snapshot used by the server's default-polygon generator.
// Mirrors keyids 0–2 of src/data/heapItemDefs.ts (allow-wheel, bw-motor-pedal-bike,
// car-tire). Width/height only — the server never renders, only computes geometry.
//
// If src/data/heapItemDefs.ts dimensions for keyids 0–2 ever change, update this
// snapshot to keep server-generated defaults visually consistent with the seed
// script's polygon shape. (Existing seeded heaps are unaffected.)

import type { ItemDefs } from './types';

export const DEFAULT_HEAP_DEFS: ItemDefs = {
  0: { width: 69, height: 96 },  // allow-wheel
  1: { width: 96, height: 79 },  // bw-motor-pedal-bike
  2: { width: 61, height: 96 },  // car-tire
};
```

- [ ] **Step 2: Compile-check**

Run: `npx tsc --noEmit`
Expected: PASS.

---

### Task 2.6: Create `shared/heapPolygon/generate.ts` + tests

**Files:**
- Create: `shared/heapPolygon/generate.ts`
- Create: `shared/heapPolygon/index.ts`
- Create: `shared/heapPolygon/generate.test.ts`

- [ ] **Step 1: Write failing test**

`shared/heapPolygon/generate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateDefaultPolygon } from './generate';

describe('generateDefaultPolygon', () => {
  it('produces a non-empty vertex list for a standard heap', () => {
    const verts = generateDefaultPolygon(42, 50_000);
    expect(verts.length).toBeGreaterThan(10);
    for (const v of verts) {
      expect(Number.isFinite(v.x)).toBe(true);
      expect(Number.isFinite(v.y)).toBe(true);
    }
  });

  it('is deterministic for a given seed + worldHeight', () => {
    const a = generateDefaultPolygon(42, 50_000);
    const b = generateDefaultPolygon(42, 50_000);
    expect(a).toEqual(b);
  });

  it('different seeds produce different polygons', () => {
    const a = generateDefaultPolygon(42, 50_000);
    const b = generateDefaultPolygon(43, 50_000);
    expect(a).not.toEqual(b);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run shared/heapPolygon/generate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the generator**

`shared/heapPolygon/generate.ts`:

```ts
// shared/heapPolygon/generate.ts
//
// Server-callable default polygon generator. Mirrors the pipeline that
// scripts/seed-heap.ts uses, with the same defaults (1200 blocks, simplify
// epsilon 2). Pure-math, no DOM/Phaser/runtime deps.

import { HeapState } from './state';
import { findSurfaceY } from './surface';
import { computeBandScanlines, computeBandPolygon, simplifyPolygon } from './polygon';
import { DEFAULT_HEAP_DEFS } from './objectDefs';
import type { HeapEntry, Vertex } from './types';

// Mirror of src/constants.ts WORLD_WIDTH. Kept inline so shared/ stays
// dependency-free of src/.
const WORLD_WIDTH = 960;

export interface GenerateOptions {
  numBlocks?: number;
  simplifyEpsilon?: number;
}

export function generateDefaultPolygon(
  seed: number,
  worldHeight: number,
  opts: GenerateOptions = {},
): Vertex[] {
  const numBlocks       = opts.numBlocks       ?? 1200;
  const simplifyEpsilon = opts.simplifyEpsilon ?? 2;

  const state = new HeapState(seed);
  const entries: HeapEntry[] = [];
  const numKeys = Object.keys(DEFAULT_HEAP_DEFS).length;

  for (let i = 0; i < numBlocks; i++) {
    const keyid = Math.floor(state.seededRandom(i * 3) * numKeys);
    const def   = DEFAULT_HEAP_DEFS[keyid];

    const xMin = WORLD_WIDTH * 0.125 + def.width / 2;
    const xMax = WORLD_WIDTH * 0.875 - def.width / 2;
    const cx   = xMin + state.seededRandom(i * 3 + 1) * (xMax - xMin);

    const surfaceY = findSurfaceY(cx, def.width, entries, worldHeight, DEFAULT_HEAP_DEFS);
    const y = surfaceY - def.height / 2;

    entries.push({ x: cx, y, keyid });
  }

  const rows = computeBandScanlines(entries, 0, worldHeight, DEFAULT_HEAP_DEFS);
  const full = computeBandPolygon(rows);
  return simplifyPolygon(full, simplifyEpsilon);
}
```

- [ ] **Step 4: Add `index.ts` re-export**

`shared/heapPolygon/index.ts`:

```ts
export { HeapState } from './state';
export { findSurfaceY } from './surface';
export {
  computeBandScanlines,
  computeBandPolygon,
  simplifyPolygon,
} from './polygon';
export { generateDefaultPolygon } from './generate';
export { DEFAULT_HEAP_DEFS } from './objectDefs';
export type { HeapEntry, ItemDef, ItemDefs, Vertex, ScanlineRow } from './types';
export type { GenerateOptions } from './generate';
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run shared/heapPolygon/`
Expected: PASS (3 tests).

---

### Task 2.7: Update `scripts/seed-heap.ts` to use the shared generator

**Files:**
- Modify: `scripts/seed-heap.ts`

- [ ] **Step 1: Replace inline pipeline with `generateDefaultPolygon`**

In `scripts/seed-heap.ts`, replace the `import { HeapState } …` and `import { findSurfaceY } …` and `import { computeBandScanlines, …}` blocks (lines 23-30 area) with:

```ts
import { generateDefaultPolygon } from '../shared/heapPolygon';
import type { CreateHeapResponse, ResetHeapResponse } from '../shared/heapTypes';
```

Delete the `buildHeap()` and `buildPolygon()` functions (they become unused). Replace the call site that produces `vertices` for the POST/PUT request with:

```ts
const vertices = generateDefaultPolygon(PARAM_SEED, PARAM_WORLD_HEIGHT);
if (VERBOSE) console.log(`  Polygon vertices: ${vertices.length}`);
```

- [ ] **Step 2: Smoke test the seed script against local server**

Start the server (`cd server && npx wrangler dev`), then in another terminal run: `npm run seed`
Expected: A new heap is created without errors. Inspect the response: `vertexCount > 10`.

- [ ] **Step 3: Commit**

```bash
git add shared/heapPolygon/ src/systems/HeapState.ts src/systems/HeapPolygon.ts \
        src/systems/HeapSurface.ts scripts/seed-heap.ts
git commit -m "refactor: move polygon pipeline to shared/heapPolygon

Extracts HeapState, findSurfaceY, scanline/polygon/simplify, and a new
generateDefaultPolygon helper into shared/heapPolygon/. Parameterizes
the math over ItemDefs so it's runnable in Cloudflare Workers (no
auto-generated sprite defs needed). Existing src/ files become thin
wrappers that pre-bind OBJECT_DEFS — zero ripple in game-client imports.
seed-heap.ts switches to generateDefaultPolygon.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2.8: Make `vertices` optional in `CreateHeapRequest`

**Files:**
- Modify: `shared/heapTypes.ts:41-44`

- [ ] **Step 1: Update the type**

```ts
export interface CreateHeapRequest {
  /** Optional. If absent, server generates a default polygon from seed + worldHeight. */
  vertices?: Vertex[];
  /** Optional. Used only when vertices is absent. Defaults to a random int. */
  seed?: number;
  params?: Partial<HeapParams>;
}
```

- [ ] **Step 2: Compile-check**

Run: `cd server && npx tsc --noEmit`
Expected: An error in `server/src/routes/heap.ts` where the handler currently destructures `body.vertices` as if required.

---

### Task 2.9: Server — failing tests for default-polygon path

**Files:**
- Modify: `server/tests/routes.test.ts` (add tests inside `describe('POST /heaps', …)`)

- [ ] **Step 1: Write failing tests**

Append:

```ts
it('creates a heap with no body — server generates default polygon', async () => {
  const res = await makeApp().request('/heaps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(201);
  const body = await res.json() as CreateHeapResponse;
  expect(body.vertexCount).toBeGreaterThan(10);
});

it('honors explicit seed for deterministic creation', async () => {
  const app = makeApp();
  const a = await app.request('/heaps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seed: 12345 }),
  }).then(r => r.json()) as CreateHeapResponse;
  const b = await app.request('/heaps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seed: 12345 }),
  }).then(r => r.json()) as CreateHeapResponse;
  expect(a.vertexCount).toBe(b.vertexCount);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd server && npx vitest run tests/routes.test.ts -t "default polygon"`
Expected: FAIL — likely 400 or 500 because the existing handler requires `vertices`.

---

### Task 2.10: Server — implement default-polygon path

**Files:**
- Modify: `server/src/routes/heap.ts` (the `POST /` handler ~line 82)

- [ ] **Step 1: Branch on `vertices` presence**

In the `app.post('/', …)` handler, before passing `vertices` to the create flow, add:

```ts
import { generateDefaultPolygon } from '../../../shared/heapPolygon';
// (add to existing imports near top of file)

// inside handler, after `body = await c.req.json()`:
const params = resolveParams(body.params);
if ('error' in params) return c.json({ error: params.error }, 400);

let vertices: Vertex[];
if (Array.isArray(body.vertices)) {
  vertices = body.vertices;
} else {
  const seed = Number.isFinite(body.seed) ? Math.floor(body.seed!) : Math.floor(Math.random() * 1_000_000);
  vertices = generateDefaultPolygon(seed, params.worldHeight);
}
```

(Adjust to match the existing flow's variable naming — read lines ~82-122 first to see how `vertices` and `params` are currently consumed.)

- [ ] **Step 2: Run new tests**

Run: `cd server && npx vitest run tests/routes.test.ts -t "default polygon"`
Expected: PASS.

- [ ] **Step 3: Run full server suite**

Run: `cd server && npx vitest run`
Expected: All pass.

- [ ] **Step 4: Run client suite**

Run: `npx vitest run`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add shared/heapTypes.ts server/src/routes/heap.ts server/tests/routes.test.ts
git commit -m "feat(server): POST /heaps generates default polygon when vertices absent

vertices is now optional in CreateHeapRequest. When absent the server
calls generateDefaultPolygon(seed, worldHeight) — seed is honored if
provided, otherwise a random int is used. Enables admin UI heap
creation without polygon JSON in the body.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2.11: Phase-2 merge

- [ ] **Step 1: Push and open PR**

```bash
git push -u origin feature/shared-heap-polygon
gh pr create --base main --title "refactor: shared/heapPolygon + optional vertices on POST /heaps" \
  --body "Implements PR-2 of docs/superpowers/specs/2026-05-06-admin-ui-and-height-display-design.md."
```

- [ ] **Step 2: Merge after review**

```bash
git checkout main && git pull
```

---

## Phase 3 — PR-3: `PUT /heaps/:id/params` + Admin UI Rework

**Branch:** `feature/admin-ui-rework` off `main`.

### Task 3.1: Add `UpdateHeapParamsRequest` type

**Files:**
- Modify: `shared/heapTypes.ts`

- [ ] **Step 1: Append the type**

Add to `shared/heapTypes.ts` after the existing Reset section:

```ts
// ── Update Params (no-vertices path) ─────────────────────────────────────────

/** All fields optional. worldHeight is rejected if present. */
export type UpdateHeapParamsRequest = Partial<Omit<HeapParams, 'worldHeight'>>;

export interface UpdateHeapParamsResponse {
  summary: HeapSummary;
}
```

---

### Task 3.2: Server — failing tests for `PUT /heaps/:id/params`

**Files:**
- Modify: `server/tests/routes.test.ts`

- [ ] **Step 1: Add a new describe block**

Append:

```ts
describe('PUT /heaps/:id/params', () => {
  async function seedOne(app: ReturnType<typeof makeApp>) {
    const res = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    return (await res.json() as CreateHeapResponse).id;
  }

  it('updates editable params and returns updated summary', async () => {
    const app = makeApp();
    const id = await seedOne(app);

    const res = await app.request(`/heaps/${id}/params`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed', difficulty: 2.5, coinMult: 1.5 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { summary: HeapSummary };
    expect(body.summary.params.name).toBe('Renamed');
    expect(body.summary.params.difficulty).toBe(2.5);
    expect(body.summary.params.coinMult).toBe(1.5);
  });

  it('rejects worldHeight in body with 400', async () => {
    const app = makeApp();
    const id = await seedOne(app);
    const res = await app.request(`/heaps/${id}/params`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldHeight: 99_999 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/worldHeight/i);
  });

  it('returns 404 when heap does not exist', async () => {
    const app = makeApp();
    const res = await app.request('/heaps/does-not-exist/params', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(404);
  });

  it('rejects when admin secret is configured but missing', async () => {
    const app = makeApp({ adminSecret: 'topsecret' });
    const id = await (async () => {
      const res = await app.request('/heaps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': 'topsecret' },
        body: JSON.stringify({ vertices: VERTICES }),
      });
      return (await res.json() as CreateHeapResponse).id;
    })();

    const res = await app.request(`/heaps/${id}/params`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },  // no X-Admin-Secret
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd server && npx vitest run tests/routes.test.ts -t "PUT /heaps/:id/params"`
Expected: All four tests FAIL (route not registered).

---

### Task 3.3: Server — implement `PUT /heaps/:id/params`

**Files:**
- Modify: `server/src/routes/heap.ts`
- Modify: `server/src/app.ts`

- [ ] **Step 1: Add route handler**

After the existing `app.put('/:id/reset', …)` handler in `server/src/routes/heap.ts`, add:

```ts
// PUT /heaps/:id/params — update editable params (worldHeight locked)
app.put('/:id/params', async (c) => {
  const id = c.req.param('id');
  const existing = await db.getHeap(id);
  if (!existing) return c.json({ error: 'Heap not found' }, 404);

  let body: UpdateHeapParamsRequest;
  try {
    body = await c.req.json<UpdateHeapParamsRequest>();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  if (body && 'worldHeight' in body) {
    return c.json({ error: 'worldHeight is locked after creation' }, 400);
  }

  // Reuse resolveParams against the merged shape (existing values + edits).
  const merged = resolveParams({
    name:          body.name          ?? existing.name,
    difficulty:    body.difficulty    ?? existing.difficulty,
    spawnRateMult: body.spawnRateMult ?? existing.spawn_rate_mult,
    coinMult:      body.coinMult      ?? existing.coin_mult,
    scoreMult:     body.scoreMult     ?? existing.score_mult,
    worldHeight:   existing.world_height,
  });
  if ('error' in merged) return c.json({ error: merged.error }, 400);

  await db.updateHeapParams(id, merged);

  return c.json({
    summary: {
      id,
      version: existing.version,
      createdAt: existing.created_at,
      topY: existing.top_y,
      params: merged,
    },
  } satisfies UpdateHeapParamsResponse);
});
```

Add `UpdateHeapParamsRequest` and `UpdateHeapParamsResponse` to the existing imports at the top of the file.

- [ ] **Step 2: Wire admin gate**

In `server/src/app.ts`, alongside the existing admin gates (around line 60):

```ts
app.put('/heaps/:id/params', adminGate);
```

- [ ] **Step 3: Run new tests**

Run: `cd server && npx vitest run tests/routes.test.ts -t "PUT /heaps/:id/params"`
Expected: PASS (4 tests).

- [ ] **Step 4: Run full server suite**

Run: `cd server && npx vitest run`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add shared/heapTypes.ts server/src/routes/heap.ts server/src/app.ts \
        server/tests/routes.test.ts
git commit -m "feat(server): PUT /heaps/:id/params endpoint (admin-gated)

Edits name/difficulty/spawnRateMult/coinMult/scoreMult on an existing
heap without resetting the polygon. worldHeight is rejected with 400
('locked after creation'). Reuses resolveParams validation. Returns
the updated HeapSummary.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3.4: Admin UI — rename file + add Settings section

**Files:**
- Move: `admin/enemy-params.html` → `admin/index.html`
- Modify: `admin/index.html`

- [ ] **Step 1: Rename**

```bash
git mv admin/enemy-params.html admin/index.html
```

- [ ] **Step 2: Add Settings section + admin secret persistence**

Open `admin/index.html`. Update the `<title>` to `Heap Admin`. Replace the existing top of the page (the `<h1>Enemy Params Admin</h1>` and the Server URL input) with the Settings card below. Append a stylesheet rule for distinct section borders.

Add to `<style>`:

```css
.section { border-left: 4px solid #444; }
.section-settings { border-left-color: #888; }
.section-list     { border-left-color: #0cf; }
.section-edit     { border-left-color: #0f0; }
.section-create   { border-left-color: #fa0; }
.muted { color: #777; font-size: 12px; }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; vertical-align: middle; margin-left: 8px; }
.dot-ok { background: #0f0; }
.dot-bad { background: #f44; }
table.heaps { width: 100%; border-collapse: collapse; font-size: 13px; }
table.heaps th, table.heaps td { padding: 6px 8px; border-bottom: 1px solid #222; text-align: left; }
table.heaps th { color: #888; }
.btn-sm { padding: 4px 10px; font-size: 12px; margin-right: 4px; }
.btn-danger { background: #c33; color: #fff; }
.btn-danger:hover { background: #a22; }
```

Replace the body's heading + URL block with:

```html
<h1>Heap Admin</h1>

<div class="section section-settings">
  <h2>Settings</h2>
  <label>Server URL</label>
  <input type="text" id="serverUrl" />

  <label>Admin Secret <span class="muted">(stored in localStorage)</span></label>
  <input type="password" id="adminSecret" placeholder="leave blank if server has no secret" />

  <div style="margin-top: 10px;">
    <button id="saveSettings">Save Settings</button>
    <span id="secretDot" class="dot dot-bad"></span>
    <span id="secretLabel" class="muted">no secret saved</span>
  </div>
</div>
```

- [ ] **Step 3: Replace the bottom `<script>` block with bootstrap + settings logic**

At the end of the file, replace the existing `<script>` content with the new structure (we'll grow it through the next tasks). For now:

```html
<script>
const LS_URL    = 'heapAdmin.serverUrl';
const LS_SECRET = 'heapAdmin.adminSecret';
const DEFAULT_URL = 'http://localhost:8787';

function $(id) { return document.getElementById(id); }
function serverUrl() { return $('serverUrl').value.replace(/\/$/, ''); }
function adminSecret() { return $('adminSecret').value; }

function refreshSecretIndicator() {
  const has = !!localStorage.getItem(LS_SECRET);
  $('secretDot').className = 'dot ' + (has ? 'dot-ok' : 'dot-bad');
  $('secretLabel').textContent = has ? 'secret saved' : 'no secret saved';
}

async function adminFetch(path, opts = {}) {
  const headers = Object.assign(
    { 'Content-Type': 'application/json' },
    opts.headers || {},
  );
  const secret = adminSecret();
  if (secret) headers['X-Admin-Secret'] = secret;
  const res = await fetch(serverUrl() + path, Object.assign({}, opts, { headers }));
  if (res.status === 401) {
    localStorage.removeItem(LS_SECRET);
    refreshSecretIndicator();
    throw new Error('admin secret rejected — cleared from localStorage');
  }
  return res;
}

function bootSettings() {
  $('serverUrl').value    = localStorage.getItem(LS_URL)    || DEFAULT_URL;
  $('adminSecret').value  = localStorage.getItem(LS_SECRET) || '';
  $('saveSettings').onclick = () => {
    localStorage.setItem(LS_URL,    $('serverUrl').value);
    localStorage.setItem(LS_SECRET, $('adminSecret').value);
    refreshSecretIndicator();
    setStatus('settings saved', 'ok');
  };
  refreshSecretIndicator();
}

function setStatus(msg, kind) {
  const el = $('status');
  if (!el) return;
  el.textContent = msg;
  el.className = kind || '';
}

document.addEventListener('DOMContentLoaded', () => {
  bootSettings();
  // bootHeapsList();  — added in Task 3.5
  // bootEditHeap();   — added in Task 3.6
  // bootCreateHeap(); — added in Task 3.7
});
</script>

<div id="status" style="margin-top: 16px; font-size: 13px;"></div>
```

- [ ] **Step 4: Open the page locally and verify**

Open `admin/index.html` directly in a browser (file://) or via a static server. Confirm: server URL pre-populates from localStorage, "Save Settings" stores both values, the secret dot turns green after saving.

---

### Task 3.5: Admin UI — Heaps list section

**Files:**
- Modify: `admin/index.html`

- [ ] **Step 1: Add list HTML before the existing enemy-params editor**

Insert below the Settings section:

```html
<div class="section section-list">
  <h2>Heaps</h2>
  <button id="refreshHeaps">Refresh</button>
  <table class="heaps">
    <thead>
      <tr>
        <th>Name</th><th>Difficulty</th><th>top Y</th><th>Created</th><th>Actions</th>
      </tr>
    </thead>
    <tbody id="heapsTbody"><tr><td colspan="5" class="muted">loading…</td></tr></tbody>
  </table>
</div>
```

- [ ] **Step 2: Add JS**

Append inside the `<script>`:

```js
let cachedHeaps = [];

async function loadHeaps() {
  try {
    const res = await fetch(serverUrl() + '/heaps');
    if (!res.ok) throw new Error('list failed: ' + res.status);
    const data = await res.json();
    cachedHeaps = data.heaps || [];
    renderHeapsTable();
  } catch (e) {
    setStatus(String(e), 'err');
  }
}

function renderHeapsTable() {
  const tbody = $('heapsTbody');
  if (!cachedHeaps.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">no heaps</td></tr>';
    return;
  }
  tbody.innerHTML = cachedHeaps.map(h => {
    const topY = (h.topY == null || !Number.isFinite(h.topY)) ? '???' : String(h.topY);
    const created = (h.createdAt || '').slice(0, 10);
    return `<tr>
      <td>${escapeHtml(h.params.name)}</td>
      <td>${h.params.difficulty.toFixed(1)}</td>
      <td>${topY}</td>
      <td>${created}</td>
      <td>
        <button class="btn-sm" onclick="onEditHeap('${h.id}')">Edit</button>
        <button class="btn-sm btn-danger" onclick="onDeleteHeap('${h.id}')">Delete</button>
      </td>
    </tr>`;
  }).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

async function onDeleteHeap(id) {
  const heap = cachedHeaps.find(h => h.id === id);
  if (!heap) return;
  if (!confirm(`Delete "${heap.params.name}"? This cannot be undone.`)) return;
  try {
    const res = await adminFetch('/heaps/' + id, { method: 'DELETE' });
    if (!res.ok) throw new Error('delete failed: ' + res.status);
    setStatus('deleted', 'ok');
    await loadHeaps();
    hideEditPanel();
  } catch (e) {
    setStatus(String(e), 'err');
  }
}

function bootHeapsList() {
  $('refreshHeaps').onclick = loadHeaps;
  loadHeaps();
}
```

Then uncomment `bootHeapsList()` in the `DOMContentLoaded` block.

`onEditHeap` and `hideEditPanel` are added in Task 3.6 — leave the references; the page will throw on click until then but list rendering works.

- [ ] **Step 3: Reload and verify**

Reload `admin/index.html`. Confirm a table renders. Click Delete on a throwaway heap (after seeding one if needed via `npm run seed`). Confirm row disappears.

---

### Task 3.6: Admin UI — Edit Heap section (params + enemy params)

**Files:**
- Modify: `admin/index.html`

- [ ] **Step 1: Add edit panel HTML**

Below the list section, replace the existing `<div id="editor">` (the enemy-params block) with a wrapping section that contains both forms. The structure:

```html
<div class="section section-edit" id="editPanel" style="display:none;">
  <h2>Edit Heap: <span id="editHeapName">—</span></h2>

  <h3 style="color: #aaa; font-size: 13px; margin-top: 12px;">Heap Params</h3>
  <div class="row">
    <div><label>Name</label><input type="text" id="ep-name" /></div>
    <div><label>Difficulty (1–5, step 0.5)</label><input type="number" step="0.5" id="ep-difficulty" /></div>
  </div>
  <div class="row">
    <div><label>spawnRateMult</label><input type="number" step="0.05" id="ep-spawnRateMult" /></div>
    <div><label>coinMult</label><input type="number" step="0.05" id="ep-coinMult" /></div>
  </div>
  <div class="row">
    <div><label>scoreMult</label><input type="number" step="0.05" id="ep-scoreMult" /></div>
    <div><label>worldHeight <span class="muted">(locked)</span></label><input type="number" id="ep-worldHeight" disabled /></div>
  </div>
  <button id="saveParams">Save Params</button>

  <h3 style="color: #aaa; font-size: 13px; margin-top: 20px;">Enemy Params</h3>
  <!-- KEEP the existing percher + ghost sections from old enemy-params.html here.
       Their <input> ids (percher-spawnStartPxAboveFloor, etc.) and the existing
       loadEnemyParams / saveEnemyParams JS continue to drive them. -->
  <div class="section" id="section-percher">
    <!-- … existing percher block … -->
  </div>
  <div class="section" id="section-ghost">
    <!-- … existing ghost block … -->
  </div>
  <button id="saveEnemyParams">Save Enemy Params</button>
</div>
```

(The existing percher/ghost blocks already exist in the file — keep them in place inside this new wrapper.)

- [ ] **Step 2: JS for edit panel**

Add to `<script>`:

```js
let editingHeapId = null;

function showEditPanel(heap) {
  editingHeapId = heap.id;
  $('editPanel').style.display = '';
  $('editHeapName').textContent = heap.params.name;
  $('ep-name').value          = heap.params.name;
  $('ep-difficulty').value    = heap.params.difficulty;
  $('ep-spawnRateMult').value = heap.params.spawnRateMult;
  $('ep-coinMult').value      = heap.params.coinMult;
  $('ep-scoreMult').value     = heap.params.scoreMult;
  $('ep-worldHeight').value   = heap.params.worldHeight;
  loadEnemyParams(heap.id);  // existing function in this file
}

function hideEditPanel() {
  editingHeapId = null;
  $('editPanel').style.display = 'none';
}

function onEditHeap(id) {
  const heap = cachedHeaps.find(h => h.id === id);
  if (heap) showEditPanel(heap);
}

async function onSaveParams() {
  if (!editingHeapId) return;
  const body = {
    name:          $('ep-name').value,
    difficulty:    Number($('ep-difficulty').value),
    spawnRateMult: Number($('ep-spawnRateMult').value),
    coinMult:      Number($('ep-coinMult').value),
    scoreMult:     Number($('ep-scoreMult').value),
  };
  try {
    const res = await adminFetch(`/heaps/${editingHeapId}/params`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || ('save failed: ' + res.status));
    }
    setStatus('params saved', 'ok');
    await loadHeaps();
  } catch (e) {
    setStatus(String(e), 'err');
  }
}

function bootEditHeap() {
  $('saveParams').onclick = onSaveParams;
  // saveEnemyParams handler is the existing one from enemy-params.html — leave intact.
}
```

Uncomment `bootEditHeap()` in `DOMContentLoaded`.

- [ ] **Step 3: Adapt the existing `loadEnemyParams` / `saveEnemyParams` calls**

Open the existing JS at the bottom of the old enemy-params section. The original code listens to a heap `<select>` change. Replace that listener with a no-op (it's now driven by `showEditPanel`). Ensure `loadEnemyParams(id)` and `saveEnemyParams(id)` accept an explicit id (refactor if they currently read from the dropdown). The save button's existing handler should call `saveEnemyParams(editingHeapId)`.

If the old code is small enough to inline-rewrite cleanly, do so — keep input ids unchanged so the load/save logic still maps correctly.

- [ ] **Step 4: Smoke test**

Reload `admin/index.html`. Click Edit on a heap row. Confirm: edit panel appears, fields prefilled, Save Params hits the new endpoint, Save Enemy Params still works.

---

### Task 3.7: Admin UI — Create Heap section

**Files:**
- Modify: `admin/index.html`

- [ ] **Step 1: Add Create section HTML at the bottom of `<body>`**

```html
<div class="section section-create">
  <h2>Create New Heap</h2>
  <div class="row">
    <div><label>Name</label><input type="text" id="cp-name" placeholder="Heap name" /></div>
    <div><label>Difficulty</label><input type="number" step="0.5" id="cp-difficulty" value="1.0" /></div>
  </div>
  <div class="row">
    <div><label>spawnRateMult</label><input type="number" step="0.05" id="cp-spawnRateMult" value="1.0" /></div>
    <div><label>coinMult</label><input type="number" step="0.05" id="cp-coinMult" value="1.0" /></div>
  </div>
  <div class="row">
    <div><label>scoreMult</label><input type="number" step="0.05" id="cp-scoreMult" value="1.0" /></div>
    <div><label>worldHeight</label><input type="number" id="cp-worldHeight" value="50000" /></div>
  </div>
  <div class="row">
    <div><label>Seed <span class="muted">(blank = random)</span></label><input type="number" id="cp-seed" /></div>
    <div></div>
  </div>
  <button id="createHeap">Create Heap</button>
</div>
```

- [ ] **Step 2: Add JS**

```js
async function onCreateHeap() {
  const params = {
    name:          $('cp-name').value || 'Unnamed Heap',
    difficulty:    Number($('cp-difficulty').value),
    spawnRateMult: Number($('cp-spawnRateMult').value),
    coinMult:      Number($('cp-coinMult').value),
    scoreMult:     Number($('cp-scoreMult').value),
    worldHeight:   Number($('cp-worldHeight').value),
  };
  const seedRaw = $('cp-seed').value;
  const body = { params };
  if (seedRaw !== '') body.seed = Number(seedRaw);

  try {
    const res = await adminFetch('/heaps', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || ('create failed: ' + res.status));
    }
    setStatus('heap created', 'ok');
    $('cp-name').value = '';
    $('cp-seed').value = '';
    await loadHeaps();
  } catch (e) {
    setStatus(String(e), 'err');
  }
}

function bootCreateHeap() {
  $('createHeap').onclick = onCreateHeap;
}
```

Uncomment `bootCreateHeap()` in `DOMContentLoaded`.

- [ ] **Step 3: Smoke test**

Reload. Fill in a name, click Create. Confirm a new row appears in the Heaps table with raw `top Y` (likely the worldHeight value or 0 depending on the freshly-created state).

- [ ] **Step 4: Commit Phase-3 UI**

```bash
git add admin/index.html
git commit -m "feat(admin): sectioned admin UI — settings, list, edit, create

Replaces enemy-params.html with admin/index.html. Four cards with
distinct accents: Settings (server URL + admin secret persisted to
localStorage, 401 clears the secret), Heaps list (raw top Y column,
Edit/Delete actions), Edit Heap (params via PUT /heaps/:id/params plus
existing enemy-params editor), Create New Heap (POST /heaps with no
vertices — server generates default polygon).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3.8: Phase-3 merge

- [ ] **Step 1: Push and open PR**

```bash
git push -u origin feature/admin-ui-rework
gh pr create --base main --title "feat: admin UI rework + PUT /heaps/:id/params" \
  --body "Implements PR-3 of docs/superpowers/specs/2026-05-06-admin-ui-and-height-display-design.md.

Closes the five Todo items: heap selector FT display (PR-1), API to delete heaps
(already shipped, now wired through UI), admin secret input, admin heap CRUD,
admin all-fields editor."
```

- [ ] **Step 2: Merge after review**

```bash
git checkout main && git pull
```

---

## Final Verification

- [ ] Run full server suite: `cd server && npx vitest run` — all pass.
- [ ] Run full client suite: `npx vitest run` — all pass.
- [ ] Open admin UI; round-trip create → edit params → edit enemy params → delete on a throwaway heap.
- [ ] Open game client; confirm HeapSelectScene shows `<name> - <N> FT` for known heaps and `<name> - ???` for any with no `top_y`.
- [ ] Update Todo: strike through the five completed lines in `Todo/Todo.md`.

## Notes for the executor

- **D1 migrations:** none required. `top_y` already exists (migrations 0003/0004). Do remember production needs `cd server && npx wrangler d1 migrations apply heap --remote` if those weren't applied yet — see prior session context.
- **OBJECT_DEFS snapshot drift:** if anyone edits `src/data/heapItemDefs.ts` such that keyids 0/1/2 change dimensions, the server-generated default polygons will visually diverge from the seed script's output. Update `shared/heapPolygon/objectDefs.ts` to match. (Already noted in that file's header comment.)
- **Admin file hosting:** the admin page is plain HTML; open it via `file://` or any static server. It is NOT served by the Worker.

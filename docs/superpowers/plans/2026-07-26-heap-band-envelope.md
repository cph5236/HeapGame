# Heap Band Envelope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the heap's unbounded vertex polygon and whole-polygon ray-cast containment test with a 20px band envelope, bounding growth and bringing `POST /heaps/:id/place` back under Cloudflare's 10ms free-tier CPU cap.

**Architecture:** A heap's shape becomes a map from band index (`floor(y / 20)`) to `(minX, maxX)`. One predicate — "is this vertex the min-x or max-x of its band?" — replaces three separate mechanisms: the placement containment test, the rollup simplification rule, and the client's render model. Band writes use `MIN`/`MAX` upserts, which are conflict-free, so the CAS retry loop and its 409s disappear. Bands carry the heap version at which they last changed, which makes deltas correct without sequence numbers.

**Tech Stack:** TypeScript 5.9, Cloudflare Workers (Hono), D1/SQLite, Vitest, Phaser 3.90 client.

**Spec:** `docs/superpowers/specs/2026-07-26-heap-band-envelope-design.md` — read it before starting. The handoff `docs/superpowers/2026-07-26-heap-delta-api-handoff.md` has the measurements.

## Global Constraints

- `BAND_SIZE_PX = 20` — must equal the client's current render resolution (`CHUNK_BAND_HEIGHT / 25`, where `CHUNK_BAND_HEIGHT = 500`). Do not change this value; the losslessness guarantee depends on it.
- Branch off `main`; PR before merge, never push direct to main. No git worktrees.
- Every schema change follows the `adding-d1-migrations` skill: migration file in `server/migrations/heap_core/`, **and** the fresh-install schema in `server/schema/heap_core.sql`. Both, or the change is incomplete.
- Repository methods exist in three flavours — `D1HeapDB` (`server/src/db.ts`), `MockHeapDB` (`server/tests/helpers/mockDb.ts`), and `CachedHeapDB` (`server/src/cache/CachedHeapDB.ts`). A new method must land in all three.
- `npm run build` must pass before any task is called done — it catches TS errors the tests miss.
- Per-player server calls key on `getEffectivePlayerId()`, never bare `getPlayerGuid()`.
- Rejected placements stay silent. No client-facing behaviour change to `.accepted`.
- Never commit `.wrangler/state/`.
- Measure performance with **CPU**, never latency (see spec §7). Free-tier quotas are account-wide and shared with production.

## File Structure

| File | Responsibility |
|---|---|
| `shared/heapPolygon/bandEnvelope.ts` | **Create.** Pure envelope logic: `BAND_SIZE_PX`, band arithmetic, vertices ⇄ envelope, the containment predicate, wire encoding. Shared by server and client. |
| `shared/heapPolygon/index.ts` | Modify — re-export the new module. |
| `src/systems/HeapPolygonLoader.ts` | Modify — derive `bandSize` from `BAND_SIZE_PX` (Task 2); add delta materialisation (Task 13). |
| `server/migrations/heap_core/0004_heap_band.sql` | **Create.** `heap_band` table + pure-SQL backfill. |
| `server/migrations/heap_core/0005_live_zone_version.sql` | **Create.** Lazy-blob version stamp. |
| `server/schema/heap_core.sql` | Modify — fresh-install schema for both migrations. |
| `server/src/db.ts` | Modify — band methods on `HeapDB` + `D1HeapDB`. |
| `server/tests/helpers/mockDb.ts` | Modify — band methods on `MockHeapDB`. |
| `server/src/cache/CachedHeapDB.ts` | Modify — band methods; heap row + bands cached as one unit. |
| `server/src/polygon.ts` | Modify — band-count freeze constants; `checkFreeze` reworked. |
| `server/src/routes/heap.ts` | Modify — `/place` containment + writes; `GET /:id` delta; reset. |
| `shared/heapTypes.ts` | Modify — `GetHeapResponse` union with `mode` discriminant. |
| `src/systems/HeapClient.ts` | Modify — cache shape, delta merge. |

---

## Phase 1 — Envelope containment (fixes the CPU breach)

### Task 1: Shared band envelope module

**Files:**
- Create: `shared/heapPolygon/bandEnvelope.ts`
- Modify: `shared/heapPolygon/index.ts`
- Test: `shared/__tests__/bandEnvelope.test.ts`

**Interfaces:**
- Consumes: `Vertex` from `shared/heapTypes`.
- Produces:
  - `BAND_SIZE_PX: 20`
  - `type BandRow = { band: number; minX: number; maxX: number }`
  - `type BandEnvelope = Map<number, { minX: number; maxX: number }>`
  - `bandOf(y: number): number`
  - `bandMidY(band: number): number`
  - `verticesToEnvelope(vertices: Vertex[]): BandEnvelope`
  - `envelopeToVertices(env: BandEnvelope): Vertex[]`
  - `extendsEnvelope(env: BandEnvelope, x: number, y: number): boolean`
  - `mergeBands(env: BandEnvelope, rows: BandRow[]): BandEnvelope`
  - `envelopeToRows(env: BandEnvelope): BandRow[]`
  - `bandsToWire(rows: BandRow[]): number[]`
  - `wireToBands(wire: number[]): BandRow[]`

- [ ] **Step 1: Write the failing tests**

```ts
// shared/__tests__/bandEnvelope.test.ts
import { describe, it, expect } from 'vitest';
import {
  BAND_SIZE_PX, bandOf, bandMidY, verticesToEnvelope, envelopeToVertices,
  extendsEnvelope, mergeBands, envelopeToRows, bandsToWire, wireToBands,
} from '../heapPolygon/bandEnvelope';

describe('band arithmetic', () => {
  it('matches the client render resolution', () => {
    expect(BAND_SIZE_PX).toBe(20);
  });

  it('maps y to its band and back to the band midpoint', () => {
    expect(bandOf(0)).toBe(0);
    expect(bandOf(19.999)).toBe(0);
    expect(bandOf(20)).toBe(1);
    expect(bandOf(47115)).toBe(2355);
    expect(bandMidY(0)).toBe(10);
    expect(bandMidY(2355)).toBe(47110);
  });
});

describe('verticesToEnvelope', () => {
  it('keeps only the min-x and max-x of each band', () => {
    const env = verticesToEnvelope([
      { x: 300, y: 5 }, { x: 500, y: 12 }, { x: 400, y: 18 },  // band 0
      { x: 250, y: 25 },                                        // band 1
    ]);
    expect(env.get(0)).toEqual({ minX: 300, maxX: 500 });
    expect(env.get(1)).toEqual({ minX: 250, maxX: 250 });
    expect(env.size).toBe(2);
  });

  it('is idempotent — re-enveloping its own output changes nothing', () => {
    const pts = [{ x: 300, y: 5 }, { x: 500, y: 12 }, { x: 250, y: 25 }];
    const once = verticesToEnvelope(pts);
    const twice = verticesToEnvelope(envelopeToVertices(once));
    expect(envelopeToRows(twice)).toEqual(envelopeToRows(once));
  });
});

describe('envelopeToVertices', () => {
  it('emits both extents at band-mid-y, ascending by band', () => {
    const env = verticesToEnvelope([{ x: 300, y: 5 }, { x: 500, y: 12 }, { x: 250, y: 25 }]);
    expect(envelopeToVertices(env)).toEqual([
      { x: 300, y: 10 }, { x: 500, y: 10 }, { x: 250, y: 30 }, { x: 250, y: 30 },
    ]);
  });

  it('emits both extents even when they are equal', () => {
    // Never one vertex: reconstructPolygonFromPoints returns [] for < 2 points,
    // so a single-band heap would render as nothing. See the design doc §5.
    const env = verticesToEnvelope([{ x: 250, y: 25 }]);
    expect(envelopeToVertices(env)).toEqual([{ x: 250, y: 30 }, { x: 250, y: 30 }]);
  });

  it('emits nothing for absent bands rather than filling gaps', () => {
    const env = verticesToEnvelope([{ x: 300, y: 5 }, { x: 250, y: 65 }]);
    expect(envelopeToVertices(env)).toEqual([
      { x: 300, y: 10 }, { x: 300, y: 10 }, { x: 250, y: 70 }, { x: 250, y: 70 },
    ]);
  });
});

describe('extendsEnvelope', () => {
  const env = verticesToEnvelope([{ x: 300, y: 5 }, { x: 500, y: 12 }]);

  it('accepts a point outside its band extents', () => {
    expect(extendsEnvelope(env, 299, 5)).toBe(true);
    expect(extendsEnvelope(env, 501, 5)).toBe(true);
  });

  it('rejects a point at or inside its band extents', () => {
    expect(extendsEnvelope(env, 300, 5)).toBe(false);
    expect(extendsEnvelope(env, 400, 5)).toBe(false);
    expect(extendsEnvelope(env, 500, 5)).toBe(false);
  });

  it('accepts any point in an empty band', () => {
    expect(extendsEnvelope(env, 400, 25)).toBe(true);
  });
});

describe('mergeBands', () => {
  it('widens with MIN/MAX rather than replacing', () => {
    const env = verticesToEnvelope([{ x: 300, y: 5 }, { x: 500, y: 12 }]);
    const merged = mergeBands(env, [{ band: 0, minX: 400, maxX: 600 }]);
    expect(merged.get(0)).toEqual({ minX: 300, maxX: 600 });
  });

  it('inserts bands it has not seen', () => {
    const merged = mergeBands(new Map(), [{ band: 7, minX: 100, maxX: 200 }]);
    expect(merged.get(7)).toEqual({ minX: 100, maxX: 200 });
  });

  it('is idempotent — applying the same rows twice is a no-op', () => {
    const rows = [{ band: 0, minX: 400, maxX: 600 }];
    const once = mergeBands(new Map(), rows);
    const twice = mergeBands(once, rows);
    expect(envelopeToRows(twice)).toEqual(envelopeToRows(once));
  });
});

describe('wire encoding', () => {
  it('round-trips through the flat triple array', () => {
    const rows: ReturnType<typeof envelopeToRows> = [
      { band: 0, minX: 300, maxX: 500 },
      { band: 3, minX: 250, maxX: 250 },
    ];
    expect(bandsToWire(rows)).toEqual([0, 300, 500, 3, 250, 250]);
    expect(wireToBands(bandsToWire(rows))).toEqual(rows);
  });

  it('ignores a trailing partial triple rather than throwing', () => {
    expect(wireToBands([0, 300, 500, 3, 250])).toEqual([{ band: 0, minX: 300, maxX: 500 }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run shared/__tests__/bandEnvelope.test.ts`
Expected: FAIL — cannot resolve `../heapPolygon/bandEnvelope`.

- [ ] **Step 3: Write the implementation**

```ts
// shared/heapPolygon/bandEnvelope.ts
//
// The band envelope is the heap's authoritative shape: for each 20px horizontal
// band, the leftmost and rightmost x. This is exactly what the client renders
// (reconstructPolygonFromPoints buckets to the same resolution and keeps the same
// two extents per band), which is why simplifying to it is visually lossless.
//
// One predicate — "is this vertex the min-x or max-x of its band?" — serves as
// the placement containment test, the rollup simplification rule, and the render
// model.

import type { Vertex } from '../heapTypes';

/** Band height in world px. MUST equal the client's render resolution
 *  (CHUNK_BAND_HEIGHT / 25 = 500 / 25). The losslessness guarantee depends on it. */
export const BAND_SIZE_PX = 20;

export type BandRow = { band: number; minX: number; maxX: number };

/** band index -> horizontal extents. Sparse: absent bands are genuinely empty. */
export type BandEnvelope = Map<number, { minX: number; maxX: number }>;

export function bandOf(y: number): number {
  return Math.floor(y / BAND_SIZE_PX);
}

/** The y the client emits every vertex of a band at. */
export function bandMidY(band: number): number {
  return band * BAND_SIZE_PX + BAND_SIZE_PX / 2;
}

export function verticesToEnvelope(vertices: Vertex[]): BandEnvelope {
  const env: BandEnvelope = new Map();
  for (const v of vertices) {
    const band = bandOf(v.y);
    const cur = env.get(band);
    if (!cur) {
      env.set(band, { minX: v.x, maxX: v.x });
    } else {
      if (v.x < cur.minX) cur.minX = v.x;
      if (v.x > cur.maxX) cur.maxX = v.x;
    }
  }
  return env;
}

/**
 * Materialise an envelope back into the point set the renderer consumes.
 * Emits at band-mid-y, ascending by band, ALWAYS both extents (even when equal),
 * and nothing at all for absent bands so the client's forward-fill still runs.
 * Feed the output to reconstructPolygonFromPoints — do not build edges from it
 * directly.
 *
 * Both extents always, because reconstructPolygonFromPoints opens with
 * `if (points.length < 2) return []`: a single-band heap materialised to one
 * vertex would render as nothing while its original points rendered as a
 * (zero-area) ring. The client's single-point-band rule still triggers, since it
 * keys on bandMinX === bandMaxX, which a duplicate preserves.
 */
export function envelopeToVertices(env: BandEnvelope): Vertex[] {
  const out: Vertex[] = [];
  for (const band of [...env.keys()].sort((a, b) => a - b)) {
    const { minX, maxX } = env.get(band)!;
    const y = bandMidY(band);
    out.push({ x: minX, y });
    out.push({ x: maxX, y });
  }
  return out;
}

/**
 * The containment test. True when (x, y) would widen its band — i.e. the vertex
 * is visible. A point at or inside the extents cannot change the silhouette, so
 * storing it would cost CPU and egress forever and render nothing.
 */
export function extendsEnvelope(env: BandEnvelope, x: number, y: number): boolean {
  const cur = env.get(bandOf(y));
  if (!cur) return true;
  return x < cur.minX || x > cur.maxX;
}

/** Apply rows to an envelope with MIN/MAX. Conflict-free and idempotent. */
export function mergeBands(env: BandEnvelope, rows: BandRow[]): BandEnvelope {
  const out: BandEnvelope = new Map(env);
  for (const r of rows) {
    const cur = out.get(r.band);
    if (!cur) {
      out.set(r.band, { minX: r.minX, maxX: r.maxX });
    } else {
      out.set(r.band, {
        minX: Math.min(cur.minX, r.minX),
        maxX: Math.max(cur.maxX, r.maxX),
      });
    }
  }
  return out;
}

export function envelopeToRows(env: BandEnvelope): BandRow[] {
  return [...env.keys()]
    .sort((a, b) => a - b)
    .map((band) => ({ band, ...env.get(band)! }));
}

/** Flat numeric triples — [band, minX, maxX, ...]. Object keys would roughly
 *  triple a payload whose size this work exists to reduce. */
export function bandsToWire(rows: BandRow[]): number[] {
  const out: number[] = [];
  for (const r of rows) out.push(r.band, r.minX, r.maxX);
  return out;
}

export function wireToBands(wire: number[]): BandRow[] {
  const out: BandRow[] = [];
  for (let i = 0; i + 2 < wire.length; i += 3) {
    out.push({ band: wire[i], minX: wire[i + 1], maxX: wire[i + 2] });
  }
  return out;
}
```

Then add to `shared/heapPolygon/index.ts`:

```ts
export * from './bandEnvelope';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run shared/__tests__/bandEnvelope.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add shared/heapPolygon/bandEnvelope.ts shared/heapPolygon/index.ts shared/__tests__/bandEnvelope.test.ts
git commit -m "feat(shared): band envelope module — the heap's authoritative shape"
```

---

### Task 2: Prove losslessness against the real renderer, and share the constant

This is the load-bearing task. The entire "no player sees any change" claim rests on the property test below. It has so far been verified only on synthetic data in a throwaway script.

**Files:**
- Modify: `src/systems/HeapPolygonLoader.ts:106-109`
- Test: `src/systems/__tests__/bandEnvelopeLossless.test.ts`

**Interfaces:**
- Consumes: `BAND_SIZE_PX`, `verticesToEnvelope`, `envelopeToVertices` (Task 1); `reconstructPolygonFromPoints` (existing).
- Produces: nothing new — this task locks in a guarantee.

- [ ] **Step 1: Write the failing property test**

```ts
// src/systems/__tests__/bandEnvelopeLossless.test.ts
//
// THE guarantee: reducing a heap's point set to its band envelope must not change
// a single rendered pixel. If this test fails, the whole design's "no visual
// change" promise is void — do not paper over it.

import { describe, it, expect } from 'vitest';
import { reconstructPolygonFromPoints } from '../HeapPolygonLoader';
import { verticesToEnvelope, envelopeToVertices } from '../../../shared/heapPolygon/bandEnvelope';
import type { Vertex } from '../../../shared/heapTypes';

/** Deterministic RNG so a failure is reproducible from the seed alone. */
function rng(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

/** A heap-shaped point cloud: silhouette skeleton plus scattered placements and
 *  ghost points, mirroring how /place actually accumulates vertices. */
function heapPoints(seed: number, count: number): Vertex[] {
  const rnd = rng(seed);
  const topY = 47115, botY = 50000;
  const pts: Vertex[] = [];
  for (let y = topY; y <= botY; y += 20) {
    const t = (y - topY) / (botY - topY);
    const halfW = 60 + t * 380;
    pts.push({ x: 480 - halfW, y }, { x: 480 + halfW, y });
  }
  for (let i = 0; i < count; i++) {
    const y = topY + rnd() * (botY - topY);
    const t = (y - topY) / (botY - topY);
    const halfW = 60 + t * 380;
    pts.push({ x: Math.max(120, Math.min(840, 480 + (rnd() * 2 - 1) * halfW)), y });
    const a = pts[Math.floor(rnd() * pts.length)];
    pts.push({
      x: Math.max(120, Math.min(840, a.x + (rnd() * 2 - 1) * 40)),
      y: Math.max(topY, Math.min(botY, a.y + (rnd() * 2 - 1) * 40)),
    });
  }
  return pts;
}

describe('band envelope losslessness', () => {
  it('renders identically for 200 random heaps', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const pts = heapPoints(seed, 300);
      const direct = reconstructPolygonFromPoints(pts);
      const viaEnvelope = reconstructPolygonFromPoints(envelopeToVertices(verticesToEnvelope(pts)));
      expect(viaEnvelope, `seed ${seed}`).toEqual(direct);
    }
  });

  it('renders identically for degenerate inputs', () => {
    const cases: Vertex[][] = [
      [],                                                   // empty
      [{ x: 400, y: 100 }],                                 // single point
      [{ x: 400, y: 100 }, { x: 400, y: 105 }],             // one band, equal x
      [{ x: 300, y: 100 }, { x: 500, y: 100 }],             // one band, two extents
      [{ x: 300, y: 100 }, { x: 500, y: 900 }],             // large gap, forward-fill
      [{ x: 300, y: 0 }, { x: 500, y: 19.999 }],            // band boundary
    ];
    for (const [i, pts] of cases.entries()) {
      const direct = reconstructPolygonFromPoints(pts);
      const viaEnvelope = reconstructPolygonFromPoints(envelopeToVertices(verticesToEnvelope(pts)));
      expect(viaEnvelope, `case ${i}`).toEqual(direct);
    }
  });

  it('bounds the point count by band coverage, not by placement count', () => {
    const few = envelopeToVertices(verticesToEnvelope(heapPoints(1, 100)));
    const many = envelopeToVertices(verticesToEnvelope(heapPoints(1, 5000)));
    expect(many.length).toBeLessThanOrEqual(2 * Math.ceil((50000 - 47115) / 20) + 2);
    expect(many.length).toBeLessThan(few.length * 3);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/systems/__tests__/bandEnvelopeLossless.test.ts`
Expected: FAIL — module `bandEnvelope` not resolvable from `src/` yet, or assertion failures if Task 1's paths differ. Fix the import path, not the assertions.

- [ ] **Step 3: Make the client derive its band size from the shared constant**

In `src/systems/HeapPolygonLoader.ts`, replace lines 106-109:

```ts
  // Smaller band = more shape detail. CHUNK_BAND_HEIGHT/10 = 50px is a good default.
  // Decrease (e.g. /20 = 25px) for more fidelity; increase (e.g. /5 = 100px) for smoother silhouette.
  const bandSize = CHUNK_BAND_HEIGHT / 25;
```

with:

```ts
  // Band height is shared with the server (server stores the envelope at exactly
  // this resolution), so it must come from one constant. Changing it changes the
  // stored shape of every heap — see the band envelope design doc.
  const bandSize = BAND_SIZE_PX;
```

and add the import at the top of the file:

```ts
import { BAND_SIZE_PX } from '../../shared/heapPolygon/bandEnvelope';
```

If `CHUNK_BAND_HEIGHT` is now unused in this file, leave the import alone only if other code in the file uses it — `applyPolygonToGenerator` does, so it stays.

- [ ] **Step 4: Run the property test and the full suite**

Run: `npx vitest run src/systems/__tests__/bandEnvelopeLossless.test.ts`
Expected: PASS — all 200 seeds and all degenerate cases.

Run: `npm test`
Expected: PASS. `bandSize` is numerically unchanged (500/25 = 20 = `BAND_SIZE_PX`), so no existing snapshot or geometry test should move. **If any existing test changes, stop** — that means the constant is not actually equal and the whole plan's premise is wrong.

- [ ] **Step 5: Commit**

```bash
git add src/systems/HeapPolygonLoader.ts src/systems/__tests__/bandEnvelopeLossless.test.ts
git commit -m "test(client): prove band-envelope losslessness; share BAND_SIZE_PX"
```

---

### Task 3: `heap_band` table and pure-SQL backfill

**Files:**
- Create: `server/migrations/heap_core/0004_heap_band.sql`
- Modify: `server/schema/heap_core.sql`

**Interfaces:**
- Consumes: existing `heap.live_zone`, `heap_base.vertices` JSON blobs.
- Produces: `heap_band(heap_id, band, min_x, max_x, version)` populated for every existing heap.

- [ ] **Step 1: Write the migration**

```sql
-- server/migrations/heap_core/0004_heap_band.sql
--
-- The band envelope becomes the heap's authoritative shape: for each 20px band,
-- the leftmost and rightmost x. Backfilled from the existing live_zone and base
-- vertex blobs, which is lossless — the client already renders only these two
-- extents per band.

CREATE TABLE IF NOT EXISTS heap_band (
  heap_id TEXT    NOT NULL,
  band    INTEGER NOT NULL,
  min_x   REAL    NOT NULL,
  max_x   REAL    NOT NULL,
  version INTEGER NOT NULL,
  PRIMARY KEY (heap_id, band)
);

-- Deltas select bands changed since a client's version.
CREATE INDEX IF NOT EXISTS idx_heap_band_version ON heap_band(heap_id, version);

-- Backfill from the live zone. json_each unnests the blob; y/20 truncates to the
-- band (y is validated non-negative, so truncation == floor).
--
-- MIN/MAX on conflict, NOT "DO NOTHING": base and live-zone vertices can share a
-- band at the freeze boundary, and DO NOTHING would keep whichever array was
-- inserted first and silently discard the other's extent — a wrong envelope on
-- exactly the bands where the two arrays meet.
INSERT INTO heap_band (heap_id, band, min_x, max_x, version)
SELECT h.id,
       CAST(json_extract(v.value, '$.y') / 20 AS INTEGER),
       MIN(json_extract(v.value, '$.x')),
       MAX(json_extract(v.value, '$.x')),
       h.version
FROM heap h, json_each(h.live_zone) v
GROUP BY h.id, CAST(json_extract(v.value, '$.y') / 20 AS INTEGER)
ON CONFLICT(heap_id, band) DO UPDATE SET
  min_x = MIN(min_x, excluded.min_x),
  max_x = MAX(max_x, excluded.max_x);

-- Backfill from the base the heap currently points at.
INSERT INTO heap_band (heap_id, band, min_x, max_x, version)
SELECT h.id,
       CAST(json_extract(v.value, '$.y') / 20 AS INTEGER),
       MIN(json_extract(v.value, '$.x')),
       MAX(json_extract(v.value, '$.x')),
       h.version
FROM heap h
JOIN heap_base b ON b.id = h.base_id, json_each(b.vertices) v
GROUP BY h.id, CAST(json_extract(v.value, '$.y') / 20 AS INTEGER)
ON CONFLICT(heap_id, band) DO UPDATE SET
  min_x = MIN(min_x, excluded.min_x),
  max_x = MAX(max_x, excluded.max_x);
```

- [ ] **Step 2: Mirror it into the fresh-install schema**

Append the `CREATE TABLE heap_band` and `CREATE INDEX idx_heap_band_version` statements (not the backfill — a fresh install has no rows) to `server/schema/heap_core.sql`.

- [ ] **Step 3: Apply locally and verify the backfill is correct**

```bash
cd server && npx wrangler d1 migrations apply heap_core --local
```

Then seed and check that the envelope matches the blob:

```bash
cd .. && npm run seed
cd server && npx wrangler d1 execute heap_core --local --command \
  "SELECT heap_id, COUNT(*) AS bands, MIN(band) AS lo, MAX(band) AS hi FROM heap_band GROUP BY heap_id;"
```

Expected: one row per seeded heap, `bands` far smaller than the heap's vertex count, `lo`/`hi` bracketing the heap's y-range divided by 20.

- [ ] **Step 4: Verify idempotency**

Re-run the two `INSERT ... SELECT` statements by hand via `wrangler d1 execute`. Expected: identical `min_x`/`max_x` afterwards — `MIN`/`MAX` are idempotent, so a re-run is a no-op. Confirm with the same aggregate query.

- [ ] **Step 5: Commit**

```bash
git add server/migrations/heap_core/0004_heap_band.sql server/schema/heap_core.sql
git commit -m "feat(server): heap_band table + lossless backfill from vertex blobs"
```

---

### Task 4: Band methods on all three repository flavours

**Files:**
- Modify: `server/src/db.ts` (`HeapDB` interface + `D1HeapDB`)
- Modify: `server/tests/helpers/mockDb.ts` (`MockHeapDB`)
- Modify: `server/src/cache/CachedHeapDB.ts`
- Test: `server/tests/bandDb.test.ts`

**Interfaces:**
- Consumes: `BandRow` (Task 1).
- Produces, on `HeapDB`:
  - `getBand(heapId: string, band: number): Promise<BandRow | null>`
  - `getAllBands(heapId: string): Promise<BandRow[]>`
  - `getBandsSince(heapId: string, version: number): Promise<BandRow[]>`
  - `getMaxBand(heapId: string): Promise<number | null>`
  - `upsertBands(heapId: string, rows: BandRow[], version: number): Promise<void>`

- [ ] **Step 1: Write the failing tests**

```ts
// server/tests/bandDb.test.ts
import { describe, it, expect } from 'vitest';
import { MockHeapDB } from './helpers/mockDb';

async function seeded() {
  const db = new MockHeapDB();
  await db.createHeap('h1', 'b1', [{ x: 400, y: 100 }], 'hash', new Date().toISOString());
  return db;
}

describe('HeapDB band methods', () => {
  it('returns null for an absent band and the row for a present one', async () => {
    const db = await seeded();
    expect(await db.getBand('h1', 5)).toBeNull();
    await db.upsertBands('h1', [{ band: 5, minX: 300, maxX: 500 }], 2);
    expect(await db.getBand('h1', 5)).toEqual({ band: 5, minX: 300, maxX: 500 });
  });

  it('widens with MIN/MAX instead of replacing', async () => {
    const db = await seeded();
    await db.upsertBands('h1', [{ band: 5, minX: 300, maxX: 500 }], 2);
    await db.upsertBands('h1', [{ band: 5, minX: 400, maxX: 600 }], 3);
    expect(await db.getBand('h1', 5)).toEqual({ band: 5, minX: 300, maxX: 600 });
  });

  it('is conflict-free — two writers in the same band both land', async () => {
    const db = await seeded();
    await Promise.all([
      db.upsertBands('h1', [{ band: 5, minX: 200, maxX: 400 }], 2),
      db.upsertBands('h1', [{ band: 5, minX: 450, maxX: 700 }], 3),
    ]);
    expect(await db.getBand('h1', 5)).toEqual({ band: 5, minX: 200, maxX: 700 });
  });

  it('lists all bands ascending', async () => {
    const db = await seeded();
    await db.upsertBands('h1', [{ band: 9, minX: 1, maxX: 2 }, { band: 3, minX: 3, maxX: 4 }], 2);
    expect((await db.getAllBands('h1')).map((r) => r.band)).toEqual([3, 9]);
  });

  it('selects only bands changed strictly after a version', async () => {
    const db = await seeded();
    await db.upsertBands('h1', [{ band: 1, minX: 1, maxX: 2 }], 5);
    await db.upsertBands('h1', [{ band: 2, minX: 3, maxX: 4 }], 6);
    expect((await db.getBandsSince('h1', 5)).map((r) => r.band)).toEqual([2]);
    expect((await db.getBandsSince('h1', 4)).map((r) => r.band)).toEqual([1, 2]);
    expect(await db.getBandsSince('h1', 6)).toEqual([]);
  });

  it('reports the highest occupied band, or null when there are none', async () => {
    const db = await seeded();
    expect(await db.getMaxBand('h1')).toBeNull();
    await db.upsertBands('h1', [{ band: 4, minX: 1, maxX: 2 }, { band: 11, minX: 3, maxX: 4 }], 2);
    expect(await db.getMaxBand('h1')).toBe(11);
  });

  it('scopes bands per heap', async () => {
    const db = await seeded();
    await db.createHeap('h2', 'b2', [{ x: 400, y: 100 }], 'hash', new Date().toISOString());
    await db.upsertBands('h1', [{ band: 1, minX: 1, maxX: 2 }], 2);
    expect(await db.getAllBands('h2')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run server/tests/bandDb.test.ts`
Expected: FAIL — `db.upsertBands is not a function`.

- [ ] **Step 3: Add the methods to the `HeapDB` interface and `D1HeapDB`**

In `server/src/db.ts`, import `BandRow` and add to the `HeapDB` interface:

```ts
  /** One band's extents, or null when the band is empty. Point read on the PK. */
  getBand(heapId: string, band: number): Promise<BandRow | null>;
  /** Every band of a heap, ascending. Used to materialise the full envelope. */
  getAllBands(heapId: string): Promise<BandRow[]>;
  /** Bands whose last change is strictly newer than `version`, ascending. */
  getBandsSince(heapId: string, version: number): Promise<BandRow[]>;
  /** Highest occupied band, or null when the heap has none. O(log n) off the PK. */
  getMaxBand(heapId: string): Promise<number | null>;
  /**
   * Widen bands with MIN/MAX and stamp them with `version`. Conflict-free: two
   * concurrent callers targeting the same band both apply, so this needs no CAS.
   */
  upsertBands(heapId: string, rows: BandRow[], version: number): Promise<void>;
```

And implement on `D1HeapDB`:

```ts
  async getBand(heapId: string, band: number): Promise<BandRow | null> {
    const row = await this.d1
      .prepare('SELECT band, min_x, max_x FROM heap_band WHERE heap_id = ?1 AND band = ?2')
      .bind(heapId, band)
      .first<{ band: number; min_x: number; max_x: number }>();
    return row ? { band: row.band, minX: row.min_x, maxX: row.max_x } : null;
  }

  async getAllBands(heapId: string): Promise<BandRow[]> {
    const res = await this.d1
      .prepare('SELECT band, min_x, max_x FROM heap_band WHERE heap_id = ?1 ORDER BY band')
      .bind(heapId)
      .all<{ band: number; min_x: number; max_x: number }>();
    return res.results.map((r) => ({ band: r.band, minX: r.min_x, maxX: r.max_x }));
  }

  async getBandsSince(heapId: string, version: number): Promise<BandRow[]> {
    const res = await this.d1
      .prepare('SELECT band, min_x, max_x FROM heap_band WHERE heap_id = ?1 AND version > ?2 ORDER BY band')
      .bind(heapId, version)
      .all<{ band: number; min_x: number; max_x: number }>();
    return res.results.map((r) => ({ band: r.band, minX: r.min_x, maxX: r.max_x }));
  }

  async getMaxBand(heapId: string): Promise<number | null> {
    const row = await this.d1
      .prepare('SELECT MAX(band) AS m FROM heap_band WHERE heap_id = ?1')
      .bind(heapId)
      .first<{ m: number | null }>();
    return row?.m ?? null;
  }

  async upsertBands(heapId: string, rows: BandRow[], version: number): Promise<void> {
    if (rows.length === 0) return;
    await this.d1.batch(
      rows.map((r) =>
        this.d1
          .prepare(
            `INSERT INTO heap_band (heap_id, band, min_x, max_x, version)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(heap_id, band) DO UPDATE SET
               min_x   = MIN(min_x, excluded.min_x),
               max_x   = MAX(max_x, excluded.max_x),
               version = excluded.version`,
          )
          .bind(heapId, r.band, r.minX, r.maxX, version),
      ),
    );
  }
```

- [ ] **Step 4: Add the same methods to `MockHeapDB`**

In `server/tests/helpers/mockDb.ts`, add a store and the five methods. Keep the `MIN`/`MAX` semantics identical to D1 or the tests lie:

```ts
  private bands = new Map<string, Map<number, { minX: number; maxX: number; version: number }>>();

  async getBand(heapId: string, band: number): Promise<BandRow | null> {
    const cur = this.bands.get(heapId)?.get(band);
    return cur ? { band, minX: cur.minX, maxX: cur.maxX } : null;
  }

  async getAllBands(heapId: string): Promise<BandRow[]> {
    const m = this.bands.get(heapId);
    if (!m) return [];
    return [...m.keys()].sort((a, b) => a - b).map((band) => ({
      band, minX: m.get(band)!.minX, maxX: m.get(band)!.maxX,
    }));
  }

  async getBandsSince(heapId: string, version: number): Promise<BandRow[]> {
    const m = this.bands.get(heapId);
    if (!m) return [];
    return [...m.entries()]
      .filter(([, v]) => v.version > version)
      .sort((a, b) => a[0] - b[0])
      .map(([band, v]) => ({ band, minX: v.minX, maxX: v.maxX }));
  }

  async getMaxBand(heapId: string): Promise<number | null> {
    const m = this.bands.get(heapId);
    if (!m || m.size === 0) return null;
    return Math.max(...m.keys());
  }

  async upsertBands(heapId: string, rows: BandRow[], version: number): Promise<void> {
    let m = this.bands.get(heapId);
    if (!m) { m = new Map(); this.bands.set(heapId, m); }
    for (const r of rows) {
      const cur = m.get(r.band);
      m.set(r.band, cur
        ? { minX: Math.min(cur.minX, r.minX), maxX: Math.max(cur.maxX, r.maxX), version }
        : { minX: r.minX, maxX: r.maxX, version });
    }
  }
```

- [ ] **Step 5: Add pass-throughs to `CachedHeapDB`**

Read `server/src/cache/CachedHeapDB.ts` first and follow its existing decorator style. For this task the band methods are **plain delegations** to the inner DB with no caching — caching them correctly is Task 11, which has to keep the heap row and its bands consistent as one unit. Add a comment saying exactly that so a later reader does not "helpfully" cache them in isolation:

```ts
  // Bands are deliberately uncached here. The delta protocol requires that the
  // version returned to a client never exceeds the bands it was sent alongside;
  // caching bands independently of the heap row would inflate that watermark and
  // silently lose bands forever. Task 11 caches the two together.
  getBand(heapId: string, band: number) { return this.inner.getBand(heapId, band); }
  getAllBands(heapId: string) { return this.inner.getAllBands(heapId); }
  getBandsSince(heapId: string, version: number) { return this.inner.getBandsSince(heapId, version); }
  getMaxBand(heapId: string) { return this.inner.getMaxBand(heapId); }
  upsertBands(heapId: string, rows: BandRow[], version: number) { return this.inner.upsertBands(heapId, rows, version); }
```

- [ ] **Step 6: Run tests and build**

Run: `npx vitest run server/tests/bandDb.test.ts && npm test && npm run build`
Expected: PASS. The build is what catches a missing method on one of the three flavours.

- [ ] **Step 7: Commit**

```bash
git add server/src/db.ts server/tests/helpers/mockDb.ts server/src/cache/CachedHeapDB.ts server/tests/bandDb.test.ts
git commit -m "feat(server): band repository methods across D1/Mock/Cached"
```

---

### Task 5: `/place` uses envelope containment

The CPU fix. The ray cast and the live-zone scan both go; the blob write and CAS stay until Phase 2.

**Files:**
- Modify: `server/src/routes/heap.ts:477-517` (live-zone parse, `liveZoneBottomY`, `isPointInside`, splice inserts)
- Test: `server/tests/placeEnvelope.test.ts`

**Interfaces:**
- Consumes: `extendsEnvelope`, `bandOf`, `verticesToEnvelope`, `BandRow` (Task 1); `getBand`, `getMaxBand`, `upsertBands` (Task 4).
- Produces: no API change. `PlaceResponse` is unchanged.

- [ ] **Step 1: Write the failing tests**

```ts
// server/tests/placeEnvelope.test.ts
//
// /place accepts a placement only when it widens its 20px band — the same
// predicate the client renders by. Replaces the whole-polygon ray cast, which
// tested a y-sorted zigzag ring that did not describe the rendered shape.

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { DEFAULT_HEAP_PARAMS, type PlaceResponse } from '../../shared/heapTypes';

const NOW = new Date().toISOString();

async function heapWith(bands: { band: number; minX: number; maxX: number }[], topY = 47000) {
  const db = new MockHeapDB();
  await db.createHeap('h1', 'b1', [{ x: 480, y: 50000 }], 'hash', NOW, {
    ...DEFAULT_HEAP_PARAMS,
    worldHeight: 50000,
    ghostPointCount: 0,   // isolate the placement from ghost noise
  });
  await db.updateHeap('h1', 'b1', 1, [], 0, topY);
  if (bands.length) await db.upsertBands('h1', bands, 1);
  return db;
}

function place(db: MockHeapDB, body: unknown) {
  return createApp(db, new MockScoreDB()).request('/heaps/h1/place', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /heaps/:id/place — envelope containment', () => {
  it('accepts a placement that widens its band to the left', async () => {
    const db = await heapWith([{ band: 2350, minX: 400, maxX: 500 }]);
    const res = await place(db, { x: 399, y: 47010 });
    expect(((await res.json()) as PlaceResponse).accepted).toBe(true);
  });

  it('accepts a placement that widens its band to the right', async () => {
    const db = await heapWith([{ band: 2350, minX: 400, maxX: 500 }]);
    const res = await place(db, { x: 501, y: 47010 });
    expect(((await res.json()) as PlaceResponse).accepted).toBe(true);
  });

  it('rejects a placement strictly inside its band extents', async () => {
    const db = await heapWith([{ band: 2350, minX: 400, maxX: 500 }]);
    const res = await place(db, { x: 450, y: 47010 });
    expect(((await res.json()) as PlaceResponse).accepted).toBe(false);
  });

  it('rejects a placement exactly on an extent', async () => {
    const db = await heapWith([{ band: 2350, minX: 400, maxX: 500 }]);
    const res = await place(db, { x: 400, y: 47010 });
    expect(((await res.json()) as PlaceResponse).accepted).toBe(false);
  });

  it('accepts into an empty band', async () => {
    const db = await heapWith([{ band: 2350, minX: 400, maxX: 500 }]);
    const res = await place(db, { x: 450, y: 47030 }); // band 2351
    expect(((await res.json()) as PlaceResponse).accepted).toBe(true);
  });

  it('persists the accepted placement into its band', async () => {
    const db = await heapWith([{ band: 2350, minX: 400, maxX: 500 }]);
    await place(db, { x: 380, y: 47010 });
    expect(await db.getBand('h1', 2350)).toEqual({ band: 2350, minX: 380, maxX: 500 });
  });

  it('does not widen the band for a rejected placement', async () => {
    const db = await heapWith([{ band: 2350, minX: 400, maxX: 500 }]);
    await place(db, { x: 450, y: 47010 });
    expect(await db.getBand('h1', 2350)).toEqual({ band: 2350, minX: 400, maxX: 500 });
  });

  it('gates on the active zone using band granularity', async () => {
    // Highest occupied band is 2350, so liveZoneBottomY = (2350 + 1) * 20 = 47020.
    const db = await heapWith([{ band: 2350, minX: 400, maxX: 500 }]);
    const inZone = await place(db, { x: 380, y: 47019 });
    expect(inZone.status).toBe(200);
    const belowZone = await place(db, { x: 380, y: 47021 });
    expect(belowZone.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run server/tests/placeEnvelope.test.ts`
Expected: FAIL — placements are judged by the old ray cast, so the "rejects strictly inside" and band-persistence cases fail.

- [ ] **Step 3: Replace the containment block**

In `server/src/routes/heap.ts`, replace the live-zone parse, `liveZoneBottomY` computation, `isPointInside` check and the two splice-insert blocks (currently lines 477-531) with:

```ts
      // Active-zone floor from band granularity: the bottom edge of the highest
      // occupied band. Replaces a scan over every live-zone vertex. Costs an
      // O(log n) probe off the (heap_id, band) primary key.
      const maxBand = await db.getMaxBand(id);
      const liveZoneBottomY = maxBand !== null
        ? (maxBand + 1) * BAND_SIZE_PX
        : row.top_y + HEAP_TOP_ZONE_PX;
      if (y > liveZoneBottomY) {
        console.warn(`[place] reject: y below active zone (${y} > liveZoneBottomY=${liveZoneBottomY}) heapId=${id}`);
        const sink = getSink();
        if (sink) {
          await captureServer(sink, 'warn', 'place:rejected', { reason: 'y below active zone', heapId: id, y, liveZoneBottomY });
        }
        return c.json({ error: 'invalid placement' }, 400);
      }
```

Keep the write-auth block exactly where it is — after every bounds check, so a doomed request never claims a `playerGuid`.

Then the containment test and the candidate set:

```ts
      // Containment: a placement counts only if it widens its band. A point at or
      // inside the extents cannot change the silhouette the client renders, so
      // storing it would cost CPU and egress forever and draw nothing.
      const band = bandOf(y);
      const existing = await db.getBand(id, band);
      const bandEnv: BandEnvelope = new Map(
        existing ? [[existing.band, { minX: existing.minX, maxX: existing.maxX }]] : [],
      );

      if (!extendsEnvelope(bandEnv, x, y)) {
        return c.json({ accepted: false, version: row.version } satisfies PlaceResponse);
      }

      // Candidate vertices: the placement plus its ghost points. Ghosts that do
      // not widen a band are dropped by the same MIN/MAX upsert — the same
      // judgement as rejecting a placement.
      const candidates: Vertex[] = [{ x, y }];
      const ghostCount = Math.max(0, Math.floor(row.ghost_point_count ?? 1));
      for (let i = 0; i < ghostCount; i++) {
        const anchor = candidates[Math.floor(Math.random() * candidates.length)];
        const dx = (Math.random() * 2 - 1) * GHOST_JITTER_RADIUS_PX;
        const dy = (Math.random() * 2 - 1) * GHOST_JITTER_RADIUS_PX;
        candidates.push({
          x: Math.max(PLACE_X_MIN, Math.min(PLACE_X_MAX, anchor.x + dx)),
          y: Math.max(row.top_y, Math.min(liveZoneBottomY, anchor.y + dy)),
        });
      }

      const bandRows: BandRow[] = envelopeToRows(verticesToEnvelope(candidates));
```

Immediately after the existing `updateHeap` CAS succeeds (i.e. after the `if (!applied) continue;` line), persist the bands:

```ts
      // Dual-write while the blob is still authoritative (Phase 1). Phase 2 makes
      // bands the source of truth and drops the blob write.
      await db.upsertBands(id, bandRows, newVersion);
```

The blob still needs the accepted vertices so the two representations agree. Keep the existing `liveZone` parse and splice-insert **only** for building the blob written by `updateHeap`, inserting every vertex in `candidates` Y-ascending exactly as before.

Add the imports:

```ts
import {
  BAND_SIZE_PX, bandOf, extendsEnvelope, verticesToEnvelope, envelopeToRows,
  type BandEnvelope, type BandRow,
} from '../../shared/heapPolygon/bandEnvelope';
```

`isPointInside` is now unused by this route. Leave the export in `server/src/polygon.ts` — `server/tests/polygon.test.ts` covers it and Phase 2 removes it.

- [ ] **Step 4: Run the new tests, then the whole suite**

Run: `npx vitest run server/tests/placeEnvelope.test.ts`
Expected: PASS.

Run: `npm test`
Expected: **`server/tests/placeCas.test.ts` and any test asserting the old ray-cast accept/reject will fail.** That is the intended behaviour change (spec: "adopt the silhouette model"). Update those tests to the envelope predicate; do not weaken the new tests to match the old behaviour. `placeCas.test.ts` should still pass on its actual subject — that a rival write does not clobber — since CAS is untouched in this task.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/heap.ts server/tests/placeEnvelope.test.ts server/tests/placeCas.test.ts
git commit -m "perf(server): band-envelope containment in /place, replacing the ray cast"
```

---

### Task 6: Dual-write equivalence guard

Proves the blob and the bands cannot drift while both are live.

**Files:**
- Test: `server/tests/bandBlobEquivalence.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1, 4, 5.
- Produces: nothing — a guard.

- [ ] **Step 1: Write the test**

```ts
// server/tests/bandBlobEquivalence.test.ts
//
// Phase 1 keeps the live_zone blob authoritative while dual-writing bands. If the
// two ever disagree, /place is judging placements against a shape that is not the
// one being served. This asserts they cannot.

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { DEFAULT_HEAP_PARAMS, type Vertex } from '../../shared/heapTypes';
import { verticesToEnvelope, envelopeToRows } from '../../shared/heapPolygon/bandEnvelope';

describe('band/blob equivalence under dual-write', () => {
  it('keeps the band envelope equal to the envelope of the blob', async () => {
    const db = new MockHeapDB();
    await db.createHeap('h1', 'b1', [{ x: 480, y: 50000 }], 'hash', new Date().toISOString(), {
      ...DEFAULT_HEAP_PARAMS, worldHeight: 50000, ghostPointCount: 2,
    });
    await db.updateHeap('h1', 'b1', 1, [], 0, 47000);

    const app = createApp(db, new MockScoreDB());
    for (let i = 0; i < 60; i++) {
      await app.request('/heaps/h1/place', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: 200 + ((i * 37) % 600), y: 47000 + (i % 15) }),
      });
    }

    const row = (await db.getHeap('h1'))!;
    const fromBlob = envelopeToRows(verticesToEnvelope(JSON.parse(row.live_zone) as Vertex[]));
    const fromBands = await db.getAllBands('h1');
    expect(fromBands).toEqual(fromBlob);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run server/tests/bandBlobEquivalence.test.ts`
Expected: PASS. **If it fails, the dual-write in Task 5 is wrong** — the blob and the bands are being fed different vertex sets. Fix Task 5, not this test.

- [ ] **Step 3: Commit**

```bash
git add server/tests/bandBlobEquivalence.test.ts
git commit -m "test(server): guard band/blob equivalence during dual-write"
```

- [ ] **Step 4: Measure — this is the phase's whole point**

Follow the `load-testing-heap` skill. Run both fixtures and read **CPU** per minute off the Cloudflare dashboard:

```bash
npm run loadtest -- -e PLACE_FIXTURE=large -e PLACEMENT_ITERATIONS=200 \
  -e PLACEMENT_VUS=1 -e PLACE_RATE=0 -e SESSIONS=50
# wait ~60s so the dashboard buckets separate, then repeat with =small
```

Baselines to beat (P50 / P90 / P99): small 2.8 / 3.8 / 5.6 ms, large 3.6 / 6.0 / **10.3** ms. The large-heap P99 must land clearly under 10ms. Record the numbers in `Todo/Todo.md` § PERF next to the existing table. Do not use latency — it cannot see this.

---

## Phase 2 — Bands authoritative, CAS removed

### Task 7: Lazy `live_zone` rebuild

**Files:**
- Create: `server/migrations/heap_core/0005_live_zone_version.sql`
- Modify: `server/schema/heap_core.sql`, `server/src/db.ts`, `server/tests/helpers/mockDb.ts`, `server/src/cache/CachedHeapDB.ts`, `server/src/routes/heap.ts`
- Test: `server/tests/liveZoneRebuild.test.ts`

**Interfaces:**
- Consumes: `getAllBands` (Task 4), `envelopeToVertices`, `mergeBands` (Task 1).
- Produces:
  - `HeapRow.live_zone_version: number`
  - `HeapDB.setLiveZoneBlob(heapId: string, liveZone: Vertex[], version: number): Promise<void>`
  - `materialiseLiveZone(db: HeapDB, row: HeapRow): Promise<Vertex[]>` in `server/src/routes/heap.ts`

- [ ] **Step 1: Write the migration and schema update**

```sql
-- server/migrations/heap_core/0005_live_zone_version.sql
--
-- live_zone becomes a derived cache of the band envelope, rebuilt on read rather
-- than rewritten on every placement — /place is the path under the 10ms CPU cap,
-- and GET is already absorbed by the KV layer for 60s. This column records which
-- heap version the blob was built from; when it lags, the blob is stale.
ALTER TABLE heap ADD COLUMN live_zone_version INTEGER NOT NULL DEFAULT 0;
```

Mirror the column into `server/schema/heap_core.sql`'s `heap` table definition.

- [ ] **Step 2: Write the failing test**

```ts
// server/tests/liveZoneRebuild.test.ts
import { describe, it, expect } from 'vitest';
import { MockHeapDB } from './helpers/mockDb';
import { materialiseLiveZone } from '../src/routes/heap';
import { DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';

async function heap() {
  const db = new MockHeapDB();
  await db.createHeap('h1', 'b1', [{ x: 480, y: 50000 }], 'h', new Date().toISOString(), {
    ...DEFAULT_HEAP_PARAMS, worldHeight: 50000,
  });
  return db;
}

describe('lazy live_zone rebuild', () => {
  it('rebuilds from bands when the blob version lags the heap version', async () => {
    const db = await heap();
    await db.upsertBands('h1', [{ band: 5, minX: 300, maxX: 500 }], 4);
    await db.updateHeap('h1', 'b1', 4, [], 0, 100);
    const row = (await db.getHeap('h1'))!;
    expect(await materialiseLiveZone(db, row)).toEqual([
      { x: 300, y: 110 }, { x: 500, y: 110 },
    ]);
  });

  it('stores the rebuilt blob so the next read is free', async () => {
    const db = await heap();
    await db.upsertBands('h1', [{ band: 5, minX: 300, maxX: 500 }], 4);
    await db.updateHeap('h1', 'b1', 4, [], 0, 100);
    await materialiseLiveZone(db, (await db.getHeap('h1'))!);
    const row = (await db.getHeap('h1'))!;
    expect(row.live_zone_version).toBe(4);
    expect(JSON.parse(row.live_zone)).toEqual([{ x: 300, y: 110 }, { x: 500, y: 110 }]);
  });

  it('serves the cached blob without rebuilding when versions match', async () => {
    const db = await heap();
    await db.setLiveZoneBlob('h1', [{ x: 1, y: 2 }], 7);
    await db.updateHeap('h1', 'b1', 7, [{ x: 1, y: 2 }], 0, 100);
    const row = { ...(await db.getHeap('h1'))!, live_zone_version: 7, version: 7 };
    expect(await materialiseLiveZone(db, row)).toEqual([{ x: 1, y: 2 }]);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run server/tests/liveZoneRebuild.test.ts`
Expected: FAIL — `materialiseLiveZone` is not exported.

- [ ] **Step 4: Implement**

Add `live_zone_version: number` to `HeapRow` in `server/src/db.ts`, include it in both `SELECT` lists, and add `setLiveZoneBlob` to the interface plus all three flavours:

```ts
  /** Store a rebuilt live_zone blob and the heap version it was built from. */
  setLiveZoneBlob(heapId: string, liveZone: Vertex[], version: number): Promise<void>;
```

`D1HeapDB`:

```ts
  async setLiveZoneBlob(heapId: string, liveZone: Vertex[], version: number): Promise<void> {
    await this.d1
      .prepare('UPDATE heap SET live_zone = ?1, live_zone_version = ?2 WHERE id = ?3')
      .bind(JSON.stringify(liveZone), version, heapId)
      .run();
  }
```

Export the materialiser from `server/src/routes/heap.ts`:

```ts
/**
 * The live_zone blob is a derived cache of the band envelope, kept for clients
 * on the `full` path that predate the band protocol. Rebuild it only when it
 * lags the heap version; writes never pay for it.
 */
export async function materialiseLiveZone(db: HeapDB, row: HeapRow): Promise<Vertex[]> {
  if (row.live_zone_version === row.version) {
    return JSON.parse(row.live_zone) as Vertex[];
  }
  const freezeBand = bandOf(row.freeze_y);
  const bands = (await db.getAllBands(row.id)).filter((b) => b.band >= freezeBand);
  const vertices = envelopeToVertices(mergeBands(new Map(), bands));
  await db.setLiveZoneBlob(row.id, vertices, row.version);
  return vertices;
}
```

In the `GET /:id` handler, replace `JSON.parse(row.live_zone)` with `await materialiseLiveZone(db, row)`.

- [ ] **Step 5: Apply the migration, run tests and build**

```bash
cd server && npx wrangler d1 migrations apply heap_core --local && cd ..
npx vitest run server/tests/liveZoneRebuild.test.ts && npm test && npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/migrations/heap_core/0005_live_zone_version.sql server/schema/heap_core.sql \
        server/src/db.ts server/tests/helpers/mockDb.ts server/src/cache/CachedHeapDB.ts \
        server/src/routes/heap.ts server/tests/liveZoneRebuild.test.ts
git commit -m "perf(server): rebuild live_zone lazily on read instead of per placement"
```

---

### Task 8: Drop the CAS retry loop

**Files:**
- Modify: `server/src/routes/heap.ts:441-573`
- Modify: `server/tests/placeCas.test.ts` (repurpose)
- Test: `server/tests/placeConcurrency.test.ts`

**Interfaces:**
- Consumes: `upsertBands` (Task 4).
- Produces:
  - `HeapDB.bumpVersion(heapId: string, topYCandidate: number): Promise<number>` — atomic increment returning the new version.

- [ ] **Step 1: Write the failing tests**

```ts
// server/tests/placeConcurrency.test.ts
//
// MIN/MAX band writes are conflict-free, so concurrent placements no longer race:
// there is no CAS, no retry loop, and no 409. Two placers in the same band both
// widen it; the result is indistinguishable from them arriving in sequence.

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { DEFAULT_HEAP_PARAMS, type PlaceResponse } from '../../shared/heapTypes';

async function heap(ghosts = 0) {
  const db = new MockHeapDB();
  await db.createHeap('h1', 'b1', [{ x: 480, y: 50000 }], 'h', new Date().toISOString(), {
    ...DEFAULT_HEAP_PARAMS, worldHeight: 50000, ghostPointCount: ghosts,
  });
  await db.updateHeap('h1', 'b1', 1, [], 0, 47000);
  await db.upsertBands('h1', [{ band: 2350, minX: 400, maxX: 500 }], 1);
  return db;
}

function place(db: MockHeapDB, body: unknown) {
  return createApp(db, new MockScoreDB()).request('/heaps/h1/place', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('POST /heaps/:id/place — concurrency without CAS', () => {
  it('applies both concurrent placements widening the same band', async () => {
    const db = await heap();
    const [a, b] = await Promise.all([
      place(db, { x: 350, y: 47010 }),
      place(db, { x: 550, y: 47010 }),
    ]);
    expect(((await a.json()) as PlaceResponse).accepted).toBe(true);
    expect(((await b.json()) as PlaceResponse).accepted).toBe(true);
    expect(await db.getBand('h1', 2350)).toEqual({ band: 2350, minX: 350, maxX: 550 });
  });

  it('never returns a version conflict', async () => {
    const db = await heap();
    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) => place(db, { x: 350 - i, y: 47010 })),
    );
    for (const r of results) expect(r.status).not.toBe(409);
  });

  it('increments the version once per accepted placement', async () => {
    const db = await heap();
    const before = (await db.getHeap('h1'))!.version;
    await Promise.all([
      place(db, { x: 350, y: 47010 }),
      place(db, { x: 550, y: 47010 }),
    ]);
    expect((await db.getHeap('h1'))!.version).toBe(before + 2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run server/tests/placeConcurrency.test.ts`
Expected: FAIL — the retry loop still serialises through CAS, so the version count or the merged band is wrong.

- [ ] **Step 3: Add `bumpVersion` to all three flavours**

`HeapDB` interface:

```ts
  /**
   * Atomically increment the heap version and lower top_y toward the summit,
   * returning the new version. Assigned inside the write, so version order
   * equals commit order — which is what makes a delta watermark sound.
   */
  bumpVersion(heapId: string, topYCandidate: number): Promise<number>;
```

`D1HeapDB`:

```ts
  async bumpVersion(heapId: string, topYCandidate: number): Promise<number> {
    const row = await this.d1
      .prepare('UPDATE heap SET version = version + 1, top_y = MIN(top_y, ?1) WHERE id = ?2 RETURNING version')
      .bind(topYCandidate, heapId)
      .first<{ version: number }>();
    if (!row) throw new Error(`bumpVersion: heap ${heapId} not found`);
    return row.version;
  }
```

`MockHeapDB`:

```ts
  async bumpVersion(heapId: string, topYCandidate: number): Promise<number> {
    const row = this.heaps.get(heapId);
    if (!row) throw new Error(`bumpVersion: heap ${heapId} not found`);
    row.version += 1;
    row.top_y = Math.min(row.top_y, topYCandidate);
    return row.version;
  }
```

`CachedHeapDB`: delegate, and invalidate the heap-row cache key exactly as `updateHeap` does.

- [ ] **Step 4: Replace the retry loop**

In `server/src/routes/heap.ts`, remove the `for (let attempt = 0; attempt < PLACE_MAX_ATTEMPTS; attempt++)` wrapper, the `PLACE_MAX_ATTEMPTS` constant, the `if (!applied) continue;` branch, the trailing "exhausted retries" 409 block, and the `authDone` flag (auth now runs once, unconditionally, in a straight-line handler). Replace `getHeapFresh` with `getHeap` **only** if no read-after-write correctness depends on it — it does not, now that containment reads the band row directly and the version is assigned inside the write. Keep `getHeapFresh` for the band read to avoid a stale extent letting a buried vertex through:

```ts
    const row = await db.getHeapFresh(id);
    if (!row) return c.json({ error: 'Heap not found' }, 404);

    // ... all bounds checks, then write-auth, then containment (Task 5) ...

    const newVersion = await db.bumpVersion(id, y);
    await db.upsertBands(id, bandRows, newVersion);

    const bonusCoins = y > row.top_y + OFF_PEAK_THRESHOLD_PX ? OFF_PEAK_BONUS_COINS : undefined;

    // ... contribution tick, unchanged ...

    return c.json({ accepted: true, version: newVersion, bonusCoins } satisfies PlaceResponse);
```

Delete the `updateHeap` call and the blob splice-insert from this handler — the blob is rebuilt lazily now (Task 7). Freeze moves to Task 9; until then, leave the `checkFreeze` call out of this handler and note it in the commit body.

- [ ] **Step 5: Repurpose `placeCas.test.ts`**

Its subject — the CAS loop — no longer exists. Replace its body with a single test asserting the new invariant, and rename the file to `server/tests/placeNoClobber.test.ts`:

```ts
// server/tests/placeNoClobber.test.ts
//
// Was placeCas.test.ts, covering the compare-and-swap retry loop (issue #82).
// MIN/MAX band writes made that loop unnecessary: a rival placement cannot clobber
// ours because neither replaces the other's extent. This asserts the property the
// CAS used to protect, without the CAS.
import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';

describe('POST /heaps/:id/place — no lost updates', () => {
  it('keeps a rival placement when ours lands in the same band', async () => {
    const db = new MockHeapDB();
    await db.createHeap('h1', 'b1', [{ x: 480, y: 50000 }], 'h', new Date().toISOString(), {
      ...DEFAULT_HEAP_PARAMS, worldHeight: 50000, ghostPointCount: 0,
    });
    await db.updateHeap('h1', 'b1', 1, [], 0, 47000);
    await db.upsertBands('h1', [{ band: 2350, minX: 400, maxX: 500 }], 1);

    const app = createApp(db, new MockScoreDB());
    const req = (x: number) => app.request('/heaps/h1/place', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x, y: 47010 }),
    });

    await req(300);                       // rival widens left
    await req(600);                       // ours widens right
    expect(await db.getBand('h1', 2350)).toEqual({ band: 2350, minX: 300, maxX: 600 });
  });
});
```

- [ ] **Step 6: Run tests and build**

Run: `npx vitest run server/tests/placeConcurrency.test.ts server/tests/placeNoClobber.test.ts && npm test && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git rm server/tests/placeCas.test.ts
git add server/src/routes/heap.ts server/src/db.ts server/tests/helpers/mockDb.ts \
        server/src/cache/CachedHeapDB.ts server/tests/placeConcurrency.test.ts \
        server/tests/placeNoClobber.test.ts
git commit -m "perf(server): drop the CAS retry loop — MIN/MAX band writes are conflict-free"
```

---

### Task 9: Freeze by band count

**Files:**
- Modify: `server/src/polygon.ts`, `server/src/routes/heap.ts`
- Test: `server/tests/freezeBands.test.ts`

**Interfaces:**
- Consumes: `getAllBands`, `getMaxBand` (Task 4); `bandOf`, `envelopeToVertices`, `mergeBands` (Task 1).
- Produces:
  - `LIVE_ZONE_MAX_BANDS = 77`, `FREEZE_BATCH_BANDS = 38` in `server/src/polygon.ts`
  - `checkFreezeBands(liveBands: BandRow[], freezeBand: number): { newFreezeBand: number; frozen: BandRow[] } | null`

- [ ] **Step 1: Write the failing tests**

```ts
// server/tests/freezeBands.test.ts
import { describe, it, expect } from 'vitest';
import { checkFreezeBands, LIVE_ZONE_MAX_BANDS, FREEZE_BATCH_BANDS } from '../src/polygon';
import type { BandRow } from '../../shared/heapPolygon/bandEnvelope';

function bands(from: number, count: number): BandRow[] {
  return Array.from({ length: count }, (_, i) => ({ band: from + i, minX: 400, maxX: 500 }));
}

describe('checkFreezeBands', () => {
  it('preserves the live-zone span the vertex limits used to imply', () => {
    expect(LIVE_ZONE_MAX_BANDS).toBe(77);
    expect(FREEZE_BATCH_BANDS).toBe(38);
  });

  it('does nothing below the band limit', () => {
    expect(checkFreezeBands(bands(2350, LIVE_ZONE_MAX_BANDS), 2350)).toBeNull();
  });

  it('freezes the bottom batch once over the limit', () => {
    const res = checkFreezeBands(bands(2350, LIVE_ZONE_MAX_BANDS + 1), 2350)!;
    expect(res.frozen).toHaveLength(FREEZE_BATCH_BANDS);
    // Bottom of the heap is the HIGHEST band (y grows downward).
    expect(res.frozen[0].band).toBe(2350 + LIVE_ZONE_MAX_BANDS + 1 - FREEZE_BATCH_BANDS);
    expect(res.newFreezeBand).toBe(res.frozen[0].band);
  });

  it('leaves the summit bands live', () => {
    const res = checkFreezeBands(bands(2350, LIVE_ZONE_MAX_BANDS + 1), 2350)!;
    expect(res.frozen.every((b) => b.band >= res.newFreezeBand)).toBe(true);
    expect(res.frozen.some((b) => b.band === 2350)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run server/tests/freezeBands.test.ts`
Expected: FAIL — `checkFreezeBands` is not exported.

- [ ] **Step 3: Implement in `server/src/polygon.ts`**

```ts
/**
 * Freeze limits as band counts. Chosen to preserve the live-zone span the old
 * vertex limits implied: the measured active band was ~1,533px, which is ~77
 * bands at BAND_SIZE_PX; FREEZE_BATCH_BANDS is half, mirroring 500/250.
 */
export const LIVE_ZONE_MAX_BANDS = 77;
export const FREEZE_BATCH_BANDS = 38;

/**
 * Once the live band count exceeds the limit, freeze the bottom batch — the
 * HIGHEST band indices, since y grows downward. Frozen bands are immutable:
 * placement is gated to y <= liveZoneBottomY, so nothing writes below the freeze
 * line again. Returns null when no freeze is due.
 */
export function checkFreezeBands(
  liveBands: BandRow[],
  freezeBand: number,
): { newFreezeBand: number; frozen: BandRow[] } | null {
  const live = liveBands.filter((b) => b.band >= freezeBand).sort((a, b) => a.band - b.band);
  if (live.length <= LIVE_ZONE_MAX_BANDS) return null;
  const frozen = live.slice(-FREEZE_BATCH_BANDS);
  return { newFreezeBand: frozen[0].band, frozen };
}
```

- [ ] **Step 4: Wire it into `/place`**

After `upsertBands`, run the freeze check. It must mint a new `baseId` — that is what invalidates the client's indefinitely-cached base blob:

```ts
    // Freeze: fold the bottom bands into the base. Minting a new baseId is
    // mandatory — loadCachedBase keys localStorage on baseId with no TTL, so a
    // stable id over changed base content strands every client on a stale base.
    const freezeBand = bandOf(row.freeze_y);
    const freeze = checkFreezeBands(await db.getAllBands(id), freezeBand);
    if (freeze) {
      const existingBase = (await db.getBaseVerticesById(row.base_id)) ?? [];
      const baseVertices = [
        ...existingBase,
        ...envelopeToVertices(mergeBands(new Map(), freeze.frozen)),
      ];
      const newBaseId = crypto.randomUUID();
      await db.createBase(newBaseId, id, baseVertices, hashVertices(baseVertices), new Date().toISOString());
      await db.setFreeze(id, newBaseId, freeze.newFreezeBand * BAND_SIZE_PX);
    }
```

Add `setFreeze(heapId, baseId, freezeY)` to `HeapDB` and all three flavours — a plain `UPDATE heap SET base_id = ?, freeze_y = ? WHERE id = ?` plus cache invalidation in the decorator.

- [ ] **Step 5: Run tests and build**

Run: `npx vitest run server/tests/freezeBands.test.ts && npm test && npm run build`
Expected: PASS.

- [ ] **Step 6: Remove the dead vertex-path code**

`isPointInside`, `checkFreeze`, `LIVE_ZONE_MAX` and `FREEZE_BATCH` now have no production callers. Delete them from `server/src/polygon.ts` and delete the parts of `server/tests/polygon.test.ts` that cover them. Keep `hashVertices` — the freeze path uses it.

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/polygon.ts server/src/routes/heap.ts server/src/db.ts \
        server/tests/helpers/mockDb.ts server/src/cache/CachedHeapDB.ts \
        server/tests/freezeBands.test.ts server/tests/polygon.test.ts
git commit -m "refactor(server): freeze by band count; drop the vertex ray-cast path"
```

---

## Phase 3 — Delta API

### Task 10: `mode: 'full' | 'delta'` responses

**Files:**
- Modify: `shared/heapTypes.ts:95-97`, `server/src/routes/heap.ts:273-310`, `src/systems/HeapClient.ts` (narrowing only)
- Test: `server/tests/heapDelta.test.ts`

**Interfaces:**
- Consumes: `getBandsSince`, `getAllBands` (Task 4); `bandsToWire` (Task 1); `materialiseLiveZone` (Task 7).
- Produces:
  - `GetHeapFullResponse`, `GetHeapDeltaResponse`, and the updated `GetHeapResponse` union.

- [ ] **Step 1: Write the failing tests**

```ts
// server/tests/heapDelta.test.ts
//
// A delta is only ever sent to a client that opted in by sending &baseId=.
// Installed clients never send it, so they always get `full` with the
// materialised liveZone in today's format.

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { DEFAULT_HEAP_PARAMS, type GetHeapResponse } from '../../shared/heapTypes';
import { wireToBands } from '../../shared/heapPolygon/bandEnvelope';

async function heap() {
  const db = new MockHeapDB();
  await db.createHeap('h1', 'b1', [{ x: 480, y: 50000 }], 'h', new Date().toISOString(), {
    ...DEFAULT_HEAP_PARAMS, worldHeight: 50000,
  });
  await db.updateHeap('h1', 'b1', 5, [], 0, 47000);
  await db.upsertBands('h1', [{ band: 2350, minX: 400, maxX: 500 }], 3);
  await db.upsertBands('h1', [{ band: 2351, minX: 300, maxX: 600 }], 5);
  return db;
}

const get = (db: MockHeapDB, q: string) =>
  createApp(db, new MockScoreDB()).request(`/heaps/h1${q}`);

describe('GET /heaps/:id — delta protocol', () => {
  it('sends full, with liveZone, to a client that did not opt in', async () => {
    const body = (await (await get(await heap(), '?version=0')).json()) as GetHeapResponse;
    expect(body).toMatchObject({ changed: true, mode: 'full' });
    if (body.changed && body.mode === 'full') {
      expect(Array.isArray(body.liveZone)).toBe(true);
      expect(wireToBands(body.bands).map((b) => b.band)).toEqual([2350, 2351]);
    }
  });

  it('sends full when the client baseId differs', async () => {
    const body = (await (await get(await heap(), '?version=5&baseId=stale')).json()) as GetHeapResponse;
    expect(body).toMatchObject({ changed: true, mode: 'full' });
  });

  it('sends changed:false when version and baseId both match', async () => {
    const body = (await (await get(await heap(), '?version=5&baseId=b1')).json()) as GetHeapResponse;
    expect(body).toEqual({ changed: false, version: 5 });
  });

  it('sends only bands newer than the client version', async () => {
    const body = (await (await get(await heap(), '?version=3&baseId=b1')).json()) as GetHeapResponse;
    expect(body).toMatchObject({ changed: true, mode: 'delta' });
    if (body.changed && body.mode === 'delta') {
      expect(wireToBands(body.bands)).toEqual([{ band: 2351, minX: 300, maxX: 600 }]);
      expect('liveZone' in body).toBe(false);
    }
  });

  it('sends every intervening band to a client several versions behind', async () => {
    const db = await heap();
    await db.upsertBands('h1', [{ band: 2352, minX: 200, maxX: 700 }], 6);
    await db.upsertBands('h1', [{ band: 2353, minX: 100, maxX: 800 }], 7);
    await db.updateHeap('h1', 'b1', 7, [], 0, 47000);
    const body = (await (await get(db, '?version=3&baseId=b1')).json()) as GetHeapResponse;
    if (body.changed && body.mode === 'delta') {
      expect(wireToBands(body.bands).map((b) => b.band)).toEqual([2351, 2352, 2353]);
    } else {
      throw new Error('expected a delta');
    }
  });

  it('falls back to full after a reset, because reset mints a new baseId', async () => {
    const db = await heap();
    await createApp(db, new MockScoreDB()).request('/heaps/h1/reset', { method: 'PUT' });
    const body = (await (await get(db, '?version=5&baseId=b1')).json()) as GetHeapResponse;
    expect(body).toMatchObject({ changed: true, mode: 'full' });
  });

  it('falls back to full after a freeze, because freeze mints a new baseId', async () => {
    const db = await heap();
    // Simulate what the freeze path does: new base row, heap repointed at it.
    await db.createBase('b2', 'h1', [{ x: 480, y: 50000 }], 'h2', new Date().toISOString());
    await db.setFreeze('h1', 'b2', 47000);
    const body = (await (await get(db, '?version=5&baseId=b1')).json()) as GetHeapResponse;
    expect(body).toMatchObject({ changed: true, mode: 'full', baseId: 'b2' });
  });

  it('returns concurrent writes to different bands in a single delta', async () => {
    const db = await heap();
    await Promise.all([
      db.upsertBands('h1', [{ band: 2352, minX: 200, maxX: 700 }], 6),
      db.upsertBands('h1', [{ band: 2360, minX: 150, maxX: 750 }], 7),
    ]);
    await db.updateHeap('h1', 'b1', 7, [], 0, 47000);
    const body = (await (await get(db, '?version=5&baseId=b1')).json()) as GetHeapResponse;
    if (body.changed && body.mode === 'delta') {
      expect(wireToBands(body.bands).map((b) => b.band)).toEqual([2352, 2360]);
    } else {
      throw new Error('expected a delta');
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run server/tests/heapDelta.test.ts`
Expected: FAIL — no `mode` on the response.

- [ ] **Step 3: Update the shared types**

In `shared/heapTypes.ts`, replace the `GetHeapResponse` union:

```ts
export type GetHeapFullResponse = {
  changed: true;
  mode: 'full';
  version: number;
  baseId: string;
  freezeY: number;
  /** Flat [band, minX, maxX, ...] triples — the whole envelope. */
  bands: number[];
  /** Materialised vertex list, for clients that predate the band protocol. */
  liveZone: Vertex[];
  params: HeapParams;
  enemyParams: HeapEnemyParams;
};

export type GetHeapDeltaResponse = {
  changed: true;
  mode: 'delta';
  version: number;
  baseId: string;
  freezeY: number;
  /** Flat triples for bands changed since the client's version. */
  bands: number[];
  params: HeapParams;
  enemyParams: HeapEnemyParams;
};

export type GetHeapResponse =
  | { changed: false; version: number }
  | GetHeapFullResponse
  | GetHeapDeltaResponse;
```

- [ ] **Step 4: Implement the handler**

Replace the body of `GET /:id` in `server/src/routes/heap.ts`:

```ts
    const id = c.req.param('id');
    const clientVersion = parseInt(c.req.query('version') ?? '0') || 0;
    const clientBaseId = c.req.query('baseId');

    const row = await db.getHeap(id);
    if (!row) return c.json({ error: 'Heap not found' }, 404);

    // A client opts into deltas by echoing the baseId it holds. A mismatch means
    // its cache spans a different generation (reset) or an older base (freeze),
    // so it must take a full response.
    const optedIn = typeof clientBaseId === 'string' && clientBaseId.length > 0;
    const sameGeneration = optedIn && clientBaseId === row.base_id;

    if (sameGeneration && clientVersion === row.version) {
      return c.json({ changed: false, version: row.version } satisfies GetHeapResponse);
    }
    // Old clients send no baseId and rely on version alone.
    if (!optedIn && clientVersion === row.version) {
      return c.json({ changed: false, version: row.version } satisfies GetHeapResponse);
    }

    const params = {
      name: row.name, difficulty: row.difficulty,
      spawnRateMult: row.spawn_rate_mult, coinMult: row.coin_mult, scoreMult: row.score_mult,
      worldHeight: row.world_height, ghostPointCount: row.ghost_point_count,
      baseItemSpawnRate: row.base_item_spawn_rate,
      positiveItemSpawnRate: row.positive_item_spawn_rate,
      negativeItemSpawnRate: row.negative_item_spawn_rate,
      lockedByHeapId: row.locked_by_heap_id ?? null,
    };

    if (sameGeneration) {
      const [changedBands, enemyParams] = await Promise.all([
        db.getBandsSince(id, clientVersion),
        db.getEnemyParams(id),
      ]);
      return c.json({
        changed: true, mode: 'delta',
        version: row.version, baseId: row.base_id, freezeY: row.freeze_y,
        bands: bandsToWire(changedBands),
        params, enemyParams,
      } satisfies GetHeapResponse);
    }

    const [allBands, liveZone, enemyParams] = await Promise.all([
      db.getAllBands(id),
      materialiseLiveZone(db, row),
      db.getEnemyParams(id),
    ]);
    return c.json({
      changed: true, mode: 'full',
      version: row.version, baseId: row.base_id, freezeY: row.freeze_y,
      bands: bandsToWire(allBands),
      liveZone,
      params, enemyParams,
    } satisfies GetHeapResponse);
```

In `PUT /:id/reset`, mint a new `baseId` so a reset invalidates client caches. Copy the current base vertices onto the new row so the heap keeps its shape below the freeze line:

```ts
    const newBaseId = crypto.randomUUID();
    const baseVertices = (await db.getBaseVerticesById(row.base_id)) ?? [];
    await db.createBase(newBaseId, id, baseVertices, hashVertices(baseVertices), new Date().toISOString());
    await db.clearBands(id);
    await db.updateHeap(id, newBaseId, 1, [], 0, row.top_y);
```

Add `clearBands(heapId: string): Promise<void>` (a `DELETE FROM heap_band WHERE heap_id = ?1`) to `HeapDB` and all three flavours.

- [ ] **Step 5: Keep the client compiling**

`src/systems/HeapClient.ts` reads `data.liveZone` on the `changed: true` branch, which no longer type-checks against the union. Narrow it — behaviour is unchanged because the client does not yet send `baseId`, so it can only ever receive `full`:

```ts
      if (data.changed && data.mode === 'full') {
```

- [ ] **Step 6: Run tests and build**

Run: `npx vitest run server/tests/heapDelta.test.ts && npm test && npm run build`
Expected: PASS. `npm run build` is the real gate here — it proves no other client call site depends on the old response shape.

- [ ] **Step 7: Commit**

```bash
git add shared/heapTypes.ts server/src/routes/heap.ts server/src/db.ts \
        server/tests/helpers/mockDb.ts server/src/cache/CachedHeapDB.ts \
        src/systems/HeapClient.ts server/tests/heapDelta.test.ts
git commit -m "feat(server): delta-aware GET /heaps/:id with an explicit full/delta mode"
```

---

### Task 11: Cache the heap row and its bands as one unit

**Files:**
- Modify: `server/src/cache/CachedHeapDB.ts`
- Test: `server/tests/bandCacheConsistency.test.ts`

**Interfaces:**
- Consumes: `getBand`, `getAllBands`, `getBandsSince`, `getMaxBand`, `upsertBands` (Task 4); `setLiveZoneBlob` (Task 7); `bumpVersion` (Task 8); `setFreeze` (Task 9); `clearBands` (Task 10). All exist on `HeapDB` by the time this task runs; `invalidateHeap` and `safeGet` are existing private helpers on `CachedHeapDB`.
- Produces: no new signatures — a correctness constraint on the decorator, plus the internal `HeapSnapshot` cache shape.

- [ ] **Step 1: Write the failing test**

```ts
// server/tests/bandCacheConsistency.test.ts
//
// The version handed to a client must never exceed the bands it was sent with.
// Serving a fresh heap row beside stale cached bands would make a client record a
// watermark covering bands it never received — and it would never ask again.
// Under-claiming is safe (the client re-receives and MIN/MAX merges idempotently);
// over-claiming loses data forever.

import { describe, it, expect } from 'vitest';
import { CachedHeapDB } from '../src/cache/CachedHeapDB';
import { MockHeapDB } from './helpers/mockDb';
import { MockKV } from './helpers/mockKv';
import { DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';

const noWait = (_p: Promise<unknown>) => {};

async function seeded() {
  const inner = new MockHeapDB();
  await inner.createHeap('h1', 'b1', [{ x: 480, y: 50000 }], 'h', new Date().toISOString(), {
    ...DEFAULT_HEAP_PARAMS, worldHeight: 50000,
  });
  await inner.upsertBands('h1', [{ band: 10, minX: 400, maxX: 500 }], 2);
  await inner.updateHeap('h1', 'b1', 2, [], 0, 100);
  return inner;
}

describe('band cache consistency', () => {
  it('serves the row and the full band set from one snapshot', async () => {
    const inner = await seeded();
    const kv = new MockKV();
    const cached = new CachedHeapDB(inner, kv.asKV(), noWait);

    const row = (await cached.getHeap('h1'))!;
    const bands = await cached.getAllBands('h1');
    expect(row.version).toBe(2);
    expect(bands).toEqual([{ band: 10, minX: 400, maxX: 500 }]);
  });

  it('never reports a row version newer than the bands served with it', async () => {
    const inner = await seeded();
    const kv = new MockKV();
    const cached = new CachedHeapDB(inner, kv.asKV(), noWait);

    await cached.getHeap('h1');   // warm the snapshot at v2

    // A placement lands directly on the inner DB, bypassing the decorator — this
    // is what a second isolate doing a placement looks like to this one.
    await inner.upsertBands('h1', [{ band: 11, minX: 300, maxX: 600 }], 3);
    await inner.updateHeap('h1', 'b1', 3, [], 0, 100);

    const row = (await cached.getHeap('h1'))!;
    const full = await cached.getAllBands('h1');
    // Both come from the same cached snapshot, so they agree with each other.
    expect(row.version).toBe(2);
    expect(full).toEqual([{ band: 10, minX: 400, maxX: 500 }]);

    // Deltas read through to D1, so they may over-send relative to the stale
    // watermark. That direction is safe.
    const since = await cached.getBandsSince('h1', 2);
    expect(since).toEqual([{ band: 11, minX: 300, maxX: 600 }]);
  });

  it('invalidates the snapshot when bands are written through the decorator', async () => {
    const inner = await seeded();
    const kv = new MockKV();
    const cached = new CachedHeapDB(inner, kv.asKV(), noWait);

    expect(await cached.getAllBands('h1')).toHaveLength(1);
    await cached.upsertBands('h1', [{ band: 11, minX: 300, maxX: 600 }], 3);
    expect(await cached.getAllBands('h1')).toHaveLength(2);
    expect(kv.deletes).toContain('cache:heap:h1');
  });

  it('invalidates the snapshot on bumpVersion, setFreeze and clearBands', async () => {
    const inner = await seeded();
    const kv = new MockKV();
    const cached = new CachedHeapDB(inner, kv.asKV(), noWait);

    await cached.getHeap('h1');
    await cached.bumpVersion('h1', 90);
    expect(kv.deletes).toContain('cache:heap:h1');
    expect((await cached.getHeap('h1'))!.version).toBe(3);

    kv.deletes.length = 0;
    await cached.clearBands('h1');
    expect(kv.deletes).toContain('cache:heap:h1');
    expect(await cached.getAllBands('h1')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run server/tests/bandCacheConsistency.test.ts`
Expected: FAIL if bands are cached independently of the row.

- [ ] **Step 3: Implement**

The decorator caches the heap row under `cache:heap:{id}` with `HEAP_TTL = 60`. Widen that entry to hold the bands too, so the two can never come from different generations. Replace `getHeap` and the Task 4 band delegations in `server/src/cache/CachedHeapDB.ts`:

```ts
/** Heap row plus its full band set, cached as ONE entry. A delta's watermark must
 *  never exceed the bands served beside it, so these two cannot be cached apart. */
type HeapSnapshot = { row: HeapRow; bands: BandRow[] };

  private async snapshot(id: string): Promise<HeapSnapshot | null> {
    const key = `cache:heap:${id}`;
    const hit = await this.safeGet<HeapSnapshot>(key);
    if (hit) return hit;
    const row = await this.inner.getHeap(id);
    if (!row) return null;
    const bands = await this.inner.getAllBands(id);
    const snap: HeapSnapshot = { row, bands };
    this.waitUntil(this.kv.put(key, JSON.stringify(snap), { expirationTtl: HEAP_TTL }));
    return snap;
  }

  async getHeap(id: string): Promise<HeapRow | null> {
    return (await this.snapshot(id))?.row ?? null;
  }

  async getAllBands(heapId: string): Promise<BandRow[]> {
    return (await this.snapshot(heapId))?.bands ?? [];
  }

  async getBand(heapId: string, band: number): Promise<BandRow | null> {
    // Placement containment must not run on a stale extent, or a buried vertex
    // slips through — read through, mirroring getHeapFresh's reasoning.
    return this.inner.getBand(heapId, band);
  }

  async getMaxBand(heapId: string): Promise<number | null> {
    return this.inner.getMaxBand(heapId);
  }

  async getBandsSince(heapId: string, version: number): Promise<BandRow[]> {
    // Read-through: fresher than the cached row's version, so a delta may
    // over-send relative to the watermark. That direction is safe — the client
    // merges with MIN/MAX, which is idempotent. The unsafe direction is a fresh
    // row beside stale bands, which the shared snapshot above prevents.
    return this.inner.getBandsSince(heapId, version);
  }

  async upsertBands(heapId: string, rows: BandRow[], version: number): Promise<void> {
    await this.inner.upsertBands(heapId, rows, version);
    await this.invalidateHeap(heapId);
  }

  async bumpVersion(heapId: string, topYCandidate: number): Promise<number> {
    const v = await this.inner.bumpVersion(heapId, topYCandidate);
    await this.invalidateHeap(heapId);
    return v;
  }

  async setFreeze(heapId: string, baseId: string, freezeY: number): Promise<void> {
    await this.inner.setFreeze(heapId, baseId, freezeY);
    await this.invalidateHeap(heapId);
  }

  async clearBands(heapId: string): Promise<void> {
    await this.inner.clearBands(heapId);
    await this.invalidateHeap(heapId);
  }

  async setLiveZoneBlob(heapId: string, liveZone: Vertex[], version: number): Promise<void> {
    await this.inner.setLiveZoneBlob(heapId, liveZone, version);
    await this.invalidateHeap(heapId);
  }
```

Remove the plain band delegations added in Task 4 Step 5 along with their placeholder comment — this task is what they were deferring to. Import `BandRow` from `shared/heapPolygon/bandEnvelope`.

Note that widening the cached payload changes what `cache:heap:{id}` holds. Entries written by the previous deploy are the old bare-row shape, so `safeGet<HeapSnapshot>` would return an object with no `bands`. Guard it:

```ts
    if (hit && Array.isArray(hit.bands) && hit.row) return hit;
```

Anything else falls through to a D1 read and rewrites the entry in the new shape. The 60s TTL means the mixed window is one minute.

- [ ] **Step 4: Run tests and build**

Run: `npx vitest run server/tests/bandCacheConsistency.test.ts server/tests/cacheDecorators.test.ts && npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/cache/CachedHeapDB.ts server/tests/bandCacheConsistency.test.ts
git commit -m "fix(server): cache heap row and bands as one unit to keep delta watermarks sound"
```

---

## Phase 4 — Client

### Task 12: Client band cache and delta merge

**Files:**
- Modify: `src/systems/HeapClient.ts`, `src/systems/HeapPolygonLoader.ts`
- Test: `src/systems/__tests__/heapClientDelta.test.ts`

**Interfaces:**
- Consumes: `mergeBands`, `envelopeToVertices`, `wireToBands`, `BandRow` (Task 1); the delta protocol (Task 10).
- Produces:
  - `HeapCache` gains `bands: number[]` and `shape: 2`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/systems/__tests__/heapClientDelta.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mergeBands, wireToBands, envelopeToVertices } from '../../../shared/heapPolygon/bandEnvelope';

describe('client delta merge', () => {
  beforeEach(() => localStorage.clear());

  it('widens cached bands with MIN/MAX rather than replacing them', () => {
    const cached = mergeBands(new Map(), wireToBands([10, 400, 500]));
    const merged = mergeBands(cached, wireToBands([10, 350, 450]));
    expect(merged.get(10)).toEqual({ minX: 350, maxX: 500 });
  });

  it('adds bands the cache has not seen', () => {
    const merged = mergeBands(mergeBands(new Map(), wireToBands([10, 400, 500])), wireToBands([11, 300, 600]));
    expect([...merged.keys()].sort((a, b) => a - b)).toEqual([10, 11]);
  });

  it('is idempotent — replaying a delta changes nothing', () => {
    const once = mergeBands(new Map(), wireToBands([10, 400, 500, 11, 300, 600]));
    const twice = mergeBands(once, wireToBands([10, 400, 500, 11, 300, 600]));
    expect([...twice.entries()]).toEqual([...once.entries()]);
  });

  it('materialises merged bands at band-mid-y for the renderer', () => {
    const merged = mergeBands(new Map(), wireToBands([10, 400, 500]));
    expect(envelopeToVertices(merged)).toEqual([{ x: 400, y: 210 }, { x: 500, y: 210 }]);
  });
});
```

Then the integration cases, in the same file:

```ts
import { HeapClient } from '../HeapClient';

const CACHE_KEY = 'heap_cache_h1';

/** Stub fetch, recording request URLs. Base fetches return a single vertex. */
function stubFetch(responses: unknown[]): { urls: string[] } {
  const urls: string[] = [];
  let i = 0;
  vi.stubGlobal('fetch', async (url: string) => {
    urls.push(url);
    if (url.includes('/base')) {
      return { ok: true, status: 200, json: async () => [{ x: 480, y: 50000 }] } as Response;
    }
    const body = responses[Math.min(i++, responses.length - 1)];
    return { ok: true, status: 200, json: async () => body } as Response;
  });
  return { urls };
}

const fullResponse = {
  changed: true, mode: 'full', version: 5, baseId: 'b1', freezeY: 0,
  bands: [10, 400, 500], liveZone: [], params: {}, enemyParams: {},
};

describe('HeapClient delta protocol', () => {
  beforeEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

  it('sends no baseId on a cold cache', async () => {
    const { urls } = stubFetch([fullResponse]);
    await new HeapClient().load('h1');
    expect(urls[0]).toContain('version=0');
    expect(urls[0]).not.toContain('baseId');
  });

  it('stores bands and the cache shape after a full response', async () => {
    stubFetch([fullResponse]);
    await new HeapClient().load('h1');
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY)!);
    expect(cache.shape).toBe(2);
    expect(cache.bands).toEqual([10, 400, 500]);
    expect(cache.version).toBe(5);
    expect(cache.liveZone).toBeUndefined();
  });

  it('opts into deltas on the next load by echoing version and baseId', async () => {
    stubFetch([fullResponse]);
    const client = new HeapClient();
    await client.load('h1');
    const { urls } = stubFetch([{ changed: false, version: 5 }]);
    await client.load('h1');
    expect(urls[0]).toContain('version=5');
    expect(urls[0]).toContain('baseId=b1');
  });

  it('merges a delta into the cached bands rather than replacing them', async () => {
    stubFetch([fullResponse]);
    const client = new HeapClient();
    await client.load('h1');
    stubFetch([{
      changed: true, mode: 'delta', version: 6, baseId: 'b1', freezeY: 0,
      bands: [10, 350, 450, 11, 300, 600], params: {}, enemyParams: {},
    }]);
    await client.load('h1');
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY)!);
    // Band 10 widened by MIN/MAX (350..500), band 11 added.
    expect(cache.bands).toEqual([10, 350, 500, 11, 300, 600]);
    expect(cache.version).toBe(6);
  });

  it('discards an unrecognised cache shape and refetches cold', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ version: 9, baseId: 'b1', liveZone: [] }));
    const { urls } = stubFetch([fullResponse]);
    await new HeapClient().load('h1');
    expect(urls[0]).toContain('version=0');
    expect(urls[0]).not.toContain('baseId');
  });

  it('replaces bands outright when a full response carries a new baseId', async () => {
    stubFetch([fullResponse]);
    const client = new HeapClient();
    await client.load('h1');
    stubFetch([{
      changed: true, mode: 'full', version: 1, baseId: 'b2', freezeY: 0,
      bands: [20, 100, 200], liveZone: [], params: {}, enemyParams: {},
    }]);
    await client.load('h1');
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY)!);
    expect(cache.baseId).toBe('b2');
    expect(cache.bands).toEqual([20, 100, 200]);   // NOT merged with band 10
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/systems/__tests__/heapClientDelta.test.ts`
Expected: FAIL on the integration cases — the client neither sends `baseId` nor stores `bands`.

- [ ] **Step 3: Implement**

In `src/systems/HeapClient.ts`:

- Extend `HeapCache` to `{ shape: 2; version: number; baseId: string; bands: number[]; enemyParams?: HeapEnemyParams }`. Drop `liveZone`.
- In `loadCache`, return `null` when `shape !== 2` so old caches are discarded and refetched cold.
- Send `?version=${version}&baseId=${encodeURIComponent(cache.baseId)}` when a cache exists; version only when it does not.
- On `mode: 'full'`: replace bands with the response's, fetch the base for the new `baseId`, save, and render.
- On `mode: 'delta'`: `mergeBands` the response's bands into the cached ones, save the new version, and render.
- Render via `reconstructPolygonFromPoints([...base, ...envelopeToVertices(env)])` — **not** by building edges from bands directly. The renderer forward-fills gaps (`HeapPolygonLoader.ts:146`) and applies a stateful nearer-edge rule to single-point bands (`:132-140`); a direct construction would silently diverge. Keep `getLiveZoneBottomY` working by deriving it from the highest cached band: `(maxBand + 1) * BAND_SIZE_PX`.

- [ ] **Step 4: Run tests and build**

Run: `npx vitest run src/systems/__tests__/heapClientDelta.test.ts && npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/systems/HeapClient.ts src/systems/HeapPolygonLoader.ts src/systems/__tests__/heapClientDelta.test.ts
git commit -m "feat(client): band cache with delta merge"
```

---

### Task 13: End-to-end verification

**Files:** none — verification only.

- [ ] **Step 1: Full suite and build**

Run: `npm test && npm run build`
Expected: PASS, both.

- [ ] **Step 2: Visual smoke test**

Use the `smoke-testing-heap` skill. The claim under test is that **nothing looks different**. Load a heap that existed before the migration, climb it, place a block, and compare against `scene-preview` screenshots taken from `main`. Any visible change in the silhouette means the losslessness property (Task 2) is not holding in production geometry — stop and investigate rather than accepting it.

- [ ] **Step 3: Load test the finished stack**

Per the `load-testing-heap` skill and spec §7, both fixtures, reading CPU per minute:

```bash
npm run loadtest -- -e PLACE_FIXTURE=large -e PLACEMENT_ITERATIONS=200 \
  -e PLACEMENT_VUS=1 -e PLACE_RATE=0 -e SESSIONS=50
```

Confirm: large-heap P99 CPU well under 10ms (baseline 10.3); no 409s at 15 concurrent placers (baseline 28–36%); peak transfer materially below the 15MB observed at the large heap.

- [ ] **Step 4: Record the results**

Update `Todo/Todo.md` § PERF with the new CPU table beside the old one, and note the egress and 409 figures. Update `docs/superpowers/2026-07-26-heap-delta-api-handoff.md` to point at the spec and mark the work delivered.

- [ ] **Step 5: Commit and open the PR**

```bash
git add Todo/Todo.md docs/superpowers/2026-07-26-heap-delta-api-handoff.md
git commit -m "docs: record band-envelope perf results"
```

Open the PR noting that `migrate-d1.yml` must succeed before the worker serves traffic — the handler requires `heap_band` and `live_zone_version` (see the player-auth 0003 lockout lesson in the migrations skill).

---

## Notes for the implementer

- **The riskiest assumption** is that band-envelope simplification is visually lossless. It is proven only on synthetic data; Task 2's property test and Task 13's smoke test are what make it real. If either fails, stop — do not adjust the assertion to pass.
- **Behaviour changes deliberately** in two places: which placements are accepted (envelope instead of ray cast) and the active-zone gate granularity (20px rounding). Both are specified; both have tests. Rejections stay silent either way.
- **Phase boundaries are shippable.** Phase 1 alone fixes the CPU breach. If priorities move, stopping after any phase leaves a working, tested system.

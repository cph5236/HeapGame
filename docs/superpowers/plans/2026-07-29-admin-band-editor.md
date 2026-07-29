# Admin Band Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator view a heap's silhouette band by band in the admin page and repair damaged geometry in both the live band rows and the frozen base blob.

**Architecture:** Two new admin-gated routes on `/heaps/:id/bands` — an uncached read that returns both layers already converted to band rows, and a compare-and-swap write guarded on `version` *and* `base_id`. A pure planner fans each edited band out to every layer that holds it, because the client renders the union of the two layers. One D1 transaction mints a new base, repoints the heap, and replaces live rows with **replace** semantics (not the MIN/MAX of `upsertBands`) so narrowing actually lands. The admin page gets a canvas overview, an SVG detail pane with draggable handles, and an inspector.

**Tech Stack:** TypeScript 5.9, Hono, Cloudflare D1, Vitest, `node:sqlite` for real-SQL tests, Tailwind v4 browser CDN in `admin/index.html`.

**Spec:** `docs/superpowers/specs/2026-07-29-admin-band-editor-design.md`

## Global Constraints

- Branch is `feature/admin-band-editor`, already created off `main`. Never push direct to `main`; PR before merge.
- `admin/index.html` is **standalone** — no bundler, no imports, no `package.json` dependency. Everything it needs is inline or comes from the server.
- Band size is `BAND_SIZE_PX = 20` (`shared/heapPolygon/bandEnvelope.ts`). Never hardcode `20` in server code; import the constant. The admin page cannot import, so it declares its own `const BAND_PX = 20;` with a comment naming the shared constant it must match.
- Request cap: **500** bands per `PUT`.
- Every save mints a fresh `baseId`, unconditionally — including a save that touches no base band.
- New `HeapDB` members must be implemented in **all three** variants: `D1HeapDB` (`server/src/db.ts`), `MockHeapDB` (`server/tests/helpers/mockDb.ts`), `CachedHeapDB` (`server/src/cache/CachedHeapDB.ts`). Missing one is a compile error.
- Commit after every task. Use `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` as the last line of each commit message.
- `npm test` runs the client/shared suite from the repo root; the server suite runs from `server/` (`cd server && npm test`). Both must pass before the final task completes.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `shared/heapTypes.ts` | modify | Wire types for both new routes |
| `server/src/routes/heap.ts` | modify | `planBandWrite` (pure fan-out rule) + the two routes |
| `server/src/db.ts` | modify | `AdminReplaceBandsArgs`, `HeapDB.adminReplaceBands`, `D1HeapDB` implementation |
| `server/tests/helpers/mockDb.ts` | modify | In-memory `adminReplaceBands` mirroring the D1 CAS |
| `server/src/cache/CachedHeapDB.ts` | modify | Invalidating decorator |
| `server/src/app.ts` | modify | Admin gate on both routes |
| `server/tests/adminBandPlan.test.ts` | create | The fan-out rule — the load-bearing logic |
| `server/tests/adminBandsDb.test.ts` | create | Real-SQLite CAS, atomicity, replace-not-merge |
| `server/tests/adminBandsRoute.test.ts` | create | Route behaviour, validation, 409 |
| `server/tests/cacheDecorators.test.ts` | modify | Invalidation on `adminReplaceBands` |
| `admin/index.html` | modify | Markup + state + render + interaction + save |
| `Todo/Todo.md` | modify | Strike the completed line |

---

## Task 1: Wire types and the band fan-out planner

The rule this task encodes is the one the whole feature turns on: the client renders `[...base, ...liveVertices]` bucketed to bands, so a band's on-screen extent is the **union** of the two layers. Editing only one layer leaves the other's stale extent winning that union — the repair looks correct in the database and changes nothing in the game.

**Files:**
- Modify: `shared/heapTypes.ts` (append at end)
- Modify: `server/src/routes/heap.ts` (add near `liveBandsOf`, around line 149)
- Test: `server/tests/adminBandPlan.test.ts` (create)

**Interfaces:**
- Produces: `AdminBandRow`, `AdminBandsResponse`, `AdminBandsRequest`, `AdminBandsWriteResponse`, `AdminBandsConflictResponse` from `shared/heapTypes`; `planBandWrite(args): BandWritePlan` and `BandWritePlan` from `server/src/routes/heap`.

- [ ] **Step 1: Add the wire types**

Append to `shared/heapTypes.ts`:

```ts
// ────── Admin band editor ──────────────────────────────────────────────────
// Type-only import, so this does not create a runtime cycle with bandEnvelope
// (which type-only imports Vertex from here). Reusing BandRow rather than
// redeclaring it keeps the wire shape tied to the storage shape.
import type { BandRow } from './heapPolygon/bandEnvelope';

export type AdminBandRow = BandRow;

/** GET /heaps/:id/bands — everything the band editor needs, in one read. */
export interface AdminBandsResponse {
  version: number;
  baseId: string;
  freezeY: number;
  worldHeight: number;
  /** heap_band rows above the freeze line. */
  liveBands: AdminBandRow[];
  /** The base blob, converted to band rows. */
  baseBands: AdminBandRow[];
}

/** PUT /heaps/:id/bands — the full dirty set across both layers. */
export interface AdminBandsRequest {
  expectedVersion: number;
  expectedBaseId: string;
  bands: AdminBandRow[];
}

export interface AdminBandsWriteResponse {
  version: number;
  baseId: string;
}

/** 409 body — the server's current values, so the UI can report the drift. */
export interface AdminBandsConflictResponse {
  error: string;
  version: number;
  baseId: string;
}
```

`shared/heapTypes.ts` currently has **no** imports — it opens with a comment block and `export const INFINITE_HEAP_ID`. Put the `import type { BandRow }` line at the very top of the file, above that comment block, rather than leaving it mid-file where the block above places it.

- [ ] **Step 2: Write the failing test**

Create `server/tests/adminBandPlan.test.ts`:

```ts
// server/tests/adminBandPlan.test.ts
//
// The fan-out rule. The client builds its polygon as [...base, ...liveVertices]
// and buckets to bands afterwards, so a band's rendered extent is the UNION of
// whatever both layers say. An edit that reaches only one layer therefore does
// not change what players see — the other layer's wider extent still wins.
// These tests pin that an edit reaches every layer holding the band.

import { describe, it, expect } from 'vitest';
import { planBandWrite } from '../src/routes/heap';
import { BAND_SIZE_PX } from '../../shared/heapPolygon/bandEnvelope';

const FREEZE_BAND = 100;
const FREEZE_Y = FREEZE_BAND * BAND_SIZE_PX;

describe('planBandWrite', () => {
  it('narrows a band held by BOTH layers in both of them', () => {
    const plan = planBandWrite({
      dirty:     [{ band: 50, minX: -100, maxX: 100 }],
      baseRows:  [{ band: 50, minX: -900, maxX: 900 }],
      liveBands: new Set([50]),
      freezeY:   FREEZE_Y,
    });
    expect(plan.liveRows).toEqual([{ band: 50, minX: -100, maxX: 100 }]);
    expect(plan.nextBaseRows).toEqual([{ band: 50, minX: -100, maxX: 100 }]);
  });

  it('leaves untouched base bands in the rebuilt base, ascending', () => {
    const plan = planBandWrite({
      dirty:     [{ band: 50, minX: -100, maxX: 100 }],
      baseRows:  [{ band: 60, minX: -5, maxX: 5 }, { band: 50, minX: -900, maxX: 900 }],
      liveBands: new Set(),
      freezeY:   FREEZE_Y,
    });
    expect(plan.nextBaseRows).toEqual([
      { band: 50, minX: -100, maxX: 100 },
      { band: 60, minX: -5,   maxX: 5 },
    ]);
    expect(plan.liveRows).toEqual([]);
  });

  it('writes only a live row when only the live layer holds the band', () => {
    const plan = planBandWrite({
      dirty:     [{ band: 50, minX: -100, maxX: 100 }],
      baseRows:  [{ band: 60, minX: -5, maxX: 5 }],
      liveBands: new Set([50]),
      freezeY:   FREEZE_Y,
    });
    expect(plan.liveRows).toEqual([{ band: 50, minX: -100, maxX: 100 }]);
    expect(plan.nextBaseRows).toEqual([{ band: 60, minX: -5, maxX: 5 }]);
  });

  it('creates a band held by neither layer in the LIVE layer above the freeze line', () => {
    const plan = planBandWrite({
      dirty:     [{ band: FREEZE_BAND - 1, minX: -10, maxX: 10 }],
      baseRows:  [],
      liveBands: new Set(),
      freezeY:   FREEZE_Y,
    });
    expect(plan.liveRows).toEqual([{ band: FREEZE_BAND - 1, minX: -10, maxX: 10 }]);
    expect(plan.nextBaseRows).toEqual([]);
  });

  it('creates a band held by neither layer in the BASE at or below the freeze line', () => {
    const plan = planBandWrite({
      dirty:     [{ band: FREEZE_BAND + 1, minX: -10, maxX: 10 }],
      baseRows:  [],
      liveBands: new Set(),
      freezeY:   FREEZE_Y,
    });
    expect(plan.liveRows).toEqual([]);
    expect(plan.nextBaseRows).toEqual([{ band: FREEZE_BAND + 1, minX: -10, maxX: 10 }]);
  });

  it('treats freezeY 0 as "nothing frozen" — a new band goes live', () => {
    // liveBandsOf reads freeze_y === 0 as the "nothing frozen yet" sentinel, so
    // every band is live on a never-frozen heap. Rule 3 must agree with it.
    const plan = planBandWrite({
      dirty:     [{ band: 9999, minX: -10, maxX: 10 }],
      baseRows:  [],
      liveBands: new Set(),
      freezeY:   0,
    });
    expect(plan.liveRows).toEqual([{ band: 9999, minX: -10, maxX: 10 }]);
    expect(plan.nextBaseRows).toEqual([]);
  });

  it('handles a freezeY-0 heap where both layers overlap — migration 0004 shape', () => {
    // 0004 backfilled heap_band from the live zone AND the base, so these heaps
    // have full overlap. Both layers must narrow or the union keeps the spike.
    const plan = planBandWrite({
      dirty:     [{ band: 7, minX: -50, maxX: 50 }],
      baseRows:  [{ band: 7, minX: -800, maxX: 800 }],
      liveBands: new Set([7]),
      freezeY:   0,
    });
    expect(plan.liveRows).toEqual([{ band: 7, minX: -50, maxX: 50 }]);
    expect(plan.nextBaseRows).toEqual([{ band: 7, minX: -50, maxX: 50 }]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd server && npx vitest run tests/adminBandPlan.test.ts`
Expected: FAIL — `planBandWrite` is not exported from `../src/routes/heap`.

- [ ] **Step 4: Implement `planBandWrite`**

In `server/src/routes/heap.ts`, immediately after the existing `liveBandsOf` function (around line 152), add:

```ts
/** What a single admin save resolves to, once fanned out across the layers. */
export interface BandWritePlan {
  /** The COMPLETE new base envelope, ready to serialise. Not just the changes:
   *  the base is an immutable blob, so it is always rewritten whole. */
  nextBaseRows: BandRow[];
  /** Only the heap_band rows that need writing. */
  liveRows: BandRow[];
}

/**
 * Fan each edited band out to every layer that holds it.
 *
 * The client builds its polygon as `[...base, ...liveVertices]` and buckets to
 * bands afterwards, so a band's rendered extent is the UNION of the two layers.
 * Writing an edit to only one of them leaves the other's stale extent winning
 * that union — the repair lands in the database and changes nothing on screen.
 * Two situations make the overlap routine rather than exotic: `freeze_y === 0`
 * is the "nothing frozen yet" sentinel, so every band row is live while the base
 * still covers those bands; and migration 0004 backfilled heap_band from the
 * live zone AND the base.
 *
 * `liveBands` is the set of bands that currently have a heap_band row, taken
 * from database state rather than from whatever the editor happened to load.
 */
export function planBandWrite(args: {
  dirty: BandRow[];
  baseRows: BandRow[];
  liveBands: Set<number>;
  freezeY: number;
}): BandWritePlan {
  const { dirty, baseRows, liveBands, freezeY } = args;
  const baseEnv: BandEnvelope = new Map(
    baseRows.map((r) => [r.band, { minX: r.minX, maxX: r.maxX }]),
  );
  const liveRows: BandRow[] = [];

  for (const r of dirty) {
    const inBase = baseEnv.has(r.band);
    const inLive = liveBands.has(r.band);

    // Rule 1 — the base holds this band, so the base must carry the edit.
    if (inBase) baseEnv.set(r.band, { minX: r.minX, maxX: r.maxX });
    // Rule 2 — so must the live row, when one exists. Both firing is the
    // normal case: afterwards the two layers agree, so their union is the
    // operator's value.
    if (inLive) liveRows.push(r);

    // Rule 3 — held by neither (a gap being filled). Create it in the layer the
    // freeze line assigns, matching liveBandsOf's freeze_y === 0 sentinel.
    if (!inBase && !inLive) {
      if (freezeY > 0 && r.band >= bandOf(freezeY)) {
        baseEnv.set(r.band, { minX: r.minX, maxX: r.maxX });
      } else {
        liveRows.push(r);
      }
    }
  }

  return { nextBaseRows: envelopeToRows(baseEnv), liveRows };
}
```

Add `BandEnvelope` to the existing `bandEnvelope` import block at the top of `server/src/routes/heap.ts` (line 9 already imports `BAND_SIZE_PX, bandOf, bandMidY, extendsEnvelope, verticesToEnvelope, envelopeToRows`). `BandEnvelope` is a type, so import it with the other type imports if the file separates them; otherwise add it to that same list.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd server && npx vitest run tests/adminBandPlan.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add shared/heapTypes.ts server/src/routes/heap.ts server/tests/adminBandPlan.test.ts
git commit -m "$(cat <<'EOF'
feat(server): band write planner fans edits across both layers

The client renders [...base, ...liveVertices] bucketed to bands, so a
band's extent on screen is the union of the two layers. Editing one layer
leaves the other's stale extent winning that union. planBandWrite writes
each edit to every layer holding the band.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `adminReplaceBands` on `D1HeapDB` and `MockHeapDB`

**Files:**
- Modify: `server/src/db.ts` (add `AdminReplaceBandsArgs` near `FreezeArgs` ~line 9; interface member near `clearBands` ~line 219; `D1HeapDB` method near `freezeAtomic`)
- Modify: `server/tests/helpers/mockDb.ts` (near `freezeAtomic` ~line 326)
- Test: `server/tests/adminBandsDb.test.ts` (create)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `AdminReplaceBandsArgs` and `HeapDB.adminReplaceBands(args: AdminReplaceBandsArgs): Promise<boolean>` from `server/src/db`. Returns `true` when the CAS won and everything was written, `false` when it lost and **nothing** was.

- [ ] **Step 1: Write the failing test**

Create `server/tests/adminBandsDb.test.ts`:

```ts
// server/tests/adminBandsDb.test.ts
//
// Runs against real SQLite (helpers/d1Sqlite.ts), not MockHeapDB, because every
// part of adminReplaceBands' correctness lives in SQL: the CAS predicate on both
// version and base_id, the correlated subqueries that make a losing batch a
// complete no-op, the replace-not-MIN/MAX upsert, and meta.changes.

import { describe, it, expect } from 'vitest';
import { D1HeapDB } from '../src/db';
import { createTestD1 } from './helpers/d1Sqlite';
import { DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';

const NOW = '2026-07-29T00:00:00.000Z';

/** Heap h1 at version 1 on base b1, with band 50 spanning [-900, 900]. */
async function seeded() {
  const db = new D1HeapDB(createTestD1());
  await db.createHeap('h1', 'b1', [{ x: 480, y: 49000 }], 'hash-b1', NOW, {
    ...DEFAULT_HEAP_PARAMS, worldHeight: 50000,
  });
  await db.upsertBands('h1', [{ band: 50, minX: -900, maxX: 900 }], 1);
  return db;
}

const ARGS = {
  heapId: 'h1',
  expectedVersion: 1,
  expectedBaseId: 'b1',
  newBaseId: 'b2',
  baseVertices: [{ x: 10, y: 49010 }],
  baseHash: 'hash-b2',
  liveRows: [{ band: 50, minX: -100, maxX: 100 }],
  now: NOW,
};

describe('adminReplaceBands', () => {
  it('NARROWS a band — the case upsertBands structurally cannot do', async () => {
    const db = await seeded();
    expect(await db.adminReplaceBands(ARGS)).toBe(true);
    expect(await db.getBand('h1', 50)).toEqual({ band: 50, minX: -100, maxX: 100 });
  });

  it('mints the new base, repoints the heap, and bumps the version', async () => {
    const db = await seeded();
    await db.adminReplaceBands(ARGS);
    const row = await db.getHeapFresh('h1');
    expect(row!.base_id).toBe('b2');
    expect(row!.version).toBe(2);
    expect(await db.getBaseVerticesById('b2')).toEqual([{ x: 10, y: 49010 }]);
  });

  it('stamps written bands with the NEW version so deltas pick them up', async () => {
    const db = await seeded();
    await db.adminReplaceBands(ARGS);
    expect(await db.getBandsSince('h1', 1)).toEqual([{ band: 50, minX: -100, maxX: 100 }]);
  });

  it('loses on a stale version and writes NOTHING', async () => {
    const db = await seeded();
    expect(await db.adminReplaceBands({ ...ARGS, expectedVersion: 99 })).toBe(false);
    const row = await db.getHeapFresh('h1');
    expect(row!.base_id).toBe('b1');
    expect(row!.version).toBe(1);
    expect(await db.getBand('h1', 50)).toEqual({ band: 50, minX: -900, maxX: 900 });
    // No orphan base row: a loser must not leave a b2 behind.
    expect(await db.getBaseVerticesById('b2')).toBeNull();
  });

  it('loses on a stale base id — a freeze landing mid-edit — and writes NOTHING', async () => {
    const db = await seeded();
    expect(await db.adminReplaceBands({ ...ARGS, expectedBaseId: 'someOtherBase' })).toBe(false);
    const row = await db.getHeapFresh('h1');
    expect(row!.base_id).toBe('b1');
    expect(row!.version).toBe(1);
    expect(await db.getBand('h1', 50)).toEqual({ band: 50, minX: -900, maxX: 900 });
    expect(await db.getBaseVerticesById('b2')).toBeNull();
  });

  it('creates a band row that did not exist', async () => {
    const db = await seeded();
    await db.adminReplaceBands({ ...ARGS, liveRows: [{ band: 77, minX: -3, maxX: 3 }] });
    expect(await db.getBand('h1', 77)).toEqual({ band: 77, minX: -3, maxX: 3 });
  });

  it('mints a new base id even when no live row changes', async () => {
    const db = await seeded();
    expect(await db.adminReplaceBands({ ...ARGS, liveRows: [] })).toBe(true);
    const row = await db.getHeapFresh('h1');
    expect(row!.base_id).toBe('b2');
    expect(row!.version).toBe(2);
  });

  it('returns false for a heap that does not exist', async () => {
    const db = await seeded();
    expect(await db.adminReplaceBands({ ...ARGS, heapId: 'nope' })).toBe(false);
  });
});

describe('MockHeapDB.adminReplaceBands mirrors D1', () => {
  it('narrows, repoints, bumps, and refuses a stale version', async () => {
    const { MockHeapDB } = await import('./helpers/mockDb');
    const db = new MockHeapDB();
    await db.createHeap('h1', 'b1', [{ x: 480, y: 49000 }], 'hash-b1', NOW, {
      ...DEFAULT_HEAP_PARAMS, worldHeight: 50000,
    });
    await db.upsertBands('h1', [{ band: 50, minX: -900, maxX: 900 }], 1);

    expect(await db.adminReplaceBands(ARGS)).toBe(true);
    expect(await db.getBand('h1', 50)).toEqual({ band: 50, minX: -100, maxX: 100 });
    const row = await db.getHeapFresh('h1');
    expect(row!.base_id).toBe('b2');
    expect(row!.version).toBe(2);

    // Now stale — the CAS must refuse.
    expect(await db.adminReplaceBands(ARGS)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx vitest run tests/adminBandsDb.test.ts`
Expected: FAIL — `adminReplaceBands` does not exist on `D1HeapDB`.

- [ ] **Step 3: Add `AdminReplaceBandsArgs` and the interface member**

In `server/src/db.ts`, after the `FreezeArgs` interface (around line 22), add:

```ts
/** Inputs to a single guarded admin band save. See HeapDB.adminReplaceBands. */
export interface AdminReplaceBandsArgs {
  heapId: string;
  /** The heap version the operator's editor was loaded from. */
  expectedVersion: number;
  /** The base the operator's editor was loaded from. Guarded alongside the
   *  version so a freeze landing mid-edit is caught rather than overwritten. */
  expectedBaseId: string;
  newBaseId: string;
  baseVertices: Vertex[];
  baseHash: string;
  /** heap_band rows to REPLACE. May be empty — the base is minted regardless. */
  liveRows: BandRow[];
  now: string;
}
```

In the `HeapDB` interface, after `clearBands` (around line 219), add:

```ts
  /**
   * The admin band editor's write, in ONE transaction: mint a new base,
   * repoint the heap at it, bump the version, and REPLACE `liveRows`.
   * Returns false when the guard fails, in which case NOTHING was written.
   *
   * Two things separate this from every other band write.
   *
   * First, replace semantics. `upsertBands` widens with MIN/MAX and therefore
   * structurally cannot shrink a band — which is exactly what repairing a spike
   * requires. This one overwrites.
   *
   * Second, the unconditional new base id, even when `liveRows` is empty and no
   * base band changed. `mergeBands` on the client is MIN/MAX too, so a narrowed
   * band delivered as a delta is merged straight back to its old width; the
   * repair would be correct in D1 and invisible in game. A changed base_id is
   * the existing signal that forces a client to discard its bands and take a
   * full response — the same mechanism reset relies on, and for the same reason.
   *
   * The CAS covers `version` AND `base_id`. Version alone would miss a freeze
   * landing between the operator's read and their save: freeze repoints base_id
   * and moves geometry between the layers, so the plan built from the old read
   * no longer describes the heap.
   *
   * As in freezeAtomic, the guard cannot live in JS between the statements — a
   * D1 batch fixes every statement's bind params before any of them run and
   * executes all of them regardless of what the others did. So each statement
   * carries its own correlated subquery.
   */
  adminReplaceBands(args: AdminReplaceBandsArgs): Promise<boolean>;
```

- [ ] **Step 4: Implement it on `D1HeapDB`**

In `server/src/db.ts`, after the `freezeAtomic` method in `D1HeapDB`, add:

```ts
  async adminReplaceBands(args: AdminReplaceBandsArgs): Promise<boolean> {
    const {
      heapId, expectedVersion, expectedBaseId,
      newBaseId, baseVertices, baseHash, liveRows, now,
    } = args;
    const newVersion = expectedVersion + 1;
    const results = await this.d1.batch([
      // 1. Mint the base — only if the version AND base the operator edited are
      //    both still current. A losing racer inserts nothing, so there is no
      //    orphan row to clean up.
      this.d1
        .prepare(
          `INSERT INTO heap_base (id, heap_id, vertices, vertex_hash, created_at)
           SELECT ?1, ?2, ?3, ?4, ?5
            WHERE EXISTS (SELECT 1 FROM heap
                           WHERE id = ?2 AND version = ?6 AND base_id = ?7)`,
        )
        .bind(newBaseId, heapId, JSON.stringify(baseVertices), baseHash, now,
              expectedVersion, expectedBaseId),
      // 2. CAS the heap onto it. This statement's changes count IS the verdict.
      this.d1
        .prepare(
          `UPDATE heap SET base_id = ?1, version = ?2
            WHERE id = ?3 AND version = ?4 AND base_id = ?5`,
        )
        .bind(newBaseId, newVersion, heapId, expectedVersion, expectedBaseId),
      // 3. REPLACE the live rows — not MIN/MAX. Narrowing is the whole point.
      //    Guarded on the heap now pointing at OUR base: base ids are unique per
      //    attempt, which is a stronger test than re-checking the version.
      ...liveRows.map((r) =>
        this.d1
          .prepare(
            `INSERT INTO heap_band (heap_id, band, min_x, max_x, version)
             SELECT ?1, ?2, ?3, ?4, ?5
              WHERE (SELECT base_id FROM heap WHERE id = ?1) = ?6
             ON CONFLICT(heap_id, band) DO UPDATE SET
               min_x   = excluded.min_x,
               max_x   = excluded.max_x,
               version = excluded.version`,
          )
          .bind(heapId, r.band, r.minX, r.maxX, newVersion, newBaseId),
      ),
    ]);
    return results[1].meta.changes > 0;
  }
```

Note on the statement-3 SQL: SQLite needs a `WHERE` clause between an `INSERT … SELECT` and its `ON CONFLICT`, otherwise the parser cannot tell whether `ON` begins an upsert clause or a join constraint. The guard supplies one. If a syntax error still appears, that is the cause — do not remove the guard, since a batch runs every statement regardless of whether statement 2 landed.

- [ ] **Step 5: Implement it on `MockHeapDB`**

In `server/tests/helpers/mockDb.ts`, after `clearBands` (around line 356), add:

```ts
  async adminReplaceBands(args: AdminReplaceBandsArgs): Promise<boolean> {
    const existing = this.heaps.get(args.heapId);
    if (!existing) return false;
    // Mirrors the D1 CAS: a stale version or base id means the operator edited a
    // snapshot that has since moved, and NOTHING is written.
    if (existing.version !== args.expectedVersion) return false;
    if (existing.base_id !== args.expectedBaseId) return false;

    const newVersion = args.expectedVersion + 1;
    this.bases.set(args.newBaseId, {
      heap_id: args.heapId,
      vertices: JSON.stringify(args.baseVertices),
      vertex_hash: args.baseHash,
      created_at: args.now,
    });
    this.heaps.set(args.heapId, {
      ...existing,
      base_id: args.newBaseId,
      version: newVersion,
    });

    let m = this.bands.get(args.heapId);
    if (!m) { m = new Map(); this.bands.set(args.heapId, m); }
    // REPLACE, not MIN/MAX — unlike upsertBands. Narrowing is the point.
    for (const r of args.liveRows) {
      m.set(r.band, { minX: r.minX, maxX: r.maxX, version: newVersion });
    }
    return true;
  }
```

Add `AdminReplaceBandsArgs` to the existing type import at the top of the file:

```ts
import type { HeapDB, HeapRow, HeapSummaryRow, VersionedBandRow, FreezeArgs, AdminReplaceBandsArgs } from '../../src/db';
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd server && npx vitest run tests/adminBandsDb.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 7: Confirm nothing else broke**

Run: `cd server && npm test`
Expected: PASS. `CachedHeapDB` will fail to compile if it does not implement `HeapDB` — if that surfaces here, stop and do Task 3 first, then re-run.

- [ ] **Step 8: Commit**

```bash
git add server/src/db.ts server/tests/helpers/mockDb.ts server/tests/adminBandsDb.test.ts
git commit -m "$(cat <<'EOF'
feat(server): adminReplaceBands with replace semantics and a two-field CAS

upsertBands widens with MIN/MAX and structurally cannot shrink a band,
which is what repairing a spike needs. This one overwrites, in a single
guarded transaction that also mints a new base and bumps the version.

The CAS covers base_id as well as version so a freeze landing mid-edit is
caught. The new base id is minted unconditionally: mergeBands on the client
is MIN/MAX, so a narrowed band sent as a delta merges back to its old
width, and a changed base id is what forces a full response.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `CachedHeapDB` decorator

**Files:**
- Modify: `server/src/cache/CachedHeapDB.ts` (after the `freezeAtomic` decorator)
- Test: `server/tests/cacheDecorators.test.ts` (append a test)

**Interfaces:**
- Consumes: `AdminReplaceBandsArgs`, `HeapDB.adminReplaceBands` from Task 2.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

`server/tests/cacheDecorators.test.ts` already has everything needed inside its `describe('CachedHeapDB')` block: a module-level `const noWait = (_p: Promise<unknown>) => {};`, a `setup()` helper returning `{ inner, kv, cached }` built as `new CachedHeapDB(inner, kv.asKV(), noWait)`, a `const HEAP_ID = 'heap-1'`, `kv.has(key)` for assertions, and `inner.seedHeap(id, version, liveZone, baseId?)`. Append this test **inside** that existing `describe`, so `setup` and `HEAP_ID` are in scope:

```ts
  it('adminReplaceBands busts both the heap row and the list cache', async () => {
    const { inner, kv, cached } = setup();
    inner.seedHeap(HEAP_ID, 1, [], 'b1');

    // Populate both keys.
    await cached.getHeap(HEAP_ID);
    await cached.listHeaps();
    expect(kv.has(`cache:heap:${HEAP_ID}`)).toBe(true);
    expect(kv.has('cache:heap:list')).toBe(true);

    const applied = await cached.adminReplaceBands({
      heapId: HEAP_ID,
      expectedVersion: 1,
      expectedBaseId: 'b1',
      newBaseId: 'b2',
      baseVertices: [{ x: 3, y: 4 }],
      baseHash: 'hash-b2',
      liveRows: [{ band: 5, minX: -1, maxX: 1 }],
      now: '2026-07-29T00:00:00.000Z',
    });

    expect(applied).toBe(true);
    // invalidateHeap, not invalidateHeapRow — base_id decides whether a client's
    // cached geometry is still valid, so the list summary must go too.
    expect(kv.has(`cache:heap:${HEAP_ID}`)).toBe(false);
    expect(kv.has('cache:heap:list')).toBe(false);
  });
```

`seedHeap`'s fourth parameter is `baseId` and defaults to the heap id, so passing `'b1'` explicitly is what makes `expectedBaseId: 'b1'` match. Note `seedHeap` writes no `heap_base` row — that is fine here, because `MockHeapDB.adminReplaceBands` never reads the old base.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx vitest run tests/cacheDecorators.test.ts`
Expected: FAIL — either a compile error (`adminReplaceBands` missing on `CachedHeapDB`) or the cache keys still present.

- [ ] **Step 3: Implement the decorator**

In `server/src/cache/CachedHeapDB.ts`, after the `freezeAtomic` decorator, add:

```ts
  async adminReplaceBands(args: AdminReplaceBandsArgs): Promise<boolean> {
    const applied = await this.inner.adminReplaceBands(args);
    // Changes base_id and version on the heap row AND rewrites band rows, so
    // both the snapshot and the list summary are stale. invalidateHeap, not
    // invalidateHeapRow: base_id is what a client uses to decide whether its
    // cached geometry is still valid, so serving a stale one is not the
    // cosmetic staleness commitPlacement tolerates.
    //
    // Unconditional, win or lose. A losing CAS wrote nothing, so the delete is
    // redundant — but admin saves are rare, and a redundant KV delete costs
    // less than a branch whose correctness depends on the return value.
    await this.invalidateHeap(args.heapId);
    return applied;
  }
```

Add `AdminReplaceBandsArgs` to the existing type import from `../db` at the top of the file.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && npx vitest run tests/cacheDecorators.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/cache/CachedHeapDB.ts server/tests/cacheDecorators.test.ts
git commit -m "$(cat <<'EOF'
feat(server): invalidate heap caches on adminReplaceBands

Busts both keys rather than the row alone: base_id is what a client uses to
decide whether its cached geometry is still valid, so a stale one is not the
cosmetic staleness commitPlacement tolerates.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `GET /heaps/:id/bands`

**Files:**
- Modify: `server/src/routes/heap.ts` (register **before** the `/:id` route, next to `/:id/base` at line 245)
- Modify: `server/src/app.ts` (admin gate, near line 104)
- Modify: `server/src/db.ts` (update the `getAllBandsVersioned` doc comment)
- Test: `server/tests/adminBandsRoute.test.ts` (create)

**Interfaces:**
- Consumes: `AdminBandsResponse` from Task 1.
- Produces: `GET /heaps/:id/bands`.

- [ ] **Step 1: Write the failing test**

Create `server/tests/adminBandsRoute.test.ts`:

```ts
// server/tests/adminBandsRoute.test.ts
//
// Route-level behaviour for the admin band editor. The SQL is proven in
// adminBandsDb.test.ts and the fan-out rule in adminBandPlan.test.ts; this pins
// the wiring — the layer split on read, validation, and the 409 contract.

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { DEFAULT_HEAP_PARAMS, type AdminBandsResponse } from '../../shared/heapTypes';
import { BAND_SIZE_PX, bandMidY } from '../../shared/heapPolygon/bandEnvelope';

const NOW = new Date().toISOString();
const SECRET = 's3cret';

/**
 * Heap h1 whose base covers bands 200 and 201, with live rows at bands 100
 * and 101, frozen at band 150.
 */
async function seeded() {
  const db = new MockHeapDB();
  await db.createHeap(
    'h1', 'b1',
    [
      { x: -800, y: bandMidY(200) }, { x: 800, y: bandMidY(200) },
      { x: -900, y: bandMidY(201) }, { x: 900, y: bandMidY(201) },
    ],
    'hash-b1', NOW,
    { ...DEFAULT_HEAP_PARAMS, worldHeight: 50000 },
  );
  await db.upsertBands('h1', [
    { band: 100, minX: -100, maxX: 100 },
    { band: 101, minX: -200, maxX: 200 },
  ], 1);
  const row = await db.getHeapFresh('h1');
  await db.updateHeap('h1', row!.base_id, row!.version, [], 150 * BAND_SIZE_PX, row!.top_y);
  return db;
}

function app(db: MockHeapDB) {
  return createApp(db, new MockScoreDB(), { adminSecret: SECRET });
}

const AUTH = { 'X-Admin-Secret': SECRET, 'Content-Type': 'application/json' };

describe('GET /heaps/:id/bands', () => {
  it('requires the admin secret', async () => {
    const res = await app(await seeded()).request('/heaps/h1/bands');
    expect(res.status).toBe(401);
  });

  it('splits live rows from base bands', async () => {
    const res = await app(await seeded()).request('/heaps/h1/bands', { headers: AUTH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdminBandsResponse;
    expect(body.baseId).toBe('b1');
    expect(body.freezeY).toBe(150 * BAND_SIZE_PX);
    expect(body.worldHeight).toBe(50000);
    expect(body.liveBands).toEqual([
      { band: 100, minX: -100, maxX: 100 },
      { band: 101, minX: -200, maxX: 200 },
    ]);
    expect(body.baseBands).toEqual([
      { band: 200, minX: -800, maxX: 800 },
      { band: 201, minX: -900, maxX: 900 },
    ]);
  });

  it('excludes straggler band rows below the freeze line', async () => {
    const db = await seeded();
    // A row at band 160 is below the freeze band (150) — invisible to players,
    // so it must not appear in the editor either.
    await db.upsertBands('h1', [{ band: 160, minX: -5, maxX: 5 }], 2);
    const res = await app(db).request('/heaps/h1/bands', { headers: AUTH });
    const body = (await res.json()) as AdminBandsResponse;
    expect(body.liveBands.map((b) => b.band)).toEqual([100, 101]);
  });

  it('404s for an unknown heap', async () => {
    const res = await app(await seeded()).request('/heaps/nope/bands', { headers: AUTH });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx vitest run tests/adminBandsRoute.test.ts`
Expected: FAIL — the route does not exist (404 where 200 is expected, 200 where 401 is expected).

- [ ] **Step 3: Add the route**

In `server/src/routes/heap.ts`, immediately **before** the existing `GET /:id/base` handler (line 245), add:

```ts
  // GET /heaps/:id/bands — the admin band editor's read. Deliberately uncached.
  // NOTE: must be registered before /:id to prevent Hono matching "bands" as an id
  app.get('/:id/bands', async (c) => {
    const id = c.req.param('id');
    // getHeapFresh, not getHeap: the editor CAS-es on the version it loaded, so
    // a 60s-old snapshot would mean saving against a version that has already
    // moved — failing repeatedly for up to a minute on an active heap.
    const row = await db.getHeapFresh(id);
    if (!row) return c.json({ error: 'Heap not found' }, 404);

    const [baseVertices, allBands] = await Promise.all([
      db.getBaseVerticesById(row.base_id),
      // getAllBandsVersioned, not getAllBands, for the same reason: the former
      // reads through the cache, the latter is served from it.
      db.getAllBandsVersioned(id),
    ]);

    return c.json({
      version: row.version,
      baseId: row.base_id,
      freezeY: row.freeze_y,
      worldHeight: row.world_height,
      // Mirrors what players see: rows below the freeze line render for nobody.
      // The version each row carries is dropped — the editor has no use for it,
      // and the heap's own version is what the CAS keys on.
      liveBands: liveBandsOf(row, allBands).map(({ band, minX, maxX }) => ({ band, minX, maxX })),
      baseBands: envelopeToRows(verticesToEnvelope(baseVertices ?? [])),
    } satisfies AdminBandsResponse);
  });
```

Add `AdminBandsResponse` to the `shared/heapTypes` import at the top of `server/src/routes/heap.ts`.

- [ ] **Step 4: Gate it**

In `server/src/app.ts`, in the admin gate block (after line 104's `const adminGate = …`), add alongside the existing heap gates:

```ts
  app.get   ('/heaps/:id/bands',        adminGate);
```

- [ ] **Step 5: Update the stale doc comment**

In `server/src/db.ts`, the `getAllBandsVersioned` doc comment says *"The freeze path is the only caller"*. That is now false. Replace that sentence with:

```
   * Two callers: the freeze path, which needs the versions to compute the
   * watermark that bounds its DELETE (a stale watermark would let it bury a row
   * the new base never captured), and GET /heaps/:id/bands, which needs the
   * read-through rather than the versions — the admin editor CAS-es on the
   * version it loaded, so a cached snapshot would make saving fail for as long
   * as the entry lives.
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd server && npx vitest run tests/adminBandsRoute.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/heap.ts server/src/app.ts server/src/db.ts server/tests/adminBandsRoute.test.ts
git commit -m "$(cat <<'EOF'
feat(server): GET /heaps/:id/bands for the admin band editor

One uncached read returning both layers already in band form. Uncached
because the editor CAS-es on the version it loaded; the conversion is
server-side because admin/index.html is standalone and cannot import
verticesToEnvelope.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `PUT /heaps/:id/bands`

**Files:**
- Modify: `server/src/routes/heap.ts` (immediately after the `GET /:id/bands` handler)
- Modify: `server/src/app.ts` (admin gate)
- Test: `server/tests/adminBandsRoute.test.ts` (append)

**Interfaces:**
- Consumes: `planBandWrite` (Task 1), `adminReplaceBands` (Task 2), `AdminBandsRequest` / `AdminBandsWriteResponse` / `AdminBandsConflictResponse` (Task 1).
- Produces: `PUT /heaps/:id/bands`.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/adminBandsRoute.test.ts` (reusing `seeded`, `app`, `AUTH`, `SECRET` from Task 4):

```ts
async function put(db: MockHeapDB, body: unknown, headers = AUTH) {
  const res = await app(db).request('/heaps/h1/bands', {
    method: 'PUT', headers, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as any };
}

async function current(db: MockHeapDB) {
  const row = await db.getHeapFresh('h1');
  return { expectedVersion: row!.version, expectedBaseId: row!.base_id };
}

describe('PUT /heaps/:id/bands', () => {
  it('requires the admin secret', async () => {
    const db = await seeded();
    const res = await app(db).request('/heaps/h1/bands', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(await current(db)), bands: [{ band: 100, minX: 0, maxX: 1 }] }),
    });
    expect(res.status).toBe(401);
  });

  it('narrows a live band and bumps the version', async () => {
    const db = await seeded();
    const r = await put(db, { ...(await current(db)), bands: [{ band: 100, minX: -10, maxX: 10 }] });
    expect(r.status).toBe(200);
    expect(r.body.version).toBe(2);
    expect(await db.getBand('h1', 100)).toEqual({ band: 100, minX: -10, maxX: 10 });
  });

  it('mints a new base id even for a live-only edit', async () => {
    const db = await seeded();
    const before = await current(db);
    const r = await put(db, { ...before, bands: [{ band: 100, minX: -10, maxX: 10 }] });
    expect(r.body.baseId).not.toBe(before.expectedBaseId);
    expect((await db.getHeapFresh('h1'))!.base_id).toBe(r.body.baseId);
  });

  it('rewrites the base when a base band is edited', async () => {
    const db = await seeded();
    const r = await put(db, { ...(await current(db)), bands: [{ band: 200, minX: -1, maxX: 1 }] });
    expect(r.status).toBe(200);
    const verts = await db.getBaseVerticesById(r.body.baseId);
    // Band 200 narrowed to [-1, 1]; band 201 survives untouched.
    expect(verts).toEqual([
      { x: -1,   y: bandMidY(200) }, { x: 1,   y: bandMidY(200) },
      { x: -900, y: bandMidY(201) }, { x: 900, y: bandMidY(201) },
    ]);
  });

  it('409s on a stale version, writing nothing', async () => {
    const db = await seeded();
    const cur = await current(db);
    const r = await put(db, { ...cur, expectedVersion: 99, bands: [{ band: 100, minX: 0, maxX: 1 }] });
    expect(r.status).toBe(409);
    expect(r.body.version).toBe(cur.expectedVersion);
    expect(r.body.baseId).toBe(cur.expectedBaseId);
    expect(await db.getBand('h1', 100)).toEqual({ band: 100, minX: -100, maxX: 100 });
  });

  it('409s on a stale base id', async () => {
    const db = await seeded();
    const r = await put(db, {
      ...(await current(db)), expectedBaseId: 'someOtherBase',
      bands: [{ band: 100, minX: 0, maxX: 1 }],
    });
    expect(r.status).toBe(409);
  });

  it('rejects an empty band list', async () => {
    const db = await seeded();
    expect((await put(db, { ...(await current(db)), bands: [] })).status).toBe(400);
  });

  it('rejects more than 500 bands', async () => {
    const db = await seeded();
    const bands = Array.from({ length: 501 }, (_, i) => ({ band: i, minX: 0, maxX: 1 }));
    expect((await put(db, { ...(await current(db)), bands })).status).toBe(400);
  });

  it('rejects a non-integer band, a negative band, and a band past world height', async () => {
    const db = await seeded();
    const cur = await current(db);
    expect((await put(db, { ...cur, bands: [{ band: 1.5, minX: 0, maxX: 1 }] })).status).toBe(400);
    expect((await put(db, { ...cur, bands: [{ band: -1,  minX: 0, maxX: 1 }] })).status).toBe(400);
    expect((await put(db, { ...cur, bands: [{ band: 999999, minX: 0, maxX: 1 }] })).status).toBe(400);
  });

  it('rejects non-finite extents and minX > maxX', async () => {
    const db = await seeded();
    const cur = await current(db);
    expect((await put(db, { ...cur, bands: [{ band: 100, minX: 0, maxX: 'x' }] })).status).toBe(400);
    expect((await put(db, { ...cur, bands: [{ band: 100, minX: 50, maxX: 10 }] })).status).toBe(400);
  });

  it('rejects duplicate bands', async () => {
    const db = await seeded();
    const cur = await current(db);
    const bands = [{ band: 100, minX: 0, maxX: 1 }, { band: 100, minX: 2, maxX: 3 }];
    expect((await put(db, { ...cur, bands })).status).toBe(400);
  });

  it('404s for an unknown heap', async () => {
    const db = await seeded();
    const res = await app(db).request('/heaps/nope/bands', {
      method: 'PUT', headers: AUTH,
      body: JSON.stringify({ expectedVersion: 1, expectedBaseId: 'b1', bands: [{ band: 1, minX: 0, maxX: 1 }] }),
    });
    expect(res.status).toBe(404);
  });
});

describe('PUT /heaps/:id/bands — the layer-union case', () => {
  it('narrows a band held by BOTH layers in both, so the union narrows', async () => {
    // The regression this guards is the whole feature silently not working: the
    // live row narrows, the base does not, and the rendered union keeps the
    // spike because the client builds [...base, ...liveVertices].
    const db = new MockHeapDB();
    await db.createHeap('h1', 'b1',
      [{ x: -900, y: bandMidY(7) }, { x: 900, y: bandMidY(7) }],
      'hash-b1', NOW, { ...DEFAULT_HEAP_PARAMS, worldHeight: 50000 });
    // freeze_y stays 0 — the "nothing frozen" sentinel, so band 7 is also live.
    await db.upsertBands('h1', [{ band: 7, minX: -900, maxX: 900 }], 1);

    const row = await db.getHeapFresh('h1');
    const res = await app(db).request('/heaps/h1/bands', {
      method: 'PUT', headers: AUTH,
      body: JSON.stringify({
        expectedVersion: row!.version, expectedBaseId: row!.base_id,
        bands: [{ band: 7, minX: -50, maxX: 50 }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(await db.getBand('h1', 7)).toEqual({ band: 7, minX: -50, maxX: 50 });
    expect(await db.getBaseVerticesById(body.baseId)).toEqual([
      { x: -50, y: bandMidY(7) }, { x: 50, y: bandMidY(7) },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx vitest run tests/adminBandsRoute.test.ts`
Expected: FAIL — the `PUT` route does not exist.

- [ ] **Step 3: Add the route**

In `server/src/routes/heap.ts`, immediately after the `GET /:id/bands` handler, add:

```ts
  // PUT /heaps/:id/bands — the admin band editor's batched save.
  // NOTE: must be registered before /:id to prevent Hono matching "bands" as an id
  app.put('/:id/bands', async (c) => {
    const id = c.req.param('id');

    let body: AdminBandsRequest;
    try {
      body = await c.req.json<AdminBandsRequest>();
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    const row = await db.getHeapFresh(id);
    if (!row) return c.json({ error: 'Heap not found' }, 404);

    if (!Number.isInteger(body.expectedVersion)) {
      return c.json({ error: 'expectedVersion must be an integer' }, 400);
    }
    if (typeof body.expectedBaseId !== 'string' || body.expectedBaseId.length === 0) {
      return c.json({ error: 'expectedBaseId must be a non-empty string' }, 400);
    }
    if (!Array.isArray(body.bands) || body.bands.length === 0) {
      return c.json({ error: 'bands must be a non-empty array' }, 400);
    }
    if (body.bands.length > MAX_ADMIN_BANDS) {
      return c.json({ error: `bands must not exceed ${MAX_ADMIN_BANDS} entries` }, 400);
    }

    const maxBand = Math.floor(row.world_height / BAND_SIZE_PX);
    const seen = new Set<number>();
    for (const r of body.bands) {
      if (!r || typeof r !== 'object') {
        return c.json({ error: 'each band must be an object' }, 400);
      }
      if (!Number.isInteger(r.band) || r.band < 0 || r.band > maxBand) {
        return c.json({ error: `band must be an integer in [0, ${maxBand}]` }, 400);
      }
      if (seen.has(r.band)) return c.json({ error: `duplicate band ${r.band}` }, 400);
      seen.add(r.band);
      if (!Number.isFinite(r.minX) || !Number.isFinite(r.maxX)) {
        return c.json({ error: `band ${r.band}: minX and maxX must be finite numbers` }, 400);
      }
      if (r.minX > r.maxX) {
        return c.json({ error: `band ${r.band}: minX must not exceed maxX` }, 400);
      }
    }

    // Checked here so a doomed save costs one read instead of a whole plan. It
    // is NOT what makes the write safe — adminReplaceBands guards again in SQL,
    // which is the check that actually holds under concurrency.
    if (row.version !== body.expectedVersion || row.base_id !== body.expectedBaseId) {
      return c.json({
        error: 'heap changed since load', version: row.version, baseId: row.base_id,
      } satisfies AdminBandsConflictResponse, 409);
    }

    const [baseVertices, allBands] = await Promise.all([
      db.getBaseVerticesById(row.base_id),
      db.getAllBandsVersioned(id),
    ]);

    const plan = planBandWrite({
      dirty:     body.bands,
      baseRows:  envelopeToRows(verticesToEnvelope(baseVertices ?? [])),
      // Database state, not what the editor loaded: a straggler row below the
      // freeze line is hidden from the editor but must still be replaced.
      liveBands: new Set(allBands.map((b) => b.band)),
      freezeY:   row.freeze_y,
    });

    const nextBaseVertices = envelopeToVertices(mergeBands(new Map(), plan.nextBaseRows));
    const newBaseId = crypto.randomUUID();
    const applied = await db.adminReplaceBands({
      heapId: id,
      expectedVersion: body.expectedVersion,
      expectedBaseId: body.expectedBaseId,
      newBaseId,
      baseVertices: nextBaseVertices,
      baseHash: hashVertices(nextBaseVertices),
      liveRows: plan.liveRows,
      now: new Date().toISOString(),
    });

    if (!applied) {
      const fresh = await db.getHeapFresh(id);
      return c.json({
        error: 'heap changed since load',
        version: fresh?.version ?? row.version,
        baseId:  fresh?.base_id ?? row.base_id,
      } satisfies AdminBandsConflictResponse, 409);
    }

    return c.json({
      version: body.expectedVersion + 1, baseId: newBaseId,
    } satisfies AdminBandsWriteResponse);
  });
```

Near the top of `server/src/routes/heap.ts`, beside the other module-level constants, add:

```ts
/** Cap on one admin band save. Base edits are O(1) statements regardless of how
 *  many bands they touch (one blob rewrite), so this bounds only the live-row
 *  statement count — and the live zone runs to roughly 77 bands. */
const MAX_ADMIN_BANDS = 500;
```

Extend the imports: add `AdminBandsRequest`, `AdminBandsWriteResponse`, `AdminBandsConflictResponse` to the `shared/heapTypes` import, and `envelopeToVertices` plus `mergeBands` to the `bandEnvelope` import if they are not already there.

- [ ] **Step 4: Gate it**

In `server/src/app.ts`, beside the `GET` gate added in Task 4:

```ts
  app.put   ('/heaps/:id/bands',        adminGate);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && npx vitest run tests/adminBandsRoute.test.ts`
Expected: PASS — 4 from Task 4 plus 13 here.

- [ ] **Step 6: Run the whole server suite**

Run: `cd server && npm test`
Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/heap.ts server/src/app.ts server/tests/adminBandsRoute.test.ts
git commit -m "$(cat <<'EOF'
feat(server): PUT /heaps/:id/bands, the band editor's batched save

Validated, CAS-guarded on version and base_id, and fanned across both
layers by planBandWrite. The layer-union test is the one that matters: a
band held by both layers must narrow in both, or the client's
[...base, ...liveVertices] keeps the old width and the repair is invisible.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Admin UI — markup, state model, load, overview canvas

From here on the deliverable is `admin/index.html`, which has no test harness — it is a standalone file with no module boundary. Verification is by browser. Every task in this group ends with a real check against a running Worker.

**Files:**
- Modify: `admin/index.html`

**Interfaces:**
- Consumes: `GET /heaps/:id/bands` (Task 4).
- Produces: globals `bandState`, `bandEdits`, `bandSel`, `bandWinTop`, `BAND_PX`, `BAND_WIN`, `BAND_COLORS`; functions `bandMerged()`, `bandLayers(band)`, `bandDomain(merged)`, `loadBands(heapId)`, `resetBandEditor()`, `renderBandOverview()`, `renderBandAll()`, `bootBandEditor()`.

- [ ] **Step 1: Start a local Worker and seed it**

```bash
npm run seed
cd server && npm run dev
```

`wrangler dev` serves on `http://localhost:8787`, which is the admin page's `Local` preset. Leave it running. Open `admin/index.html` from disk, pick the **Local** environment, and confirm the Heaps table populates and the reachability dot is green before changing anything — that is the baseline this task builds on.

- [ ] **Step 2: Add the markup**

In `admin/index.html`, inside the `editPanel` card, after the last enemy-kind section (`section-jumper`) and before the card's closing `</div>`, add:

```html
    <h3 class="card-sub">Silhouette <span class="muted">— band editor</span></h3>
    <div class="card border-l-term-cyan">
      <button id="bandLoad" class="btn btn-sm">Load silhouette</button>
      <div id="bandEditor" style="display:none;" class="mt-3">
        <div class="flex flex-col gap-3 md:flex-row">
          <div>
            <div class="lbl">All bands</div>
            <canvas id="bandOverview" width="64" height="420"
                    class="cursor-ns-resize border border-term-line bg-black"></canvas>
          </div>
          <div class="min-w-0 flex-1">
            <div class="lbl">Window <span id="bandWinLabel" class="text-term-text">—</span></div>
            <svg id="bandDetail" viewBox="0 0 600 640"
                 class="w-full border border-term-line bg-black"
                 style="touch-action:none"></svg>
          </div>
          <div class="md:w-52">
            <div class="lbl">Selected band</div>
            <div class="rounded-sm border border-term-line bg-black p-2">
              <div id="bandMeta" class="muted mb-2">no band selected</div>
              <label class="lbl">min_x</label>
              <input id="bandMinX" type="number" step="1" class="field" />
              <label class="lbl">max_x</label>
              <input id="bandMaxX" type="number" step="1" class="field" />
              <button id="bandApply" class="btn btn-sm">Apply</button>
              <div class="card-sub">Re-derive range</div>
              <label class="lbl">from band</label>
              <input id="bandFrom" type="number" step="1" class="field" />
              <label class="lbl">to band</label>
              <input id="bandTo" type="number" step="1" class="field" />
              <button id="bandRederive" class="btn btn-sm">Re-derive</button>
            </div>
          </div>
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-3">
          <span id="bandDirty" class="badge">0 bands dirty</span>
          <span class="badge"><span class="dot dot-ok"></span>live</span>
          <span class="badge"><span class="dot" style="background:#00ccff"></span>base</span>
          <span class="badge"><span class="dot" style="background:#3ecf8e"></span>both</span>
          <span class="badge"><span class="dot" style="background:#ffaa00"></span>edited</span>
          <button id="bandSave" class="btn btn-sm">Save Bands</button>
          <button id="bandDiscard" class="btn btn-sm btn-danger">Discard</button>
        </div>
      </div>
    </div>
```

- [ ] **Step 3: Add the state model and loader**

In the `<script>` block, after the enemy-params functions and before the Reward Codes section, add:

```js
    // ────── Band editor ────────────────────────────────────────────────────
    //
    // The heap's shape lives in two layers and the game renders their UNION:
    // HeapClient builds its polygon as [...base, ...liveVertices] and buckets to
    // bands afterwards. So this editor shows the merged envelope — what players
    // actually see — and colours each band by which layer(s) hold it. The server
    // decides where an edit is written; the operator never picks a layer.

    /** Must match BAND_SIZE_PX in shared/heapPolygon/bandEnvelope.ts. This file
     *  is standalone (no bundler, no imports), so it cannot import the constant. */
    const BAND_PX = 20;
    /** Bands visible in the detail pane at once. */
    const BAND_WIN = 40;
    const BAND_COLORS = { live: '#00ff00', base: '#00ccff', both: '#3ecf8e', dirty: '#ffaa00' };

    let bandState = null;          // { version, baseId, freezeY, worldHeight, base:Map, live:Map, dom }
    let bandEdits = new Map();     // band -> { minX, maxX } — staged, unsaved
    let bandSel   = null;          // selected band index
    let bandWinTop = 0;            // topmost band index shown in the detail pane

    /** The union of both layers, with staged edits REPLACING it. An edit is the
     *  operator's intent for the band, not another extent to union in. */
    function bandMerged() {
      const m = new Map();
      const put = (band, e) => {
        const cur = m.get(band);
        m.set(band, cur
          ? { minX: Math.min(cur.minX, e.minX), maxX: Math.max(cur.maxX, e.maxX) }
          : { minX: e.minX, maxX: e.maxX });
      };
      for (const [b, e] of bandState.base) put(b, e);
      for (const [b, e] of bandState.live) put(b, e);
      for (const [b, e] of bandEdits) m.set(b, { minX: e.minX, maxX: e.maxX });
      return m;
    }

    function bandLayers(band) {
      const inBase = bandState.base.has(band);
      const inLive = bandState.live.has(band);
      return inBase && inLive ? 'both' : inBase ? 'base' : 'live';
    }

    /** Fixed once per load. Recomputing during a drag would rescale the pane
     *  under the pointer, so the handle would not follow the cursor. */
    function bandDomain(merged) {
      let lo = Infinity, hi = -Infinity;
      for (const e of merged.values()) {
        if (e.minX < lo) lo = e.minX;
        if (e.maxX > hi) hi = e.maxX;
      }
      if (!isFinite(lo)) return { lo: 0, hi: 1 };
      const pad = Math.max(1, (hi - lo) * 0.2);
      return { lo: lo - pad, hi: hi + pad };
    }

    function bandKeys() {
      return [...bandMerged().keys()].sort((a, b) => a - b);
    }

    function resetBandEditor() {
      bandState = null;
      bandEdits = new Map();
      bandSel = null;
      bandWinTop = 0;
      const ed = $('bandEditor');
      if (ed) ed.style.display = 'none';
    }

    async function loadBands(heapId) {
      const gen = envGeneration;
      try {
        const res = await adminFetch(`/heaps/${heapId}/bands`);
        if (gen !== envGeneration) return; // operator switched environments mid-flight
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || ('load failed: ' + res.status));
        }
        const d = await res.json();
        if (gen !== envGeneration) return;

        bandState = {
          version: d.version,
          baseId: d.baseId,
          freezeY: d.freezeY,
          worldHeight: d.worldHeight,
          base: new Map(d.baseBands.map(b => [b.band, { minX: b.minX, maxX: b.maxX }])),
          live: new Map(d.liveBands.map(b => [b.band, { minX: b.minX, maxX: b.maxX }])),
        };
        bandEdits = new Map();
        bandSel = null;
        bandState.dom = bandDomain(bandMerged());
        const ks = bandKeys();
        bandWinTop = ks.length ? ks[0] : 0;
        $('bandEditor').style.display = '';
        renderBandAll();
        setStatus(`silhouette loaded — v${d.version}, ${ks.length} bands`, 'ok');
      } catch (e) {
        setStatus('Failed to load silhouette: ' + e.message, 'err');
      }
    }
```

- [ ] **Step 4: Add the overview renderer and the render entry point**

Append to the same block:

```js
    function renderBandOverview() {
      const cv = $('bandOverview');
      const ctx = cv.getContext('2d');
      const W = cv.width, H = cv.height;
      ctx.clearRect(0, 0, W, H);

      const merged = bandMerged();
      const ks = bandKeys();
      if (ks.length === 0) return;
      const first = ks[0], rows = ks[ks.length - 1] - first + 1;
      const { lo, hi } = bandState.dom;
      const sx = (x) => ((x - lo) / (hi - lo)) * W;
      const sy = (band) => ((band - first) / rows) * H;
      const rowH = Math.max(1, H / rows);

      for (const band of ks) {
        const e = merged.get(band);
        ctx.fillStyle = bandEdits.has(band) ? BAND_COLORS.dirty : BAND_COLORS[bandLayers(band)];
        ctx.fillRect(sx(e.minX), sy(band), Math.max(1, sx(e.maxX) - sx(e.minX)), rowH);
      }

      if (bandState.freezeY > 0) {
        const fy = sy(Math.floor(bandState.freezeY / BAND_PX));
        ctx.strokeStyle = '#ffaa00';
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(W, fy); ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.strokeStyle = '#00ff00';
      ctx.strokeRect(0.5, sy(bandWinTop), W - 1, Math.max(2, rowH * BAND_WIN));
    }

    function renderBandAll() {
      if (!bandState) return;
      renderBandOverview();
      $('bandDirty').textContent = bandEdits.size + ' bands dirty';
    }

    /** Drag anywhere on the overview to scrub the detail window. */
    function bootBandOverviewScrub() {
      const cv = $('bandOverview');
      let scrubbing = false;
      const scrub = (ev) => {
        if (!bandState) return;
        const ks = bandKeys();
        if (ks.length === 0) return;
        const first = ks[0], last = ks[ks.length - 1];
        const r = cv.getBoundingClientRect();
        const frac = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
        const target = Math.round(first + frac * (last - first + 1)) - Math.floor(BAND_WIN / 2);
        bandWinTop = Math.max(first, Math.min(target, Math.max(first, last - BAND_WIN + 1)));
        renderBandAll();
      };
      cv.addEventListener('pointerdown', (ev) => {
        scrubbing = true; cv.setPointerCapture(ev.pointerId); scrub(ev);
      });
      cv.addEventListener('pointermove', (ev) => { if (scrubbing) scrub(ev); });
      cv.addEventListener('pointerup', (ev) => {
        scrubbing = false; cv.releasePointerCapture(ev.pointerId);
      });
    }

    function bootBandEditor() {
      $('bandLoad').onclick = () => { if (editingHeapId) loadBands(editingHeapId); };
      bootBandOverviewScrub();
    }
```

- [ ] **Step 5: Reset the editor when the edit panel changes heap**

In `showEditPanel`, add `resetBandEditor();` as the **first** statement in the function body, before `editingHeapId = heap.id;`. Without it, opening heap B shows heap A's silhouette and a save would CAS against the wrong heap's version.

In `hideEditPanel` (the function that sets `editingHeapId = null`, around line 536), add `resetBandEditor();`.

- [ ] **Step 6: Wire boot**

In the `DOMContentLoaded` handler, add `bootBandEditor();` after `bootEditHeap();`.

- [ ] **Step 7: Verify in the browser**

With the Worker still running and the admin page open on **Local**:

1. Click Edit on a seeded heap. The **Silhouette** section appears with a **Load silhouette** button.
2. Click it. The status bar reports `silhouette loaded — vN, M bands` and the overview canvas draws a heap-shaped column of bars.
3. Bar colours are meaningful: on a never-frozen heap almost everything should be **teal (`both`)**, because `freeze_y = 0` makes every band live while the base still covers those bands. Blue-only or green-only bands mean the layers genuinely diverge there.
4. Drag vertically on the canvas — the green window rectangle follows the pointer and stays inside the band range.
5. Open Edit on a different heap. The silhouette section collapses back to just the button (no stale canvas).
6. Switch environment while the silhouette is loaded — the panel closes and no error is thrown.

- [ ] **Step 8: Commit**

```bash
git add admin/index.html
git commit -m "$(cat <<'EOF'
feat(admin): band editor state model and overview canvas

Renders the merged envelope — the union the game actually draws — with
per-band colour for which layer(s) hold it. Overview drag scrubs the
detail window. The x-domain is fixed at load so a later drag cannot
rescale the pane under the pointer.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Admin UI — detail pane, handles, selection, drag

**Files:**
- Modify: `admin/index.html`

**Interfaces:**
- Consumes: everything Task 6 produced.
- Produces: `renderBandDetail()`, `renderBandInspector()`, `bandStage(band, extents)`, `bootBandDrag()`; `renderBandAll()` gains two calls.

- [ ] **Step 1: Add the detail renderer**

After `renderBandOverview`, add:

```js
    function renderBandDetail() {
      const svg = $('bandDetail');
      const merged = bandMerged();
      const ks = bandKeys();
      if (ks.length === 0) { svg.innerHTML = ''; return; }

      const last = ks[ks.length - 1];
      const top = Math.max(ks[0], Math.min(bandWinTop, Math.max(ks[0], last - BAND_WIN + 1)));
      const W = 600, ROW = 16;
      const { lo, hi } = bandState.dom;
      const sx = (x) => ((x - lo) / (hi - lo)) * W;
      const cy = (band) => (band - top) * ROW + ROW / 2;

      const bars = [], edges = [], handles = [];
      let prev = null;
      for (let band = top; band < top + BAND_WIN; band++) {
        const e = merged.get(band);
        if (!e) continue;                       // genuinely empty band — a gap
        const dirty = bandEdits.has(band);
        const col = dirty ? BAND_COLORS.dirty : BAND_COLORS[bandLayers(band)];
        const y = cy(band);
        const x0 = sx(e.minX), x1 = sx(e.maxX);

        bars.push(`<rect x="${x0}" y="${y - 5}" width="${Math.max(1, x1 - x0)}" height="10"
                         fill="${col}" opacity="0.45" data-band="${band}"/>`);

        // The two edges the client renders. A segment that spans a missing band
        // is dashed: that dashed run IS the forward-fill sawtooth, and it is the
        // only way a gap is visible at all — an empty row just looks empty.
        if (prev) {
          const dash = (band !== prev.band + 1) ? ' stroke-dasharray="4 3" opacity="0.5"' : '';
          edges.push(`<line x1="${prev.x0}" y1="${prev.y}" x2="${x0}" y2="${y}"
                            stroke="${col}" stroke-width="1.2"${dash}/>`);
          edges.push(`<line x1="${prev.x1}" y1="${prev.y}" x2="${x1}" y2="${y}"
                            stroke="${col}" stroke-width="1.2"${dash}/>`);
        }
        prev = { band, x0, x1, y };

        const ring = band === bandSel ? '#ffffff' : col;
        for (const side of ['minX', 'maxX']) {
          handles.push(`<rect class="bandHandle" data-band="${band}" data-side="${side}"
                              x="${sx(e[side]) - 4}" y="${y - 4}" width="8" height="8"
                              fill="#0a0a0a" stroke="${ring}" stroke-width="1.5"
                              style="cursor:ew-resize"/>`);
        }
      }

      let freeze = '';
      if (bandState.freezeY > 0) {
        const fb = Math.floor(bandState.freezeY / BAND_PX);
        if (fb >= top && fb < top + BAND_WIN) {
          const fy = cy(fb) - ROW / 2;
          freeze = `<line x1="0" y1="${fy}" x2="${W}" y2="${fy}"
                          stroke="#ffaa00" stroke-width="1" stroke-dasharray="4 3"/>`;
        }
      }

      svg.setAttribute('viewBox', `0 0 ${W} ${BAND_WIN * ROW}`);
      svg.innerHTML = bars.join('') + edges.join('') + freeze + handles.join('');
      $('bandWinLabel').textContent = `${top}–${top + BAND_WIN - 1}`;
    }
```

- [ ] **Step 2: Add the inspector renderer and the staging helper**

```js
    function renderBandInspector() {
      if (bandSel === null) {
        $('bandMeta').textContent = 'no band selected';
        $('bandMinX').value = '';
        $('bandMaxX').value = '';
        return;
      }
      const e = bandMerged().get(bandSel);
      if (!e) { $('bandMeta').textContent = `band ${bandSel} — empty`; return; }
      const y0 = bandSel * BAND_PX;
      $('bandMeta').innerHTML =
        `band <span class="text-term-text">${bandSel}</span> · y ${y0}–${y0 + BAND_PX}`
        + ` · ${bandLayers(bandSel)} · w ${Math.round(e.maxX - e.minX)}`;
      $('bandMinX').value = e.minX;
      $('bandMaxX').value = e.maxX;
    }

    /** Stage an edit, keeping minX <= maxX. Clamps rather than swapping: a
     *  handle dragged past its partner should stop, not flip sides. */
    function bandStage(band, next) {
      const minX = Math.min(next.minX, next.maxX);
      const maxX = Math.max(next.minX, next.maxX);
      bandEdits.set(band, { minX, maxX });
    }
```

Update `renderBandAll` to:

```js
    function renderBandAll() {
      if (!bandState) return;
      renderBandOverview();
      renderBandDetail();
      renderBandInspector();
      $('bandDirty').textContent = bandEdits.size + ' bands dirty';
    }
```

- [ ] **Step 3: Add drag and selection**

```js
    function bootBandDrag() {
      const svg = $('bandDetail');
      let drag = null;

      /** Pointer x -> world x, snapped to whole pixels. Bands are floats in D1,
       *  but pixel granularity on a 20px band is finer than anything visible. */
      const worldX = (ev) => {
        const { lo, hi } = bandState.dom;
        const r = svg.getBoundingClientRect();
        return Math.round(lo + ((ev.clientX - r.left) / r.width) * (hi - lo));
      };

      svg.addEventListener('pointerdown', (ev) => {
        if (!bandState) return;
        const ds = ev.target && ev.target.dataset;
        if (!ds || ds.band === undefined) return;
        bandSel = Number(ds.band);
        // Only a handle starts a drag; clicking the bar just selects.
        if (ds.side) {
          drag = { band: bandSel, side: ds.side };
          svg.setPointerCapture(ev.pointerId);
        }
        renderBandAll();
        ev.preventDefault();
      });

      svg.addEventListener('pointermove', (ev) => {
        if (!drag) return;
        const cur = bandEdits.get(drag.band) || bandMerged().get(drag.band);
        if (!cur) return;
        const next = { minX: cur.minX, maxX: cur.maxX };
        next[drag.side] = worldX(ev);
        bandStage(drag.band, next);
        renderBandAll();
      });

      const end = (ev) => {
        if (!drag) return;
        drag = null;
        try { svg.releasePointerCapture(ev.pointerId); } catch (_) { /* already released */ }
      };
      svg.addEventListener('pointerup', end);
      svg.addEventListener('pointercancel', end);

      $('bandApply').onclick = () => {
        if (bandSel === null || !bandState) return;
        const minX = parseFloat($('bandMinX').value);
        const maxX = parseFloat($('bandMaxX').value);
        if (!isFinite(minX) || !isFinite(maxX)) {
          setStatus('min_x and max_x must be numbers', 'err');
          return;
        }
        bandStage(bandSel, { minX, maxX });
        renderBandAll();
      };
    }
```

Add `bootBandDrag();` to `bootBandEditor()`.

- [ ] **Step 4: Verify in the browser**

Reload the admin page with the Worker running, load a heap's silhouette, then:

1. The detail pane draws ~40 bands as bars with square handles at both ends and connecting edge lines.
2. Click a bar. The inspector fills in — band index, y range, layer, width — and that band's handles turn white.
3. Drag a `min_x` handle left. The bar and the edge line follow the pointer, the inspector's `min_x` tracks it, the band turns amber, and the dirty count increments.
4. Drag the same handle right past `max_x`. It **stops** at `max_x` rather than crossing.
5. Find a band where `min_x === max_x` (both handles on one pixel), select it, type a new `max_x` into the inspector, click Apply. The band widens — this is the case that cannot be done by dragging.
6. Scrub the overview to a range containing a gap. The edge lines across it are dashed.
7. Verify the browser console is free of errors throughout.

- [ ] **Step 5: Commit**

```bash
git add admin/index.html
git commit -m "$(cat <<'EOF'
feat(admin): band detail pane with draggable handles and inspector

SVG rather than canvas so handles are real pointer targets. Edge lines
across a missing band are dashed — that dashed run is the forward-fill
sawtooth, and it is the only way a gap is visible at all.

The inspector is load-bearing, not a convenience: a band with
min_x === max_x collapses both handles onto one pixel, and that
single-point band is exactly the defect class being repaired.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Admin UI — re-derive, save, discard, 409

**Files:**
- Modify: `admin/index.html`

**Interfaces:**
- Consumes: everything from Tasks 6 and 7, plus `PUT /heaps/:id/bands` (Task 5).
- Produces: `bandReDerive(from, to)`, `onSaveBands()`, `onDiscardBands()`.

- [ ] **Step 1: Add re-derive**

```js
    /**
     * Recompute a band range by interpolating between the nearest good bands on
     * either side, filling gaps inside the range as it goes.
     *
     * Two rules borrowed from interpolateBandSeed in shared/heapPolygon: a
     * single-extent band is skipped as a seed source, because its unknown side
     * is itself a forward-filled guess and interpolating from a guess propagates
     * it; and a seed is required on BOTH sides, so the range must be genuinely
     * between two known bands rather than hanging off one.
     *
     * Runs here rather than on the server so the result is visible before it is
     * saved — for this operation the preview is the check.
     */
    function bandReDerive(fromBand, toBand) {
      if (!bandState) return;
      if (!Number.isInteger(fromBand) || !Number.isInteger(toBand) || toBand < fromBand) {
        setStatus('re-derive needs an integer band range, from <= to', 'err');
        return;
      }
      const merged = bandMerged();
      let above = null, below = null;
      for (const [b, e] of merged) {
        if (e.minX === e.maxX) continue;
        if (b < fromBand && (above === null || b > above)) above = b;
        if (b > toBand  && (below === null || b < below)) below = b;
      }
      if (above === null || below === null) {
        setStatus('re-derive needs a two-extent band on BOTH sides of the range', 'err');
        return;
      }
      const a = merged.get(above), z = merged.get(below);
      for (let band = fromBand; band <= toBand; band++) {
        const t = (band - above) / (below - above);
        bandStage(band, {
          minX: Math.round(a.minX + (z.minX - a.minX) * t),
          maxX: Math.round(a.maxX + (z.maxX - a.maxX) * t),
        });
      }
      renderBandAll();
      setStatus(`re-derived bands ${fromBand}–${toBand} from ${above} and ${below}`, 'ok');
    }
```

- [ ] **Step 2: Add save and discard**

```js
    /** True when saving would rewrite base geometry, so the confirm can say so.
     *  Mirrors the server's routing rule: the base carries a band it already
     *  holds, and it takes a brand-new band at or below the freeze line. */
    function bandSaveTouchesBase() {
      const freezeBand = bandState.freezeY > 0 ? Math.floor(bandState.freezeY / BAND_PX) : Infinity;
      for (const band of bandEdits.keys()) {
        if (bandState.base.has(band)) return true;
        if (!bandState.live.has(band) && band >= freezeBand) return true;
      }
      return false;
    }

    async function onSaveBands() {
      if (!bandState || !editingHeapId || bandEdits.size === 0) return;
      const bands = [...bandEdits.entries()].map(([band, e]) => ({
        band, minX: e.minX, maxX: e.maxX,
      }));

      let msg = `Save ${bands.length} band(s) to ${envLabel()}?`;
      if (bandSaveTouchesBase()) {
        msg += '\n\nThis rewrites the base. Every client will re-download it.';
      }
      if (!confirm(msg)) return;

      try {
        const res = await adminFetch(`/heaps/${editingHeapId}/bands`, {
          method: 'PUT',
          body: JSON.stringify({
            expectedVersion: bandState.version,
            expectedBaseId: bandState.baseId,
            bands,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.status === 409) {
          setStatus(
            `heap changed on the server (now v${body.version}) — reload the silhouette`,
            'err',
          );
          return;
        }
        if (!res.ok) throw new Error(body.error || ('save failed: ' + res.status));
        setStatus(`✓ saved ${bands.length} band(s) — now v${body.version}`, 'ok');
        await loadBands(editingHeapId);
      } catch (e) {
        setStatus('Save failed: ' + e.message, 'err');
      }
    }

    function onDiscardBands() {
      if (bandEdits.size === 0) return;
      if (!confirm(`Discard ${bandEdits.size} staged band edit(s)?`)) return;
      bandEdits = new Map();
      renderBandAll();
      setStatus('staged band edits discarded', 'ok');
    }
```

- [ ] **Step 3: Guard reload against losing staged edits**

Change the `bandLoad` wiring in `bootBandEditor` and add the remaining handlers:

```js
    function bootBandEditor() {
      $('bandLoad').onclick = () => {
        if (!editingHeapId) return;
        if (bandEdits.size > 0
            && !confirm(`Reloading discards ${bandEdits.size} staged band edit(s). Continue?`)) {
          return;
        }
        loadBands(editingHeapId);
      };
      $('bandSave').onclick = onSaveBands;
      $('bandDiscard').onclick = onDiscardBands;
      $('bandRederive').onclick = () => bandReDerive(
        parseInt($('bandFrom').value, 10),
        parseInt($('bandTo').value, 10),
      );
      bootBandOverviewScrub();
      bootBandDrag();
    }
```

- [ ] **Step 4: Verify end to end in the browser**

With the Worker running and a seeded heap loaded:

1. **Narrow and save.** Drag a `min_x` handle inward, click Save Bands, accept the confirm. Status reports the new version and the silhouette reloads with the narrowed band no longer amber. Confirm the confirm dialog names the environment.
2. **The base-rewrite warning.** On a `freeze_y = 0` heap every band is in the base too, so the dialog must include *"This rewrites the base."*
3. **Narrowing actually reaches the game.** This is the one to be careful about — it is the failure that would look fine everywhere else. Note the heap's `baseId` before saving, save a narrowing edit, then `curl "http://localhost:8787/heaps/<id>/bands" -H "X-Admin-Secret: <secret>"` and confirm the band narrowed in **both** `liveBands` and `baseBands`, and that `baseId` changed.
4. **Re-derive.** Find or create a gap (narrow a run of bands to nothing useful), enter its range, click Re-derive. The staged bands interpolate smoothly between the neighbours and the dashed gap run disappears.
5. **Re-derive refuses without both seeds.** Enter a range that extends past the top band. Status reports that it needs a two-extent band on both sides, and nothing is staged.
6. **Discard.** Stage several edits, click Discard, accept. Dirty count returns to 0 and the silhouette returns to its loaded shape.
7. **409.** With edits staged, place a block on the same heap from the game (or `curl -X PUT` the heap's params to bump its version), then Save. Status reports the drift with the server's current version, staged edits survive, and nothing wedges.
8. **Reload guard.** With edits staged, click Load silhouette. The confirm warns about discarding them.
9. Console clean throughout.

- [ ] **Step 5: Commit**

```bash
git add admin/index.html
git commit -m "$(cat <<'EOF'
feat(admin): band re-derive, batched save, discard, and 409 handling

Save stages locally and writes the whole dirty set in one request, so a
repair costs one version bump and one cache invalidation rather than one
per drag. The confirm names the environment, and says when the save
rewrites the base — which every client then re-downloads.

Re-derive runs client-side so its result is visible before it is saved;
for this operation the preview is the check.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Screenshots, Todo, and full verification

**Files:**
- Modify: `Todo/Todo.md`
- Create: nothing permanent — the screenshot script is temporary and deleted.

- [ ] **Step 1: Capture layout screenshots**

Write a temporary Playwright script at the **repo root** (Playwright resolves from the repo's `node_modules`, so a scratchpad path fails with `ERR_MODULE_NOT_FOUND`):

```js
// band-shots.mjs — temporary, delete after use
import { chromium } from 'playwright';
const url = 'file://' + process.cwd() + '/admin/index.html';
const browser = await chromium.launch();
for (const [name, size] of [['desktop', { width: 1280, height: 1000 }],
                            ['narrow',  { width: 500,  height: 1000 }]]) {
  const page = await browser.newPage({ viewport: size });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `/tmp/band-${name}.png`, fullPage: true });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  console.log(name, 'horizontalOverflow=', overflow, 'errors=', errors);
  await page.close();
}
await browser.close();
```

Run `node band-shots.mjs`, open both PNGs, confirm the band editor lays out sensibly and `horizontalOverflow=false` at 500px, then `rm band-shots.mjs`.

A `Failed to fetch` error or a red reachability dot is expected here if no Worker is running — the page probes the server on load. Anything else is a real bug.

- [ ] **Step 2: Update the Todo**

In `Todo/Todo.md`, replace the band-editor line (line 13) with:

```markdown
~~Heap silhouette rendered in the Admin UI — 20px bands as horizontal bars, x min/max editable, base points editable, versioned writes~~ — done 2026-07-29, see `docs/superpowers/specs/2026-07-29-admin-band-editor-design.md`.
```

- [ ] **Step 3: Full regression run**

```bash
cd server && npm test && cd .. && npm test && npm run build
```

Expected: server suite green, root suite green, build green. `npm run build` catches TypeScript errors the tests miss — do not skip it.

- [ ] **Step 4: Commit and push**

```bash
git add Todo/Todo.md
git commit -m "$(cat <<'EOF'
docs(todo): admin band editor done

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push -u origin feature/admin-band-editor
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create --base main --title "feat(admin): heap silhouette band editor" --body "$(cat <<'EOF'
Renders a heap's silhouette band by band in the admin page and lets an operator repair damaged geometry in both layers — the live `heap_band` rows and the frozen base blob. Motivated by migration `heap_core/0004`, which converted the old vertex blobs into band rows and got some of that geometry wrong.

Spec: `docs/superpowers/specs/2026-07-29-admin-band-editor-design.md`

## The finding that shaped the design

The two layers overlap and the client renders their **union** — `HeapClient.buildPolygon` returns `[...base, ...liveVertices]`, bucketed to bands afterwards. Two things make the overlap routine: `liveBandsOf` reads `freeze_y === 0` as "nothing frozen yet", so on a never-frozen heap every band row is live while the base still covers those bands; and `0004` backfilled `heap_band` from the live zone *and* the base.

So writing an edit to one layer leaves the other's stale extent winning the union — the repair lands in D1 and changes nothing on screen. `planBandWrite` fans each edit out to every layer holding the band, with dedicated tests for it.

## Server

- `GET /heaps/:id/bands` — admin-gated, uncached, returns both layers already in band form. Uncached because the editor CAS-es on the version it loaded; server-side conversion because `admin/index.html` is standalone and cannot import `verticesToEnvelope`.
- `PUT /heaps/:id/bands` — validated, CAS-guarded on `version` **and** `base_id`, capped at 500 bands.
- `adminReplaceBands` — one transaction, guarded with correlated subqueries like `freezeAtomic`. Cannot reuse `upsertBands`, which is MIN/MAX by design and structurally cannot narrow a band.
- Every save mints a fresh `baseId`, unconditionally. `mergeBands` on the client is MIN/MAX too, so a narrowed band sent as a delta merges back to its old width; a changed `baseId` is the existing signal that forces a full response, and `reset` already depends on it.

## Admin UI

Canvas overview, SVG detail pane with draggable handles, always-present inspector. Edits stage locally and save in one request. The inspector is load-bearing rather than convenient: a band with `min_x === max_x` collapses both handles onto one pixel, and that single-point band is exactly the defect class being repaired.

## Verification

Server suite, root suite, and `npm run build` green. Manually verified against a local Worker: narrowing survives a save and reload in both layers with a changed `baseId`, re-derive closes a gap, 409 reports drift without losing staged edits, and layout has no horizontal overflow at 500px.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage.** `GET` → Task 4. `PUT` + validation + response codes → Task 5. Routing rule → Task 1. New-`baseId`-every-save → Tasks 2 and 5. One transaction with correlated-subquery guards → Task 2. Three DB variants → Tasks 2 and 3. `top_y`/`freeze_y` untouched → no task writes them. Base normalisation on save → falls out of the `envelopeToVertices` round trip in Task 5, asserted by the base-rewrite test. Panes, merged rendering, layer colours → Tasks 6 and 7. Interaction, snapping, clamping → Task 7. Re-derive → Task 8. Staging, save confirmation, 409 → Task 8. Server tests 1–12 → Tasks 1–5. Admin checks 1–8 → Tasks 6–9.

**Naming consistency.** `planBandWrite` / `BandWritePlan` / `nextBaseRows` / `liveRows` are used identically in Tasks 1 and 5. `AdminReplaceBandsArgs` field names match across `db.ts`, `mockDb.ts`, `CachedHeapDB.ts`, and the route. `bandState` / `bandEdits` / `bandSel` / `bandWinTop` / `bandMerged` / `bandLayers` / `bandStage` / `renderBandAll` are consistent across Tasks 6, 7, and 8. `BAND_PX` is the admin page's local mirror of `BAND_SIZE_PX`; server code always imports the shared constant.

**Verified against the codebase rather than assumed.** `hideEditPanel` and `envLabel()` exist in `admin/index.html` as Task 6 and Task 8 use them. `shared/heapTypes.ts` has no existing imports. `cacheDecorators.test.ts`'s `setup()` / `noWait` / `kv.has` / `seedHeap` signatures are quoted exactly in Task 3. `MockHeapDB.seedHeap`'s fourth parameter is `baseId`, defaulting to the heap id.

**Known softness, flagged rather than hidden.** Task 2 step 4 carries a note about the SQLite `INSERT … SELECT … WHERE … ON CONFLICT` parse requirement — the one piece of SQL here that can fail for a reason unrelated to its logic. Task 6's browser check assumes `npm run seed` produces a heap with band geometry; if the seeded heap turns out to have an empty envelope, seed shape by placing a few blocks from the game before loading the silhouette.

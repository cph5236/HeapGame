# Atomic Guarded Freeze Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the freeze step of `POST /heaps/:id/place` atomic and lossless, so two placements crossing the freeze threshold together can no longer silently destroy heap geometry.

**Architecture:** Replace the `createBase` + `setFreeze` call pair with a single `freezeAtomic` method that issues all three writes as one guarded D1 batch — a compare-and-swap on `freeze_y`, with every statement correlated to that guard so the losing request writes nothing at all. A version watermark on the `DELETE` ensures only rows the new base actually captured are buried; rows written concurrently survive as "stragglers" and are folded into the base by the next freeze.

**Tech Stack:** TypeScript 5.9, Cloudflare Workers + Hono, D1 (SQLite), Vitest, `node:sqlite` (`DatabaseSync`) for the test harness.

**Spec:** `docs/superpowers/specs/2026-07-28-freeze-race-cas-design.md`

## Global Constraints

- Work happens on branch `fix/freeze-race-cas` (already created, spec already committed there). Never push directly to `main`; open a PR.
- No schema change and no D1 migration. `heap_band.version` already exists and is already indexed by `idx_heap_band_version`.
- No new npm dependencies. The SQLite test harness uses `node:sqlite`, which ships with Node (local v22.23, CI v24). On v22 it prints an `ExperimentalWarning` — that is expected noise, not a failure.
- Tests run from the `server/` directory: `cd server && npx vitest run`. The repo root `npm test` runs the client/shared suites.
- `npm run build` from the repo root must pass before the work is called done — it catches TS errors the tests miss.
- Band geometry conventions, unchanged: y grows downward, so band indices grow downward too. The FROZEN region is `band >= freezeBand`; the LIVE region is `band < freezeBand`. `freeze_y === 0` is the "nothing frozen yet" sentinel and callers translate it to `Infinity`, never `bandOf(0)`.
- Follow the surrounding comment style in `server/src/db.ts` and `server/src/routes/heap.ts`: dense explanatory blocks stating *why* an invariant holds, not what the code does.

---

### Task 1: `node:sqlite` D1 test harness

A test-only `D1Database` implementation over real SQLite. The entire fix is SQL semantics — correlated subquery guards, batch-as-transaction, `meta.changes` — and the existing suite runs only against `MockHeapDB`, so nothing in it can execute the SQL being written. This harness is what makes Task 3 provable.

**Files:**
- Create: `server/tests/helpers/d1Sqlite.ts`
- Create: `server/tests/d1Sqlite.test.ts`

**Interfaces:**
- Consumes: `server/schema/heap_core.sql` (the real DDL), `D1Database` from `@cloudflare/workers-types`.
- Produces: `createTestD1(): D1Database` — an in-memory database with `heap_core.sql` applied, usable anywhere a `D1Database` is expected (notably `new D1HeapDB(createTestD1())`).

- [ ] **Step 1: Write the failing test**

Create `server/tests/d1Sqlite.test.ts`. These tests pin the three behaviours the freeze SQL depends on, in the harness itself — if the harness lies about any of them, Task 3's tests prove nothing.

```ts
// server/tests/d1Sqlite.test.ts
//
// Tests for the test harness. The freeze fix rests on three D1 behaviours that
// MockHeapDB cannot express: a batch is one transaction, meta.changes reports
// rows actually touched, and correlated subqueries resolve against the
// transaction's own state. If the harness got any of them wrong, every test
// built on it would be vacuously green.

import { describe, it, expect } from 'vitest';
import { createTestD1 } from './helpers/d1Sqlite';

describe('d1Sqlite harness', () => {
  it('applies the real heap_core schema', async () => {
    const d1 = createTestD1();
    await d1.prepare("INSERT INTO heap_base (id, heap_id, vertices, vertex_hash, created_at) VALUES ('b1','h1','[]','hash','now')").run();
    const row = await d1.prepare('SELECT id FROM heap_base WHERE id = ?1').bind('b1').first<{ id: string }>();
    expect(row?.id).toBe('b1');
  });

  it('reports rows changed per statement', async () => {
    const d1 = createTestD1();
    await d1.prepare("INSERT INTO heap_band (heap_id, band, min_x, max_x, version) VALUES ('h1', 10, 0, 100, 1)").run();
    const hit = await d1.prepare('UPDATE heap_band SET max_x = 200 WHERE heap_id = ?1 AND band = ?2').bind('h1', 10).run();
    const miss = await d1.prepare('UPDATE heap_band SET max_x = 200 WHERE heap_id = ?1 AND band = ?2').bind('h1', 99).run();
    expect(hit.meta.changes).toBe(1);
    expect(miss.meta.changes).toBe(0);
  });

  it('runs a batch as one transaction and returns per-statement meta', async () => {
    const d1 = createTestD1();
    const results = await d1.batch([
      d1.prepare("INSERT INTO heap_band (heap_id, band, min_x, max_x, version) VALUES ('h1', 10, 0, 100, 1)"),
      d1.prepare("INSERT INTO heap_band (heap_id, band, min_x, max_x, version) VALUES ('h1', 11, 0, 100, 1)"),
      d1.prepare('DELETE FROM heap_band WHERE heap_id = ?1 AND band = ?2').bind('h1', 10),
    ]);
    expect(results.map((r) => r.meta.changes)).toEqual([1, 1, 1]);
    const rows = await d1.prepare('SELECT band FROM heap_band ORDER BY band').all<{ band: number }>();
    expect(rows.results.map((r) => r.band)).toEqual([11]);
  });

  it('rolls a batch back when a statement fails', async () => {
    const d1 = createTestD1();
    await expect(d1.batch([
      d1.prepare("INSERT INTO heap_band (heap_id, band, min_x, max_x, version) VALUES ('h1', 10, 0, 100, 1)"),
      d1.prepare("INSERT INTO heap_band (heap_id, band, min_x, max_x, version) VALUES ('h1', 10, 0, 100, 1)"), // PK conflict
    ])).rejects.toThrow();
    const rows = await d1.prepare('SELECT band FROM heap_band').all<{ band: number }>();
    expect(rows.results).toHaveLength(0);
  });

  it('resolves a correlated subquery against uncommitted state inside the batch', async () => {
    const d1 = createTestD1();
    await d1.batch([
      d1.prepare("INSERT INTO heap_base (id, heap_id, vertices, vertex_hash, created_at) VALUES ('b1','h1','[]','hash','now')"),
      // Every other heap column carries a schema default.
      d1.prepare("INSERT INTO heap (id, base_id, created_at) VALUES ('h1','b1','now')"),
      d1.prepare("INSERT INTO heap_band (heap_id, band, min_x, max_x, version) VALUES ('h1', 10, 0, 100, 1)"),
    ]);
    // Statement 2 sees the base_id statement 1 just wrote, not the pre-batch one.
    const results = await d1.batch([
      d1.prepare('UPDATE heap SET base_id = ?1 WHERE id = ?2').bind('b2', 'h1'),
      d1.prepare('DELETE FROM heap_band WHERE heap_id = ?1 AND (SELECT base_id FROM heap WHERE id = ?1) = ?2').bind('h1', 'b2'),
    ]);
    expect(results[1].meta.changes).toBe(1);
  });

  it('binds numbered ?NNN params positionally, including a reused index', async () => {
    // Every statement in server/src/db.ts uses ?NNN, and several reuse an index
    // (freezeAtomic's DELETE binds heap_id once but references ?1 twice). If the
    // harness got this wrong, statements would bind to the wrong columns and
    // fail in ways that look like logic bugs.
    const d1 = createTestD1();
    await d1.prepare("INSERT INTO heap_band (heap_id, band, min_x, max_x, version) VALUES ('h1', 10, 0, 100, 1)").run();
    const res = await d1
      .prepare('DELETE FROM heap_band WHERE heap_id = ?1 AND band = ?2 AND (SELECT COUNT(*) FROM heap_band WHERE heap_id = ?1) = ?3')
      .bind('h1', 10, 1)
      .run();
    expect(res.meta.changes).toBe(1);
  });

  it('returns rows from a RETURNING mutation inside a batch', async () => {
    // commitPlacement reads results[0].results[0].version from exactly this shape.
    const d1 = createTestD1();
    await d1.batch([
      d1.prepare("INSERT INTO heap_base (id, heap_id, vertices, vertex_hash, created_at) VALUES ('b1','h1','[]','hash','now')"),
      // Every other heap column carries a schema default.
      d1.prepare("INSERT INTO heap (id, base_id, created_at) VALUES ('h1','b1','now')"),
    ]);
    const results = await d1.batch<{ version: number }>([
      d1.prepare('UPDATE heap SET version = version + 1 WHERE id = ?1 RETURNING version').bind('h1'),
    ]);
    expect(results[0].results[0].version).toBe(2);
  });

  it('does not silently swallow a mutation passed through the read path', async () => {
    // Regression guard for the harness itself: node:sqlite executes an UPDATE
    // handed to .all() and returns [], so dispatching by try/catch instead of by
    // SQL text reports changes: 0 for every mutation — which would make
    // freezeAtomic's CAS verdict permanently false and every race test vacuous.
    const d1 = createTestD1();
    await d1.prepare("INSERT INTO heap_band (heap_id, band, min_x, max_x, version) VALUES ('h1', 10, 0, 100, 1)").run();
    const res = await d1.prepare('UPDATE heap_band SET max_x = 999 WHERE heap_id = ?1').bind('h1').run();
    expect(res.meta.changes).toBe(1);
    const row = await d1.prepare('SELECT max_x FROM heap_band WHERE heap_id = ?1').bind('h1').first<{ max_x: number }>();
    expect(row?.max_x).toBe(999); // and exactly once — not applied twice
  });

  it('isolates databases between calls', async () => {
    const a = createTestD1();
    const b = createTestD1();
    await a.prepare("INSERT INTO heap_base (id, heap_id, vertices, vertex_hash, created_at) VALUES ('b1','h1','[]','hash','now')").run();
    const rows = await b.prepare('SELECT id FROM heap_base').all<{ id: string }>();
    expect(rows.results).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx vitest run tests/d1Sqlite.test.ts`
Expected: FAIL — `Failed to resolve import "./helpers/d1Sqlite"`.

- [ ] **Step 3: Write the harness**

Create `server/tests/helpers/d1Sqlite.ts`.

Notes for the implementer:
- `node:sqlite` `DatabaseSync` is synchronous; the D1 surface is promise-based. Wrap returns in `async` methods — awaiting an already-resolved value is exactly what D1 does under the hood locally.
- D1 binds `?1`-style numbered parameters. `node:sqlite` supports anonymous `?` and named parameters; numbered `?NNN` is standard SQLite and works with positional binding, so pass bound values positionally in order. Every call site in `server/src/db.ts` binds `?1..?N` in ascending order with no reuse gaps *except* where a parameter is referenced more than once — `.bind()` is still given each distinct parameter exactly once, in index order, so positional binding matches. (`freezeAtomic` in Task 3 is written to respect this.)
- The type assertions to `D1Database` are deliberate: this implements the subset the server actually calls, not the full interface.

```ts
// server/tests/helpers/d1Sqlite.ts
//
// A real-SQLite D1Database for tests, over node:sqlite (ships with Node — no
// native build, no new dependency). MockHeapDB proves route logic; this proves
// SQL. Anything whose correctness lives in a WHERE clause — CAS guards,
// correlated subqueries, batch atomicity, meta.changes — can only be tested
// here.
//
// It implements the subset of D1Database the server actually calls. Unused
// members are absent by design rather than stubbed, so an untested call fails
// loudly instead of silently returning something plausible.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA_PATH = join(__dirname, '../../schema/heap_core.sql');

interface PreparedLike {
  sql: string;
  params: unknown[];
}

function makeResult(rows: unknown[], changes: number) {
  return {
    results: rows,
    success: true,
    meta: { changes, last_row_id: 0, duration: 0, rows_read: rows.length, rows_written: changes },
  };
}

/** Statements whose rows we need: plain reads, and mutations with RETURNING. */
const RETURNS_ROWS = /^\s*(SELECT|WITH)\b/i;
const HAS_RETURNING = /\bRETURNING\b/i;

function run(db: DatabaseSync, stmt: PreparedLike) {
  const prepared = db.prepare(stmt.sql);
  // Dispatch on the SQL text, NOT on try/catch. node:sqlite does not throw when
  // .all() is handed an UPDATE — it executes the update and returns [] — so a
  // try-all-then-fall-back-to-run shape would silently report changes: 0 for
  // every mutation (breaking freezeAtomic's CAS verdict outright) and would
  // double-execute anything that did fall through. .run() on a SELECT is
  // equally wrong in the other direction: it succeeds, returns no rows, and
  // reports a meaningless changes count.
  const wantsRows = RETURNS_ROWS.test(stmt.sql) || HAS_RETURNING.test(stmt.sql);
  if (wantsRows) {
    const rows = prepared.all(...(stmt.params as never[]));
    // For a RETURNING mutation the row count IS the changed-row count; a plain
    // SELECT changes nothing.
    return makeResult(rows, HAS_RETURNING.test(stmt.sql) ? rows.length : 0);
  }
  const info = prepared.run(...(stmt.params as never[]));
  return makeResult([], Number(info.changes));
}

class TestStatement {
  constructor(private db: DatabaseSync, private stmt: PreparedLike) {}

  bind(...params: unknown[]) {
    return new TestStatement(this.db, { sql: this.stmt.sql, params });
  }

  async all<T>() {
    return makeResult(run(this.db, this.stmt).results as T[], 0) as unknown as { results: T[] };
  }

  async first<T>(): Promise<T | null> {
    const rows = run(this.db, this.stmt).results as T[];
    return rows[0] ?? null;
  }

  async run() {
    return run(this.db, this.stmt);
  }

  /** Internal: used by batch, which must not open its own transaction per statement. */
  execInBatch() {
    return run(this.db, this.stmt);
  }
}

/**
 * A fresh in-memory database with the production heap_core schema applied.
 * Reading the real .sql file (rather than restating the DDL here) is what keeps
 * these tests from drifting away from production when a column is added.
 */
export function createTestD1(): D1Database {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));

  const api = {
    prepare(sql: string) {
      return new TestStatement(db, { sql, params: [] });
    },
    async batch(statements: TestStatement[]) {
      // One batch = one transaction, matching D1. A throw inside rolls the
      // whole thing back, which is the property the freeze fix depends on.
      db.exec('BEGIN');
      try {
        const results = statements.map((s) => s.execInBatch());
        db.exec('COMMIT');
        return results;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    async exec(sql: string) {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
  };

  return api as unknown as D1Database;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && npx vitest run tests/d1Sqlite.test.ts`
Expected: PASS, 9 tests. An `ExperimentalWarning: SQLite is an experimental feature` line on Node 22 is expected.

If the "correlated subquery" or "batch" test fails, fix the harness — not the test. Those behaviours are what D1 genuinely does.

- [ ] **Step 5: Commit**

```bash
git add server/tests/helpers/d1Sqlite.ts server/tests/d1Sqlite.test.ts
git commit -m "test: node:sqlite D1 harness for testing real SQL semantics"
```

---

### Task 2: `getAllBandsVersioned`

The freeze path needs each band's stamped `version` to compute the delete watermark. `BandRow` is `{ band, minX, maxX }` and `getAllBands` does not select `version`, so this is a new read. It is read-through (never cached) and called only when a freeze is actually due — once per `FREEZE_BATCH_BANDS = 38` bands of climb — so the hot placement path is untouched.

**Files:**
- Modify: `server/src/db.ts` — `HeapDB` interface (near `getAllBands`, ~line 96) and `D1HeapDB` (near `getAllBands`, ~line 317)
- Modify: `server/src/cache/CachedHeapDB.ts` — near `getAllBands`, ~line 132
- Modify: `server/tests/helpers/mockDb.ts` — near `getAllBands`, ~line 236
- Test: `server/tests/bandDb.test.ts`

**Interfaces:**
- Produces: `type VersionedBandRow = BandRow & { version: number }` exported from `server/src/db.ts`, and `getAllBandsVersioned(heapId: string): Promise<VersionedBandRow[]>` on `HeapDB` (ascending by band). Task 3 consumes both.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/bandDb.test.ts` (match the file's existing describe/setup style — read it first and reuse its seeding helper rather than inventing a new one):

```ts
describe('getAllBandsVersioned', () => {
  it('returns each band with the version it was stamped with, ascending', async () => {
    const db = new MockHeapDB();
    await db.upsertBands('h1', [{ band: 12, minX: 100, maxX: 200 }], 5);
    await db.upsertBands('h1', [{ band: 10, minX: 400, maxX: 500 }], 7);
    expect(await db.getAllBandsVersioned('h1')).toEqual([
      { band: 10, minX: 400, maxX: 500, version: 7 },
      { band: 12, minX: 100, maxX: 200, version: 5 },
    ]);
  });

  it('returns [] for a heap with no bands', async () => {
    const db = new MockHeapDB();
    expect(await db.getAllBandsVersioned('nope')).toEqual([]);
  });

  it('keeps the OLD version on a row that did not widen', async () => {
    // The watermark depends on this: an unwidened row's geometry is unchanged,
    // so it is safe to bury even though a later placement touched it.
    const db = new MockHeapDB();
    await db.upsertBands('h1', [{ band: 10, minX: 400, maxX: 500 }], 3);
    await db.upsertBands('h1', [{ band: 10, minX: 450, maxX: 480 }], 9);
    expect(await db.getAllBandsVersioned('h1')).toEqual([
      { band: 10, minX: 400, maxX: 500, version: 3 },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx vitest run tests/bandDb.test.ts`
Expected: FAIL — `db.getAllBandsVersioned is not a function`.

- [ ] **Step 3: Implement across all three HeapDB implementations**

In `server/src/db.ts`, export the type near the other band types and add the interface member directly below `getAllBands`:

```ts
/** A band row carrying the version it was last widened at. */
export type VersionedBandRow = BandRow & { version: number };
```

```ts
  /**
   * Every band of a heap, ascending, WITH the version each row was last
   * widened at. Separate from getAllBands because BandRow deliberately carries
   * no version — the client's envelope maths has no use for one — and because
   * this must never be served from a cached snapshot.
   *
   * The freeze path is the only caller: it needs the versions to compute the
   * watermark that bounds its DELETE, and a stale watermark would let it bury
   * a row the new base never captured. Called only when a freeze is actually
   * due (once per FREEZE_BATCH_BANDS of climb), so the read cost does not land
   * on the placement hot path.
   */
  getAllBandsVersioned(heapId: string): Promise<VersionedBandRow[]>;
```

`D1HeapDB`, directly below `getAllBands`:

```ts
  async getAllBandsVersioned(heapId: string): Promise<VersionedBandRow[]> {
    const res = await this.d1
      .prepare('SELECT band, min_x, max_x, version FROM heap_band WHERE heap_id = ?1 ORDER BY band')
      .bind(heapId)
      .all<{ band: number; min_x: number; max_x: number; version: number }>();
    return res.results.map((r) => ({ band: r.band, minX: r.min_x, maxX: r.max_x, version: r.version }));
  }
```

`CachedHeapDB`, directly below `getAllBands`:

```ts
  async getAllBandsVersioned(heapId: string): Promise<VersionedBandRow[]> {
    // Read-through, deliberately. The cached snapshot can lag, and the freeze
    // path uses this read to decide which rows it is safe to DELETE — a stale
    // row set there means burying geometry the new base never captured, which
    // is the exact loss this whole path exists to prevent. Rare enough (once
    // per freeze) that skipping the cache costs nothing measurable.
    return this.inner.getAllBandsVersioned(heapId);
  }
```

`MockHeapDB`, directly below `getAllBands`:

```ts
  async getAllBandsVersioned(heapId: string): Promise<VersionedBandRow[]> {
    const m = this.bands.get(heapId);
    if (!m) return [];
    return [...m.keys()].sort((a, b) => a - b).map((band) => ({
      band, minX: m.get(band)!.minX, maxX: m.get(band)!.maxX, version: m.get(band)!.version,
    }));
  }
```

Add `VersionedBandRow` to the existing type imports in `CachedHeapDB.ts` and `mockDb.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx vitest run tests/bandDb.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the D1 implementation against real SQLite**

Add to `server/tests/bandDb.test.ts` (this is why Task 1 exists — it checks the actual column projection, which the mock cannot):

```ts
  it('D1HeapDB projects the version column', async () => {
    const db = new D1HeapDB(createTestD1());
    await db.upsertBands('h1', [{ band: 10, minX: 400, maxX: 500 }], 7);
    expect(await db.getAllBandsVersioned('h1')).toEqual([
      { band: 10, minX: 400, maxX: 500, version: 7 },
    ]);
  });
```

Import `D1HeapDB` from `../src/db` and `createTestD1` from `./helpers/d1Sqlite`.

Run: `cd server && npx vitest run tests/bandDb.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/db.ts server/src/cache/CachedHeapDB.ts server/tests/helpers/mockDb.ts server/tests/bandDb.test.ts
git commit -m "feat(server): getAllBandsVersioned for the freeze watermark"
```

---

### Task 3: `freezeAtomic` replaces `setFreeze`

The core of the fix. One guarded D1 batch performing all three freeze writes, with a compare-and-swap on `freeze_y`. `setFreeze` is removed rather than kept alongside: leaving an unguarded blind-write freeze in the interface invites the same bug straight back. `createBase` stays — the reset path at `server/src/routes/heap.ts:388` uses it and has no freeze semantics.

**Files:**
- Modify: `server/src/db.ts` — replace the `setFreeze` interface member (~line 134-157) and its `D1HeapDB` implementation (~line 413-424)
- Modify: `server/src/cache/CachedHeapDB.ts` — replace the `setFreeze` decorator (~line 196-206)
- Modify: `server/tests/helpers/mockDb.ts` — replace `setFreeze` (~line 318-331)
- Test: `server/tests/freezeRace.test.ts` (create)

**Interfaces:**
- Consumes: `createTestD1` (Task 1), `VersionedBandRow` (Task 2).
- Produces:

```ts
freezeAtomic(args: {
  heapId: string;
  expectedFreezeY: number;
  newBaseId: string;
  baseVertices: Vertex[];
  baseHash: string;
  newFreezeY: number;
  versionWatermark: number;
  now: string;
}): Promise<boolean>;   // true = applied, false = another request froze first
```

Task 4 consumes this. Note there is no `newFreezeBand` argument — the delete boundary is derived inside as `bandOf(newFreezeY)`, so the deletion can never disagree with the freeze line it is supposed to match.

- [ ] **Step 1: Write the failing test**

Create `server/tests/freezeRace.test.ts`. Run against **real SQLite** — the whole fix is the WHERE clauses.

```ts
// server/tests/freezeRace.test.ts
//
// The regression guard for the HIGH-severity freeze race found in the PR #126
// review. Freeze used to decide on one D1 round trip (getAllBands +
// checkFreezeBands) and apply on another (createBase + a blind UPDATE in
// setFreeze). Two placements crossing the threshold together both read the same
// pre-freeze base_id, both built a new base from it, and the loser's bands were
// deleted by its own DELETE while surviving only in its orphaned base — which
// the heap no longer pointed at. That geometry was unrecoverable.
//
// These run against real SQLite (see helpers/d1Sqlite.ts), not MockHeapDB,
// because every part of the fix lives in SQL: the CAS predicate, the correlated
// subqueries that make a losing batch a no-op, and meta.changes.

import { describe, it, expect } from 'vitest';
import { D1HeapDB } from '../src/db';
import { createTestD1 } from './helpers/d1Sqlite';
import { DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';
import { BAND_SIZE_PX } from '../../shared/heapPolygon/bandEnvelope';

const NOW = '2026-07-28T00:00:00.000Z';

/** A heap with bands 100..104, each stamped at version 1. */
async function seeded() {
  const db = new D1HeapDB(createTestD1());
  await db.createHeap('h1', 'b1', [{ x: 480, y: 49000 }], 'hash-b1', NOW, {
    ...DEFAULT_HEAP_PARAMS, worldHeight: 50000,
  });
  await db.upsertBands('h1', [100, 101, 102, 103, 104].map((band) => ({ band, minX: 400, maxX: 500 })), 1);
  return db;
}

describe('freezeAtomic', () => {
  it('applies when the freeze line is unchanged', async () => {
    const db = await seeded();
    const applied = await db.freezeAtomic({
      heapId: 'h1', expectedFreezeY: 0,
      newBaseId: 'b2', baseVertices: [{ x: 400, y: 102 * BAND_SIZE_PX }], baseHash: 'hash-b2',
      newFreezeY: 102 * BAND_SIZE_PX, versionWatermark: 1, now: NOW,
    });
    expect(applied).toBe(true);

    const row = (await db.getHeap('h1'))!;
    expect(row.base_id).toBe('b2');
    expect(row.freeze_y).toBe(102 * BAND_SIZE_PX);
    // Bands 102..104 are buried; 100 and 101 stay live.
    expect((await db.getAllBands('h1')).map((b) => b.band)).toEqual([100, 101]);
  });

  it('is a TOTAL no-op when another request froze first', async () => {
    const db = await seeded();
    // Winner.
    await db.freezeAtomic({
      heapId: 'h1', expectedFreezeY: 0,
      newBaseId: 'b2', baseVertices: [{ x: 400, y: 102 * BAND_SIZE_PX }], baseHash: 'hash-b2',
      newFreezeY: 102 * BAND_SIZE_PX, versionWatermark: 1, now: NOW,
    });
    // Loser: computed from the SAME pre-freeze snapshot, so it still expects
    // freeze_y === 0 and still picks a line of its own. This is the interleaving
    // that used to destroy geometry.
    const applied = await db.freezeAtomic({
      heapId: 'h1', expectedFreezeY: 0,
      newBaseId: 'b3', baseVertices: [{ x: 400, y: 101 * BAND_SIZE_PX }], baseHash: 'hash-b3',
      newFreezeY: 101 * BAND_SIZE_PX, versionWatermark: 1, now: NOW,
    });

    expect(applied).toBe(false);
    const row = (await db.getHeap('h1'))!;
    expect(row.base_id).toBe('b2');                       // winner still owns the heap
    expect(row.freeze_y).toBe(102 * BAND_SIZE_PX);        // line not moved
    expect(await db.getBaseVerticesById('b3')).toBeNull(); // no orphaned base row
    expect((await db.getAllBands('h1')).map((b) => b.band)).toEqual([100, 101]); // band 101 NOT deleted
  });

  it('leaves a row stamped above the watermark as a straggler', async () => {
    const db = await seeded();
    // A concurrent placement widens band 103 after the freeze read the bands.
    await db.upsertBands('h1', [{ band: 103, minX: 100, maxX: 900 }], 9);

    await db.freezeAtomic({
      heapId: 'h1', expectedFreezeY: 0,
      newBaseId: 'b2', baseVertices: [{ x: 400, y: 102 * BAND_SIZE_PX }], baseHash: 'hash-b2',
      newFreezeY: 102 * BAND_SIZE_PX, versionWatermark: 1, now: NOW,
    });

    // 102 and 104 buried (version 1 <= watermark); 103 survives because the base
    // this freeze built never captured its new width.
    const bands = await db.getAllBandsVersioned('h1');
    expect(bands.map((b) => b.band)).toEqual([100, 101, 103]);
    expect(bands.find((b) => b.band === 103)).toMatchObject({ minX: 100, maxX: 900 });
  });

  it('a later freeze buries a straggler once its base captures it', async () => {
    const db = await seeded();
    await db.upsertBands('h1', [{ band: 103, minX: 100, maxX: 900 }], 9);
    await db.freezeAtomic({
      heapId: 'h1', expectedFreezeY: 0,
      newBaseId: 'b2', baseVertices: [], baseHash: 'hash-b2',
      newFreezeY: 102 * BAND_SIZE_PX, versionWatermark: 1, now: NOW,
    });
    // Next freeze reads the straggler, so its watermark covers version 9.
    const applied = await db.freezeAtomic({
      heapId: 'h1', expectedFreezeY: 102 * BAND_SIZE_PX,
      newBaseId: 'b3', baseVertices: [{ x: 100, y: 101 * BAND_SIZE_PX }], baseHash: 'hash-b3',
      newFreezeY: 101 * BAND_SIZE_PX, versionWatermark: 9, now: NOW,
    });

    expect(applied).toBe(true);
    expect((await db.getAllBands('h1')).map((b) => b.band)).toEqual([100]);
  });

  it('two racers computing the SAME line still leave one clean winner', async () => {
    const db = await seeded();
    const args = {
      heapId: 'h1', expectedFreezeY: 0,
      baseVertices: [{ x: 400, y: 102 * BAND_SIZE_PX }],
      newFreezeY: 102 * BAND_SIZE_PX, versionWatermark: 1, now: NOW,
    };
    const first = await db.freezeAtomic({ ...args, newBaseId: 'b2', baseHash: 'h2' });
    const second = await db.freezeAtomic({ ...args, newBaseId: 'b3', baseHash: 'h3' });
    expect([first, second]).toEqual([true, false]);
    expect((await db.getHeap('h1'))!.base_id).toBe('b2');
    expect(await db.getBaseVerticesById('b3')).toBeNull();
  });

  it('advances the line on a heap that is already frozen', async () => {
    const db = await seeded();
    await db.freezeAtomic({
      heapId: 'h1', expectedFreezeY: 0, newBaseId: 'b2', baseVertices: [], baseHash: 'h2',
      newFreezeY: 104 * BAND_SIZE_PX, versionWatermark: 1, now: NOW,
    });
    const applied = await db.freezeAtomic({
      heapId: 'h1', expectedFreezeY: 104 * BAND_SIZE_PX, newBaseId: 'b3', baseVertices: [], baseHash: 'h3',
      newFreezeY: 102 * BAND_SIZE_PX, versionWatermark: 1, now: NOW,
    });
    expect(applied).toBe(true);
    expect((await db.getHeap('h1'))!.freeze_y).toBe(102 * BAND_SIZE_PX);
    expect((await db.getAllBands('h1')).map((b) => b.band)).toEqual([100, 101]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx vitest run tests/freezeRace.test.ts`
Expected: FAIL — `db.freezeAtomic is not a function`.

- [ ] **Step 3: Implement `freezeAtomic` in `D1HeapDB`**

In `server/src/db.ts`, delete the `setFreeze` interface member and its doc block, and put this in its place (keep the doc block's existing reasoning about why the deletion and the line advance are one fact — it is still true and still load-bearing):

```ts
  /**
   * Complete a freeze in ONE transaction: mint the new base, repoint the heap at
   * it, advance the freeze line, and DELETE the band rows that line buries.
   * Returns false when the guard fails, in which case NOTHING was written — no
   * base row, no line advance, no deletion.
   *
   * Every statement is guarded on `expectedFreezeY`, the freeze line the caller
   * read before deciding. This is a compare-and-swap, and it has to be, even
   * though placement itself needs none: MIN/MAX band widening is conflict-free,
   * but a freeze is a destructive repoint-and-delete. Two placements crossing
   * the threshold together both read the same pre-freeze base_id and both build
   * a new base from it; without the guard the loser's bands are removed by its
   * own DELETE while surviving only in its orphaned base, which the heap no
   * longer points at. That geometry is unrecoverable — the bug this method
   * exists to close.
   *
   * The guard cannot live in JS between the statements: a D1 batch fixes every
   * statement's bind params before any of them run and executes all of them
   * regardless of what the others did. So the condition is a correlated
   * subquery inside each statement, resolving against the transaction's own
   * state. The INSERT uses SELECT..WHERE so a loser mints no orphan base; the
   * DELETE keys off whether the heap now points at OUR base, which is a
   * stronger test than re-checking the freeze line — two racers can legitimately
   * compute the same line, and base_id is unique per attempt.
   *
   * `versionWatermark` bounds the deletion to rows the new base actually
   * captured. Heap versions are monotonic and heap_band.version is stamped only
   * when a row widens, so a row written after the caller's read provably carries
   * a version above the watermark and survives as a straggler — invisible below
   * the freeze line, but present, and folded into the base by the next freeze.
   * Without it, a placement landing in the frozen slice mid-freeze is deleted
   * having never reached any base.
   *
   * The deletion is what keeps per-request cost bounded. A frozen band's
   * geometry lives in the new base blob, which every client fetches by baseId
   * and caches indefinitely, so the row is pure dead weight the moment freeze_y
   * passes it: getAllBands still returns it on every read and liveBandsOf still
   * filters it out. Left in place it accumulates forever — a staging fixture
   * measured 283 frozen rows against 65 live ones, and the read path paid for
   * all 348.
   *
   * The delete boundary is derived from newFreezeY here rather than passed in,
   * so the deletion can never disagree with the freeze line it is supposed to
   * match.
   */
  freezeAtomic(args: FreezeArgs): Promise<boolean>;
```

Export the args type next to the other exported types in `db.ts`:

```ts
/** Inputs to a single guarded freeze. See HeapDB.freezeAtomic. */
export interface FreezeArgs {
  heapId: string;
  /** The heap's freeze_y as READ before the freeze decision — never recomputed,
   *  so the REAL-column equality compares an exact round-tripped value. */
  expectedFreezeY: number;
  newBaseId: string;
  baseVertices: Vertex[];
  baseHash: string;
  newFreezeY: number;
  /** Max version among the band rows the caller captured into baseVertices. */
  versionWatermark: number;
  now: string;
}
```

The `D1HeapDB` implementation, replacing `setFreeze`:

```ts
  async freezeAtomic(args: FreezeArgs): Promise<boolean> {
    const { heapId, expectedFreezeY, newBaseId, baseVertices, baseHash, newFreezeY, versionWatermark, now } = args;
    const results = await this.d1.batch([
      // 1. Mint the base — only if the line we read is still the line. A losing
      //    racer inserts nothing, so there is no orphan to clean up.
      this.d1
        .prepare(
          `INSERT INTO heap_base (id, heap_id, vertices, vertex_hash, created_at)
           SELECT ?1, ?2, ?3, ?4, ?5
            WHERE (SELECT freeze_y FROM heap WHERE id = ?2) = ?6`,
        )
        .bind(newBaseId, heapId, JSON.stringify(baseVertices), baseHash, now, expectedFreezeY),
      // 2. CAS the heap onto it. This statement's changes count IS the verdict.
      this.d1
        .prepare('UPDATE heap SET base_id = ?1, freeze_y = ?2 WHERE id = ?3 AND freeze_y = ?4')
        .bind(newBaseId, newFreezeY, heapId, expectedFreezeY),
      // 3. Bury rows — only ones the new base captured (version watermark), and
      //    only if statement 2 landed (the heap now points at OUR base).
      this.d1
        .prepare(
          `DELETE FROM heap_band
            WHERE heap_id = ?1 AND band >= ?2 AND version <= ?3
              AND (SELECT base_id FROM heap WHERE id = ?1) = ?4`,
        )
        .bind(heapId, bandOf(newFreezeY), versionWatermark, newBaseId),
    ]);
    return results[1].meta.changes > 0;
  }
```

`bandOf` is already imported in `db.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx vitest run tests/freezeRace.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Update `CachedHeapDB` and `MockHeapDB`**

`CachedHeapDB`, replacing `setFreeze`:

```ts
  async freezeAtomic(args: FreezeArgs): Promise<boolean> {
    const applied = await this.inner.freezeAtomic(args);
    // Changes base_id and freeze_y on the heap row AND deletes the band rows the
    // new freeze line buries — invalidate like every other write, or the cached
    // snapshot keeps pointing at the stale base while still serving rows that no
    // longer exist. One invalidation covers both, because the inner call is one
    // transaction.
    //
    // Unconditional, win or lose. A losing freeze wrote nothing, so this
    // invalidation is redundant — but freezes are rare (once per
    // FREEZE_BATCH_BANDS of climb) and a redundant KV delete costs less than a
    // branch whose correctness depends on freezeAtomic's return value being
    // right. Freezes also pay the full two-key cost rather than the row-only
    // shortcut commitPlacement takes.
    await this.invalidateHeap(args.heapId);
    if (applied) {
      // Base vertices are immutable — safe to populate on write, mirroring
      // createBase. Only on a win: a loser's base row does not exist.
      this.waitUntil(this.kv.put(`cache:base:${args.newBaseId}`, JSON.stringify(args.baseVertices), { expirationTtl: BASE_TTL }));
    }
    return applied;
  }
```

`MockHeapDB`, replacing `setFreeze` — same guard semantics, so route-level tests exercise the real branching:

```ts
  async freezeAtomic(args: FreezeArgs): Promise<boolean> {
    const existing = this.heaps.get(args.heapId);
    if (!existing) return false;
    // Mirrors the D1 CAS: a stale expectedFreezeY means another request froze
    // first, and NOTHING is written — no base, no line advance, no deletion.
    if (existing.freeze_y !== args.expectedFreezeY) return false;

    this.bases.set(args.newBaseId, {
      heap_id: args.heapId,
      vertices: JSON.stringify(args.baseVertices),
      vertex_hash: args.baseHash,
      created_at: args.now,
    });
    this.heaps.set(args.heapId, { ...existing, base_id: args.newBaseId, freeze_y: args.newFreezeY });

    // Drop the rows the freeze line just buried, matching the D1 batch: the
    // boundary is derived from newFreezeY exactly as it is there, and the
    // version watermark spares any row written after the caller's read.
    const m = this.bands.get(args.heapId);
    if (m) {
      const freezeBand = bandOf(args.newFreezeY);
      for (const [band, row] of [...m.entries()]) {
        if (band >= freezeBand && row.version <= args.versionWatermark) m.delete(band);
      }
    }
    return true;
  }
```

Import `FreezeArgs` from `../src/db` / `../../src/db` in both files.

- [ ] **Step 6: Fix the two existing `setFreeze` call sites**

`server/tests/heapDelta.test.ts:112-113` — the two-call simulation collapses into one:

```ts
    await db.freezeAtomic({
      heapId: 'h1', expectedFreezeY: 0, newBaseId: 'b2',
      baseVertices: [{ x: 480, y: 50000 }], baseHash: 'h2',
      newFreezeY: 47000, versionWatermark: 0, now: new Date().toISOString(),
    });
```

Note `versionWatermark: 0` — this test only cares that a freeze mints a new baseId, and 0 spares every band, keeping the delta assertions unchanged.

`server/tests/bandCacheConsistency.test.ts:74` — the test is named `'invalidates the snapshot on commitPlacement, setFreeze and clearBands'` but never actually calls `setFreeze`; the name has always been aspirational. Keep the name accurate AND make it true: rename `setFreeze` → `freezeAtomic` in the title, and insert this between the existing `commitPlacement` block and the `clearBands` block (just before the existing `kv.deletes.length = 0;` line that precedes `clearBands`):

```ts
    kv.deletes.length = 0;
    // Freeze invalidates unconditionally, and busts BOTH keys rather than
    // taking commitPlacement's row-only shortcut: it changes base_id, so a
    // stale list summary would point at a base that no longer exists.
    const applied = await cached.freezeAtomic({
      heapId: 'h1', expectedFreezeY: 0, newBaseId: 'b2',
      baseVertices: [{ x: 400, y: 210 }], baseHash: 'hash-b2',
      newFreezeY: 200, versionWatermark: 0, now: NOW,
    });
    expect(applied).toBe(true);
    expect(kv.deletes).toContain('cache:heap:h1');
    expect((await cached.getHeap('h1'))!.base_id).toBe('b2');
```

`versionWatermark: 0` spares every band, so the existing `getAllBands` assertions later in the test are unaffected. Add a `NOW` constant if the file has no equivalent; reuse its existing timestamp constant if it does.

- [ ] **Step 7: Run the whole server suite**

Run: `cd server && npx vitest run`
Expected: PASS. Any failure mentioning `setFreeze` is a call site missed in Step 6.

- [ ] **Step 8: Commit**

```bash
git add server/src/db.ts server/src/cache/CachedHeapDB.ts server/tests/helpers/mockDb.ts server/tests/freezeRace.test.ts server/tests/heapDelta.test.ts server/tests/bandCacheConsistency.test.ts
git commit -m "fix(server): atomic guarded freeze replaces blind setFreeze

Two placements crossing the freeze threshold together could both build a
new base from the same pre-freeze base_id; the loser's bands were deleted
by its own DELETE and survived only in an orphaned base the heap no
longer pointed at. Silent and unrecoverable.

freezeAtomic issues all three writes as one D1 batch, every statement
guarded on the freeze_y the caller read, so a losing request writes
nothing at all. A version watermark bounds the DELETE to rows the new
base actually captured."
```

---

### Task 4: Wire the route to `freezeAtomic`

**Files:**
- Modify: `server/src/routes/heap.ts:646-672` (the freeze block at the end of `/place`)
- Test: `server/tests/freezeInvariant.test.ts`

**Interfaces:**
- Consumes: `freezeAtomic` and `FreezeArgs` (Task 3), `getAllBandsVersioned` (Task 2).

- [ ] **Step 1: Write the failing test**

Append to the `describe('freeze partition invariant')` block in `server/tests/freezeInvariant.test.ts`. It reuses the file's existing `driveToFreeze`, `climb` and `place` helpers — do not add new ones.

```ts
  it('folds a straggler into the base on the next freeze', async () => {
    // A straggler is a band the previous freeze deliberately spared: written
    // concurrently, so stamped above that freeze's watermark, so excluded from
    // the DELETE because the base it was building never captured it. It sits
    // below the freeze line — invisible to every live filter — and would be
    // stranded there forever if the next freeze only ever folded in its own
    // fresh slice. The base source is `band >= newFreezeBand`, deliberately
    // wider than the frozen slice, precisely to collect it.
    const db = await driveToFreeze();
    const afterFirst = (await db.getHeapFresh('h1'))!;
    expect(afterFirst.freeze_y).toBeGreaterThan(0); // freeze genuinely fired

    // Inject exactly what a concurrent mid-freeze placement leaves behind: a row
    // below the freeze line, stamped at the current heap version (which is above
    // the watermark that freeze captured).
    const firstFreezeBand = bandOf(afterFirst.freeze_y);
    const stragglerBand = firstFreezeBand + 5;
    await db.upsertBands('h1', [{ band: stragglerBand, minX: 100, maxX: 900 }], afterFirst.version);

    // It is genuinely invisible: below the line, so no live consumer sees it.
    expect((await db.getAllBands('h1')).some((b) => b.band === stragglerBand)).toBe(true);
    expect(stragglerBand).toBeGreaterThanOrEqual(firstFreezeBand);

    // Climb until a SECOND freeze fires.
    await climb(db, PLACEMENT_COUNT, FREEZE_BATCH_BANDS + 1);
    const afterSecond = (await db.getHeapFresh('h1'))!;
    expect(afterSecond.freeze_y).toBeLessThan(afterFirst.freeze_y); // line advanced
    expect(afterSecond.base_id).not.toBe(afterFirst.base_id);

    // The straggler's geometry is now in the base, at its real extents...
    const baseBands = verticesToEnvelope((await db.getBaseVerticesById(afterSecond.base_id)) ?? []);
    expect(baseBands.get(stragglerBand)).toMatchObject({ minX: 100, maxX: 900 });

    // ...and its row is gone, because this freeze's watermark DID capture it.
    expect((await db.getAllBands('h1')).some((b) => b.band === stragglerBand)).toBe(false);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx vitest run tests/freezeInvariant.test.ts`
Expected: FAIL — the straggler's extents are absent from the base.

- [ ] **Step 3: Rewrite the freeze block**

Replace lines 646-672 of `server/src/routes/heap.ts`. Keep the existing comment block above `commitPlacement` untouched; rewrite only the freeze comment and code:

```ts
    // Freeze: fold the bottom bands into the base, then drop them from
    // heap_band. All of it is ONE guarded transaction inside freezeAtomic —
    // see its doc for why a compare-and-swap is mandatory here even though the
    // placement write above needs none.
    //
    // Minting a new baseId is mandatory — loadCachedBase keys localStorage on
    // baseId with no TTL, so a stable id over changed base content strands
    // every client on a stale base.
    //
    // Same freeze_y>0 sentinel as liveBandsOf and the full-response filter:
    // `bandOf(0)` would be band 0, which is a real (if absurdly high) band
    // index, not "nothing is frozen".
    const freezeBand = row.freeze_y > 0 ? bandOf(row.freeze_y) : Infinity;
    const freeze = checkFreezeBands(await db.getAllBands(id), freezeBand);
    if (freeze) {
      // Re-read WITH versions, and read through the cache. The decision above
      // can safely run on a cached snapshot — a stale one can only under-report
      // bands, which defers the freeze to the next placement — but the set we
      // are about to DELETE cannot. This read costs a D1 query once per
      // FREEZE_BATCH_BANDS of climb, never on the placement hot path.
      const versioned = await db.getAllBandsVersioned(id);

      // Everything at or below the new line: the freshly frozen slice PLUS any
      // straggler an earlier freeze spared because it was written mid-freeze.
      // Widening the base source is the entire straggler-collection mechanism —
      // the DELETE below already covers `band >= newFreezeBand`, so a straggler
      // is captured and buried in the same pass.
      const buried = versioned.filter((b) => b.band >= freeze.newFreezeBand);

      // The watermark is the max version we actually captured. Heap versions
      // are monotonic, so any row written after the read above carries a higher
      // one and survives the DELETE rather than being buried into a base that
      // never saw it.
      const versionWatermark = Math.max(...buried.map((b) => b.version));

      const existingBase = (await db.getBaseVerticesById(row.base_id)) ?? [];
      const baseVertices = [
        ...existingBase,
        ...envelopeToVertices(mergeBands(new Map(), buried)),
      ];
      // row.base_id was read before commitPlacement, so a losing racer builds
      // its base from a stale one. Harmless: the guard makes its whole batch a
      // no-op, base row included.
      await db.freezeAtomic({
        heapId: id,
        expectedFreezeY: row.freeze_y,
        newBaseId: crypto.randomUUID(),
        baseVertices,
        baseHash: hashVertices(baseVertices),
        newFreezeY: freeze.newFreezeBand * BAND_SIZE_PX,
        versionWatermark,
        now: new Date().toISOString(),
      });
      // Return value deliberately ignored. A lost CAS means another request
      // froze first; the placement itself already committed and succeeded, and
      // freeze is opportunistic — the next placement re-evaluates it against
      // fresh state. Nothing to retry and nothing to report.
    }
```

`buried` is guaranteed non-empty whenever `freeze` is non-null (`checkFreezeBands` returns a non-empty `frozen` slice, and `versioned` is a superset of the rows it was computed from), so the `Math.max` spread always has an argument.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx vitest run tests/freezeInvariant.test.ts tests/freezeBands.test.ts tests/placeConcurrency.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole server suite and the build**

Run: `cd server && npx vitest run`
Expected: PASS.

Run: `cd /home/connor/Documents/Repos/HeapGame && npm run build`
Expected: clean build, no TS errors.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/heap.ts server/tests/freezeInvariant.test.ts
git commit -m "fix(server): /place freeze uses the guarded atomic path"
```

---

### Task 5: Stale comment and final verification

**Files:**
- Modify: `server/src/polygon.ts:24-27`

- [ ] **Step 1: Fix the stale doc comment**

`checkFreezeBands`'s doc still claims freeze never deletes rows, which stopped being true in #126. It sits directly on top of the reasoning this whole fix depends on. Replace:

```
 * `allBands` is every band the heap has ever recorded — freeze never deletes
 * rows — so the live set must be carved out here with the SAME predicate every
 * other consumer uses: LIVE is `band < freezeBand`. Callers pass `Infinity` for
 * the pre-freeze sentinel (`freeze_y === 0`), never `bandOf(0)`.
```

with:

```
 * `allBands` is every band row the heap currently has: the live set plus any
 * straggler a freeze spared because it was written mid-freeze (see
 * HeapDB.freezeAtomic). Frozen rows are otherwise deleted, so this is NOT the
 * heap's whole history. The live set must still be carved out here with the
 * SAME predicate every other consumer uses: LIVE is `band < freezeBand`.
 * Callers pass `Infinity` for the pre-freeze sentinel (`freeze_y === 0`), never
 * `bandOf(0)`.
```

- [ ] **Step 2: Full verification**

Run: `cd server && npx vitest run`
Expected: PASS, no skipped freeze tests.

Run: `cd /home/connor/Documents/Repos/HeapGame && npm test`
Expected: PASS (client + shared suites — unaffected, but confirm).

Run: `cd /home/connor/Documents/Repos/HeapGame && npm run build`
Expected: clean.

Run: `cd /home/connor/Documents/Repos/HeapGame && git grep -n "setFreeze"`
Expected: no matches outside the spec/plan docs. A match in `server/src` or `server/tests` means a call site was missed.

- [ ] **Step 3: Commit and open the PR**

```bash
git add server/src/polygon.ts
git commit -m "docs(server): checkFreezeBands doc no longer claims freeze keeps rows"
git push -u origin fix/freeze-race-cas
```

Then open a PR against `main` describing the race, the guarded-batch fix, and the watermark. Note in the PR body that the fix is covered by real-SQLite tests (`server/tests/freezeRace.test.ts`) rather than mock-only ones, and that no migration is required.

---

## Post-merge follow-up (not part of this plan)

- Update `Todo/Bugs.md` to strike the HIGH freeze-race entry.
- Gating the freeze check behind a `COUNT` so `getAllBands` stops scanning on every placement is a real CPU win, deliberately kept out of this correctness fix. Worth its own change with load-test numbers (see the `load-testing-heap` skill).

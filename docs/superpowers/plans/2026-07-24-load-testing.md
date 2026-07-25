# Load Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simulate many concurrent players against a dedicated staging Heap Worker with k6, hitting a realistic mix of endpoints, to find where the system breaks.

**Architecture:** Four prerequisite server changes land first — three of them (fail-open cache, two redundant-invalidation removals) are production fixes worth shipping regardless, and one adds a staging-only synthetic rate-limit key so k6 running from a single IP isn't throttled to ~5 req/s. A `[env.staging]` Worker with its own D1/KV then serves as the target. k6 scenarios live in `loadtest/`, with the pure-logic modules (payloads, budget, identity) unit-tested by vitest so request shapes can't drift from `shared/` types.

**Tech Stack:** TypeScript 5.9, Hono, Cloudflare Workers/D1/KV, Vitest 2, k6 (standalone binary), tsx.

**Spec:** `docs/superpowers/specs/2026-07-24-load-testing-design.md`

## Global Constraints

- Branch off `main`; PR before merge, never push direct to main. Work happens on `feature/load-testing`.
- No git worktrees — regular feature branches in the main working dir.
- `npm run build` must pass before any task is called done; it catches TS errors tests miss.
- `npm test` (root, Vitest) and `cd server && npx vitest run` must both stay green.
- Free-tier quotas are **account-wide**, shared with production: 100,000 Workers requests/day, 10 ms CPU/request, 5M D1 rows read/day, 100,000 D1 rows written/day, 10 D1 databases/account, 100,000 KV reads/day, 1,000 KV writes/day, 1,000 KV deletes/day.
- Per-run budget: ≤800 sessions / ≤10,000 requests, ≤150 placements total, ≤500 KV deletes.
- `LOADTEST_SECRET` must never be set in the production Worker environment.
- Do not wire the load test into CI — every push would spend production's quota.
- Never commit `.wrangler/state/` or `loadtest/identities.json`.

## Prerequisite (manual, human — blocks Task 5)

The D1 free plan allows 10 databases per account. The account has 5; staging needs 4 more. **The user deletes the old `heap` database** (the PR #81 rollback path, unused since sharding went live) before Task 5 provisions staging DBs.

---

## Task 1: Make the cache layer fail open

Highest-priority change. `server/src/cache/` has no `try`/`catch` at all, so a KV error propagates out as a 500 — the read path throws straight past its own D1 fallback.

**Files:**
- Modify: `server/src/cache/CachedHeapDB.ts`
- Modify: `server/src/cache/CachedScoreDB.ts`
- Modify: `server/src/cache/CachedConfigDB.ts`
- Modify: `server/tests/helpers/mockKv.ts`
- Test: `server/tests/cacheDecorators.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `MockKV.failNext(op: 'get' | 'put' | 'delete')` and `MockKV.failAll(op)` test helpers, used by Task 3's tests.

- [ ] **Step 1: Add failure injection to MockKV**

In `server/tests/helpers/mockKv.ts`, add fields and helpers to the `MockKV` class (keep the existing `store`/`puts`/`deletes` members and `asKV()` exactly as they are):

```ts
  /** Ops that should throw on their next call, then clear. */
  private failOnce = new Set<'get' | 'put' | 'delete'>();
  /** Ops that should throw on every call until reset. */
  private failEvery = new Set<'get' | 'put' | 'delete'>();

  /** Test helper — make the next call to `op` throw, simulating a KV error. */
  failNext(op: 'get' | 'put' | 'delete'): void {
    this.failOnce.add(op);
  }

  /** Test helper — make every call to `op` throw, simulating quota exhaustion. */
  failAll(op: 'get' | 'put' | 'delete'): void {
    this.failEvery.add(op);
  }

  private maybeThrow(op: 'get' | 'put' | 'delete'): void {
    if (this.failEvery.has(op)) throw new Error(`KV ${op} failed (simulated quota exhaustion)`);
    if (this.failOnce.delete(op)) throw new Error(`KV ${op} failed (simulated)`);
  }
```

Then add `this.maybeThrow('get')`, `this.maybeThrow('put')`, `this.maybeThrow('delete')` as the **first line** of the existing `get`, `put` and `delete` methods respectively.

- [ ] **Step 2: Write the failing tests**

Append to `server/tests/cacheDecorators.test.ts`:

```ts
describe('cache fail-open behaviour', () => {
  it('CachedHeapDB.getHeap falls through to D1 when KV get throws', async () => {
    const inner = new MockHeapDB();
    const kv = new MockKV();
    const cached = new CachedHeapDB(inner, kv.asKV(), noWait);
    inner.seedHeap(HEAP_ID, 3, []);

    kv.failAll('get');

    const row = await cached.getHeap(HEAP_ID);
    expect(row?.version).toBe(3);
  });

  it('CachedHeapDB.listHeaps falls through to D1 when KV get throws', async () => {
    const inner = new MockHeapDB();
    const kv = new MockKV();
    const cached = new CachedHeapDB(inner, kv.asKV(), noWait);
    inner.seedHeap(HEAP_ID, 1, []);

    kv.failAll('get');

    const rows = await cached.listHeaps();
    expect(rows).toHaveLength(1);
  });

  it('CachedHeapDB.updateHeap still reports success when invalidation throws', async () => {
    const inner = new MockHeapDB();
    const kv = new MockKV();
    const cached = new CachedHeapDB(inner, kv.asKV(), noWait);
    inner.seedHeap(HEAP_ID, 1, []);

    kv.failAll('delete');

    // The D1 write commits before invalidation, so the caller must see success.
    const applied = await cached.updateHeap(HEAP_ID, HEAP_ID, 2, [{ x: 1, y: 2 }], 0, 1);
    expect(applied).toBe(true);
    expect((await inner.getHeap(HEAP_ID))?.version).toBe(2);
  });

  it('CachedScoreDB.getTopScores falls through to D1 when KV get throws', async () => {
    const inner = new MockScoreDB();
    const kv = new MockKV();
    const cached = new CachedScoreDB(inner, kv.asKV(), noWait);
    await inner.upsertScore(HEAP_ID, 'p1', 500, '2026-01-01T00:00:00.000Z');

    kv.failAll('get');

    const top = await cached.getTopScores(HEAP_ID, 5);
    expect(top).toHaveLength(1);
    expect(top[0].score).toBe(500);
  });

  it('CachedConfigDB.getAll falls through to D1 when KV get throws', async () => {
    const inner = new MockConfigDB();
    const kv = new MockKV();
    const cached = new CachedConfigDB(inner, kv.asKV(), noWait);
    await inner.set('ad_cadence', '3');

    kv.failAll('get');

    const all = await cached.getAll();
    expect(all['ad_cadence']).toBe('3');
  });
});
```

Before running, open `server/src/configDb.ts` and `server/tests/helpers/mockConfigDb.ts` and confirm the method names used above (`getAll`, `set`). If they differ, use the real names — do not add methods to make the test compile.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd server && npx vitest run tests/cacheDecorators.test.ts`
Expected: the five new tests FAIL, throwing `KV get failed (simulated quota exhaustion)` / `KV delete failed (...)`. Existing tests in the file still pass.

- [ ] **Step 4: Add the safe helpers to CachedHeapDB**

In `server/src/cache/CachedHeapDB.ts`, add two private methods next to the existing `invalidateHeap` helper:

```ts
  /** KV read that degrades to a cache miss on error, so callers fall through to D1. */
  private async safeGet<T>(key: string): Promise<T | null> {
    try {
      return await this.kv.get<T>(key, 'json');
    } catch (err) {
      console.warn(`[cache] KV get failed key=${key}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /** KV delete that never fails the request. The D1 write already committed;
   *  staleness is bounded by HEAP_TTL. */
  private async safeDelete(key: string): Promise<void> {
    try {
      await this.kv.delete(key);
    } catch (err) {
      console.warn(`[cache] KV delete failed key=${key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
```

Replace every `await this.kv.get<...>(key, 'json')` in this file with `await this.safeGet<...>(key)`, and every `this.kv.delete(...)` inside `invalidateHeap` with `this.safeDelete(...)`.

Leave the `this.waitUntil(this.kv.put(...))` calls alone — they already run outside the response path.

- [ ] **Step 5: Add the same helpers to CachedScoreDB and CachedConfigDB**

Repeat the two private methods in `server/src/cache/CachedScoreDB.ts` and `server/src/cache/CachedConfigDB.ts` verbatim (adjusting only the TTL mentioned in the `safeDelete` comment to `SCORES_TTL` / `CONFIG_TTL`), and swap their `this.kv.get` / `this.kv.delete` call sites the same way.

Note `CachedConfigDB.delete` calls `await this.kv.delete(CONFIG_KEY)` after `await this.inner.delete(key)` — same ordering hazard, same fix.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd server && npx vitest run`
Expected: all tests PASS, including the five new ones.

- [ ] **Step 7: Verify the build**

Run: `npm run build`
Expected: exit 0, no TS errors.

- [ ] **Step 8: Commit**

```bash
git add server/src/cache/ server/tests/cacheDecorators.test.ts server/tests/helpers/mockKv.ts
git commit -m "fix(cache): fail open on KV errors instead of returning 500

The cache decorators had no error handling, so a KV failure (quota
exhaustion) threw past the D1 fallback on the next line and surfaced as
a 500. Reads now degrade to a cache miss; invalidations log and continue
since the D1 write already committed and the TTL bounds staleness."
```

---

## Task 2: Fold `top_y` into the CAS write

Removes 2 of the 4 KV deletes per placement, and 1 of 2 D1 writes, by merging the summit update into the compare-and-swap instead of issuing it as a separate follow-up.

**Files:**
- Modify: `server/src/db.ts` (interface at `:77`, `D1HeapDB.updateHeap` at `:147`, `D1HeapDB.updateTopY` at `:183`)
- Modify: `server/src/cache/CachedHeapDB.ts` (`updateHeap`, `updateTopY` at `:100`)
- Modify: `server/src/routes/heap.ts` (`:551-554`)
- Modify: `server/tests/helpers/mockDb.ts` (`updateHeap` at `:99`, `updateTopY` at `:197`)
- Test: `server/tests/cacheDecorators.test.ts`, `server/tests/placeCas.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `HeapDB.updateHeap(id, baseId, version, liveZone, freezeY, topYCandidate, expectedVersion?) => Promise<boolean>` — note `topYCandidate: number` inserted as the **6th** positional parameter, before `expectedVersion`. `HeapDB.updateTopY` no longer exists.

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/cacheDecorators.test.ts`:

```ts
describe('CachedHeapDB top_y folding', () => {
  it('updateHeap applies the summit candidate and invalidates exactly twice', async () => {
    const inner = new MockHeapDB();
    const kv = new MockKV();
    const cached = new CachedHeapDB(inner, kv.asKV(), noWait);
    inner.seedHeap(HEAP_ID, 1, []);
    inner.setTopYForTest(HEAP_ID, 900);
    await cached.getHeap(HEAP_ID);
    await cached.listHeaps();
    kv.deletes.length = 0;

    const applied = await cached.updateHeap(HEAP_ID, HEAP_ID, 2, [{ x: 1, y: 400 }], 0, 400, 1);

    expect(applied).toBe(true);
    // Summit is the LOWEST y, so 400 beats 900.
    expect(inner.getTopYForTest(HEAP_ID)).toBe(400);
    // Exactly one invalidation: the heap row and the list, and nothing more.
    expect(kv.deletes).toEqual([`cache:heap:${HEAP_ID}`, 'cache:heap:list']);
  });

  it('updateHeap does not raise the summit when the candidate is lower down', async () => {
    const inner = new MockHeapDB();
    const kv = new MockKV();
    const cached = new CachedHeapDB(inner, kv.asKV(), noWait);
    inner.seedHeap(HEAP_ID, 1, []);
    inner.setTopYForTest(HEAP_ID, 300);

    await cached.updateHeap(HEAP_ID, HEAP_ID, 2, [{ x: 1, y: 800 }], 0, 800, 1);

    expect(inner.getTopYForTest(HEAP_ID)).toBe(300);
  });

  it('a failed CAS leaves top_y untouched and performs no invalidation', async () => {
    const inner = new MockHeapDB();
    const kv = new MockKV();
    const cached = new CachedHeapDB(inner, kv.asKV(), noWait);
    inner.seedHeap(HEAP_ID, 5, []);
    inner.setTopYForTest(HEAP_ID, 900);
    kv.deletes.length = 0;

    // expectedVersion 1 != actual 5 -> CAS must fail.
    const applied = await cached.updateHeap(HEAP_ID, HEAP_ID, 2, [{ x: 1, y: 100 }], 0, 100, 1);

    expect(applied).toBe(false);
    expect(inner.getTopYForTest(HEAP_ID)).toBe(900);
    expect(kv.deletes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npx vitest run tests/cacheDecorators.test.ts`
Expected: FAIL — TS/arity errors, because `updateHeap` does not yet take a `topYCandidate` parameter.

- [ ] **Step 3: Update the HeapDB interface**

In `server/src/db.ts`, change the interface signature (currently around `:70-77`) to insert `topYCandidate` before `expectedVersion`, and **delete** the `updateTopY(id: string, candidateY: number): Promise<void>;` line at `:77`:

```ts
  updateHeap(
    id: string,
    baseId: string,
    version: number,
    liveZone: Vertex[],
    freezeY: number,
    topYCandidate: number,
    expectedVersion?: number,
  ): Promise<boolean>;
```

- [ ] **Step 4: Update D1HeapDB**

In `server/src/db.ts`, replace the body of `updateHeap` (`:147-168`) so both branches fold in the summit, and **delete** the whole `updateTopY` method (`:183-188`):

```ts
  async updateHeap(
    id: string,
    baseId: string,
    version: number,
    liveZone: Vertex[],
    freezeY: number,
    topYCandidate: number,
    expectedVersion?: number,
  ): Promise<boolean> {
    // top_y is the summit — the LOWEST y — so MIN() only ever raises the peak.
    // Folding it into the CAS makes the summit update atomic with the placement
    // and halves both the D1 writes and the KV invalidations per placement.
    if (expectedVersion === undefined) {
      await this.d1
        .prepare('UPDATE heap SET base_id = ?1, version = ?2, live_zone = ?3, freeze_y = ?4, top_y = MIN(top_y, ?5) WHERE id = ?6')
        .bind(baseId, version, JSON.stringify(liveZone), freezeY, topYCandidate, id)
        .run();
      return true;
    }
    const res = await this.d1
      .prepare('UPDATE heap SET base_id = ?1, version = ?2, live_zone = ?3, freeze_y = ?4, top_y = MIN(top_y, ?5) WHERE id = ?6 AND version = ?7')
      .bind(baseId, version, JSON.stringify(liveZone), freezeY, topYCandidate, id, expectedVersion)
      .run();
    return (res.meta.changes ?? 0) > 0;
  }
```

- [ ] **Step 5: Update CachedHeapDB**

In `server/src/cache/CachedHeapDB.ts`, widen `updateHeap` to pass the new parameter through, and **delete** the `updateTopY` method at `:100-103`:

```ts
  async updateHeap(
    id: string,
    baseId: string,
    version: number,
    liveZone: Vertex[],
    freezeY: number,
    topYCandidate: number,
    expectedVersion?: number,
  ): Promise<boolean> {
    const applied = await this.inner.updateHeap(id, baseId, version, liveZone, freezeY, topYCandidate, expectedVersion);
    // A failed CAS changed nothing — the winning writer already busted the cache.
    if (applied) await this.invalidateHeap(id);
    return applied;
  }
```

- [ ] **Step 6: Update MockHeapDB**

In `server/tests/helpers/mockDb.ts`, widen `updateHeap` (`:99-110`) and **delete** `updateTopY` (`:197-201`). Keep `getTopYForTest` and `setTopYForTest`:

```ts
  async updateHeap(
    id: string,
    baseId: string,
    version: number,
    liveZone: Vertex[],
    freezeY: number,
    topYCandidate: number,
    expectedVersion?: number,
  ): Promise<boolean> {
    const existing = this.heaps.get(id);
    if (!existing) return false;
    if (expectedVersion !== undefined && existing.version !== expectedVersion) return false;
    this.heaps.set(id, {
      ...existing,
      base_id: baseId,
      version,
      live_zone: JSON.stringify(liveZone),
      freeze_y: freezeY,
      top_y: Math.min(existing.top_y, topYCandidate),
    });
    return true;
  }
```

- [ ] **Step 7: Update the place route**

In `server/src/routes/heap.ts`, replace lines `551-554`:

```ts
      const newVersion = row.version + 1;
      const applied = await db.updateHeap(id, currentBaseId, newVersion, finalLiveZone, newFreezeY, y, row.version);
      if (!applied) continue; // lost-update conflict — re-read and retry
```

The standalone `await db.updateTopY(id, y);` line is deleted — the summit now rides along in the CAS above.

- [ ] **Step 8: Fix remaining call sites**

Run: `cd server && npx tsc --noEmit`
Expected: errors listing every other `updateHeap` / `updateTopY` call site (notably in `server/tests/`). Update each to the new arity. For test call sites that only care about the polygon, pass the placement's `y`, or `0` where no summit change is intended — but if a test asserts on `top_y`, pass the value that preserves its intent.

Re-run until clean.

- [ ] **Step 9: Run the full server suite**

Run: `cd server && npx vitest run`
Expected: all PASS. Pay particular attention to `tests/placeCas.test.ts`, which exercises the CAS retry loop directly.

- [ ] **Step 10: Verify the build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 11: Commit**

```bash
git add server/src/db.ts server/src/cache/CachedHeapDB.ts server/src/routes/heap.ts server/tests/
git commit -m "perf(heap): fold top_y into the CAS write

updateTopY ran on the line after updateHeap, so every placement paid two
D1 writes and four KV deletes -- the second invalidation removing keys the
first had just deleted. top_y = MIN(top_y, ?) folds into the CAS UPDATE,
halving both and making the summit update atomic with the placement."
```

---

## Task 3: Stop over-invalidating the score cache

Two independent savings on `POST /scores`: drop a provably-dead invalidation, then skip the remaining one when the new score cannot enter the cached top-50.

**Files:**
- Modify: `server/src/cache/CachedScoreDB.ts` (`upsertScore` at `:48`, `pruneScores` at `:54`)
- Test: `server/tests/cacheDecorators.test.ts`

**Interfaces:**
- Consumes: `MockKV.failAll` from Task 1; `safeGet`/`safeDelete` added to `CachedScoreDB` in Task 1.
- Produces: no signature changes. `CachedScoreDB.pruneScores` no longer touches KV.

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/cacheDecorators.test.ts`. `CACHE_TOP_N` is 50, so the "full board" cases seed 50 rows:

```ts
describe('CachedScoreDB selective invalidation', () => {
  const NOW = '2026-01-01T00:00:00.000Z';

  async function seedFullBoard(inner: MockScoreDB) {
    // 50 players scoring 1000, 1020, ... 1980. Cutoff (50th place) is 1000.
    for (let i = 0; i < 50; i++) {
      await inner.upsertScore(HEAP_ID, `filler-${i}`, 1000 + i * 20, NOW);
    }
  }

  it('pruneScores no longer touches KV', async () => {
    const inner = new MockScoreDB();
    const kv = new MockKV();
    const cached = new CachedScoreDB(inner, kv.asKV(), noWait);
    await inner.upsertScore(HEAP_ID, 'p1', 500, NOW);
    await cached.getTopScores(HEAP_ID, 5);
    kv.deletes.length = 0;

    await cached.pruneScores(HEAP_ID);

    expect(kv.deletes).toEqual([]);
  });

  it('skips invalidation when the improved score misses the top-50 cutoff', async () => {
    const inner = new MockScoreDB();
    const kv = new MockKV();
    const cached = new CachedScoreDB(inner, kv.asKV(), noWait);
    await seedFullBoard(inner);
    await cached.getTopScores(HEAP_ID, 50); // populate the cache
    kv.deletes.length = 0;

    // A genuine personal best (no prior row), but far below the 1000 cutoff.
    const changed = await cached.upsertScore(HEAP_ID, 'nobody', 600, NOW);

    expect(changed).toBe(true);
    expect(kv.deletes).toEqual([]);
  });

  it('invalidates when the improved score reaches the cutoff', async () => {
    const inner = new MockScoreDB();
    const kv = new MockKV();
    const cached = new CachedScoreDB(inner, kv.asKV(), noWait);
    await seedFullBoard(inner);
    await cached.getTopScores(HEAP_ID, 50);
    kv.deletes.length = 0;

    const changed = await cached.upsertScore(HEAP_ID, 'climber', 5000, NOW);

    expect(changed).toBe(true);
    expect(kv.deletes).toEqual([`cache:scores:${HEAP_ID}:top`]);
  });

  it('invalidates on an exact tie with the cutoff', async () => {
    const inner = new MockScoreDB();
    const kv = new MockKV();
    const cached = new CachedScoreDB(inner, kv.asKV(), noWait);
    await seedFullBoard(inner);
    await cached.getTopScores(HEAP_ID, 50);
    kv.deletes.length = 0;

    await cached.upsertScore(HEAP_ID, 'tied', 1000, NOW); // == cutoff

    expect(kv.deletes).toEqual([`cache:scores:${HEAP_ID}:top`]);
  });

  it('invalidates when the board is not yet full, since any score enters', async () => {
    const inner = new MockScoreDB();
    const kv = new MockKV();
    const cached = new CachedScoreDB(inner, kv.asKV(), noWait);
    await inner.upsertScore(HEAP_ID, 'p1', 9000, NOW);
    await cached.getTopScores(HEAP_ID, 50); // cache holds 1 row
    kv.deletes.length = 0;

    await cached.upsertScore(HEAP_ID, 'p2', 1, NOW);

    expect(kv.deletes).toEqual([`cache:scores:${HEAP_ID}:top`]);
  });

  it('skips invalidation when nothing is cached', async () => {
    const inner = new MockScoreDB();
    const kv = new MockKV();
    const cached = new CachedScoreDB(inner, kv.asKV(), noWait);
    // No getTopScores call, so no cache entry exists.

    await cached.upsertScore(HEAP_ID, 'p1', 9999, NOW);

    expect(kv.deletes).toEqual([]);
  });

  it('does not invalidate when the score did not improve', async () => {
    const inner = new MockScoreDB();
    const kv = new MockKV();
    const cached = new CachedScoreDB(inner, kv.asKV(), noWait);
    await inner.upsertScore(HEAP_ID, 'p1', 9000, NOW);
    await cached.getTopScores(HEAP_ID, 50);
    kv.deletes.length = 0;

    const changed = await cached.upsertScore(HEAP_ID, 'p1', 100, NOW);

    expect(changed).toBe(false);
    expect(kv.deletes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npx vitest run tests/cacheDecorators.test.ts`
Expected: the `pruneScores`, "misses the cutoff" and "nothing is cached" tests FAIL — each currently records an unwanted delete. The others pass already.

- [ ] **Step 3: Implement selective invalidation**

In `server/src/cache/CachedScoreDB.ts`, replace `upsertScore` and `pruneScores`:

```ts
  async upsertScore(heapId: string, playerId: string, score: number, now: string): Promise<boolean> {
    const changed = await this.inner.upsertScore(heapId, playerId, score, now);
    if (!changed) return false;

    // `changed` only means the player beat their OWN previous best, which says
    // nothing about whether the leaderboard moved. Bust the cache only when the
    // new score can actually appear in the cached window — trading a KV read
    // (100k/day bucket) for a KV delete (1k/day bucket).
    const key = this.topKey(heapId);
    const cached = await this.safeGet<ScoreRow[]>(key);
    if (!cached) return true;                         // nothing cached, nothing to bust
    const boardNotFull = cached.length < CACHE_TOP_N; // any score would enter
    const cutoff = cached[cached.length - 1].score;   // current 50th place
    if (boardNotFull || score >= cutoff) {            // >= so ties invalidate
      await this.safeDelete(key);
    }
    return true;
  }

  async pruneScores(heapId: string): Promise<void> {
    // No invalidation: prune retains the top 1000 (see D1ScoreDB.pruneScores)
    // while this cache holds only CACHE_TOP_N (50), so pruning can only ever
    // remove rows that were never in the cached window. Revisit if either
    // constant changes.
    await this.inner.pruneScores(heapId);
  }
```

`boardNotFull` is evaluated before `cutoff` is used, and `cached` is non-empty whenever it is truthy (an empty array is only cached when the heap has no scores, in which case `boardNotFull` is `true` and short-circuits before `cutoff` is read). If `cached.length === 0`, `cutoff` would be `undefined` — the `||` short-circuit prevents it being compared.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx vitest run`
Expected: all PASS.

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add server/src/cache/CachedScoreDB.ts server/tests/cacheDecorators.test.ts
git commit -m "perf(scores): invalidate the leaderboard cache only when it changes

upsertScore returned changed=true for any personal best, and pruneScores
then deleted the same key again. Prune retains the top 1000 while the
cache holds 50, so its invalidation was dead. The remaining one now fires
only when the score reaches the cached cutoff. Safe because getScore and
getRank are uncached, so submitters always see fresh values."
```

---

## Task 4: Staging-only synthetic rate-limit key

`rateLimit` keys on `cf-connecting-ip`, which Cloudflare sets at the edge and clients cannot spoof — so k6 from one machine shares one bucket and hits `RL_GLOBAL` (300/min) at ~5 req/s.

**Files:**
- Modify: `server/src/middleware/rateLimit.ts`
- Test: `server/tests/security.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: request headers `X-LoadTest-Secret` and `X-LoadTest-Key`, honoured only when `env.LOADTEST_SECRET` is set. Task 9 sends both.

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/security.test.ts`. Match the file's existing app-construction helper rather than inventing one — read the top of the file first and reuse its pattern for building a Hono app with a stub limiter.

```ts
describe('load-test rate-limit key override', () => {
  /** Records the key each limit() call used; always allows the request. */
  function recordingLimiter() {
    const keys: string[] = [];
    return {
      keys,
      limiter: { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: true }; } },
    };
  }

  it('keys on the client IP when LOADTEST_SECRET is unset', async () => {
    const { keys, limiter } = recordingLimiter();
    const app = new Hono();
    app.use('*', rateLimit(limiter, 'test'));
    app.get('/x', (c) => c.text('ok'));

    await app.fetch(new Request('http://localhost/x', {
      headers: {
        'cf-connecting-ip': '203.0.113.9',
        'X-LoadTest-Secret': 'shhh',
        'X-LoadTest-Key': 'vu-42',
      },
    }), {});

    expect(keys).toEqual(['203.0.113.9']);
  });

  it('keys on X-LoadTest-Key when the secret matches', async () => {
    const { keys, limiter } = recordingLimiter();
    const app = new Hono();
    app.use('*', rateLimit(limiter, 'test'));
    app.get('/x', (c) => c.text('ok'));

    await app.fetch(new Request('http://localhost/x', {
      headers: {
        'cf-connecting-ip': '203.0.113.9',
        'X-LoadTest-Secret': 'shhh',
        'X-LoadTest-Key': 'vu-42',
      },
    }), { LOADTEST_SECRET: 'shhh' });

    expect(keys).toEqual(['vu-42']);
  });

  it('ignores the override when the secret is wrong', async () => {
    const { keys, limiter } = recordingLimiter();
    const app = new Hono();
    app.use('*', rateLimit(limiter, 'test'));
    app.get('/x', (c) => c.text('ok'));

    await app.fetch(new Request('http://localhost/x', {
      headers: {
        'cf-connecting-ip': '203.0.113.9',
        'X-LoadTest-Secret': 'wrong',
        'X-LoadTest-Key': 'vu-42',
      },
    }), { LOADTEST_SECRET: 'shhh' });

    expect(keys).toEqual(['203.0.113.9']);
  });

  it('falls back to the IP when the secret matches but no key is sent', async () => {
    const { keys, limiter } = recordingLimiter();
    const app = new Hono();
    app.use('*', rateLimit(limiter, 'test'));
    app.get('/x', (c) => c.text('ok'));

    await app.fetch(new Request('http://localhost/x', {
      headers: {
        'cf-connecting-ip': '203.0.113.9',
        'X-LoadTest-Secret': 'shhh',
      },
    }), { LOADTEST_SECRET: 'shhh' });

    expect(keys).toEqual(['203.0.113.9']);
  });
});
```

Add `import { Hono } from 'hono';` and `import { rateLimit } from '../src/middleware/rateLimit';` to the file's imports if not already present.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npx vitest run tests/security.test.ts`
Expected: the second test FAILS with `expected [ '203.0.113.9' ] to equal [ 'vu-42' ]`. The other three pass (they assert current behaviour).

- [ ] **Step 3: Implement the override**

In `server/src/middleware/rateLimit.ts`, replace the key derivation inside the returned middleware:

```ts
    const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
    // Staging-only: let a load generator present a synthetic per-VU key so that
    // traffic from one machine models many players arriving from distinct IPs.
    // LOADTEST_SECRET is never set in production, so this branch is unreachable
    // there and the limiter keys on the (unspoofable) edge-set client IP.
    const loadTestSecret = (c.env as { LOADTEST_SECRET?: string } | undefined)?.LOADTEST_SECRET;
    const key = loadTestSecret && c.req.header('X-LoadTest-Secret') === loadTestSecret
      ? c.req.header('X-LoadTest-Key') ?? ip
      : ip;
    const { success } = await limiter.limit({ key });
```

Update the `console.warn` and the `rate_limit:hit` capture below to log `key` rather than `ip`, so blocked-request logs identify the actual bucket.

- [ ] **Step 4: Add the header to the CORS allowlist**

In `server/src/app.ts`, extend `allowHeaders` in the `cors({...})` call to include the two new headers:

```ts
    allowHeaders: ['Content-Type', 'X-Admin-Secret', 'X-Player-Token', 'X-LoadTest-Secret', 'X-LoadTest-Key'],
```

- [ ] **Step 5: Add LOADTEST_SECRET to the Env type**

In `server/src/index.ts`, add to the `Env` interface, next to `ADMIN_SECRET`:

```ts
  /** Staging only — enables the synthetic rate-limit key. Never set in production. */
  LOADTEST_SECRET?: string;
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd server && npx vitest run`
Expected: all PASS.

- [ ] **Step 7: Verify the build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add server/src/middleware/rateLimit.ts server/src/app.ts server/src/index.ts server/tests/security.test.ts
git commit -m "feat(server): staging-only synthetic rate-limit key

The limiter keys on cf-connecting-ip, so a load generator on one machine
shares a single bucket. When LOADTEST_SECRET is set (staging only) and the
request presents it, key on X-LoadTest-Key instead, modelling players
arriving from distinct IPs. Inert in production, where the var is unset."
```

---

## Task 5: Provision the staging Worker

**Blocked on:** the user deleting the old `heap` D1 database (10-DB free-tier cap).

**Files:**
- Modify: `server/wrangler.toml`
- Create: `docs/superpowers/runbooks/loadtest-staging.md`

**Interfaces:**
- Consumes: `LOADTEST_SECRET` from Task 4.
- Produces: a deployed Worker whose URL is passed to k6 as `BASE_URL`, and heap fixtures created in Task 6.

- [ ] **Step 1: Confirm the DB budget**

Run: `cd server && npx wrangler d1 list`
Expected: 4 databases (`heap_core`, `heap_scores`, `heap_rewards`, `heap_telemetry`). If `heap` is still listed, **stop** — the prerequisite deletion has not happened. Do not proceed.

- [ ] **Step 2: Create the staging resources**

```bash
cd server
npx wrangler d1 create heap_core_staging
npx wrangler d1 create heap_scores_staging
npx wrangler d1 create heap_rewards_staging
npx wrangler d1 create heap_telemetry_staging
npx wrangler kv namespace create CACHE_STAGING
```

Record each returned `database_id` and the KV `id`.

- [ ] **Step 3: Add the staging environment**

Append to `server/wrangler.toml`, substituting the real IDs from Step 2. Wrangler environments do not inherit bindings, so every binding is repeated:

```toml
# ── Load-test staging ─────────────────────────────────────────────────────────
# Deploy:  npx wrangler deploy --env staging
# Secrets: npx wrangler secret put ADMIN_SECRET --env staging
#          npx wrangler secret put LOADTEST_SECRET --env staging
# See docs/superpowers/runbooks/loadtest-staging.md
[env.staging]
name = "heap-server-staging"

[[env.staging.d1_databases]]
binding = "DB_HEAP"
database_name = "heap_core_staging"
database_id = "<heap_core_staging id>"
migrations_dir = "migrations/heap_core"

[[env.staging.d1_databases]]
binding = "DB_SCORES"
database_name = "heap_scores_staging"
database_id = "<heap_scores_staging id>"
migrations_dir = "migrations/heap_scores"

[[env.staging.d1_databases]]
binding = "DB_REWARDS"
database_name = "heap_rewards_staging"
database_id = "<heap_rewards_staging id>"
migrations_dir = "migrations/heap_rewards"

[[env.staging.d1_databases]]
binding = "DB_TELEMETRY"
database_name = "heap_telemetry_staging"
database_id = "<heap_telemetry_staging id>"
migrations_dir = "migrations/heap_telemetry"

[[env.staging.kv_namespaces]]
binding = "CACHE"
id = "<CACHE_STAGING id>"

# Separate dataset so load-test noise never reaches crash triage.
[[env.staging.analytics_engine_datasets]]
  binding = "LOGS"
  dataset = "heap_logs_staging"

[env.staging.vars]
ALLOWED_ORIGINS = "*"

# Same limits as production, so the limiter is exercised rather than bypassed.
[[env.staging.ratelimits]]
name = "RL_SCORES"
namespace_id = "2001"
  [env.staging.ratelimits.simple]
  limit = 10
  period = 60

[[env.staging.ratelimits]]
name = "RL_PLACE"
namespace_id = "2002"
  [env.staging.ratelimits.simple]
  limit = 30
  period = 60

[[env.staging.ratelimits]]
name = "RL_GLOBAL"
namespace_id = "2003"
  [env.staging.ratelimits.simple]
  limit = 300
  period = 60

[[env.staging.ratelimits]]
name = "RL_LOG"
namespace_id = "2004"
  [env.staging.ratelimits.simple]
  limit = 100
  period = 60

[[env.staging.ratelimits]]
name = "RL_CODES"
namespace_id = "2005"
  [env.staging.ratelimits.simple]
  limit = 10
  period = 60

[[env.staging.ratelimits]]
name = "RL_FEEDBACK"
namespace_id = "2006"
  [env.staging.ratelimits.simple]
  limit = 5
  period = 60
```

Staging rate-limit `namespace_id`s are 2001-2006 so they never share counters with production's 1001-1006.

- [ ] **Step 4: Apply migrations and deploy**

```bash
cd server
for db in heap_core heap_scores heap_rewards heap_telemetry; do
  npx wrangler d1 migrations apply "${db}_staging" --remote --env staging
done
npx wrangler secret put ADMIN_SECRET --env staging
npx wrangler secret put LOADTEST_SECRET --env staging
npx wrangler deploy --env staging
```

Record the deployed URL.

- [ ] **Step 5: Verify the deployment**

```bash
curl -s "https://heap-server-staging.<subdomain>.workers.dev/heaps"
```

Expected: `200` with `[]` (no heaps seeded yet), **not** a 500. A 500 here means a binding is missing.

Then confirm the limiter override is live — 40 rapid requests with a per-request key must not 429, while 40 without must:

```bash
for i in $(seq 1 40); do
  curl -s -o /dev/null -w "%{http_code} " \
    -H "X-LoadTest-Secret: <secret>" -H "X-LoadTest-Key: vu-$i" \
    "https://heap-server-staging.<subdomain>.workers.dev/heaps"
done; echo
```

Expected: all `200`.

- [ ] **Step 6: Write the runbook**

Create `docs/superpowers/runbooks/loadtest-staging.md` documenting: the resource IDs from Step 2, the deploy and migrate commands, the secret-setting commands, how to verify with Step 5's curls, how to tail logs (`npx wrangler tail --env staging`), and an explicit warning that free-tier quotas are account-wide and shared with production.

- [ ] **Step 7: Commit**

```bash
git add server/wrangler.toml docs/superpowers/runbooks/loadtest-staging.md
git commit -m "chore(server): add load-test staging environment

Separate Worker, D1 shards, KV namespace and AE dataset so load tests
never touch production data. Rate-limit namespace_ids 2001-2006 keep
counters distinct from production's 1001-1006."
```

---

## Task 6: Seed and reset scripts

**Files:**
- Create: `loadtest/scripts/seed-staging.ts`
- Create: `loadtest/scripts/reset-staging.ts`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**
- Consumes: the staging URL and `ADMIN_SECRET` from Task 5.
- Produces: `loadtest/fixtures.json`, shape:
  `{ "smallHeapId": string, "largeHeapId": string, "identities": Array<{ playerId: string, playerSecret: string }> }`
  Consumed by Task 7's `player.js` and Task 10/11's scenarios.

- [ ] **Step 1: Ignore the generated fixtures**

Add to `.gitignore`:

```
# Load-test fixtures — contains generated player secrets, regenerate with `npm run loadtest:seed`
loadtest/fixtures.json
```

- [ ] **Step 2: Write the seed script**

Create `loadtest/scripts/seed-staging.ts`:

```ts
/**
 * Seeds the load-test staging environment:
 *   - a small heap fixture (fresh, empty live zone)
 *   - a large heap fixture (pre-grown live zone, to test how placement CPU
 *     scales with polygon size against the 10ms free-tier CPU cap)
 *   - a pool of player identities, reused across runs so that most score
 *     submissions are not personal bests (see the design doc's KV budget)
 *
 * Usage:
 *   BASE_URL=https://heap-server-staging.<sub>.workers.dev \
 *   ADMIN_SECRET=... npm run loadtest:seed
 */

/// <reference types="node" />

import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { generateDefaultPolygon } from '../../shared/heapPolygon';
import { MOCK_HEAP_HEIGHT_PX } from '../../src/constants';
import type { CreateHeapResponse } from '../../shared/heapTypes';

const BASE_URL     = process.env.BASE_URL     ?? '';
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? '';
const POOL_SIZE    = Number(process.env.POOL_SIZE ?? 200);
/** Vertices pre-placed on the large fixture. */
const LARGE_SEED_VERTICES = Number(process.env.LARGE_SEED_VERTICES ?? 400);

if (!BASE_URL)     throw new Error('BASE_URL is required');
if (!ADMIN_SECRET) throw new Error('ADMIN_SECRET is required');
if (BASE_URL.includes('heap-server.') && !BASE_URL.includes('staging')) {
  throw new Error('Refusing to seed what looks like production. Set BASE_URL to the staging Worker.');
}

async function createHeap(name: string): Promise<string> {
  const vertices = generateDefaultPolygon(Math.floor(Math.random() * 1_000_000));
  const res = await fetch(`${BASE_URL}/heaps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
    body: JSON.stringify({
      vertices,
      params: {
        name,
        difficulty: 1.0,
        spawnRateMult: 1.0,
        coinMult: 1.0,
        scoreMult: 1.0,
        worldHeight: MOCK_HEAP_HEIGHT_PX,
      },
    }),
  });
  if (!res.ok) throw new Error(`createHeap(${name}) failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as CreateHeapResponse;
  return body.id;
}

async function main(): Promise<void> {
  const smallHeapId = await createHeap('LoadTest Small');
  const largeHeapId = await createHeap('LoadTest Large');
  console.log(`small heap: ${smallHeapId}`);
  console.log(`large heap: ${largeHeapId}`);

  // Grow the large fixture. Placements go through the real endpoint so the
  // polygon is shaped exactly as production data would be.
  const secret = randomUUID();
  const seeder = randomUUID();
  for (let i = 0; i < LARGE_SEED_VERTICES; i++) {
    const res = await fetch(`${BASE_URL}/heaps/${largeHeapId}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Player-Token': secret },
      body: JSON.stringify({
        x: Math.floor(Math.random() * 800) - 400,
        y: 0,
        playerGuid: seeder,
      }),
    });
    if (!res.ok) throw new Error(`seed placement ${i} failed: ${res.status} ${await res.text()}`);
  }
  console.log(`grew large heap by ${LARGE_SEED_VERTICES} placements`);

  const identities = Array.from({ length: POOL_SIZE }, () => ({
    playerId:     randomUUID(),
    playerSecret: randomUUID(),
  }));

  writeFileSync(
    new URL('../fixtures.json', import.meta.url),
    JSON.stringify({ smallHeapId, largeHeapId, identities }, null, 2),
  );
  console.log(`wrote loadtest/fixtures.json with ${identities.length} identities`);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

The `y: 0` placements will be clamped/validated by the endpoint's live-zone rules. **Before running, read `server/src/routes/heap.ts:403-500` and the `PLACE_X_MIN` / `PLACE_X_MAX` / `PLACE_HEIGHT_GRACE_PX` constants in `server/src/constants.ts`**, and pick `x`/`y` values that fall inside the valid window for a freshly created heap. If a placement 400s, fix the coordinates rather than removing the error check.

- [ ] **Step 3: Write the reset script**

Create `loadtest/scripts/reset-staging.ts`:

```ts
/**
 * Resets the load-test heap fixtures to an empty live zone so runs are
 * repeatable. Identities in fixtures.json are deliberately preserved —
 * reusing them across runs is what keeps score-submit KV cost low.
 *
 * Usage:
 *   BASE_URL=... ADMIN_SECRET=... npm run loadtest:reset
 */

/// <reference types="node" />

import { readFileSync } from 'node:fs';

const BASE_URL     = process.env.BASE_URL     ?? '';
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? '';

if (!BASE_URL)     throw new Error('BASE_URL is required');
if (!ADMIN_SECRET) throw new Error('ADMIN_SECRET is required');

interface Fixtures { smallHeapId: string; largeHeapId: string }

async function main(): Promise<void> {
  const raw = readFileSync(new URL('../fixtures.json', import.meta.url), 'utf8');
  const { smallHeapId, largeHeapId } = JSON.parse(raw) as Fixtures;

  for (const id of [smallHeapId, largeHeapId]) {
    const res = await fetch(`${BASE_URL}/heaps/${id}/reset`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
    });
    if (!res.ok) throw new Error(`reset ${id} failed: ${res.status} ${await res.text()}`);
    console.log(`reset ${id}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
```

Read `server/src/routes/heap.ts:312-350` to confirm `PUT /heaps/:id/reset` needs no request body; add one if it does.

- [ ] **Step 4: Add npm scripts**

In the root `package.json` `scripts` block:

```json
    "loadtest:seed": "tsx loadtest/scripts/seed-staging.ts",
    "loadtest:reset": "tsx loadtest/scripts/reset-staging.ts",
```

- [ ] **Step 5: Run the seed script**

Run: `BASE_URL=<staging url> ADMIN_SECRET=<secret> npm run loadtest:seed`
Expected: prints two heap IDs, the growth confirmation, and writes `loadtest/fixtures.json`. Verify with `curl -s <staging url>/heaps` that both heaps are listed.

Note this spends roughly `LARGE_SEED_VERTICES` placements (~400) against the daily budget — a one-off cost, not per-run.

- [ ] **Step 6: Commit**

```bash
git add loadtest/scripts/ .gitignore package.json
git commit -m "feat(loadtest): staging seed and reset scripts

Creates small and large heap fixtures plus a reusable identity pool.
The large fixture exists to measure how placement CPU scales with polygon
size against the 10ms free-tier cap."
```

---

## Task 7: Load-test lib — config and identity selection

Pure modules with no k6 imports, so vitest can test them.

**Files:**
- Create: `loadtest/k6/lib/config.js`
- Create: `loadtest/k6/lib/player.js`
- Test: `loadtest/__tests__/player.test.ts`

**Interfaces:**
- Consumes: `loadtest/fixtures.json` from Task 6.
- Produces:
  - `config.js`: `BASE_URL`, `LOADTEST_SECRET`, `NEW_IDENTITY_RATE` (number), `loadTestHeaders(vuKey: string) => Record<string,string>`
  - `player.js`: `pickIdentity(pool, vuId, iteration, rand) => { playerId, playerSecret, isNew }`

- [ ] **Step 1: Write the failing test**

Create `loadtest/__tests__/player.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain JS module shared with the k6 runtime, no types
import { pickIdentity } from '../k6/lib/player.js';

const POOL = [
  { playerId: 'a', playerSecret: 'sa' },
  { playerId: 'b', playerSecret: 'sb' },
  { playerId: 'c', playerSecret: 'sc' },
];

describe('pickIdentity', () => {
  it('draws from the pool when the roll is above the new-identity rate', () => {
    const id = pickIdentity(POOL, 0, 0, () => 0.99);
    expect(POOL.some((p) => p.playerId === id.playerId)).toBe(true);
    expect(id.isNew).toBe(false);
  });

  it('mints a fresh identity when the roll is below the new-identity rate', () => {
    const id = pickIdentity(POOL, 0, 0, () => 0.0);
    expect(POOL.some((p) => p.playerId === id.playerId)).toBe(false);
    expect(id.isNew).toBe(true);
    expect(id.playerSecret).toBeTruthy();
    expect(id.playerId).not.toBe(id.playerSecret);
  });

  it('spreads different VUs across different pool members', () => {
    const a = pickIdentity(POOL, 0, 0, () => 0.99);
    const b = pickIdentity(POOL, 1, 0, () => 0.99);
    expect(a.playerId).not.toBe(b.playerId);
  });

  it('is deterministic for the same vuId and iteration', () => {
    const a = pickIdentity(POOL, 2, 5, () => 0.99);
    const b = pickIdentity(POOL, 2, 5, () => 0.99);
    expect(a.playerId).toBe(b.playerId);
  });

  it('never indexes past the end of the pool', () => {
    for (let vu = 0; vu < 50; vu++) {
      const id = pickIdentity(POOL, vu, vu * 7, () => 0.99);
      expect(id.playerId).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run loadtest/__tests__/player.test.ts`
Expected: FAIL — cannot resolve `../k6/lib/player.js`.

- [ ] **Step 3: Write config.js**

Create `loadtest/k6/lib/config.js`:

```js
// Shared config for the k6 scenarios. Values come from the k6 CLI environment
// (`k6 run -e BASE_URL=... `), exposed as the __ENV global inside k6.

/* global __ENV */

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:8787';
export const LOADTEST_SECRET = __ENV.LOADTEST_SECRET || '';

/** Fraction of sessions that mint a brand-new identity, exercising the TOFU
 *  claim-on-first-write path. The rest reuse the seeded pool, which keeps
 *  score-submit KV invalidations low. */
export const NEW_IDENTITY_RATE = Number(__ENV.NEW_IDENTITY_RATE || 0.05);

/**
 * Headers that make the Worker's rate limiter treat this VU as its own client,
 * modelling players arriving from distinct IPs. Honoured only when the staging
 * Worker has LOADTEST_SECRET set; inert everywhere else.
 */
export function loadTestHeaders(vuKey) {
  if (!LOADTEST_SECRET) return {};
  return {
    'X-LoadTest-Secret': LOADTEST_SECRET,
    'X-LoadTest-Key': vuKey,
  };
}
```

- [ ] **Step 4: Write player.js**

Create `loadtest/k6/lib/player.js`:

```js
// Per-VU player identity selection. Pure — no k6 imports — so vitest can
// exercise it directly. `rand` is injected for determinism in tests.

import { NEW_IDENTITY_RATE } from './config.js';

function uuid(rand) {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (rand() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Choose the identity a session runs as.
 *
 * Most sessions reuse a seeded identity: real traffic is mostly returning
 * players whose stored best already exists, so their submissions rarely move
 * the leaderboard and rarely invalidate the score cache. A small fraction mint
 * a fresh identity to keep the TOFU claim path covered.
 *
 * @param {Array<{playerId: string, playerSecret: string}>} pool
 * @param {number} vuId       k6's __VU
 * @param {number} iteration  k6's __ITER
 * @param {() => number} rand injectable RNG, defaults to Math.random
 * @returns {{playerId: string, playerSecret: string, isNew: boolean}}
 */
export function pickIdentity(pool, vuId, iteration, rand = Math.random) {
  if (rand() < NEW_IDENTITY_RATE || pool.length === 0) {
    return { playerId: uuid(rand), playerSecret: uuid(rand), isNew: true };
  }
  const idx = (vuId * 31 + iteration) % pool.length;
  const picked = pool[idx];
  return { playerId: picked.playerId, playerSecret: picked.playerSecret, isNew: false };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run loadtest/__tests__/player.test.ts`
Expected: all 5 PASS.

If the "spreads different VUs" test fails because `NEW_IDENTITY_RATE` read `__ENV` at import time under vitest (where `__ENV` is undefined), guard it in `config.js` as
`const ENV = typeof __ENV !== 'undefined' ? __ENV : {};` and read from `ENV`. Apply the same guard to `BASE_URL` and `LOADTEST_SECRET`.

- [ ] **Step 6: Commit**

```bash
git add loadtest/k6/lib/config.js loadtest/k6/lib/player.js loadtest/__tests__/player.test.ts
git commit -m "feat(loadtest): config and per-VU identity selection"
```

---

## Task 8: Request payloads and the drift-guard contract test

k6 runs its own JS runtime and cannot import the project's TypeScript, so payload shapes would normally be free to drift from `shared/`. This task pins them.

**Files:**
- Create: `loadtest/k6/lib/payloads.js`
- Test: `loadtest/__tests__/payload-contract.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `buildPlaceBody({ x, y, playerGuid })`, `buildScoreBody({ heapId, playerId, playerName, elapsedMs, kills, baseHeightPx, isFailure })`, `buildLogBody({ level, event, data })`. Used by Tasks 9-10.

- [ ] **Step 1: Write the failing contract test**

Create `loadtest/__tests__/payload-contract.test.ts`:

```ts
import { describe, it, expect, expectTypeOf } from 'vitest';
import type { PlaceRequest } from '../../shared/heapTypes';
import type { SubmitScoreRequest } from '../../shared/scoreTypes';
// @ts-expect-error — plain JS module shared with the k6 runtime, no types
import { buildPlaceBody, buildScoreBody, buildLogBody } from '../k6/lib/payloads.js';

describe('k6 payloads satisfy the shared request types', () => {
  it('buildPlaceBody produces a valid PlaceRequest', () => {
    const body: PlaceRequest = buildPlaceBody({ x: 10, y: 500, playerGuid: 'p1' });
    expectTypeOf(body).toMatchTypeOf<PlaceRequest>();
    expect(body.x).toBe(10);
    expect(body.y).toBe(500);
    expect(body.playerGuid).toBe('p1');
  });

  it('buildScoreBody produces a valid SubmitScoreRequest', () => {
    const body: SubmitScoreRequest = buildScoreBody({
      heapId: 'h1',
      playerId: 'p1',
      playerName: 'Tester',
      elapsedMs: 30_000,
      kills: { percher: 1, ghost: 0 },
      baseHeightPx: 1200,
      isFailure: false,
    });
    expectTypeOf(body).toMatchTypeOf<SubmitScoreRequest>();
    expect(body.inputs.baseHeightPx).toBe(1200);
    expect(body.inputs.kills.percher).toBe(1);
  });

  it('buildScoreBody emits integers where the server demands them', () => {
    // routes/scores.ts rejects non-integer baseHeightPx / kills outright.
    const body = buildScoreBody({
      heapId: 'h1', playerId: 'p1', playerName: 'T',
      elapsedMs: 1234.7, kills: { percher: 1.4, ghost: 2.9 },
      baseHeightPx: 900.6, isFailure: false,
    });
    expect(Number.isInteger(body.inputs.baseHeightPx)).toBe(true);
    expect(Number.isInteger(body.inputs.kills.percher)).toBe(true);
    expect(Number.isInteger(body.inputs.kills.ghost)).toBe(true);
    expect(body.inputs.elapsedMs).toBeGreaterThanOrEqual(1);
  });

  it('buildLogBody produces a batch envelope', () => {
    const body = buildLogBody({ level: 'info', event: 'loadtest:tick', data: { n: 1 } });
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.entries[0].event).toBe('loadtest:tick');
  });
});
```

Before writing the implementation, **read `server/src/routes/log.ts:43` to confirm the `/log` request envelope** and adjust the fourth test to match the real shape.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run loadtest/__tests__/payload-contract.test.ts`
Expected: FAIL — cannot resolve `../k6/lib/payloads.js`.

- [ ] **Step 3: Write payloads.js**

Create `loadtest/k6/lib/payloads.js`. Shapes are pinned by `loadtest/__tests__/payload-contract.test.ts` — if `shared/` changes, that test fails rather than the load test silently measuring 400s:

```js
// Request bodies for the k6 scenarios.
//
// k6 has its own JS runtime and cannot import the project's TypeScript, so
// these are plain JS. loadtest/__tests__/payload-contract.test.ts imports this
// same module and type-checks the output against shared/heapTypes and
// shared/scoreTypes, so a breaking change to either fails `npm test`.

/** @returns {import('../../../shared/heapTypes').PlaceRequest} */
export function buildPlaceBody({ x, y, playerGuid }) {
  return { x, y, playerGuid };
}

/** @returns {import('../../../shared/scoreTypes').SubmitScoreRequest} */
export function buildScoreBody({
  heapId, playerId, playerName,
  elapsedMs, kills, baseHeightPx, isFailure,
}) {
  // The server rejects non-integer baseHeightPx and kill counts outright
  // (routes/scores.ts), and requires elapsedMs >= 1.
  return {
    heapId,
    playerId,
    playerName,
    inputs: {
      baseHeightPx: Math.floor(baseHeightPx),
      kills: {
        percher: Math.floor(kills.percher),
        ghost:   Math.floor(kills.ghost),
      },
      elapsedMs: Math.max(1, Math.floor(elapsedMs)),
      isFailure,
    },
  };
}

export function buildLogBody({ level, event, data }) {
  return {
    entries: [{ level, event, data, ts: new Date().toISOString() }],
  };
}
```

If Step 1's reading of `server/src/routes/log.ts` showed a different envelope, or if `SubmitScoreInputs` in `shared/scoreTypes.ts` has required fields beyond those above (check `salvageItems`), extend `buildScoreBody` to match — the contract test is the authority.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run loadtest/__tests__/payload-contract.test.ts`
Expected: all 4 PASS.

- [ ] **Step 5: Run the whole suite and build**

Run: `npm test && npm run build`
Expected: both green.

- [ ] **Step 6: Commit**

```bash
git add loadtest/k6/lib/payloads.js loadtest/__tests__/payload-contract.test.ts
git commit -m "feat(loadtest): k6 payload builders pinned to shared types

k6 cannot import the project's TS, so a vitest contract test imports the
same JS fixtures and type-checks them against PlaceRequest and
SubmitScoreRequest. Drift now fails npm test instead of producing a load
test that only measures 400s."
```

---

## Task 9: Budget counters

Enforces the per-run caps as a safety net beneath k6's iteration-count bounding.

**Files:**
- Create: `loadtest/k6/lib/budget.js`
- Test: `loadtest/__tests__/budget.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `createBudget({ maxRequests, maxPlacements }) => { recordRequest(), recordPlacement(), canPlace(), exceeded(), snapshot() }`. Used by Tasks 10-11.

- [ ] **Step 1: Write the failing test**

Create `loadtest/__tests__/budget.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain JS module shared with the k6 runtime, no types
import { createBudget } from '../k6/lib/budget.js';

describe('createBudget', () => {
  it('starts unexceeded and allows placements', () => {
    const b = createBudget({ maxRequests: 10, maxPlacements: 2 });
    expect(b.exceeded()).toBe(false);
    expect(b.canPlace()).toBe(true);
  });

  it('reports exceeded once the request cap is reached', () => {
    const b = createBudget({ maxRequests: 3, maxPlacements: 10 });
    b.recordRequest(); b.recordRequest();
    expect(b.exceeded()).toBe(false);
    b.recordRequest();
    expect(b.exceeded()).toBe(true);
  });

  it('stops allowing placements at the placement cap', () => {
    const b = createBudget({ maxRequests: 100, maxPlacements: 2 });
    b.recordPlacement();
    expect(b.canPlace()).toBe(true);
    b.recordPlacement();
    expect(b.canPlace()).toBe(false);
  });

  it('placements do not consume the request budget twice', () => {
    const b = createBudget({ maxRequests: 100, maxPlacements: 10 });
    b.recordPlacement();
    expect(b.snapshot().placements).toBe(1);
    expect(b.snapshot().requests).toBe(0);
  });

  it('snapshot reports both counters', () => {
    const b = createBudget({ maxRequests: 100, maxPlacements: 10 });
    b.recordRequest(); b.recordRequest(); b.recordPlacement();
    expect(b.snapshot()).toEqual({ requests: 2, placements: 1, maxRequests: 100, maxPlacements: 10 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run loadtest/__tests__/budget.test.ts`
Expected: FAIL — cannot resolve `../k6/lib/budget.js`.

- [ ] **Step 3: Write budget.js**

Create `loadtest/k6/lib/budget.js`:

```js
// Per-run budget counters.
//
// k6's shared-iterations executor already bounds total volume before the run
// starts; this is the safety net that stops a misconfigured run from spending
// production's account-wide daily quota. Placements are tracked separately
// because KV deletes (1,000/day) are the tightest resource, not requests.

export function createBudget({ maxRequests, maxPlacements }) {
  let requests = 0;
  let placements = 0;

  return {
    recordRequest() { requests += 1; },
    recordPlacement() { placements += 1; },
    /** Placements are the scarce resource — gate them separately. */
    canPlace() { return placements < maxPlacements; },
    exceeded() { return requests >= maxRequests; },
    snapshot() { return { requests, placements, maxRequests, maxPlacements }; },
  };
}
```

Note: k6 VUs do not share module state across VU instances, so this counter is per-VU. Task 11 divides the caps by the VU count when constructing it, and the authoritative global bound remains the executor's `iterations` setting.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run loadtest/__tests__/budget.test.ts`
Expected: all 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add loadtest/k6/lib/budget.js loadtest/__tests__/budget.test.ts
git commit -m "feat(loadtest): per-run request and placement budget counters"
```

---

## Task 10: Player journey scenario

**Files:**
- Create: `loadtest/k6/scenarios/journey.js`

**Interfaces:**
- Consumes: `config.js`, `player.js`, `payloads.js`, `budget.js` from Tasks 7-9; `loadtest/fixtures.json` from Task 6.
- Produces: `export function journey(fixtures, budget)` — the default per-iteration function wired up by Task 12's `main.js`. Also exports the custom metrics `placeConflicts` and `rateLimited`.

- [ ] **Step 1: Write the scenario**

Create `loadtest/k6/scenarios/journey.js`:

```js
// The realistic player session: boot, load a heap, read the leaderboard, play a
// run, submit a score. Endpoint mix and ordering mirror what the game client
// actually does. ~10 requests per iteration.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import { BASE_URL, loadTestHeaders } from '../lib/config.js';
import { pickIdentity } from '../lib/player.js';
import { buildPlaceBody, buildScoreBody, buildLogBody } from '../lib/payloads.js';

/* global __VU, __ITER */

export const placeConflicts = new Counter('place_conflicts');
export const placeAccepted   = new Counter('place_accepted');
export const rateLimited     = new Rate('rate_limited');

/** Probability a session places a block. Real players place rarely. */
const PLACE_RATE = Number(__ENV.PLACE_RATE || 0.15);

function jsonHeaders(extra) {
  return Object.assign({ 'Content-Type': 'application/json' }, extra || {});
}

function track(res) {
  rateLimited.add(res.status === 429);
  return res;
}

export function journey(fixtures, budget) {
  const vuKey = `vu-${__VU}`;
  const lt = loadTestHeaders(vuKey);
  const id = pickIdentity(fixtures.identities, __VU, __ITER);
  const heapId = fixtures.smallHeapId;

  // ---- boot ----
  const boot = http.batch([
    ['GET', `${BASE_URL}/config`, null, { headers: lt, tags: { name: 'config' } }],
    ['GET', `${BASE_URL}/heaps`, null, { headers: lt, tags: { name: 'heaps-list' } }],
    ['GET', `${BASE_URL}/daily/status?playerId=${id.playerId}`, null, { headers: lt, tags: { name: 'daily-status' } }],
    ['GET', `${BASE_URL}/customization/${id.playerId}`, null, { headers: lt, tags: { name: 'customization-get' } }],
  ]);
  boot.forEach((r) => { track(r); budget.recordRequest(); });
  check(boot[1], { 'heaps list ok': (r) => r.status === 200 });

  // ---- heap load ----
  const heapRes = track(http.get(`${BASE_URL}/heaps/${heapId}`, { headers: lt, tags: { name: 'heap-get' } }));
  budget.recordRequest();
  check(heapRes, { 'heap get ok': (r) => r.status === 200 });

  // The client caches base vertices in localStorage keyed by baseId, so it
  // fetches them once per VU rather than once per session.
  if (__ITER === 0) {
    track(http.get(`${BASE_URL}/heaps/${heapId}/base`, { headers: lt, tags: { name: 'heap-base' } }));
    budget.recordRequest();
  }

  // ---- leaderboard ----
  track(http.get(`${BASE_URL}/scores/${heapId}/context?playerId=${id.playerId}`, {
    headers: lt, tags: { name: 'scores-context' },
  }));
  budget.recordRequest();

  sleep(Math.random() * 2); // think time: the player is climbing

  // ---- placement (rare) ----
  if (Math.random() < PLACE_RATE && budget.canPlace()) {
    const authed = jsonHeaders(Object.assign({ 'X-Player-Token': id.playerSecret }, lt));
    const body = buildPlaceBody({ x: Math.floor(Math.random() * 400) - 200, y: 0, playerGuid: id.playerId });
    const res = track(http.post(`${BASE_URL}/heaps/${heapId}/place`, JSON.stringify(body), {
      headers: authed, tags: { name: 'place' },
    }));
    budget.recordPlacement();
    if (res.status === 409) placeConflicts.add(1);
    if (res.status === 200) placeAccepted.add(1);
    check(res, { 'place not 5xx': (r) => r.status < 500 });
  }

  // ---- end of run ----
  const authed = jsonHeaders(Object.assign({ 'X-Player-Token': id.playerSecret }, lt));
  const scoreBody = buildScoreBody({
    heapId,
    playerId: id.playerId,
    playerName: `LoadTest ${__VU}`,
    elapsedMs: 20_000 + Math.floor(Math.random() * 40_000),
    kills: { percher: Math.floor(Math.random() * 3), ghost: Math.floor(Math.random() * 2) },
    baseHeightPx: Math.floor(Math.random() * 4000),
    isFailure: Math.random() < 0.7,
  });
  const scoreRes = track(http.post(`${BASE_URL}/scores`, JSON.stringify(scoreBody), {
    headers: authed, tags: { name: 'score-submit' },
  }));
  budget.recordRequest();
  check(scoreRes, { 'score not 5xx': (r) => r.status < 500 });

  track(http.post(`${BASE_URL}/log`, JSON.stringify(buildLogBody({
    level: 'info', event: 'loadtest:session', data: { vu: __VU, iter: __ITER },
  })), { headers: jsonHeaders(lt), tags: { name: 'log' } }));
  budget.recordRequest();

  // ---- occasional writes ----
  if (Math.random() < 0.1) {
    track(http.put(`${BASE_URL}/customization/${id.playerId}`, JSON.stringify({ loadout: {} }), {
      headers: authed, tags: { name: 'customization-put' },
    }));
    budget.recordRequest();
  }
  if (Math.random() < 0.1) {
    track(http.post(`${BASE_URL}/daily/claim`, JSON.stringify({ playerId: id.playerId }), {
      headers: authed, tags: { name: 'daily-claim' },
    }));
    budget.recordRequest();
  }
}
```

**Before the first staging run**, verify each request shape against its route handler and fix any mismatch here:
- `GET /daily/status` query params — `server/src/routes/daily.ts:40`
- `POST /daily/claim` body — `server/src/routes/daily.ts:52`
- `PUT /customization/:playerId` body — `server/src/routes/customization.ts:18`
- `GET /scores/:heapId/context` query params — `server/src/routes/scores.ts:331`
- `POST /heaps/:id/place` valid `x`/`y` window — `server/src/routes/heap.ts:403` and `server/src/constants.ts`

- [ ] **Step 2: Commit**

```bash
git add loadtest/k6/scenarios/journey.js
git commit -m "feat(loadtest): realistic player journey scenario"
```

Verification for this scenario happens in Task 12 against a local `wrangler dev`, which costs no quota.

---

## Task 11: Placement contention and limiter scenarios

**Files:**
- Create: `loadtest/k6/scenarios/placement.js`
- Create: `loadtest/k6/scenarios/limiter.js`

**Interfaces:**
- Consumes: `config.js`, `player.js`, `payloads.js` from Tasks 7-8.
- Produces: `export function placement(fixtures, budget)` and `export function limiter(fixtures)`, wired up by Task 12.

- [ ] **Step 1: Write the placement contention scenario**

Create `loadtest/k6/scenarios/placement.js`:

```js
// Bounded placement contention: a realistic handful of concurrent placers on
// ONE heap, to drive the CAS retry loop in routes/heap.ts and measure how often
// it exhausts its 5 attempts and returns 409.
//
// Deliberately small. Real players do not all place simultaneously, and each
// successful placement costs KV deletes from a 1,000/day account-wide bucket.

import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE_URL, loadTestHeaders } from '../lib/config.js';
import { pickIdentity } from '../lib/player.js';
import { buildPlaceBody } from '../lib/payloads.js';

/* global __VU, __ITER, __ENV */

export const casConflicts = new Counter('cas_conflicts');
export const casAccepted  = new Counter('cas_accepted');

/** Which fixture to hammer: 'small' (default) or 'large' to measure how
 *  placement cost scales with polygon size against the 10ms CPU cap. */
const FIXTURE = __ENV.PLACE_FIXTURE || 'small';

export function placement(fixtures, budget) {
  if (!budget.canPlace()) return;

  const id = pickIdentity(fixtures.identities, __VU, __ITER);
  const heapId = FIXTURE === 'large' ? fixtures.largeHeapId : fixtures.smallHeapId;
  const headers = Object.assign(
    { 'Content-Type': 'application/json', 'X-Player-Token': id.playerSecret },
    loadTestHeaders(`vu-${__VU}`),
  );

  const body = buildPlaceBody({
    x: Math.floor(Math.random() * 400) - 200,
    y: 0,
    playerGuid: id.playerId,
  });

  const res = http.post(`${BASE_URL}/heaps/${heapId}/place`, JSON.stringify(body), {
    headers, tags: { name: 'place-contention' },
  });
  budget.recordPlacement();

  if (res.status === 409) casConflicts.add(1);
  if (res.status === 200) casAccepted.add(1);
  check(res, {
    'placement not 5xx': (r) => r.status < 500,
    'placement resolved': (r) => r.status === 200 || r.status === 409 || r.status === 400,
  });
}
```

Use the same valid `x`/`y` window established in Task 10.

- [ ] **Step 2: Write the limiter sanity scenario**

Create `loadtest/k6/scenarios/limiter.js`:

```js
// Confirms the rate limiter still protects production behaviour: requests sent
// WITHOUT the load-test headers all share one IP bucket and must start
// returning 429 once RL_GLOBAL (300/min) is exhausted.
//
// Cheap by design — a few dozen requests, not a load profile.

import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE_URL } from '../lib/config.js';

export const limiterBlocks = new Counter('limiter_blocks');

export function limiter(fixtures) {
  // No loadTestHeaders() here — that is the entire point of this scenario.
  const res = http.get(`${BASE_URL}/heaps/${fixtures.smallHeapId}`, {
    tags: { name: 'limiter-probe' },
  });
  if (res.status === 429) limiterBlocks.add(1);
  check(res, { 'limiter probe answered': (r) => r.status === 200 || r.status === 429 });
}
```

- [ ] **Step 3: Commit**

```bash
git add loadtest/k6/scenarios/placement.js loadtest/k6/scenarios/limiter.js
git commit -m "feat(loadtest): placement contention and limiter sanity scenarios"
```

---

## Task 12: Wire it together, validate locally, document

**Files:**
- Create: `loadtest/k6/main.js`
- Create: `loadtest/README.md`
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `vite.config.ts`

**Interfaces:**
- Consumes: every module from Tasks 6-11.
- Produces: `npm run loadtest` (staging) and `npm run loadtest:local` (local dry run).

- [ ] **Step 1: Write main.js**

Create `loadtest/k6/main.js`:

```js
// k6 entrypoint. Scenario volumes use the shared-iterations executor so that
// total request count is known BEFORE the run starts, rather than being
// discovered when a runtime guard trips. Free-tier quotas are account-wide and
// shared with production — see loadtest/README.md.

import { SharedArray } from 'k6/data';
import { createBudget } from './lib/budget.js';
import { journey } from './scenarios/journey.js';
import { placement } from './scenarios/placement.js';
import { limiter } from './scenarios/limiter.js';

/* global __ENV */

const SESSIONS = Number(__ENV.SESSIONS || 800);
const MAX_PLACEMENTS = Number(__ENV.MAX_PLACEMENTS || 150);

const fixtures = new SharedArray('fixtures', () => [JSON.parse(open('../fixtures.json'))]);

export const options = {
  scenarios: {
    journey: {
      executor: 'shared-iterations',
      vus: 50,
      iterations: SESSIONS,
      maxDuration: '10m',
      exec: 'journeyScenario',
    },
    placement: {
      executor: 'shared-iterations',
      vus: 15,
      iterations: 30,
      maxDuration: '5m',
      startTime: '30s',
      exec: 'placementScenario',
    },
    limiter: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 20,
      maxDuration: '2m',
      startTime: '10s',
      exec: 'limiterScenario',
    },
  },
  thresholds: {
    // 409 (CAS conflict) and 429 (rate limited) are expected outcomes, not failures.
    'http_req_failed{expected_response:true}': ['rate<0.01'],
    'http_req_duration{name:heaps-list}':      ['p(95)<500', 'p(99)<1500'],
    'http_req_duration{name:heap-get}':        ['p(95)<500', 'p(99)<1500'],
    'http_req_duration{name:scores-context}':  ['p(95)<500', 'p(99)<1500'],
    'http_req_duration{name:place}':           ['p(95)<1000'],
    'http_req_duration{name:place-contention}':['p(95)<1000'],
  },
};

// Per-VU budget: k6 VUs do not share module state, so divide the global caps by
// the scenario's VU count. The authoritative global bound is `iterations` above.
const journeyBudget   = createBudget({ maxRequests: 10_000 / 50, maxPlacements: MAX_PLACEMENTS / 50 });
const placementBudget = createBudget({ maxRequests: 10_000 / 15, maxPlacements: MAX_PLACEMENTS / 15 });

export function journeyScenario()   { journey(fixtures[0], journeyBudget); }
export function placementScenario() { placement(fixtures[0], placementBudget); }
export function limiterScenario()   { limiter(fixtures[0]); }
```

- [ ] **Step 2: Exclude loadtest from the build**

In `tsconfig.json`, add an `exclude` array (the `include` is already `["src"]`, so this is belt-and-braces for editors and any future widening):

```json
  "exclude": ["loadtest/k6"],
```

In `vite.config.ts`, confirm nothing globs `loadtest/`. If the config has no explicit input globs, no change is needed — note that in the commit message rather than editing speculatively.

- [ ] **Step 3: Add npm scripts**

In the root `package.json` `scripts` block:

```json
    "loadtest": "k6 run loadtest/k6/main.js",
    "loadtest:local": "k6 run -e SESSIONS=20 -e MAX_PLACEMENTS=5 loadtest/k6/main.js",
```

- [ ] **Step 4: Validate locally — costs zero quota**

Start a local Worker in one terminal:

```bash
cd server && npx wrangler dev
```

Seed local fixtures against it, then dry-run:

```bash
BASE_URL=http://localhost:8787 ADMIN_SECRET=dev npm run loadtest:seed
BASE_URL=http://localhost:8787 npm run loadtest:local
```

Expected: k6 completes 20 journey iterations, 30 placements and 20 limiter probes with **zero 4xx other than expected 409/429, and zero 5xx**. Read k6's per-endpoint summary and confirm every tagged request name appears.

Any 400 means a payload shape is wrong — fix it in `payloads.js` or the scenario, and extend `loadtest/__tests__/payload-contract.test.ts` to cover the case so it cannot regress. Re-run until clean.

This step is the real verification gate for Tasks 10 and 11. Do not proceed to a staging run until it is green.

- [ ] **Step 5: Run the full test suite and build**

Run: `npm test && npm run build && cd server && npx vitest run`
Expected: all green.

- [ ] **Step 6: Write the README**

Create `loadtest/README.md` covering:
- **Quota warning first**, in bold: free-tier limits are account-wide and shared with production. Reproduce the limits table from the spec.
- Prerequisites: k6 installed, staging deployed (link the Task 5 runbook), `npm run loadtest:seed` run once.
- The local dry-run loop from Step 4 as the default way to iterate.
- How to run against staging: `BASE_URL=... LOADTEST_SECRET=... npm run loadtest`.
- Per-run budget: ≤800 sessions, ≤10,000 requests, ≤150 placements, ≈329 KV deletes; ~2 runs/day.
- Tunable env vars: `SESSIONS`, `MAX_PLACEMENTS`, `PLACE_RATE`, `NEW_IDENTITY_RATE`, `PLACE_FIXTURE=large`.
- Reset between runs: `npm run loadtest:reset`.
- Watching the server: `cd server && npx wrangler tail --env staging`.
- How to read the results: the thresholds, and what `place_conflicts` / `cas_conflicts` / `limiter_blocks` mean.
- **The leading hypothesis to test**: placement CPU scales with polygon size against the 10 ms free-tier cap. Compare `PLACE_FIXTURE=small` against `PLACE_FIXTURE=large`.
- An explicit note that this is not wired into CI, and why.

- [ ] **Step 7: Commit**

```bash
git add loadtest/k6/main.js loadtest/README.md package.json tsconfig.json
git commit -m "feat(loadtest): k6 entrypoint, thresholds and docs

shared-iterations executors bound total request volume before the run
starts. Validated end-to-end against a local wrangler dev, which costs no
account quota."
```

- [ ] **Step 8: Open the PR**

```bash
git push -u origin feature/load-testing
gh pr create --title "Load testing harness + cache fixes" --body "$(cat <<'EOF'
## Summary

Adds a k6 load-testing harness targeting a dedicated staging Worker, plus four
server changes it depends on — three of which are production fixes worth
shipping regardless.

Spec: `docs/superpowers/specs/2026-07-24-load-testing-design.md`
Plan: `docs/superpowers/plans/2026-07-24-load-testing.md`

## Server changes

- **Fail-open cache** (highest priority). `server/src/cache/` had no error
  handling, so a KV failure threw past the D1 fallback on the next line and
  surfaced as a 500 — a full outage on read-quota exhaustion, and durably
  persisted placements reported as failures on delete-quota exhaustion.
- **`top_y` folded into the CAS write.** Placements paid two D1 writes and four
  KV deletes; the second invalidation removed keys the first had just deleted.
- **Selective score-cache invalidation.** `pruneScores` invalidation was dead
  (prune retains the top 1000, the cache holds 50), and `upsertScore` busted on
  any personal best rather than on an actual leaderboard change.
- **Staging-only synthetic rate-limit key.** Inert in production, where
  `LOADTEST_SECRET` is unset.

Net effect: a load-test run drops from ~1,320 KV deletes to ~329, and the free
tier's ~250 placements/day production ceiling roughly doubles.

## Load-test harness

`loadtest/` — k6 scenarios for a realistic player journey, bounded placement
contention, and a limiter sanity check. Payloads are pinned to `shared/` types
by a vitest contract test. Not wired into CI: quotas are account-wide and shared
with production.

## Test plan

- [ ] `npm test` green
- [ ] `cd server && npx vitest run` green
- [ ] `npm run build` clean
- [ ] `npm run loadtest:local` against `wrangler dev` — no unexpected 4xx/5xx
- [ ] First staging run completed and results recorded

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Fix 1 — fold `top_y` into CAS | Task 2 |
| Fix 2a — drop `pruneScores` invalidation | Task 3 |
| Fix 2b — top-50 cutoff check | Task 3 |
| Fix 3 — synthetic rate-limit key | Task 4 |
| Fix 4 — fail-open cache | Task 1 |
| Retire the old `heap` D1 DB | Manual prerequisite, gated by Task 5 Step 1 |
| Staging environment | Task 5 |
| Heap fixtures (small + large) | Task 6 |
| Identity pool + 5% new | Tasks 6, 7 |
| Player journey scenario | Task 10 |
| Placement contention scenario | Task 11 |
| Limiter sanity check | Task 11 |
| Budget control | Tasks 9, 12 |
| Thresholds and observability | Task 12 |
| Layout, payload drift guard, build isolation | Tasks 8, 12 |
| `npm run loadtest`, not in CI | Task 12 |

**Known deviations from the spec, recorded deliberately:**

- The spec's layout lists `seed-staging.ts` producing `identities.json`; this plan writes a single `loadtest/fixtures.json` holding both heap IDs and identities, so scenarios read one file.
- Task 12 uses per-VU budget counters divided by VU count, because k6 VUs do not share module state. The authoritative global bound is the executor's `iterations`, exactly as the spec intends.

**Open verification points carried into execution** — each is an explicit step, not a placeholder:

- Exact request shapes for `/daily/status`, `/daily/claim`, `/customization/:id`, `/scores/:id/context`, `/log` (Task 10 Step 1, Task 8 Step 1)
- Valid `x`/`y` placement window (Task 6 Step 2, Task 10 Step 1)
- `SubmitScoreInputs` optional fields, e.g. `salvageItems` (Task 8 Step 3)
- Whether `__ENV` needs a vitest guard (Task 7 Step 5)
- KV failure mode at real quota exhaustion (spec; confirm during the first staging run)

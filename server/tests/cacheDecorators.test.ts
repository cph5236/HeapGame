// server/tests/cacheDecorators.test.ts
//
// Unit tests for the KV cache decorators (CachedHeapDB / CachedScoreDB):
// cache-aside reads, write-through invalidation, the placement fresh-read
// bypass, and the score top-N slice/bypass boundary. Inner repos are the
// in-memory mocks; KV is MockKV.

import { describe, it, expect } from 'vitest';
import { CachedHeapDB } from '../src/cache/CachedHeapDB';
import { CachedScoreDB } from '../src/cache/CachedScoreDB';
import { CachedConfigDB } from '../src/cache/CachedConfigDB';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockConfigDB } from './helpers/mockConfigDb';
import { MockKV } from './helpers/mockKv';
import { MockSink } from './helpers/mockSink';

const HEAP_ID = 'heap-1';
const noWait = (_p: Promise<unknown>) => {};

describe('CachedHeapDB', () => {
  function setup() {
    const inner = new MockHeapDB();
    const kv = new MockKV();
    const cached = new CachedHeapDB(inner, kv.asKV(), noWait);
    return { inner, kv, cached };
  }

  it('getHeap populates the cache on a miss, then serves the cached row on a hit', async () => {
    const { inner, kv, cached } = setup();
    inner.seedHeap(HEAP_ID, 1, []);

    const first = await cached.getHeap(HEAP_ID);
    expect(first?.version).toBe(1);
    expect(kv.has(`cache:heap:${HEAP_ID}`)).toBe(true);

    // Mutate the inner row directly (no invalidation) — a cache hit must still
    // return the stale cached value, proving the second read didn't hit D1.
    inner.seedHeap(HEAP_ID, 99, [{ x: 1, y: 2 }]);
    const second = await cached.getHeap(HEAP_ID);
    expect(second?.version).toBe(1);
  });

  it('getHeapFresh bypasses the cache and does not populate it', async () => {
    const { inner, kv, cached } = setup();
    inner.seedHeap(HEAP_ID, 1, []);
    await cached.getHeap(HEAP_ID); // seed cache at v1

    inner.seedHeap(HEAP_ID, 7, []); // move the source of truth forward
    const fresh = await cached.getHeapFresh(HEAP_ID);
    expect(fresh?.version).toBe(7);
    // The stale cached value is untouched (fresh read never repopulates).
    expect(JSON.parse(kv.store.get(`cache:heap:${HEAP_ID}`)!).version).toBe(1);
  });

  it('updateHeap (applied) invalidates both the heap row and the list cache', async () => {
    const { inner, kv, cached } = setup();
    inner.seedHeap(HEAP_ID, 1, []);
    await cached.getHeap(HEAP_ID);
    await cached.listHeaps();
    expect(kv.has(`cache:heap:${HEAP_ID}`)).toBe(true);
    expect(kv.has('cache:heap:list')).toBe(true);

    const applied = await cached.updateHeap(HEAP_ID, HEAP_ID, 2, [{ x: 5, y: 5 }], 0, 0, 1);
    expect(applied).toBe(true);
    expect(kv.deletes).toContain(`cache:heap:${HEAP_ID}`);
    expect(kv.deletes).toContain('cache:heap:list');
    expect(kv.has(`cache:heap:${HEAP_ID}`)).toBe(false);

    // Next read reflects the new version.
    expect((await cached.getHeap(HEAP_ID))?.version).toBe(2);
  });

  it('updateHeap CAS miss does not invalidate the cache', async () => {
    const { inner, kv, cached } = setup();
    inner.seedHeap(HEAP_ID, 5, []);
    await cached.getHeap(HEAP_ID); // cache v5
    const deletesBefore = kv.deletes.length;

    // Stale expectedVersion (1 != 5) — CAS must fail and change nothing.
    const applied = await cached.updateHeap(HEAP_ID, HEAP_ID, 6, [{ x: 1, y: 1 }], 0, 0, 1);
    expect(applied).toBe(false);
    expect(kv.deletes.length).toBe(deletesBefore);
    expect(kv.has(`cache:heap:${HEAP_ID}`)).toBe(true);
  });

  it('getBaseVerticesById is cache-aside; createBase pre-populates it', async () => {
    const { kv, cached } = setup();
    const verts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }];
    await cached.createBase('base-1', HEAP_ID, verts, 'hash', '2026-01-01T00:00:00.000Z');
    expect(kv.has('cache:base:base-1')).toBe(true);

    const got = await cached.getBaseVerticesById('base-1');
    expect(got).toEqual(verts);
  });
});

describe('CachedScoreDB', () => {
  function setup() {
    const inner = new MockScoreDB();
    const kv = new MockKV();
    const cached = new CachedScoreDB(inner, kv.asKV(), noWait);
    return { inner, kv, cached };
  }

  function seedScores(inner: MockScoreDB, n: number) {
    for (let i = 0; i < n; i++) {
      inner.seed(HEAP_ID, `p${i}`, `P${i}`, 1000 - i); // descending scores
    }
  }

  it('getTopScores caches the top-N and serves smaller limits by slicing', async () => {
    const { inner, kv, cached } = setup();
    seedScores(inner, 60);

    const ten = await cached.getTopScores(HEAP_ID, 10);
    expect(ten).toHaveLength(10);
    expect(ten[0].score).toBe(1000);
    expect(kv.has(`cache:scores:${HEAP_ID}:top`)).toBe(true);

    // Mutate inner directly; a cached slice must still return the stale top.
    inner.seed(HEAP_ID, 'cheater', 'CHEAT', 999_999);
    const five = await cached.getTopScores(HEAP_ID, 5);
    expect(five).toHaveLength(5);
    expect(five[0].score).toBe(1000); // not the injected 999_999 → served from cache
  });

  it('bypasses the cache for limits larger than the cached top-N', async () => {
    const { inner, kv, cached } = setup();
    seedScores(inner, 60);

    const rows = await cached.getTopScores(HEAP_ID, 60);
    expect(rows).toHaveLength(60);
    expect(kv.has(`cache:scores:${HEAP_ID}:top`)).toBe(false); // never cached
  });

  it('upsertScore invalidates the top cache only when the row actually changed', async () => {
    const { inner, kv, cached } = setup();
    inner.seed(HEAP_ID, 'p1', 'P1', 500);
    await cached.getTopScores(HEAP_ID, 10); // populate cache
    expect(kv.has(`cache:scores:${HEAP_ID}:top`)).toBe(true);

    // Lower score → no change → no invalidation.
    const unchanged = await cached.upsertScore(HEAP_ID, 'p1', 100, 'now');
    expect(unchanged).toBe(false);
    expect(kv.has(`cache:scores:${HEAP_ID}:top`)).toBe(true);

    // Higher score → changed → invalidate.
    const changed = await cached.upsertScore(HEAP_ID, 'p1', 900, 'now');
    expect(changed).toBe(true);
    expect(kv.deletes).toContain(`cache:scores:${HEAP_ID}:top`);
    expect(kv.has(`cache:scores:${HEAP_ID}:top`)).toBe(false);
  });

  // pruneScores no longer invalidates the cache — see 'pruneScores no longer
  // touches KV' in the 'CachedScoreDB selective invalidation' block below.
});

describe('CachedConfigDB', () => {
  function setup() {
    const inner = new MockConfigDB();
    const kv = new MockKV();
    const cached = new CachedConfigDB(inner, kv.asKV(), noWait);
    return { inner, kv, cached };
  }

  it('getAll populates the cache on a miss, then serves the cached map on a hit', async () => {
    const { inner, kv, cached } = setup();
    inner.seed('ad_cadence', { min: 40, max: 50 });

    const first = await cached.getAll();
    expect(first).toEqual({ ad_cadence: { min: 40, max: 50 } });
    expect(kv.has('cache:config:all')).toBe(true);

    // Mutate the inner map directly (no invalidation) — a cache hit must
    // still return the stale cached value, proving the second read didn't
    // hit the inner store.
    inner.seed('ad_cadence', { min: 1, max: 2 });
    const second = await cached.getAll();
    expect(second).toEqual({ ad_cadence: { min: 40, max: 50 } });
  });

  it('set writes through to the inner store and invalidates the cache', async () => {
    const { inner, kv, cached } = setup();
    inner.seed('ad_cadence', { min: 40, max: 50 });
    await cached.getAll(); // populate cache
    expect(kv.has('cache:config:all')).toBe(true);

    await cached.set('ad_cadence', { min: 10, max: 20 }, 'now');
    expect(kv.deletes).toContain('cache:config:all');
    expect(kv.has('cache:config:all')).toBe(false);

    const after = await cached.getAll();
    expect(after).toEqual({ ad_cadence: { min: 10, max: 20 } });
  });

  it('delete removes the key from the inner store and invalidates the cache', async () => {
    const { inner, kv, cached } = setup();
    inner.seed('ad_cadence', { min: 40, max: 50 });
    inner.seed('other_key', { foo: 'bar' });
    await cached.getAll(); // populate cache
    expect(kv.has('cache:config:all')).toBe(true);

    await cached.delete('ad_cadence');
    expect(kv.deletes).toContain('cache:config:all');

    const after = await cached.getAll();
    expect(after).toEqual({ other_key: { foo: 'bar' } });
  });

  it('delete is a no-op (not an error) for a key that does not exist', async () => {
    const { inner, kv, cached } = setup();
    inner.seed('ad_cadence', { min: 40, max: 50 });

    await expect(cached.delete('nonexistent_key')).resolves.toBeUndefined();
    const after = await cached.getAll();
    expect(after).toEqual({ ad_cadence: { min: 40, max: 50 } });
  });
});

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
    const applied = await cached.updateHeap(HEAP_ID, HEAP_ID, 2, [{ x: 1, y: 2 }], 0, 0, 1);
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
    await inner.set('ad_cadence', '3', '2026-01-01T00:00:00.000Z');

    kv.failAll('get');

    const all = await cached.getAll();
    expect(all['ad_cadence']).toBe('3');
  });
});

describe('cache KV failure telemetry', () => {
  it('CachedHeapDB.getHeap emits cache:kv-failed on a KV get error, with sink present', async () => {
    const inner = new MockHeapDB();
    const kv = new MockKV();
    const sink = new MockSink();
    const cached = new CachedHeapDB(inner, kv.asKV(), noWait, sink);
    inner.seedHeap(HEAP_ID, 3, []);

    kv.failAll('get');

    const row = await cached.getHeap(HEAP_ID);
    expect(row?.version).toBe(3); // still degrades to a cache miss / D1 fallback

    expect(sink.written).toHaveLength(1);
    expect(sink.written[0].message).toBe('cache:kv-failed');
    expect(sink.written[0].level).toBe('warn');
    expect(sink.written[0].payload).toMatchObject({
      op: 'get',
      key: `cache:heap:${HEAP_ID}`,
    });
    expect(typeof sink.written[0].payload.error).toBe('string');
  });

  it('CachedHeapDB.updateHeap emits cache:kv-failed on a KV delete error, and still applies the write', async () => {
    const inner = new MockHeapDB();
    const kv = new MockKV();
    const sink = new MockSink();
    const cached = new CachedHeapDB(inner, kv.asKV(), noWait, sink);
    inner.seedHeap(HEAP_ID, 1, []);

    kv.failAll('delete');

    const applied = await cached.updateHeap(HEAP_ID, HEAP_ID, 2, [{ x: 1, y: 2 }], 0, 0, 1);
    expect(applied).toBe(true);

    // Two invalidation deletes attempted (heap row + list), both fail → two events.
    expect(sink.written).toHaveLength(2);
    for (const entry of sink.written) {
      expect(entry.message).toBe('cache:kv-failed');
      expect(entry.level).toBe('warn');
      expect(entry.payload.op).toBe('delete');
    }
    const keys = sink.written.map((e) => e.payload.key);
    expect(keys).toEqual(expect.arrayContaining([`cache:heap:${HEAP_ID}`, 'cache:heap:list']));
  });

  it('CachedHeapDB does not emit or throw when no sink is configured', async () => {
    const inner = new MockHeapDB();
    const kv = new MockKV();
    const cached = new CachedHeapDB(inner, kv.asKV(), noWait); // no sink
    inner.seedHeap(HEAP_ID, 3, []);

    kv.failAll('get');

    await expect(cached.getHeap(HEAP_ID)).resolves.toMatchObject({ version: 3 });
  });

  it('CachedScoreDB.getTopScores emits cache:kv-failed on a KV get error', async () => {
    const inner = new MockScoreDB();
    const kv = new MockKV();
    const sink = new MockSink();
    const cached = new CachedScoreDB(inner, kv.asKV(), noWait, sink);
    await inner.upsertScore(HEAP_ID, 'p1', 500, '2026-01-01T00:00:00.000Z');

    kv.failAll('get');

    const top = await cached.getTopScores(HEAP_ID, 5);
    expect(top).toHaveLength(1);

    expect(sink.written).toHaveLength(1);
    expect(sink.written[0].message).toBe('cache:kv-failed');
    expect(sink.written[0].level).toBe('warn');
    expect(sink.written[0].payload).toMatchObject({
      op: 'get',
      key: `cache:scores:${HEAP_ID}:top`,
    });
  });

  it('CachedConfigDB.getAll emits cache:kv-failed on a KV get error', async () => {
    const inner = new MockConfigDB();
    const kv = new MockKV();
    const sink = new MockSink();
    const cached = new CachedConfigDB(inner, kv.asKV(), noWait, sink);
    await inner.set('ad_cadence', '3', '2026-01-01T00:00:00.000Z');

    kv.failAll('get');

    const all = await cached.getAll();
    expect(all['ad_cadence']).toBe('3');

    expect(sink.written).toHaveLength(1);
    expect(sink.written[0].message).toBe('cache:kv-failed');
    expect(sink.written[0].level).toBe('warn');
    expect(sink.written[0].payload).toMatchObject({
      op: 'get',
      key: 'cache:config:all',
    });
  });
});

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

  it('invalidates without crashing when the cached board is empty', async () => {
    const inner = new MockScoreDB();
    const kv = new MockKV();
    const cached = new CachedScoreDB(inner, kv.asKV(), noWait);
    // Read the leaderboard of a heap with no scores — this caches an empty array,
    // which is truthy, so it is NOT treated as a cache miss.
    await cached.getTopScores(HEAP_ID, 50);
    kv.deletes.length = 0;

    const changed = await cached.upsertScore(HEAP_ID, 'first-ever', 42, '2026-01-01T00:00:00.000Z');

    expect(changed).toBe(true);
    expect(kv.deletes).toEqual([`cache:scores:${HEAP_ID}:top`]);
  });
});

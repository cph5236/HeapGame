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

    const applied = await cached.updateHeap(HEAP_ID, HEAP_ID, 2, [{ x: 5, y: 5 }], 0, 1);
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
    const applied = await cached.updateHeap(HEAP_ID, HEAP_ID, 6, [{ x: 1, y: 1 }], 0, 1);
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
    const unchanged = await cached.upsertScore(HEAP_ID, 'p1', 'P1', 100, 'now');
    expect(unchanged).toBe(false);
    expect(kv.has(`cache:scores:${HEAP_ID}:top`)).toBe(true);

    // Higher score → changed → invalidate.
    const changed = await cached.upsertScore(HEAP_ID, 'p1', 'P1', 900, 'now');
    expect(changed).toBe(true);
    expect(kv.deletes).toContain(`cache:scores:${HEAP_ID}:top`);
    expect(kv.has(`cache:scores:${HEAP_ID}:top`)).toBe(false);
  });

  it('pruneScores invalidates the top cache', async () => {
    const { inner, kv, cached } = setup();
    seedScores(inner, 5);
    await cached.getTopScores(HEAP_ID, 5);
    expect(kv.has(`cache:scores:${HEAP_ID}:top`)).toBe(true);

    await cached.pruneScores(HEAP_ID);
    expect(kv.deletes).toContain(`cache:scores:${HEAP_ID}:top`);
  });
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
});

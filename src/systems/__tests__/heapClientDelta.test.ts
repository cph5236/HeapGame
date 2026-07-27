import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { mergeBands, wireToBands, envelopeToVertices } from '../../../shared/heapPolygon/bandEnvelope';

// vitest runs in a node environment (see vite.config.ts test.environment), so
// there is no global `localStorage` unless we install one. Mirrors the stub
// pattern in dailyRunGate.test.ts. A real Storage-backed Map, not vi.stubGlobal,
// because HeapClient (imported below) reads `localStorage` at call time, not
// module-init time, so a plain global works and stays installed across both
// describe blocks in this file.
beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(global, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
    },
    configurable: true,
  });
});

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

  it('self-heals a delta received with no cache at all: forces a full refetch instead of rendering empty', async () => {
    // Simulates the safety-net case: a cache-less client (no baseId sent, so
    // this should be unreachable via the server's own sameGeneration check)
    // somehow receives mode:'delta' back. It must not silently return [].
    const deltaWithNoCache = {
      changed: true, mode: 'delta', version: 6, baseId: 'b1', freezeY: 0,
      bands: [10, 400, 500], params: {}, enemyParams: {},
    };
    const { urls } = stubFetch([deltaWithNoCache, fullResponse]);

    const polygon = await new HeapClient().load('h1');

    const heapQueryUrls = urls.filter((u) => !u.includes('/base'));
    // Exactly two /heaps/:id requests — the original (unexpected delta) and
    // the forced retry — never a third. Proves the _retry guard bounds the
    // self-heal to one attempt rather than looping.
    expect(heapQueryUrls).toHaveLength(2);
    expect(heapQueryUrls[1]).toContain('version=0');
    expect(heapQueryUrls[1]).not.toContain('baseId');

    // Self-healed to the full response rather than silently rendering empty.
    expect(polygon.length).toBeGreaterThan(0);
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY)!);
    expect(cache.bands).toEqual(fullResponse.bands);
    expect(cache.version).toBe(fullResponse.version);
  });

  it('merges a delta into a cache with empty-but-present bands without retriggering a refetch', async () => {
    // Narrowed-guard companion: a freshly created heap's first cache has
    // bands: [] (nothing placed yet) — that is a valid, mergeable envelope,
    // not "no usable cache". It must merge normally, not pay the self-heal's
    // extra round-trip.
    localStorage.setItem(CACHE_KEY, JSON.stringify({ shape: 2, version: 5, baseId: 'b1', bands: [] }));
    localStorage.setItem('heap_base_b1', JSON.stringify([{ x: 480, y: 50000 }]));

    const { urls } = stubFetch([{
      changed: true, mode: 'delta', version: 6, baseId: 'b1', freezeY: 0,
      bands: [10, 400, 500], params: {}, enemyParams: {},
    }]);

    await new HeapClient().load('h1');

    // Only the single heap query — no self-heal retry, and no base fetch
    // (already cached) — proving the empty-bands cache was treated as
    // mergeable, not discarded.
    expect(urls).toHaveLength(1);
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY)!);
    expect(cache.bands).toEqual([10, 400, 500]);
    expect(cache.version).toBe(6);
  });
});

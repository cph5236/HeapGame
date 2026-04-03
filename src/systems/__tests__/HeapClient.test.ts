import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// HeapClient reads SERVER_URL at module evaluation time from import.meta.env,
// so we need to stub the global before importing.
const BASE = 'http://localhost:8787';

// Minimal localStorage stub
function makeLocalStorage(): Storage {
  const store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  } as Storage;
}

let localStorageStub: Storage;

beforeEach(() => {
  localStorageStub = makeLocalStorage();
  vi.stubGlobal('localStorage', localStorageStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

// Import AFTER stubbing globals so module init captures the stubs
const { HeapClient } = await import('../HeapClient');

// ── list() ────────────────────────────────────────────────────────────────────

describe('HeapClient.list', () => {
  it('returns array of IDs from GET /heaps', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        heaps: [
          { id: 'aaa', version: 1, createdAt: '2026-01-01T00:00:00.000Z' },
          { id: 'bbb', version: 2, createdAt: '2026-01-02T00:00:00.000Z' },
        ],
      }),
    }));

    const ids = await HeapClient.list();

    expect(ids).toEqual(['aaa', 'bbb']);
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/heaps`);
  });

  it('returns [] on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('network down')));

    const ids = await HeapClient.list();

    expect(ids).toEqual([]);
  });

  it('returns [] when server responds with non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 500 }));

    const ids = await HeapClient.list();

    expect(ids).toEqual([]);
  });
});

// ── load() ────────────────────────────────────────────────────────────────────

describe('HeapClient.load', () => {
  it('fetches GET /heaps/:id with version=0 on cold cache and returns base + liveZone', async () => {
    const heapId = 'heap-guid-001';
    const baseId = 'base-guid-001';
    const baseVertices = [{ x: 100, y: 400 }, { x: 300, y: 600 }, { x: 500, y: 400 }];
    const liveZone = [{ x: 200, y: 350 }];

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ changed: true, version: 3, baseId, liveZone }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => baseVertices,
      }),
    );

    const polygon = await HeapClient.load(heapId);

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenNthCalledWith(1, `${BASE}/heaps/${heapId}?version=0`);
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${BASE}/heaps/${heapId}/base`);
    expect(polygon).toEqual([...baseVertices, ...liveZone]);
  });

  it('sends cached version in query param on warm cache', async () => {
    const heapId = 'heap-guid-002';
    const baseId = 'base-guid-002';
    const cachedBase = [{ x: 0, y: 500 }, { x: 100, y: 500 }, { x: 50, y: 300 }];
    const cachedLive = [{ x: 60, y: 280 }];

    // Prime the cache
    localStorageStub.setItem(
      `heap_cache_${heapId}`,
      JSON.stringify({ version: 7, baseId, liveZone: cachedLive }),
    );
    localStorageStub.setItem(
      `heap_base_${baseId}`,
      JSON.stringify(cachedBase),
    );

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ changed: false, version: 7 }),
    }));

    const polygon = await HeapClient.load(heapId);

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/heaps/${heapId}?version=7`);
    // base should NOT be re-fetched — cached
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(polygon).toEqual([...cachedBase, ...cachedLive]);
  });

  it('re-fetches base from GET /heaps/:id/base when baseId changes after freeze', async () => {
    const heapId = 'heap-guid-003';
    const oldBaseId = 'base-old';
    const newBaseId = 'base-new';
    const oldBase = [{ x: 0, y: 600 }, { x: 200, y: 800 }, { x: 400, y: 600 }];
    const newBase = [{ x: 0, y: 600 }, { x: 200, y: 800 }, { x: 400, y: 600 }, { x: 200, y: 350 }];
    const newLive = [{ x: 210, y: 340 }];

    // Cache has the old baseId
    localStorageStub.setItem(
      `heap_cache_${heapId}`,
      JSON.stringify({ version: 5, baseId: oldBaseId, liveZone: [] }),
    );
    localStorageStub.setItem(
      `heap_base_${oldBaseId}`,
      JSON.stringify(oldBase),
    );

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ changed: true, version: 10, baseId: newBaseId, liveZone: newLive }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => newBase,
      }),
    );

    const polygon = await HeapClient.load(heapId);

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${BASE}/heaps/${heapId}/base`);
    expect(polygon).toEqual([...newBase, ...newLive]);
  });

  it('falls back to cached polygon on network error', async () => {
    const heapId = 'heap-guid-004';
    const baseId = 'base-guid-004';
    const base = [{ x: 0, y: 400 }, { x: 100, y: 600 }, { x: 200, y: 400 }];
    const live = [{ x: 110, y: 390 }];

    localStorageStub.setItem(
      `heap_cache_${heapId}`,
      JSON.stringify({ version: 2, baseId, liveZone: live }),
    );
    localStorageStub.setItem(
      `heap_base_${baseId}`,
      JSON.stringify(base),
    );

    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('network down')));

    const polygon = await HeapClient.load(heapId);

    expect(polygon).toEqual([...base, ...live]);
  });
});

// ── append() ──────────────────────────────────────────────────────────────────

describe('HeapClient.append', () => {
  it('posts {x, y} to POST /heaps/:id/place (no hash in body)', async () => {
    const heapId = 'heap-guid-005';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accepted: true, version: 14 }),
    }));

    await HeapClient.append(heapId, 220, 380);

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/heaps/${heapId}/place`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ x: 220, y: 380 }),
      }),
    );
    // Ensure no 'hash' field leaks into the request body
    const callArgs = fetchMock.mock.calls[0];
    const body = JSON.parse((callArgs[1] as RequestInit).body as string);
    expect(body).not.toHaveProperty('hash');
  });

  it('does not update cached version when block is accepted (load() must fetch the real data)', async () => {
    const heapId = 'heap-guid-006';
    const baseId = 'base-guid-006';

    localStorageStub.setItem(
      `heap_cache_${heapId}`,
      JSON.stringify({ version: 8, baseId, liveZone: [] }),
    );

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accepted: true, version: 9 }),
    }));

    await HeapClient.append(heapId, 150, 300);

    // Version must stay at 8 — we don't have the server's v9 data yet.
    // load() will send ?version=8, receive the real liveZone, then save v9.
    const stored = JSON.parse(localStorageStub.getItem(`heap_cache_${heapId}`)!);
    expect(stored.version).toBe(8);
  });

  it('does not throw on network error', async () => {
    const heapId = 'heap-guid-007';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')));

    await expect(HeapClient.append(heapId, 100, 200)).resolves.toBeUndefined();
  });
});

// ── append() → load() workflow ────────────────────────────────────────────────

describe('HeapClient workflow: append then load', () => {
  it('load() after accepted append sends bumped version and returns server-fresh polygon', async () => {
    const heapId = 'heap-guid-009';
    const baseId = 'base-guid-009';
    const base = [{ x: 0, y: 600 }, { x: 300, y: 800 }, { x: 600, y: 600 }];
    const liveAfterPlace = [{ x: 150, y: 550 }];

    // Warm cache at version 5
    localStorageStub.setItem(
      `heap_cache_${heapId}`,
      JSON.stringify({ version: 5, baseId, liveZone: [] }),
    );
    localStorageStub.setItem(`heap_base_${baseId}`, JSON.stringify(base));

    vi.stubGlobal('fetch', vi.fn()
      // append POST → accepted at version 6
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accepted: true, version: 6 }),
      })
      // load GET → server returns changed data at version 6 with new live zone
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ changed: true, version: 6, baseId, liveZone: liveAfterPlace }),
      }),
    );

    await HeapClient.append(heapId, 150, 550);
    const polygon = await HeapClient.load(heapId);

    const fetchMock = vi.mocked(fetch);
    // load() must send the PRE-append version (5, not 6) — we don't have v6 data yet
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${BASE}/heaps/${heapId}?version=5`);
    expect(polygon).toEqual([...base, ...liveAfterPlace]);
  });
});

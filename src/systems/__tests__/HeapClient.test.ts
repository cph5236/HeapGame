import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reconstructPolygonFromPoints } from '../HeapPolygonLoader';
import { mergeBands, wireToBands, envelopeToVertices } from '../../../shared/heapPolygon/bandEnvelope';

vi.mock('../authToken', () => ({
  authHeaders: () => ({ 'X-Player-Token': 'secret-test' }),
  logIfAuthRejected: vi.fn(),
}));

// HeapClient reads SERVER_URL at module evaluation time from import.meta.env,
// so we need to stub the global before importing.
const BASE = 'http://localhost:8787';

/** Decode a wire [band, minX, maxX, ...] triple array the same way HeapClient
 * does internally, for building expected-polygon assertions in these tests. */
function wireToVertices(wire: number[]) {
  return envelopeToVertices(mergeBands(new Map(), wireToBands(wire)));
}

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
import { logIfAuthRejected } from '../authToken';

// ── list() ────────────────────────────────────────────────────────────────────

describe('HeapClient.list', () => {
  it('returns heap summaries with params from server', async () => {
    (global as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        heaps: [
          {
            id: 'abc',
            version: 3,
            createdAt: '2026-04-01T00:00:00.000Z',
            params: { name: 'A', difficulty: 2, spawnRateMult: 1, coinMult: 1, scoreMult: 1 },
          },
        ],
      }),
    });
    const summaries = await HeapClient.list();
    expect(summaries).toHaveLength(1);
    expect(summaries[0].id).toBe('abc');
    expect(summaries[0].params.name).toBe('A');
  });

  it('returns [] when fetch fails', async () => {
    (global as any).fetch = vi.fn().mockRejectedValue(new Error('net'));
    expect(await HeapClient.list()).toEqual([]);
  });

  it('returns [] when response is not ok', async () => {
    (global as any).fetch = vi.fn().mockResolvedValue({ ok: false });
    expect(await HeapClient.list()).toEqual([]);
  });
});

// ── load() ────────────────────────────────────────────────────────────────────

describe('HeapClient.load', () => {
  it('fetches GET /heaps/:id with version=0 and no baseId on cold cache, returns base + bands', async () => {
    const heapId = 'heap-guid-001';
    const baseId = 'base-guid-001';
    const baseVertices = [{ x: 100, y: 400 }, { x: 300, y: 600 }, { x: 500, y: 400 }];
    // band 17 -> mid-y 350, single point (minX === maxX)
    const bandsWire = [17, 200, 200];

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ changed: true, mode: 'full', version: 3, baseId, bands: bandsWire, liveZone: [], params: {}, enemyParams: {} }),
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
    expect(polygon).toEqual(reconstructPolygonFromPoints([...baseVertices, ...wireToVertices(bandsWire)]));
  });

  it('sends cached version AND baseId in query params on warm cache (delta opt-in)', async () => {
    const heapId = 'heap-guid-002';
    const baseId = 'base-guid-002';
    const cachedBase = [{ x: 0, y: 500 }, { x: 100, y: 500 }, { x: 50, y: 300 }];
    // band 14 -> mid-y 290, single point
    const cachedBandsWire = [14, 60, 60];

    // Prime the cache in the new (shape: 2) form
    localStorageStub.setItem(
      `heap_cache_${heapId}`,
      JSON.stringify({ shape: 2, version: 7, baseId, bands: cachedBandsWire }),
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
    // A warm cache now opts into deltas by echoing BOTH version and baseId —
    // this is the request-shape change this task exists to make.
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/heaps/${heapId}?version=7&baseId=${baseId}`);
    // base should NOT be re-fetched — cached
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(polygon).toEqual(reconstructPolygonFromPoints([...cachedBase, ...wireToVertices(cachedBandsWire)]));
  });

  it('re-fetches base from GET /heaps/:id/base when baseId changes after freeze', async () => {
    const heapId = 'heap-guid-003';
    const oldBaseId = 'base-old';
    const newBaseId = 'base-new';
    const oldBase = [{ x: 0, y: 600 }, { x: 200, y: 800 }, { x: 400, y: 600 }];
    const newBase = [{ x: 0, y: 600 }, { x: 200, y: 800 }, { x: 400, y: 600 }, { x: 200, y: 350 }];
    // band 17 -> mid-y 350, single point
    const newBandsWire = [17, 210, 210];

    // Cache has the old baseId, no bands yet (nothing placed pre-freeze)
    localStorageStub.setItem(
      `heap_cache_${heapId}`,
      JSON.stringify({ shape: 2, version: 5, baseId: oldBaseId, bands: [] }),
    );
    localStorageStub.setItem(
      `heap_base_${oldBaseId}`,
      JSON.stringify(oldBase),
    );

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ changed: true, mode: 'full', version: 10, baseId: newBaseId, bands: newBandsWire, liveZone: [], params: {}, enemyParams: {} }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => newBase,
      }),
    );

    const polygon = await HeapClient.load(heapId);

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${BASE}/heaps/${heapId}/base`);
    expect(polygon).toEqual(reconstructPolygonFromPoints([...newBase, ...wireToVertices(newBandsWire)]));
  });

  it('falls back to cached polygon on network error', async () => {
    const heapId = 'heap-guid-004';
    const baseId = 'base-guid-004';
    const base = [{ x: 0, y: 400 }, { x: 100, y: 600 }, { x: 200, y: 400 }];
    // band 19 -> mid-y 390, single point
    const liveBandsWire = [19, 110, 110];

    localStorageStub.setItem(
      `heap_cache_${heapId}`,
      JSON.stringify({ shape: 2, version: 2, baseId, bands: liveBandsWire }),
    );
    localStorageStub.setItem(
      `heap_base_${baseId}`,
      JSON.stringify(base),
    );

    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('network down')));

    const polygon = await HeapClient.load(heapId);

    expect(polygon).toEqual(reconstructPolygonFromPoints([...base, ...wireToVertices(liveBandsWire)]));
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
      JSON.stringify({ shape: 2, version: 8, baseId, bands: [] }),
    );

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accepted: true, version: 9 }),
    }));

    await HeapClient.append(heapId, 150, 300);

    // Version must stay at 8 — we don't have the server's v9 data yet.
    // load() will send ?version=8, receive the real bands, then save v9.
    const stored = JSON.parse(localStorageStub.getItem(`heap_cache_${heapId}`)!);
    expect(stored.version).toBe(8);
  });

  it('does not throw on network error', async () => {
    const heapId = 'heap-guid-007';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')));

    await expect(HeapClient.append(heapId, 100, 200)).resolves.toBeNull();
  });

  it('includes playerGuid in the body and X-Player-Token header when passed', async () => {
    const heapId = 'heap-guid-008';

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accepted: true, version: 1 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await HeapClient.append(heapId, 220, 380, 'player-guid-1');

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/heaps/${heapId}/place`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ x: 220, y: 380, playerGuid: 'player-guid-1' }),
      }),
    );
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers['X-Player-Token']).toBe('secret-test');
  });

  it('omits playerGuid from the body when not passed (legacy shape preserved)', async () => {
    const heapId = 'heap-guid-009';

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accepted: true, version: 1 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await HeapClient.append(heapId, 220, 380);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).not.toHaveProperty('playerGuid');
  });

  it('on 403, resolves null and fires the remote auth:rejected log', async () => {
    const heapId = 'heap-guid-010';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 403 }));

    const result = await HeapClient.append(heapId, 220, 380, 'player-guid-1');

    expect(result).toBeNull();
    expect(vi.mocked(logIfAuthRejected)).toHaveBeenCalledWith('heaps:place', 403);
  });
});

// ── append() → load() workflow ────────────────────────────────────────────────

describe('HeapClient workflow: append then load', () => {
  it('load() after accepted append sends bumped version and returns server-fresh polygon', async () => {
    const heapId = 'heap-guid-009b';
    const baseId = 'base-guid-009';
    const base = [{ x: 0, y: 600 }, { x: 300, y: 800 }, { x: 600, y: 600 }];
    // band 27 -> mid-y 550, single point
    const bandsAfterPlace = [27, 150, 150];

    // Warm cache at version 5
    localStorageStub.setItem(
      `heap_cache_${heapId}`,
      JSON.stringify({ shape: 2, version: 5, baseId, bands: [] }),
    );
    localStorageStub.setItem(`heap_base_${baseId}`, JSON.stringify(base));

    vi.stubGlobal('fetch', vi.fn()
      // append POST → accepted at version 6
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accepted: true, version: 6 }),
      })
      // load GET → server returns changed data at version 6 with new bands
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ changed: true, mode: 'full', version: 6, baseId, bands: bandsAfterPlace, liveZone: [], params: {}, enemyParams: {} }),
      }),
    );

    await HeapClient.append(heapId, 150, 550);
    const polygon = await HeapClient.load(heapId);

    const fetchMock = vi.mocked(fetch);
    // load() must send the PRE-append version (5, not 6) — we don't have v6 data yet.
    // Cache is warm (baseId known), so it also echoes baseId to opt into deltas.
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${BASE}/heaps/${heapId}?version=5&baseId=${baseId}`);
    expect(polygon).toEqual(reconstructPolygonFromPoints([...base, ...wireToVertices(bandsAfterPlace)]));
  });
});

// ── getEnemyParams() ─────────────────────────────────────────────────────────

describe('HeapClient.getEnemyParams', () => {
  it('getEnemyParams returns enemyParams from the last changed:true response', async () => {
    const heapId = 'heap-enemy-params-001';
    const baseId = 'base-enemy-params-001';
    const baseVertices = [{ x: 0, y: 500 }, { x: 100, y: 700 }, { x: 200, y: 500 }];
    const enemyParams = {
      percher: { spawnStartPxAboveFloor: 0, spawnEndPxAboveFloor: -1, spawnRampPxAboveFloor: 12000, spawnChanceMin: 0.2, spawnChanceMax: 0.5 },
    };

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ changed: true, mode: 'full', version: 1, baseId, bands: [], liveZone: [], params: {}, enemyParams }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => baseVertices,
      }),
    );

    await HeapClient.load(heapId);

    const cached = HeapClient.getEnemyParams(heapId);
    expect(cached).not.toBeNull();
    expect(cached!.percher.spawnRampPxAboveFloor).toBe(12000);
  });
});

// ── getLiveZoneBottomY() ──────────────────────────────────────────────────────

describe('HeapClient.getLiveZoneBottomY', () => {
  it('returns null when no cache exists for the heapId', () => {
    // localStorage is empty (fresh stub from beforeEach)
    expect(HeapClient.getLiveZoneBottomY('no-such-id')).toBeNull();
  });

  it('returns null when cached bands are empty', () => {
    localStorageStub.setItem(
      'heap_cache_abc',
      JSON.stringify({ shape: 2, version: 1, baseId: 'b1', bands: [] }),
    );
    expect(HeapClient.getLiveZoneBottomY('abc')).toBeNull();
  });

  it('returns (highest band + 1) * BAND_SIZE_PX derived from the cached bands', () => {
    // Bands 10, 25, 39 present (order in the wire deliberately not sorted) — the
    // highest band is 39, so the bottom edge is (39 + 1) * 20 = 800.
    localStorageStub.setItem(
      'heap_cache_xyz',
      JSON.stringify({
        shape: 2,
        version: 3,
        baseId: 'b2',
        bands: [10, 100, 100, 39, 150, 150, 25, 120, 120],
      }),
    );
    expect(HeapClient.getLiveZoneBottomY('xyz')).toBe(800);
  });
});

// ── primeEnemyParams() ──────────────────────────────────────────────────────────

describe('HeapClient.primeEnemyParams', () => {
  const HEAP = 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF';
  const PARAMS = {
    percher: { spawnStartPxAboveFloor: 0, spawnEndPxAboveFloor: -1, spawnRampPxAboveFloor: 15000, spawnChanceMin: 0.15, spawnChanceMax: 0.45 },
  };

  it('fetches /enemy-params and makes getEnemyParams return them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => PARAMS }));
    await HeapClient.primeEnemyParams(HEAP);
    expect(global.fetch).toHaveBeenCalledWith(`${BASE}/heaps/${HEAP}/enemy-params`);
    expect(HeapClient.getEnemyParams(HEAP)).toEqual(PARAMS);
  });

  it('is a no-op on non-ok response (getEnemyParams stays null)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await HeapClient.primeEnemyParams(HEAP);
    expect(HeapClient.getEnemyParams(HEAP)).toBeNull();
  });

  it('is a no-op when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')));
    await expect(HeapClient.primeEnemyParams(HEAP)).resolves.toBeUndefined();
    expect(HeapClient.getEnemyParams(HEAP)).toBeNull();
  });

  it('merges enemyParams into an existing cache without clobbering bands/baseId', async () => {
    localStorageStub.setItem(
      `heap_cache_${HEAP}`,
      JSON.stringify({ shape: 2, version: 5, baseId: 'b1', bands: [1, 5, 6] }),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => PARAMS }));
    await HeapClient.primeEnemyParams(HEAP);
    const cache = JSON.parse(localStorageStub.getItem(`heap_cache_${HEAP}`)!);
    expect(cache.shape).toBe(2);
    expect(cache.baseId).toBe('b1');
    expect(cache.bands).toEqual([1, 5, 6]);
    expect(cache.enemyParams).toEqual(PARAMS);
  });
});

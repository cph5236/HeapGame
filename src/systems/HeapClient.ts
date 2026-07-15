import type {
  GetHeapResponse,
  HeapEnemyParams,
  ListHeapsResponse,
  PlaceRequest,
  PlaceResponse,
  Vertex,
} from '../../shared/heapTypes';
import { reconstructPolygonFromPoints } from './HeapPolygonLoader';
import { fetchWithLog } from '../logging/fetchWithLog';
import { authHeaders, logIfAuthRejected } from './authToken';

const SERVER_URL: string =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_HEAP_SERVER_URL ??
  'http://localhost:8787';

const CACHE_PREFIX = 'heap_cache_';      // + heapId
const BASE_CACHE_PREFIX = 'heap_base_'; // + baseId (GUID, changes on freeze)

interface HeapCache {
  version: number;
  baseId: string;
  liveZone: Vertex[];
  enemyParams?: HeapEnemyParams;
}

function loadCache(heapId: string): HeapCache | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + heapId);
    return raw ? (JSON.parse(raw) as HeapCache) : null;
  } catch {
    return null;
  }
}

function saveCache(heapId: string, cache: HeapCache): void {
  localStorage.setItem(CACHE_PREFIX + heapId, JSON.stringify(cache));
}

function loadCachedBase(baseId: string): Vertex[] | null {
  try {
    const raw = localStorage.getItem(BASE_CACHE_PREFIX + baseId);
    return raw ? (JSON.parse(raw) as Vertex[]) : null;
  } catch {
    return null;
  }
}

function saveCachedBase(baseId: string, vertices: Vertex[]): void {
  localStorage.setItem(BASE_CACHE_PREFIX + baseId, JSON.stringify(vertices));
}

function clearCache(heapId: string): void {
  try {
    localStorage.removeItem(CACHE_PREFIX + heapId);
  } catch {
    // best effort
  }
}

async function fetchBase(heapId: string, baseId: string): Promise<Vertex[]> {
  const cached = loadCachedBase(baseId);
  if (cached) return cached;
  const res = await fetchWithLog(`${SERVER_URL}/heaps/${heapId}/base`);
  if (!res.ok) throw new Error(`base fetch failed: ${res.status}`);
  const vertices = (await res.json()) as Vertex[];
  saveCachedBase(baseId, vertices);
  return vertices;
}

async function buildPolygon(heapId: string, cache: HeapCache): Promise<Vertex[]> {
  if (!cache.baseId) return cache.liveZone;
  const base = await fetchBase(heapId, cache.baseId);
  return [...base, ...cache.liveZone];
}

export class HeapClient {
  /**
   * Fetch all heap summaries from the server.
   * Returns [] on network failure.
   */
  static async list(): Promise<import('../../shared/heapTypes').HeapSummary[]> {
    try {
      const res = await fetchWithLog(`${SERVER_URL}/heaps`);
      if (!res.ok) return [];
      const data = (await res.json()) as ListHeapsResponse;
      return data.heaps;
    } catch {
      return [];
    }
  }

  /**
   * Load the full polygon for a specific heap.
   * Uses localStorage cache + server delta strategy.
   * Falls back to last cached data (or []) on network failure.
   */
  static async load(heapId: string, _retry = false): Promise<Vertex[]> {
    const cache = loadCache(heapId);
    const version = cache?.version ?? 0;

    try {
      const res = await fetchWithLog(`${SERVER_URL}/heaps/${heapId}?version=${version}`);
      if (res.status === 404) {
        console.warn(
          `[HeapClient] Heap ${heapId} returned 404 — clearing orphan cache.`,
        );
        clearCache(heapId);
        return [];
      }
      if (!res.ok) throw new Error(`heap fetch failed: ${res.status}`);
      const data = (await res.json()) as GetHeapResponse;

      if (!data.changed && cache) {
        try {
          return reconstructPolygonFromPoints(await buildPolygon(heapId, cache));
        } catch (err) {
          // Cache version matches server but base fetch failed (e.g. baseId no
          // longer exists). Invalidate and retry with version=0 to pull fresh
          // baseId + liveZone from server.
          console.warn(
            `[HeapClient] Heap ${heapId} cache healed: server reported changed=false (v${cache.version}) but base ${cache.baseId} could not be loaded (${(err as Error)?.message ?? err}). Clearing cache and retrying with version=0.`,
          );
          clearCache(heapId);
          if (!_retry) return HeapClient.load(heapId, true);
          throw new Error('base fetch failed after cache reset');
        }
      }

      if (data.changed) {
        // Fetch base BEFORE saving cache, so we never persist a cache pointing
        // at a baseId we couldn't actually retrieve.
        const base = await fetchBase(heapId, data.baseId);
        const newCache: HeapCache = {
          version: data.version,
          baseId: data.baseId,
          liveZone: data.liveZone,
          enemyParams: data.enemyParams,
        };
        saveCache(heapId, newCache);
        return reconstructPolygonFromPoints([...base, ...data.liveZone]);
      }

      return [];
    } catch {
      if (cache) {
        try {
          return reconstructPolygonFromPoints(await buildPolygon(heapId, cache));
        } catch {
          return reconstructPolygonFromPoints(cache.liveZone);
        }
      }
      return [];
    }
  }

  /**
   * Fire-and-forget block placement for a specific heap.
   * Called after the player places a block. Never throws or blocks gameplay.
   * Returns the PlaceResponse if successful, or null on network error or non-ok response.
   */
  static async append(heapId: string, x: number, y: number, playerGuid?: string): Promise<PlaceResponse | null> {
    try {
      const body: PlaceRequest = playerGuid !== undefined ? { x, y, playerGuid } : { x, y };
      const res = await fetchWithLog(`${SERVER_URL}/heaps/${heapId}/place`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        logIfAuthRejected('heaps:place', res.status);
        return null;
      }
      // Do NOT update the cache version here. The client doesn't hold the
      // server's new data yet — load() must fetch it with the current version
      // so the server responds with the real liveZone.
      return await res.json() as PlaceResponse;
    } catch {
      // Silently drop — game never depends on server for local progression
      return null;
    }
  }

  static getEnemyParams(heapId: string): HeapEnemyParams | null {
    const cache = loadCache(heapId);
    return cache?.enemyParams ?? null;
  }

  /**
   * Fetch a heap's enemy spawn config from the base-independent
   * GET /heaps/:id/enemy-params endpoint and cache it so getEnemyParams() can
   * read it synchronously. Used for the procedural infinite heap, which has no
   * base polygon and so cannot use load(). No-op on network failure — callers
   * fall back to DEFAULT_ENEMY_PARAMS.
   */
  static async primeEnemyParams(heapId: string): Promise<void> {
    try {
      const res = await fetchWithLog(`${SERVER_URL}/heaps/${heapId}/enemy-params`);
      if (!res.ok) return;
      const enemyParams = (await res.json()) as HeapEnemyParams;
      const cache = loadCache(heapId) ?? { version: 0, baseId: '', liveZone: [] };
      saveCache(heapId, { ...cache, enemyParams });
    } catch {
      // silent — caller falls back to DEFAULT_ENEMY_PARAMS
    }
  }

  /**
   * Returns the maximum Y value (freeze line) of the cached liveZone for a heap.
   * Returns null if the cache is absent or the liveZone is empty.
   */
  static getLiveZoneBottomY(heapId: string): number | null {
    const cache = loadCache(heapId);
    if (!cache || cache.liveZone.length === 0) return null;
    return cache.liveZone.reduce((max, v) => v.y > max ? v.y : max, -Infinity);
  }
}

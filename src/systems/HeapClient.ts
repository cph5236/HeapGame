import type {
  GetHeapResponse,
  ListHeapsResponse,
  Vertex,
} from '../../shared/heapTypes';
import { reconstructPolygonFromPoints } from './HeapPolygonLoader';

const SERVER_URL: string =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_HEAP_SERVER_URL ??
  'http://localhost:8787';

const CACHE_PREFIX = 'heap_cache_';      // + heapId
const BASE_CACHE_PREFIX = 'heap_base_'; // + baseId (GUID, changes on freeze)

interface HeapCache {
  version: number;
  baseId: string;
  liveZone: Vertex[];
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

async function fetchBase(heapId: string, baseId: string): Promise<Vertex[]> {
  const cached = loadCachedBase(baseId);
  if (cached) return cached;
  const res = await fetch(`${SERVER_URL}/heaps/${heapId}/base`);
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
   * Fetch all heap IDs from the server.
   * Returns [] on network failure.
   */
  static async list(): Promise<string[]> {
    try {
      const res = await fetch(`${SERVER_URL}/heaps`);
      if (!res.ok) return [];
      const data = (await res.json()) as ListHeapsResponse;
      return data.heaps.map(h => h.id);
    } catch {
      return [];
    }
  }

  /**
   * Load the full polygon for a specific heap.
   * Uses localStorage cache + server delta strategy.
   * Falls back to last cached data (or []) on network failure.
   */
  static async load(heapId: string): Promise<Vertex[]> {
    const cache = loadCache(heapId);
    const version = cache?.version ?? 0;

    try {
      const res = await fetch(`${SERVER_URL}/heaps/${heapId}?version=${version}`);
      if (!res.ok) throw new Error(`heap fetch failed: ${res.status}`);
      const data = (await res.json()) as GetHeapResponse;

      if (!data.changed && cache) {
        return reconstructPolygonFromPoints(await buildPolygon(heapId, cache));
      }

      if (data.changed) {
        const newCache: HeapCache = {
          version: data.version,
          baseId: data.baseId,
          liveZone: data.liveZone,
        };
        saveCache(heapId, newCache);
        return reconstructPolygonFromPoints(await buildPolygon(heapId, newCache));
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
   */
  static async append(heapId: string, x: number, y: number): Promise<void> {
    try {
      const res = await fetch(`${SERVER_URL}/heaps/${heapId}/place`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x, y }),
      });
      if (!res.ok) return;
      // Do NOT update the cache version here. The client doesn't hold the
      // server's new data yet — load() must fetch it with the current version
      // so the server responds with the real liveZone.
      await res.json();
    } catch {
      // Silently drop — game never depends on server for local progression
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

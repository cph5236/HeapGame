import type {
  GetHeapResponse,
  GetHashesResponse,
  AppendHeapRequest,
  AppendHeapResponse,
  Vertex,
} from '../../shared/heapTypes';

const SERVER_URL: string =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_HEAP_SERVER_URL ??
  'http://localhost:8787';

const CACHE_PREFIX = 'heap_cache_';       // + heapId
const BASE_CACHE_PREFIX = 'heap_base_';  // + baseHash (content-addressed, unchanged)

interface HeapCache {
  version: number;
  baseHash: string;
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

function loadCachedBase(hash: string): Vertex[] | null {
  try {
    const raw = localStorage.getItem(BASE_CACHE_PREFIX + hash);
    return raw ? (JSON.parse(raw) as Vertex[]) : null;
  } catch {
    return null;
  }
}

function saveCachedBase(hash: string, vertices: Vertex[]): void {
  localStorage.setItem(BASE_CACHE_PREFIX + hash, JSON.stringify(vertices));
}

async function fetchBase(hash: string): Promise<Vertex[]> {
  const cached = loadCachedBase(hash);
  if (cached) return cached;
  const res = await fetch(`${SERVER_URL}/heap/base/${hash}`);
  if (!res.ok) throw new Error(`base fetch failed: ${res.status}`);
  const vertices = (await res.json()) as Vertex[];
  saveCachedBase(hash, vertices);
  return vertices;
}

async function buildPolygon(cache: HeapCache): Promise<Vertex[]> {
  if (!cache.baseHash) return cache.liveZone;
  const base = await fetchBase(cache.baseHash);
  return [...base, ...cache.liveZone];
}

export class HeapClient {
  /**
   * Fetch all heap IDs from the server.
   * Returns [] on network failure.
   */
  static async getHashes(): Promise<string[]> {
    try {
      const res = await fetch(`${SERVER_URL}/heap/hashes`);
      if (!res.ok) return [];
      const data = (await res.json()) as GetHashesResponse;
      return data.hashes;
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
      const res = await fetch(`${SERVER_URL}/heap/${heapId}?version=${version}`);
      if (!res.ok) throw new Error(`heap fetch failed: ${res.status}`);
      const data = (await res.json()) as GetHeapResponse;

      if (!data.changed && cache) {
        return buildPolygon(cache);
      }

      if (data.changed) {
        const newCache: HeapCache = {
          version: data.version,
          baseHash: data.baseHash,
          liveZone: data.liveZone,
        };
        saveCache(heapId, newCache);
        return buildPolygon(newCache);
      }

      return [];
    } catch {
      if (cache) {
        try {
          return await buildPolygon(cache);
        } catch {
          return cache.liveZone;
        }
      }
      return [];
    }
  }

  /**
   * Fire-and-forget block placement for a specific heap.
   * Called after the player summits. Never throws or blocks gameplay.
   */
  static async append(heapId: string, x: number, y: number): Promise<void> {
    const cache = loadCache(heapId);
    try {
      const body: AppendHeapRequest = { hash: heapId, x, y };
      const res = await fetch(`${SERVER_URL}/heap/place`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return;
      const data = (await res.json()) as AppendHeapResponse;
      if (data.accepted && cache) {
        saveCache(heapId, { ...cache, version: data.version });
      }
    } catch {
      // Silently drop — game never depends on server for local progression
    }
  }
}

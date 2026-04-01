import type {
  GetHeapResponse,
  AppendHeapRequest,
  AppendHeapResponse,
  Vertex,
} from '../../shared/heapTypes';

const SERVER_URL: string =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_HEAP_SERVER_URL ??
  'http://localhost:8787';

const CACHE_KEY = 'heap_cache';
const BASE_CACHE_PREFIX = 'heap_base_';

interface HeapCache {
  version: number;
  baseHash: string;
  liveZone: Vertex[];
}

function loadCache(): HeapCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as HeapCache) : null;
  } catch {
    return null;
  }
}

function saveCache(cache: HeapCache): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
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
   * Load the full heap polygon.
   * Uses localStorage cache + server delta strategy.
   * Falls back to last cached data (or empty array) on network failure.
   */
  static async load(): Promise<Vertex[]> {
    const cache = loadCache();
    const version = cache?.version ?? 0;

    try {
      const res = await fetch(`${SERVER_URL}/heap?version=${version}`);
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
        saveCache(newCache);
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
   * Fire-and-forget block placement.
   * Called after the player summits. Never throws or blocks gameplay.
   */
  static async append(x: number, y: number): Promise<void> {
    const cache = loadCache();
    try {
      const body: AppendHeapRequest = { x, y };
      const res = await fetch(`${SERVER_URL}/heap/place`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return;
      const data = (await res.json()) as AppendHeapResponse;
      if (data.accepted && cache) {
        saveCache({ ...cache, version: data.version });
      }
    } catch {
      // Silently drop — game never depends on server for local progression
    }
  }
}

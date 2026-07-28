import type {
  GetHeapResponse,
  HeapEnemyParams,
  ListHeapsResponse,
  PlaceRequest,
  PlaceResponse,
  Vertex,
} from '../../shared/heapTypes';
import {
  BAND_SIZE_PX,
  bandsToWire,
  envelopeToRows,
  envelopeToVertices,
  mergeBands,
  wireToBands,
  type BandEnvelope,
} from '../../shared/heapPolygon/bandEnvelope';
import { reconstructPolygonFromPoints } from './HeapPolygonLoader';
import { fetchWithLog } from '../logging/fetchWithLog';
import { authHeaders, logIfAuthRejected } from './authToken';

const SERVER_URL: string =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_HEAP_SERVER_URL ??
  'http://localhost:8787';

const CACHE_PREFIX = 'heap_cache_';      // + heapId
const BASE_CACHE_PREFIX = 'heap_base_'; // + baseId (GUID, changes on freeze)

/** Bumped when the cache's stored shape changes. Anything without shape 2 is
 * discarded as cold rather than misread — installed players carry the old
 * `{ liveZone: Vertex[] }` shape in localStorage right now. */
const CACHE_SHAPE = 2;

interface HeapCache {
  shape: 2;
  version: number;
  baseId: string;
  /** Flat [band, minX, maxX, ...] triples — the whole known envelope. */
  bands: number[];
  enemyParams?: HeapEnemyParams;
}

function loadCache(heapId: string): HeapCache | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + heapId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HeapCache>;
    // Old caches (shape 1, `liveZone`-based) and anything malformed are cold —
    // discard and let the caller refetch with version=0 and no baseId.
    if (parsed.shape !== CACHE_SHAPE || !Array.isArray(parsed.bands)) return null;
    return parsed as HeapCache;
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

/** Decode a cache/wire's flat band triples into an envelope. */
function bandsToEnvelope(bands: number[]): BandEnvelope {
  return mergeBands(new Map(), wireToBands(bands));
}

async function buildPolygon(heapId: string, cache: HeapCache): Promise<Vertex[]> {
  const liveVertices = envelopeToVertices(bandsToEnvelope(cache.bands));
  if (!cache.baseId) return liveVertices;
  const base = await fetchBase(heapId, cache.baseId);
  return [...base, ...liveVertices];
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
   * Uses localStorage cache + server delta strategy: a warm cache echoes both
   * `version` and `baseId` so the server may respond with `mode: 'delta'`
   * (only bands changed since that version) instead of `mode: 'full'`.
   * Falls back to last cached data (or []) on network failure.
   *
   * Exposed as both an instance and a static method — the static form is the
   * stable call site used across the game (BootScene, GameScene, …); the
   * instance form exists for tests that construct a client directly. Both run
   * the same logic; HeapClient carries no per-instance state.
   */
  async load(heapId: string, _retry = false): Promise<Vertex[]> {
    const cache = loadCache(heapId);
    const query = cache
      ? `version=${cache.version}&baseId=${encodeURIComponent(cache.baseId)}`
      : `version=0`;

    try {
      const res = await fetchWithLog(`${SERVER_URL}/heaps/${heapId}?${query}`);
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
          // baseId + bands from server.
          console.warn(
            `[HeapClient] Heap ${heapId} cache healed: server reported changed=false (v${cache.version}) but base ${cache.baseId} could not be loaded (${(err as Error)?.message ?? err}). Clearing cache and retrying with version=0.`,
          );
          clearCache(heapId);
          if (!_retry) return this.load(heapId, true);
          throw new Error('base fetch failed after cache reset');
        }
      }

      if (data.changed && data.mode === 'full') {
        // Fetch base BEFORE saving cache, so we never persist a cache pointing
        // at a baseId we couldn't actually retrieve.
        const base = await fetchBase(heapId, data.baseId);
        const newCache: HeapCache = {
          shape: CACHE_SHAPE,
          version: data.version,
          baseId: data.baseId,
          bands: data.bands,
          enemyParams: data.enemyParams,
        };
        saveCache(heapId, newCache);
        return reconstructPolygonFromPoints([...base, ...envelopeToVertices(bandsToEnvelope(data.bands))]);
      }

      if (data.changed && data.mode === 'delta') {
        if (!cache) {
          // A delta with NO cache at all has nothing to merge into — rendering
          // it would otherwise silently produce an empty polygon (a blank heap
          // with no error). This is a safety net, not a real scenario we expect
          // to hit: a cache-less client never sends `baseId`, so the server's
          // own sameGeneration check should never route it to the delta
          // branch. If it somehow does, self-heal by forcing a full refetch
          // rather than rendering nothing. Note an EMPTY-but-present band
          // cache (`bands: []`, e.g. a freshly created heap's first update) is
          // NOT this case — mergeBands handles an empty envelope fine, so that
          // merges normally below instead of paying this extra round-trip.
          console.warn(
            `[HeapClient] Heap ${heapId} received mode:'delta' with no cache to merge into. Clearing cache and retrying with version=0.`,
          );
          clearCache(heapId);
          if (!_retry) return this.load(heapId, true);
          return [];
        }
        const mergedEnv = mergeBands(bandsToEnvelope(cache.bands), wireToBands(data.bands));
        const base = await fetchBase(heapId, data.baseId);
        const newCache: HeapCache = {
          shape: CACHE_SHAPE,
          version: data.version,
          baseId: data.baseId,
          bands: bandsToWire(envelopeToRows(mergedEnv)),
          enemyParams: data.enemyParams,
        };
        saveCache(heapId, newCache);
        return reconstructPolygonFromPoints([...base, ...envelopeToVertices(mergedEnv)]);
      }

      return [];
    } catch {
      if (cache) {
        try {
          return reconstructPolygonFromPoints(await buildPolygon(heapId, cache));
        } catch {
          return reconstructPolygonFromPoints(envelopeToVertices(bandsToEnvelope(cache.bands)));
        }
      }
      return [];
    }
  }

  static async load(heapId: string, _retry = false): Promise<Vertex[]> {
    return new HeapClient().load(heapId, _retry);
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
      // so the server responds with the real bands.
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
      const cache = loadCache(heapId) ?? { shape: CACHE_SHAPE, version: 0, baseId: '', bands: [] };
      saveCache(heapId, { ...cache, enemyParams });
    } catch {
      // silent — caller falls back to DEFAULT_ENEMY_PARAMS
    }
  }

  /**
   * Returns the maximum Y value (freeze line) implied by the cached bands for
   * a heap — i.e. the bottom edge of the highest-numbered known band.
   * Returns null if the cache is absent or holds no bands.
   */
  static getLiveZoneBottomY(heapId: string): number | null {
    const cache = loadCache(heapId);
    if (!cache || cache.bands.length === 0) return null;
    const rows = wireToBands(cache.bands);
    let maxBand = -Infinity;
    for (const row of rows) {
      if (row.band > maxBand) maxBand = row.band;
    }
    if (maxBand === -Infinity) return null;
    return (maxBand + 1) * BAND_SIZE_PX;
  }
}

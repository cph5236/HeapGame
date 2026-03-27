import { HeapEntry } from '../data/heapTypes';
import { ChunkPolygon, VertexDelta } from '../data/heapPolygonTypes';

const LOCAL_KEY = 'heap_additions';
const API_URL   = import.meta.env.VITE_HEAP_API_URL as string | undefined;

// ── Server mode: pre-fetch at module load so data is ready by GameScene.create() ──
let _serverCache: HeapEntry[] = [];

if (API_URL) {
  fetch(`${API_URL}/heap/additions`)
    .then(r => r.json())
    .then((data: HeapEntry[]) => { _serverCache = data; })
    .catch(() => { /* stay empty on error */ });
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Returns all player-placed entries (localStorage or server cache). */
export function loadHeapAdditions(): HeapEntry[] {
  if (API_URL) return _serverCache;
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as HeapEntry[]) : [];
  } catch {
    return [];
  }
}

/** Persist one player-placed entry (localStorage or fire-and-forget POST). */
export function persistHeapEntry(entry: HeapEntry): void {
  if (API_URL) {
    fetch(`${API_URL}/heap/entry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    }).catch(() => {});
    _serverCache.push(entry); // optimistic local update
    return;
  }
  const current = loadHeapAdditions();
  current.push(entry);
  localStorage.setItem(LOCAL_KEY, JSON.stringify(current));
}

/** Clear all persisted additions (debug / reset). */
export function clearHeapAdditions(): void {
  if (API_URL) { _serverCache = []; return; }
  localStorage.removeItem(LOCAL_KEY);
}

// ── Polygon streaming (server-connected mode only) ────────────────────────────

/**
 * Fetch pre-computed band polygons for a Y range from the server.
 * Returns empty array if no API is configured or the request fails.
 */
export async function fetchBandPolygons(fromY: number, toY: number): Promise<ChunkPolygon[]> {
  if (!API_URL) return [];
  try {
    const r = await fetch(`${API_URL}/heap/polygons?from=${fromY}&to=${toY}`);
    return (await r.json()) as ChunkPolygon[];
  } catch {
    return [];
  }
}

/**
 * Push a vertex delta to the server (fire-and-forget).
 * Called when the client recomputes a band polygon after a local block placement.
 */
export function pushVertexDelta(delta: VertexDelta): void {
  if (!API_URL) return;
  fetch(`${API_URL}/heap/polygon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(delta),
  }).catch(() => {});
}

/**
 * Poll for polygon updates from other players since a given timestamp.
 * Returns empty array if no API is configured or the request fails.
 */
export async function pollPolygonUpdates(sinceMs: number): Promise<VertexDelta[]> {
  if (!API_URL) return [];
  try {
    const r = await fetch(`${API_URL}/heap/updates?since=${sinceMs}`);
    return (await r.json()) as VertexDelta[];
  } catch {
    return [];
  }
}

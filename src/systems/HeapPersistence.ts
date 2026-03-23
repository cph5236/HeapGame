import { HeapEntry } from '../data/heapTypes';

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

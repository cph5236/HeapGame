import type { LogEntry } from '../../shared/logging/Logger';

const LOG_URL = (() => {
  // Same origin as HeapClient — for Capacitor builds this is the worker URL.
  // Fall back to `/log` for web origins.
  const apiBase = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';
  return `${apiBase}/log`;
})();

/** Best-effort POST. Returns true if a send was attempted; never throws. */
export function defaultTransport(entries: LogEntry[]): boolean {
  try {
    const body = JSON.stringify({ entries });
    const blob = new Blob([body], { type: 'application/json' });
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      // sendBeacon ignores custom headers; the Blob's `type` becomes Content-Type.
      navigator.sendBeacon(LOG_URL, blob);
      return true;
    }
    // Fallback: keepalive fetch (survives unload up to 64KB).
    fetch(LOG_URL, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
    }).catch(() => { /* swallow */ });
    return true;
  } catch {
    return false;
  }
}

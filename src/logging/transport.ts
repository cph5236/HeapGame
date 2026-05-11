import type { LogEntry } from '../../shared/logging/Logger';

const LOG_URL = (() => {
  const serverUrl =
    (import.meta as unknown as { env: Record<string, string> }).env.VITE_HEAP_SERVER_URL ??
    'http://localhost:8787';
  return `${serverUrl}/log`;
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

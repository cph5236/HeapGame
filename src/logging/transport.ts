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
    // keepalive fetch survives page unload (same benefit as sendBeacon) without
    // forcing credentials mode, which avoids the CORS Allow-Credentials requirement.
    fetch(LOG_URL, {
      method: 'POST',
      body: JSON.stringify({ entries }),
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
    }).catch(() => { /* swallow */ });
    return true;
  } catch {
    return false;
  }
}

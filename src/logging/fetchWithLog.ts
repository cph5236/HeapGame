import { getLogger } from './index';

const SLOW_FETCH_MS = 3000;

export async function fetchWithLog(url: string, init?: RequestInit): Promise<Response> {
  const started = performance.now();
  let res: Response | null = null;
  try {
    res = init ? await fetch(url, init) : await fetch(url);
  } catch (err) {
    const durationMs = Math.round(performance.now() - started);
    getLogger().error('fetch failed', {
      url, durationMs,
      stack: err instanceof Error ? err.stack : undefined,
      reason: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
  const durationMs = Math.round(performance.now() - started);
  if (!res.ok) {
    let bodySnippet = '';
    try { bodySnippet = (await res.clone().text()).slice(0, 256); } catch { /* swallow */ }
    if (res.status >= 500) {
      getLogger().error('fetch 5xx', { url, status: res.status, durationMs, bodySnippet });
    } else if (res.status >= 400) {
      getLogger().warn('fetch 4xx', { url, status: res.status, durationMs, bodySnippet });
    }
  } else if (durationMs > SLOW_FETCH_MS) {
    getLogger().warn('fetch slow', { url, status: res.status, durationMs });
  }
  return res;
}

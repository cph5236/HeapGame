// src/systems/ConfigClient.ts

import { fetchWithLog } from '../logging/fetchWithLog';
import type { GetConfigResponse, AppConfig } from '../../shared/configTypes';

const SERVER_URL: string =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_HEAP_SERVER_URL ??
  'http://localhost:8787';

let cached: AppConfig | null = null;

/**
 * Fire-and-forget fetch of the global config map. Never throws — on failure
 * `cached` stays null and getConfigValue() returns undefined for every key,
 * so callers fall back to their own hardcoded defaults.
 */
export function primeConfig(): void {
  fetchWithLog(`${SERVER_URL}/config`)
    .then((res) => (res.ok ? (res.json() as Promise<GetConfigResponse>) : null))
    .then((body) => { cached = body?.config ?? null; })
    .catch(() => { /* cached stays null */ });
}

export function getConfigValue<T>(key: string): T | undefined {
  return cached?.[key] as T | undefined;
}

/** Test-only: reset the in-memory cache between tests. */
export function resetConfigCacheForTests(): void {
  cached = null;
}

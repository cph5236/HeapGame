// src/systems/ConfigClient.ts

import { fetchWithLog } from '../logging/fetchWithLog';
import { getStoredRemoteConfig, setStoredRemoteConfig } from './SaveData';
import { CONFIG_FETCH_TIMEOUT_MS } from '../constants';
import type { GetConfigResponse, AppConfig } from '../../shared/configTypes';

const SERVER_URL: string =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_HEAP_SERVER_URL ??
  'http://localhost:8787';

let cached: AppConfig | null = null;
let primePromise: Promise<void> | null = null;

/**
 * Fetch the global config map once at boot. Resolution order for each key:
 *   fresh fetch (this launch) → last-known-good persisted in SaveData → the
 *   caller's own hardcoded default (getConfigValue returns undefined).
 *
 * The cache is warmed synchronously from SaveData before the network call, so
 * getConfigValue() returns real values immediately and an offline launch keeps
 * whatever was last pushed instead of snapping back to compiled-in defaults.
 * The fetch is bounded by CONFIG_FETCH_TIMEOUT_MS via AbortController. Never
 * throws; idempotent (a second call returns the same in-flight promise).
 */
export function primeConfig(): Promise<void> {
  if (primePromise) return primePromise;
  primePromise = (async () => {
    // Warm from last-known-good before hitting the network.
    if (!cached) cached = getStoredRemoteConfig() ?? null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG_FETCH_TIMEOUT_MS);
    try {
      const res = await fetchWithLog(`${SERVER_URL}/config`, { signal: controller.signal });
      if (res.ok) {
        const body = (await res.json()) as GetConfigResponse;
        if (body?.config) {
          cached = body.config;
          setStoredRemoteConfig(body.config); // persist + ride the cloud save
        }
      }
    } catch {
      /* timeout / offline / abort — keep the warmed last-known-good */
    } finally {
      clearTimeout(timer);
    }
  })();
  return primePromise;
}

/**
 * Resolves when the boot-time config fetch has settled — success, failure, or
 * the CONFIG_FETCH_TIMEOUT_MS ceiling. The LoadingScene awaits this (concurrent
 * with asset loading) so the menu opens with remote values in hand. Never
 * rejects; resolves immediately if primeConfig() was never called.
 */
export function configReady(): Promise<void> {
  return primePromise ?? Promise.resolve();
}

export function getConfigValue<T>(key: string): T | undefined {
  return cached?.[key] as T | undefined;
}

/** Test-only: reset the in-memory cache and in-flight promise between tests. */
export function resetConfigCacheForTests(): void {
  cached = null;
  primePromise = null;
}

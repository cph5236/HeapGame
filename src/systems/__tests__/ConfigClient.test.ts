import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchWithLog = vi.fn();
vi.mock('../../logging/fetchWithLog', () => ({
  fetchWithLog: (...args: unknown[]) => fetchWithLog(...args),
}));

// SaveData touches localStorage (vitest runs in node); mock the two cache
// accessors so ConfigClient stays a pure unit under test.
const getStoredRemoteConfig = vi.fn();
const setStoredRemoteConfig = vi.fn();
vi.mock('../SaveData', () => ({
  getStoredRemoteConfig: () => getStoredRemoteConfig(),
  setStoredRemoteConfig: (c: unknown) => setStoredRemoteConfig(c),
}));

import { primeConfig, configReady, getConfigValue, resetConfigCacheForTests } from '../ConfigClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('ConfigClient', () => {
  beforeEach(() => {
    fetchWithLog.mockReset();
    getStoredRemoteConfig.mockReset().mockReturnValue(undefined);
    setStoredRemoteConfig.mockReset();
    resetConfigCacheForTests();
  });

  it('getConfigValue returns undefined before primeConfig runs', () => {
    expect(getConfigValue('ad_cadence')).toBeUndefined();
  });

  it('populates and persists the cache on a successful fetch', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, { config: { ad_cadence: { min: 10, max: 20 } } }));
    await primeConfig();
    expect(getConfigValue('ad_cadence')).toEqual({ min: 10, max: 20 });
    // Persisted so it rides the cloud save and warms the next launch.
    expect(setStoredRemoteConfig).toHaveBeenCalledWith({ ad_cadence: { min: 10, max: 20 } });
  });

  it('warms the cache from last-known-good before the fetch resolves', () => {
    getStoredRemoteConfig.mockReturnValue({ ad_cadence: { min: 3, max: 7 } });
    fetchWithLog.mockReturnValue(new Promise(() => { /* never resolves */ }));
    primeConfig();
    // Synchronous read: the stored value is available immediately.
    expect(getConfigValue('ad_cadence')).toEqual({ min: 3, max: 7 });
  });

  it('keeps last-known-good and does not persist when the fetch fails', async () => {
    getStoredRemoteConfig.mockReturnValue({ ad_cadence: { min: 3, max: 7 } });
    fetchWithLog.mockRejectedValue(new Error('offline'));
    await primeConfig();
    expect(getConfigValue('ad_cadence')).toEqual({ min: 3, max: 7 });
    expect(setStoredRemoteConfig).not.toHaveBeenCalled();
  });

  it('aborts the fetch when it exceeds the timeout ceiling', async () => {
    vi.useFakeTimers();
    try {
      let abortedSignal: AbortSignal | undefined;
      fetchWithLog.mockImplementation((_url: string, init?: RequestInit) => {
        abortedSignal = init?.signal ?? undefined;
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      });
      const p = primeConfig();
      await vi.advanceTimersByTimeAsync(10_000);
      await p; // never rejects — timeout is swallowed
      expect(abortedSignal?.aborted).toBe(true);
      expect(setStoredRemoteConfig).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves the cache empty on a non-ok response', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(500, { error: 'boom' }));
    await primeConfig();
    expect(getConfigValue('ad_cadence')).toBeUndefined();
    expect(setStoredRemoteConfig).not.toHaveBeenCalled();
  });

  it('is idempotent — a second call reuses the in-flight promise', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, { config: { ad_cadence: { min: 1, max: 2 } } }));
    const a = primeConfig();
    const b = primeConfig();
    expect(a).toBe(b);
    await Promise.all([a, b]);
    expect(fetchWithLog).toHaveBeenCalledTimes(1);
  });

  it('configReady resolves without a fetch when primeConfig was never called', async () => {
    await expect(configReady()).resolves.toBeUndefined();
    expect(fetchWithLog).not.toHaveBeenCalled();
  });

  it('configReady resolves after the boot fetch settles', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, { config: {} }));
    primeConfig();
    await expect(configReady()).resolves.toBeUndefined();
  });
});

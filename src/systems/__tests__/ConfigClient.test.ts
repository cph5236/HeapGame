import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchWithLog = vi.fn();
vi.mock('../../logging/fetchWithLog', () => ({
  fetchWithLog: (...args: unknown[]) => fetchWithLog(...args),
}));

import { primeConfig, getConfigValue, resetConfigCacheForTests } from '../ConfigClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// primeConfig() is fire-and-forget; flush microtasks so its promise chain settles.
async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('ConfigClient', () => {
  beforeEach(() => {
    fetchWithLog.mockReset();
    resetConfigCacheForTests();
  });

  it('getConfigValue returns undefined before primeConfig resolves', () => {
    expect(getConfigValue('ad_cadence')).toBeUndefined();
  });

  it('primeConfig populates the cache on a successful fetch', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, { config: { ad_cadence: { min: 10, max: 20 } } }));
    primeConfig();
    await flush();
    expect(getConfigValue('ad_cadence')).toEqual({ min: 10, max: 20 });
  });

  it('getConfigValue returns undefined for a key not present in the fetched config', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, { config: {} }));
    primeConfig();
    await flush();
    expect(getConfigValue('ad_cadence')).toBeUndefined();
  });

  it('leaves the cache empty on a non-ok response', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(500, { error: 'boom' }));
    primeConfig();
    await flush();
    expect(getConfigValue('ad_cadence')).toBeUndefined();
  });

  it('leaves the cache empty on a network throw', async () => {
    fetchWithLog.mockRejectedValue(new Error('offline'));
    primeConfig();
    await flush();
    expect(getConfigValue('ad_cadence')).toBeUndefined();
  });
});

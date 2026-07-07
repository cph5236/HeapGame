import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock SaveData and fetchWithLog before importing the module under test.
const getEquippedCosmetics = vi.fn();
const getPlayerGuid = vi.fn();
const getLoadoutSyncPending = vi.fn();
const setLoadoutSyncPending = vi.fn();
const resetAllData = vi.fn();
const resetCacheForTests = vi.fn();

vi.mock('../SaveData', () => ({
  getEquippedCosmetics: () => getEquippedCosmetics(),
  getPlayerGuid: () => getPlayerGuid(),
  getLoadoutSyncPending: () => getLoadoutSyncPending(),
  setLoadoutSyncPending: (v: boolean) => setLoadoutSyncPending(v),
  resetAllData: () => resetAllData(),
  resetCacheForTests: () => resetCacheForTests(),
}));

const fetchWithLog = vi.fn();
vi.mock('../../logging/fetchWithLog', () => ({
  fetchWithLog: (url: string, init?: Record<string, unknown>) => fetchWithLog(url, init),
}));

import { syncLoadoutNow } from '../cosmeticsSync';

beforeEach(() => {
  resetAllData();
  resetCacheForTests();
  getEquippedCosmetics.mockReturnValue({ tie: 'tie_blue' });
  getPlayerGuid.mockReturnValue('guid-test');
  getLoadoutSyncPending.mockReturnValue(false);
  setLoadoutSyncPending.mockClear();
  fetchWithLog.mockClear();
});

afterEach(() => vi.unstubAllGlobals());

describe('syncLoadoutNow', () => {
  it('PUTs the equipped loadout and clears the pending flag on success', async () => {
    fetchWithLog.mockResolvedValue({ ok: true });

    const ok = await syncLoadoutNow();

    expect(ok).toBe(true);
    expect(setLoadoutSyncPending).toHaveBeenCalledWith(false);
    expect(fetchWithLog).toHaveBeenCalledTimes(1);
    const [url, init] = fetchWithLog.mock.calls[0];
    expect(String(url)).toContain('/customization/');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body).loadout).toEqual({ tie: 'tie_blue' });
  });

  it('sets the pending flag when the server is unreachable', async () => {
    fetchWithLog.mockRejectedValue(new Error('offline'));

    const ok = await syncLoadoutNow();

    expect(ok).toBe(false);
    expect(setLoadoutSyncPending).toHaveBeenCalledWith(true);
  });

  it('sets the pending flag on a non-OK response', async () => {
    fetchWithLog.mockResolvedValue({ ok: false, status: 400 });

    const ok = await syncLoadoutNow();

    expect(ok).toBe(false);
    expect(setLoadoutSyncPending).toHaveBeenCalledWith(true);
  });
});

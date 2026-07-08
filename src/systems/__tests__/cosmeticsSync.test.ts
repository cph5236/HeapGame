import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock SaveData and fetchWithLog before importing the module under test.
const getEquippedCosmetics = vi.fn();
const getPlayerGuid = vi.fn();
const getEffectivePlayerId = vi.fn();
const getLoadoutSyncPending = vi.fn();
const setLoadoutSyncPending = vi.fn();
const resetAllData = vi.fn();
const resetCacheForTests = vi.fn();

vi.mock('../SaveData', () => ({
  getEquippedCosmetics: () => getEquippedCosmetics(),
  getPlayerGuid: () => getPlayerGuid(),
  getEffectivePlayerId: () => getEffectivePlayerId(),
  getLoadoutSyncPending: () => getLoadoutSyncPending(),
  setLoadoutSyncPending: (v: boolean) => setLoadoutSyncPending(v),
  resetAllData: () => resetAllData(),
  resetCacheForTests: () => resetCacheForTests(),
  // putLoadout now attaches X-Player-Token via authHeaders() → getPlayerSecret().
  getPlayerSecret: () => 'test-secret',
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
  getEffectivePlayerId.mockReturnValue('gpgs-effective');
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

  it('PUTs under the effective player id (GPGS id when signed in), not the local GUID', async () => {
    fetchWithLog.mockResolvedValue({ ok: true });

    await syncLoadoutNow();

    const [url] = fetchWithLog.mock.calls[0];
    expect(String(url)).toContain('/customization/gpgs-effective');
    expect(String(url)).not.toContain('guid-test');
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

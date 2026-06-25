import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSaveSnapshot = vi.fn();

vi.mock('../PlayGamesClient', () => ({
  PlayGamesClient: { saveSnapshot: mockSaveSnapshot },
}));

vi.mock('../SaveData', () => ({
  getRawSaveForCloudSync: () => ({ balance: 42, upgrades: { air_jump: 1 } }),
}));

const { syncSaveToCloud } = await import('../cloudSave');

describe('syncSaveToCloud', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pushes the serialized local save to the cloud snapshot', () => {
    syncSaveToCloud();

    expect(mockSaveSnapshot).toHaveBeenCalledTimes(1);
    const arg = mockSaveSnapshot.mock.calls[0][0];
    expect(JSON.parse(arg)).toEqual({ balance: 42, upgrades: { air_jump: 1 } });
  });
});

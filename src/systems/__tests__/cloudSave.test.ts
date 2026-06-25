import { describe, it, expect, vi, beforeEach } from 'vitest';

// A controllable saveSnapshot: each call returns a promise we resolve manually,
// so tests can interleave new syncs while a write is "in flight".
let resolvers: Array<() => void> = [];
const mockSaveSnapshot = vi.fn((_data: string) => new Promise<void>((resolve) => {
  resolvers.push(resolve);
}));

// Mutable local save so we can assert the queue always sends the latest state.
let currentSave: Record<string, unknown> = { balance: 0 };

vi.mock('../PlayGamesClient', () => ({
  PlayGamesClient: { saveSnapshot: mockSaveSnapshot },
}));

vi.mock('../SaveData', () => ({
  getRawSaveForCloudSync: () => currentSave,
}));

const { syncSaveToCloud, resetCloudSyncForTests } = await import('../cloudSave');

/** Flush microtasks so awaited continuations in runSync() run. */
const tick = () => Promise.resolve();

describe('syncSaveToCloud', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvers = [];
    currentSave = { balance: 0 };
    resetCloudSyncForTests();
  });

  it('pushes the serialized local save to the cloud snapshot', async () => {
    currentSave = { balance: 42, upgrades: { air_jump: 1 } };
    syncSaveToCloud();

    expect(mockSaveSnapshot).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockSaveSnapshot.mock.calls[0][0])).toEqual(currentSave);
  });

  it('does not start a second write while one is in flight', async () => {
    currentSave = { balance: 100 };
    syncSaveToCloud(); // starts write #1 (in flight, unresolved)

    currentSave = { balance: 80 };
    syncSaveToCloud(); // should NOT start a concurrent write
    currentSave = { balance: 60 };
    syncSaveToCloud();

    expect(mockSaveSnapshot).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst into one follow-up write carrying the latest state', async () => {
    currentSave = { balance: 100 };
    syncSaveToCloud(); // write #1 sends balance 100

    // Two more purchases land while #1 is in flight.
    currentSave = { balance: 80 };
    syncSaveToCloud();
    currentSave = { balance: 60 };
    syncSaveToCloud();

    expect(mockSaveSnapshot).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockSaveSnapshot.mock.calls[0][0]).balance).toBe(100);

    // Resolve write #1 → the runner loops once more with the freshest state.
    resolvers[0]();
    await tick();
    await tick();

    // Exactly one follow-up write, carrying the LATEST balance (60), not 80.
    expect(mockSaveSnapshot).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mockSaveSnapshot.mock.calls[1][0]).balance).toBe(60);

    // Resolve the follow-up; no further writes (no changes since).
    resolvers[1]();
    await tick();
    await tick();
    expect(mockSaveSnapshot).toHaveBeenCalledTimes(2);
  });

  it('allows a fresh write after the queue drains', async () => {
    currentSave = { balance: 100 };
    syncSaveToCloud();
    resolvers[0]();
    await tick();
    await tick();

    currentSave = { balance: 50 };
    syncSaveToCloud();
    expect(mockSaveSnapshot).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mockSaveSnapshot.mock.calls[1][0]).balance).toBe(50);
  });
});

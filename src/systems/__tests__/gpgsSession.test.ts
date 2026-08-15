import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const mockPlugin = {
  signIn:                vi.fn(),
  unlockAchievement:     vi.fn(),
  incrementAchievement:  vi.fn(),
  submitScore:           vi.fn(),
  showPlayerProfile:     vi.fn(),
  saveSnapshot:          vi.fn(),
  loadSnapshot:          vi.fn(),
};

const mockGetPlatform = vi.fn();

vi.mock('@capacitor/core', () => ({
  registerPlugin: vi.fn(() => mockPlugin),
  Capacitor:      { getPlatform: mockGetPlatform },
}));

// Import after mocks are set up — PlayGamesClient binds the plugin at module load.
const { beginSignIn, signInSettled, resetSignInForTests } = await import('../gpgsSession');
const { GPGS_SIGNIN_TIMEOUT_MS } = await import('../../constants');
const {
  getGpgsPlayerId, getEffectivePlayerId, getPlayerGuid, getPlayerName,
  resetAllData, resetCacheForTests,
} = await import('../SaveData');

// Stub localStorage — vitest runs in node environment
const store: Record<string, string> = {};
beforeAll(() => {
  Object.defineProperty(global, 'localStorage', {
    value: {
      getItem:    (k: string) => store[k] ?? null,
      setItem:    (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear:      () => { Object.keys(store).forEach(k => delete store[k]); },
    },
    configurable: true,
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(store).forEach(k => delete store[k]);
  resetCacheForTests();
  resetAllData();
  resetSignInForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('gpgsSession', () => {
  it('adopts the GPGS id and name when sign-in succeeds', async () => {
    mockGetPlatform.mockReturnValue('android');
    mockPlugin.signIn.mockResolvedValue({ playerId: 'gpgs-abc', displayName: 'Connor' });

    beginSignIn();
    const player = await signInSettled();

    expect(player).toEqual({ playerId: 'gpgs-abc', displayName: 'Connor' });
    expect(getGpgsPlayerId()).toBe('gpgs-abc');
    expect(getEffectivePlayerId()).toBe('gpgs-abc');
    expect(getPlayerName()).toBe('Connor');
  });

  it('resolves null and keeps the GUID when sign-in fails', async () => {
    mockGetPlatform.mockReturnValue('android');
    mockPlugin.signIn.mockRejectedValue(new Error('no network'));

    beginSignIn();
    const player = await signInSettled();

    expect(player).toBeNull();
    expect(getGpgsPlayerId()).toBeNull();
    expect(getEffectivePlayerId()).toBe(getPlayerGuid());
  });

  it('resolves null without waiting when off Android', async () => {
    mockGetPlatform.mockReturnValue('web');

    beginSignIn();
    const player = await signInSettled();

    expect(player).toBeNull();
    expect(mockPlugin.signIn).not.toHaveBeenCalled();
  });

  it('resolves null at the timeout ceiling when sign-in never settles', async () => {
    vi.useFakeTimers();
    mockGetPlatform.mockReturnValue('android');
    mockPlugin.signIn.mockReturnValue(new Promise(() => { /* never settles */ }));

    beginSignIn();
    const settled = signInSettled();
    await vi.advanceTimersByTimeAsync(GPGS_SIGNIN_TIMEOUT_MS);

    await expect(settled).resolves.toBeNull();
  });

  // The whole point of the gate: once the ceiling has passed, the effective
  // player id is final for the app session. A late sign-in must not flip it
  // mid-run and orphan that run's score under the GUID.
  it('never adopts a sign-in that lands after the timeout', async () => {
    vi.useFakeTimers();
    mockGetPlatform.mockReturnValue('android');
    let release!: (p: { playerId: string; displayName: string }) => void;
    mockPlugin.signIn.mockReturnValue(new Promise((r) => { release = r; }));

    beginSignIn();
    await vi.advanceTimersByTimeAsync(GPGS_SIGNIN_TIMEOUT_MS);
    await expect(signInSettled()).resolves.toBeNull();

    release({ playerId: 'gpgs-late', displayName: 'TooLate' });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(getGpgsPlayerId()).toBeNull();
    expect(getEffectivePlayerId()).toBe(getPlayerGuid());
  });

  it('only attempts sign-in once across repeated calls', async () => {
    mockGetPlatform.mockReturnValue('android');
    mockPlugin.signIn.mockResolvedValue({ playerId: 'gpgs-abc', displayName: 'Connor' });

    beginSignIn();
    beginSignIn();
    await signInSettled();

    expect(mockPlugin.signIn).toHaveBeenCalledTimes(1);
  });

  it('resolves null when awaited before sign-in was ever started', async () => {
    await expect(signInSettled()).resolves.toBeNull();
  });
});

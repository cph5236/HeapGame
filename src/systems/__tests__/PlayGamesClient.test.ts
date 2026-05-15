import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPlugin = {
  signIn:                vi.fn(),
  unlockAchievement:     vi.fn(),
  incrementAchievement:  vi.fn(),
  submitScore:           vi.fn(),
  saveSnapshot:          vi.fn(),
  loadSnapshot:          vi.fn(),
};

const mockGetPlatform = vi.fn();

vi.mock('@capacitor/core', () => ({
  registerPlugin: vi.fn(() => mockPlugin),
  Capacitor:      { getPlatform: mockGetPlatform },
}));

// Import after mocks are set up
const { PlayGamesClient } = await import('../PlayGamesClient');

describe('PlayGamesClient.signIn', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns player info when on Android and plugin resolves', async () => {
    mockGetPlatform.mockReturnValue('android');
    mockPlugin.signIn.mockResolvedValue({ playerId: 'gpgs-abc', displayName: 'TestUser' });

    const result = await PlayGamesClient.signIn();

    expect(result).toEqual({ playerId: 'gpgs-abc', displayName: 'TestUser' });
  });

  it('returns null when not on Android', async () => {
    mockGetPlatform.mockReturnValue('web');

    const result = await PlayGamesClient.signIn();

    expect(result).toBeNull();
    expect(mockPlugin.signIn).not.toHaveBeenCalled();
  });

  it('returns null when plugin throws', async () => {
    mockGetPlatform.mockReturnValue('android');
    mockPlugin.signIn.mockRejectedValue(new Error('no network'));

    const result = await PlayGamesClient.signIn();

    expect(result).toBeNull();
  });
});

describe('PlayGamesClient.unlockAchievement', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls plugin with achievementId when on Android', async () => {
    mockGetPlatform.mockReturnValue('android');
    mockPlugin.unlockAchievement.mockResolvedValue(undefined);

    await PlayGamesClient.unlockAchievement('CgkI_test_id');

    expect(mockPlugin.unlockAchievement).toHaveBeenCalledWith({ achievementId: 'CgkI_test_id' });
  });

  it('does nothing when not on Android', async () => {
    mockGetPlatform.mockReturnValue('web');

    await PlayGamesClient.unlockAchievement('CgkI_test_id');

    expect(mockPlugin.unlockAchievement).not.toHaveBeenCalled();
  });

  it('swallows plugin errors silently', async () => {
    mockGetPlatform.mockReturnValue('android');
    mockPlugin.unlockAchievement.mockRejectedValue(new Error('not signed in'));

    await expect(PlayGamesClient.unlockAchievement('CgkI_test_id')).resolves.toBeUndefined();
  });
});

describe('PlayGamesClient.incrementAchievement', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls plugin with achievementId and steps when on Android', async () => {
    mockGetPlatform.mockReturnValue('android');
    mockPlugin.unlockAchievement.mockResolvedValue(undefined);

    await PlayGamesClient.incrementAchievement('CgkI_test_id', 5);

    expect(mockPlugin.incrementAchievement).toHaveBeenCalledWith({ achievementId: 'CgkI_test_id', steps: 5 });
  });

  it('does nothing when not on Android', async () => {
    mockGetPlatform.mockReturnValue('web');

    await PlayGamesClient.incrementAchievement('CgkI_test_id', 1);

    expect(mockPlugin.incrementAchievement).not.toHaveBeenCalled();
  });
});

describe('PlayGamesClient.submitScore', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls plugin with leaderboardId and score when on Android', async () => {
    mockGetPlatform.mockReturnValue('android');
    mockPlugin.submitScore.mockResolvedValue(undefined);

    await PlayGamesClient.submitScore('CgkI_lb_id', 42000);

    expect(mockPlugin.submitScore).toHaveBeenCalledWith({ leaderboardId: 'CgkI_lb_id', score: 42000 });
  });

  it('does nothing when not on Android', async () => {
    mockGetPlatform.mockReturnValue('ios');

    await PlayGamesClient.submitScore('CgkI_lb_id', 42000);

    expect(mockPlugin.submitScore).not.toHaveBeenCalled();
  });
});

describe('PlayGamesClient.saveSnapshot', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls plugin with serialized data when on Android', async () => {
    mockGetPlatform.mockReturnValue('android');
    mockPlugin.saveSnapshot.mockResolvedValue(undefined);

    await PlayGamesClient.saveSnapshot('{"balance":100}');

    expect(mockPlugin.saveSnapshot).toHaveBeenCalledWith({ data: '{"balance":100}' });
  });
});

describe('PlayGamesClient.loadSnapshot', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns data string from plugin on Android', async () => {
    mockGetPlatform.mockReturnValue('android');
    mockPlugin.loadSnapshot.mockResolvedValue({ data: '{"balance":50}' });

    const result = await PlayGamesClient.loadSnapshot();

    expect(result).toBe('{"balance":50}');
  });

  it('returns null when not on Android', async () => {
    mockGetPlatform.mockReturnValue('web');

    const result = await PlayGamesClient.loadSnapshot();

    expect(result).toBeNull();
  });

  it('returns null when plugin returns null data', async () => {
    mockGetPlatform.mockReturnValue('android');
    mockPlugin.loadSnapshot.mockResolvedValue({ data: null });

    const result = await PlayGamesClient.loadSnapshot();

    expect(result).toBeNull();
  });
});

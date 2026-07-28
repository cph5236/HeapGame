import { describe, it, expect, vi, beforeEach } from 'vitest';

const getConfigValue = vi.fn();
const isConfigFresh  = vi.fn();
vi.mock('../ConfigClient', () => ({
  getConfigValue: (k: string) => getConfigValue(k),
  isConfigFresh:  () => isConfigFresh(),
}));

const mockGetPlatform = vi.fn();
vi.mock('@capacitor/core', () => ({
  registerPlugin: vi.fn(),
  Capacitor:      { getPlatform: mockGetPlatform },
}));

const {
  getClientVersion, getMinVersionConfig, shouldConfirmUpdateGate,
  isUpdateRequired, openUpdateDestination, updateActionLabel,
} = await import('../UpdateGate');

/** A floor strictly above whatever version this build reports. */
function floorAbove(): string {
  const [maj, min, patch] = getClientVersion().split('.').map(Number);
  return `${maj}.${min}.${patch + 1}`;
}

describe('UpdateGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConfigValue.mockReturnValue(undefined);
    isConfigFresh.mockReturnValue(true);
    mockGetPlatform.mockReturnValue('web');
  });

  it('reads min_version from remote config', () => {
    getConfigValue.mockReturnValue({ version: '9.0.0', message: 'nope' });
    expect(getMinVersionConfig()).toEqual({ version: '9.0.0', message: 'nope' });
    expect(getConfigValue).toHaveBeenCalledWith('min_version');
  });

  it('returns null config when the value is malformed', () => {
    getConfigValue.mockReturnValue({ version: 'soon' });
    expect(getMinVersionConfig()).toBeNull();
  });

  describe('isUpdateRequired', () => {
    it('blocks when fresh config puts this build below the floor', () => {
      getConfigValue.mockReturnValue({ version: floorAbove() });
      expect(isUpdateRequired()).toBe(true);
    });

    it('does not block at the exact floor', () => {
      getConfigValue.mockReturnValue({ version: getClientVersion() });
      expect(isUpdateRequired()).toBe(false);
    });

    // The core safety property: a stale gate must not strand an offline player,
    // who could not reach the store to update even if we did block them.
    it('does not block on stale last-known-good config', () => {
      getConfigValue.mockReturnValue({ version: floorAbove() });
      isConfigFresh.mockReturnValue(false);
      expect(isUpdateRequired()).toBe(false);
    });

    it('does not block when there is no config at all', () => {
      getConfigValue.mockReturnValue(undefined);
      expect(isUpdateRequired()).toBe(false);
    });

    it('does not block on a malformed floor', () => {
      getConfigValue.mockReturnValue({ version: 'tomorrow' });
      expect(isUpdateRequired()).toBe(false);
    });
  });

  describe('shouldConfirmUpdateGate', () => {
    it('is true for a stale gate, so LoadingScene waits for confirmation', () => {
      getConfigValue.mockReturnValue({ version: floorAbove() });
      isConfigFresh.mockReturnValue(false);
      expect(shouldConfirmUpdateGate()).toBe(true);
      expect(isUpdateRequired()).toBe(false); // …but still does not block on its own
    });

    it('is false when config holds no gate', () => {
      getConfigValue.mockReturnValue({ version: '0.0.1' });
      expect(shouldConfirmUpdateGate()).toBe(false);
    });

    it('is false when there is no config', () => {
      expect(shouldConfirmUpdateGate()).toBe(false);
    });
  });

  // Vitest runs in the node environment (no jsdom), so stand up just the two
  // window members openUpdateDestination touches.
  describe('update destination', () => {
    const open   = vi.fn();
    const reload = vi.fn();

    beforeEach(() => {
      open.mockReset();
      reload.mockReset();
      (globalThis as unknown as { window: unknown }).window = { open, location: { reload } };
    });

    it('opens the Play listing on Android', () => {
      mockGetPlatform.mockReturnValue('android');
      openUpdateDestination();
      expect(open).toHaveBeenCalledWith(
        'https://play.google.com/store/apps/details?id=com.hanlinsoftware.heapgame.app',
        '_blank',
      );
      expect(reload).not.toHaveBeenCalled();
      expect(updateActionLabel()).toBe('UPDATE');
    });

    it('reloads on web, where the newest build is already served', () => {
      mockGetPlatform.mockReturnValue('web');
      openUpdateDestination();
      expect(reload).toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      expect(updateActionLabel()).toBe('RELOAD');
    });
  });
});

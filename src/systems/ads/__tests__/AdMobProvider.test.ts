import { describe, it, expect, beforeEach, vi } from 'vitest';

// The plugin is native-only; stub the whole surface AdMobProvider touches.
// vi.mock factories are hoisted above module scope, so the stubs must be too.
const { admob, warn } = vi.hoisted(() => ({
  admob: {
    initialize:            vi.fn(),
    showInterstitial:      vi.fn(),
    prepareInterstitial:   vi.fn(),
    prepareRewardVideoAd:  vi.fn(),
    showRewardVideoAd:     vi.fn(),
    addListener:           vi.fn(),
  },
  warn: vi.fn(),
}));

vi.mock('@capacitor-community/admob', () => ({
  AdMob: admob,
  RewardAdPluginEvents: { Rewarded: 'rewarded', Dismissed: 'dismissed' },
}));
vi.mock('../../../logging', () => ({ getLogger: () => ({ warn }) }));

import { AdMobProvider } from '../AdMobProvider';

const warnedMessages = (): string[] => warn.mock.calls.map(c => c[0] as string);

/** Native event handlers registered by the provider, keyed by event name. */
let handlers: Record<string, () => void> = {};

/** showRewarded resolves only once Dismissed fires, mirroring the real SDK. */
const awaitListeners = () => vi.waitFor(() => expect(handlers.dismissed).toBeTypeOf('function'));

beforeEach(() => {
  vi.clearAllMocks();
  handlers = {};
  admob.initialize.mockResolvedValue(undefined);
  admob.showInterstitial.mockResolvedValue(undefined);
  admob.prepareInterstitial.mockResolvedValue(undefined);
  admob.prepareRewardVideoAd.mockResolvedValue(undefined);
  admob.showRewardVideoAd.mockResolvedValue(undefined);
  admob.addListener.mockImplementation((event: string, cb: () => void) => {
    handlers[event] = cb;
    return Promise.resolve({ remove: vi.fn().mockResolvedValue(undefined) });
  });
});

describe('AdMobProvider failure reporting', () => {
  // Every one of these paths was previously an empty `catch {}`, which is how a
  // malformed ad unit ID survived in production undetected.
  it('reports a failed preload rather than swallowing it', async () => {
    admob.prepareInterstitial.mockRejectedValue(new Error('no fill'));
    await new AdMobProvider().initialize();
    await vi.waitFor(() => expect(warnedMessages()).toContain('ads: prepareInterstitial failed'));
    expect(warn.mock.calls[0][1]).toMatchObject({ reason: 'no fill' });
  });

  it('reports a failed interstitial show', async () => {
    admob.showInterstitial.mockRejectedValue(new Error('not prepared'));
    await new AdMobProvider().showInterstitial();
    expect(warnedMessages()).toContain('ads: showInterstitial failed');
  });

  it('reports a failed rewarded prepare and resolves false', async () => {
    admob.prepareRewardVideoAd.mockRejectedValue(new Error('invalid request'));
    await expect(new AdMobProvider().showRewarded()).resolves.toBe(false);
    expect(warnedMessages()).toContain('ads: showRewarded prepare failed');
    expect(warn.mock.calls[0][1]).toMatchObject({ reason: 'invalid request' });
  });

  it('reports a failed rewarded show and resolves false', async () => {
    admob.showRewardVideoAd.mockRejectedValue(new Error('not prepared'));
    await expect(new AdMobProvider().showRewarded()).resolves.toBe(false);
    expect(warnedMessages()).toContain('ads: showRewarded show failed');
  });

  it('stays silent on the happy path', async () => {
    await new AdMobProvider().initialize();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('AdMobProvider ad unit ids', () => {
  it('passes a trimmed id to prepareInterstitial', async () => {
    await new AdMobProvider().initialize();
    await vi.waitFor(() => expect(admob.prepareInterstitial).toHaveBeenCalled());
    const { adId } = admob.prepareInterstitial.mock.calls[0][0] as { adId: string };
    expect(adId).toBe(adId.trim());
    expect(adId.length).toBeGreaterThan(0);
  });

  it('passes a trimmed id to prepareRewardVideoAd', async () => {
    const pending = new AdMobProvider().showRewarded();
    await awaitListeners();
    handlers.dismissed();
    await pending;

    const { adId } = admob.prepareRewardVideoAd.mock.calls[0][0] as { adId: string };
    expect(adId).toBe(adId.trim());
    expect(adId.length).toBeGreaterThan(0);
  });
});

describe('AdMobProvider rewarded outcome', () => {
  it('resolves true when the reward lands before dismissal', async () => {
    const pending = new AdMobProvider().showRewarded();
    await awaitListeners();
    handlers.rewarded();
    handlers.dismissed();
    await expect(pending).resolves.toBe(true);
  });

  it('resolves false when dismissed without earning the reward', async () => {
    const pending = new AdMobProvider().showRewarded();
    await awaitListeners();
    handlers.dismissed();
    await expect(pending).resolves.toBe(false);
  });
});

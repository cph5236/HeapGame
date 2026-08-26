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
    requestConsentInfo:      vi.fn(),
    showConsentForm:         vi.fn(),
    showPrivacyOptionsForm:  vi.fn(),
  },
  warn: vi.fn(),
}));

vi.mock('@capacitor-community/admob', () => ({
  AdMob: admob,
  RewardAdPluginEvents: { Rewarded: 'rewarded', Dismissed: 'dismissed' },
  InterstitialAdPluginEvents: {
    Dismissed: 'interstitialDismissed', FailedToShow: 'interstitialFailedToShow',
  },
  AdmobConsentStatus: {
    NOT_REQUIRED: 'NOT_REQUIRED', OBTAINED: 'OBTAINED',
    REQUIRED: 'REQUIRED', UNKNOWN: 'UNKNOWN',
  },
  PrivacyOptionsRequirementStatus: {
    NOT_REQUIRED: 'NOT_REQUIRED', REQUIRED: 'REQUIRED', UNKNOWN: 'UNKNOWN',
  },
}));
vi.mock('../../../logging', () => ({ getLogger: () => ({ warn }) }));

import { AdMobProvider, INTERSTITIAL_WAIT_CEILING_MS } from '../AdMobProvider';

const warnedMessages = (): string[] => warn.mock.calls.map(c => c[0] as string);

/** A provider past its consent gate — ads are only requested once consent
 *  has settled, so every ad-behaviour test must initialize first. */
const readyProvider = async (interstitialId?: string, rewardedId?: string) => {
  const p = new AdMobProvider(interstitialId, rewardedId);
  await p.initialize();
  vi.clearAllMocks();
  return p;
};

/** Native event handlers registered by the provider, keyed by event name. */
let handlers: Record<string, () => void> = {};

/** showRewarded resolves only once Dismissed fires, mirroring the real SDK. */
const awaitListeners = () => vi.waitFor(() => expect(handlers.dismissed).toBeTypeOf('function'));

/** Same for showInterstitial: the native show() call returns as soon as the ad
 *  is on screen, so the provider has to wait on the dismissal event instead. */
const awaitInterstitialListeners = () =>
  vi.waitFor(() => expect(handlers.interstitialDismissed).toBeTypeOf('function'));

beforeEach(() => {
  vi.clearAllMocks();
  handlers = {};
  admob.initialize.mockResolvedValue(undefined);
  admob.requestConsentInfo.mockResolvedValue({
    status: 'OBTAINED', isConsentFormAvailable: false,
    canRequestAds: true, privacyOptionsRequirementStatus: 'NOT_REQUIRED',
  });
  admob.showConsentForm.mockResolvedValue({
    status: 'OBTAINED', isConsentFormAvailable: true,
    canRequestAds: true, privacyOptionsRequirementStatus: 'REQUIRED',
  });
  admob.showPrivacyOptionsForm.mockResolvedValue(undefined);
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
    const provider = await readyProvider();
    admob.showInterstitial.mockRejectedValue(new Error('not prepared'));
    await provider.showInterstitial();
    expect(warnedMessages()).toContain('ads: showInterstitial failed');
  });

  it('reports a failed rewarded prepare and resolves false', async () => {
    const provider = await readyProvider();
    admob.prepareRewardVideoAd.mockRejectedValue(new Error('invalid request'));
    await expect(provider.showRewarded()).resolves.toBe(false);
    expect(warnedMessages()).toContain('ads: showRewarded prepare failed');
    expect(warn.mock.calls[0][1]).toMatchObject({ reason: 'invalid request' });
  });

  it('reports a failed rewarded show and resolves false', async () => {
    const provider = await readyProvider();
    admob.showRewardVideoAd.mockRejectedValue(new Error('not prepared'));
    await expect(provider.showRewarded()).resolves.toBe(false);
    expect(warnedMessages()).toContain('ads: showRewarded show failed');
  });

  it('stays silent on the happy path', async () => {
    await new AdMobProvider().initialize();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('AdMobProvider ad unit ids', () => {
  // Reproduces the production failure: the rewarded ID secret carried a trailing
  // newline, so the GMA SDK rejected every load with ERROR_CODE_INVALID_REQUEST.
  // IDs are passed explicitly — `.env` is untracked, so build-time env is empty
  // in CI and anything reading import.meta.env here would assert nothing.
  const POISONED_INTERSTITIAL = 'ca-app-pub-9580963584294486/5213759265\n';
  const POISONED_REWARDED     = '  ca-app-pub-9580963584294486/4249681864\r\n';

  it('strips the newline before handing the id to prepareInterstitial', async () => {
    await new AdMobProvider(POISONED_INTERSTITIAL, POISONED_REWARDED).initialize();
    await vi.waitFor(() => expect(admob.prepareInterstitial).toHaveBeenCalled());

    expect(admob.prepareInterstitial.mock.calls[0][0])
      .toEqual({ adId: 'ca-app-pub-9580963584294486/5213759265' });
  });

  it('strips the whitespace before handing the id to prepareRewardVideoAd', async () => {
    const provider = await readyProvider(POISONED_INTERSTITIAL, POISONED_REWARDED);
    const pending = provider.showRewarded();
    await awaitListeners();
    handlers.dismissed();
    await pending;

    expect(admob.prepareRewardVideoAd.mock.calls[0][0])
      .toEqual({ adId: 'ca-app-pub-9580963584294486/4249681864' });
  });
});

describe('AdMobProvider rewarded outcome', () => {
  it('resolves true when the reward lands before dismissal', async () => {
    const pending = (await readyProvider()).showRewarded();
    await awaitListeners();
    handlers.rewarded();
    handlers.dismissed();
    await expect(pending).resolves.toBe(true);
  });

  it('resolves false when dismissed without earning the reward', async () => {
    const pending = (await readyProvider()).showRewarded();
    await awaitListeners();
    handlers.dismissed();
    await expect(pending).resolves.toBe(false);
  });
});

describe('AdMobProvider interstitial lifetime', () => {
  // The player tapping PLAY AGAIN restarts the run the moment this resolves, so
  // resolving at display time boots the next run underneath the ad — the game
  // was audible behind the interstitial. Native show() resolves on display
  // (AdInterstitialExecutor calls show() then call.resolve()), so the provider
  // must wait for the dismissal event itself.
  it('stays pending while the interstitial is on screen', async () => {
    const provider = await readyProvider();
    let settled = false;
    const pending = provider.showInterstitial().then(() => { settled = true; });

    await awaitInterstitialListeners();
    expect(settled).toBe(false);

    handlers.interstitialDismissed();
    await pending;
    expect(settled).toBe(true);
  });

  it('resolves when the interstitial fails to show', async () => {
    const provider = await readyProvider();
    const pending = provider.showInterstitial();

    await awaitInterstitialListeners();
    handlers.interstitialFailedToShow();

    await expect(pending).resolves.toBeUndefined();
  });

  it('preloads the next interstitial only after dismissal', async () => {
    const provider = await readyProvider();
    const pending = provider.showInterstitial();

    await awaitInterstitialListeners();
    expect(admob.prepareInterstitial).not.toHaveBeenCalled();

    handlers.interstitialDismissed();
    await pending;
    expect(admob.prepareInterstitial).toHaveBeenCalled();
  });

  it('removes its listeners once the interstitial closes', async () => {
    const removals: Array<ReturnType<typeof vi.fn>> = [];
    admob.addListener.mockImplementation((event: string, cb: () => void) => {
      handlers[event] = cb;
      const remove = vi.fn().mockResolvedValue(undefined);
      removals.push(remove);
      return Promise.resolve({ remove });
    });

    const provider = await readyProvider();
    const pending = provider.showInterstitial();
    await awaitInterstitialListeners();
    handlers.interstitialDismissed();
    await pending;

    await vi.waitFor(() => {
      expect(removals).toHaveLength(2);
      for (const remove of removals) expect(remove).toHaveBeenCalled();
    });
  });

  it('resolves on its own if no dismissal event ever arrives', async () => {
    // Belt and braces: a swallowed event must not strand the player on the
    // score screen with no way to start the next run.
    const provider = await readyProvider();

    // Fake timers must be in place before the ceiling is scheduled.
    vi.useFakeTimers();
    try {
      const pending = provider.showInterstitial();
      await vi.advanceTimersByTimeAsync(INTERSTITIAL_WAIT_CEILING_MS);
      await expect(pending).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('AdMobProvider consent gating', () => {
  it('gathers consent before initializing the ads SDK', async () => {
    await new AdMobProvider().initialize();

    expect(admob.requestConsentInfo).toHaveBeenCalled();
    expect(admob.requestConsentInfo.mock.invocationCallOrder[0])
      .toBeLessThan(admob.initialize.mock.invocationCallOrder[0]);
  });

  it('shows the consent form when consent is required and a form is available', async () => {
    admob.requestConsentInfo.mockResolvedValue({
      status: 'REQUIRED', isConsentFormAvailable: true,
      canRequestAds: false, privacyOptionsRequirementStatus: 'REQUIRED',
    });

    await new AdMobProvider().initialize();

    expect(admob.showConsentForm).toHaveBeenCalled();
  });

  it('does not show the consent form when consent is not required', async () => {
    admob.requestConsentInfo.mockResolvedValue({
      status: 'NOT_REQUIRED', isConsentFormAvailable: false,
      canRequestAds: true, privacyOptionsRequirementStatus: 'NOT_REQUIRED',
    });

    await new AdMobProvider().initialize();

    expect(admob.showConsentForm).not.toHaveBeenCalled();
  });

  it('takes canRequestAds from the form result once the player has answered', async () => {
    admob.requestConsentInfo.mockResolvedValue({
      status: 'REQUIRED', isConsentFormAvailable: true,
      canRequestAds: false, privacyOptionsRequirementStatus: 'REQUIRED',
    });
    // Declining still permits non-personalized ads, so canRequestAds flips true.
    admob.showConsentForm.mockResolvedValue({
      status: 'OBTAINED', isConsentFormAvailable: true,
      canRequestAds: true, privacyOptionsRequirementStatus: 'REQUIRED',
    });

    const provider = new AdMobProvider();
    await provider.initialize();

    expect(provider.canRequestAds).toBe(true);
    expect(admob.prepareInterstitial).toHaveBeenCalled();
  });

  it('fails closed when consent info cannot be gathered', async () => {
    admob.requestConsentInfo.mockRejectedValue(new Error('network down'));

    const provider = new AdMobProvider();
    await provider.initialize();

    expect(provider.canRequestAds).toBe(false);
    expect(admob.initialize).not.toHaveBeenCalled();
    expect(admob.prepareInterstitial).not.toHaveBeenCalled();
    expect(warnedMessages()).toContain('ads: consent failed');
  });

  it('requests no interstitial while consent is unresolved', async () => {
    admob.requestConsentInfo.mockRejectedValue(new Error('network down'));
    const provider = new AdMobProvider();
    await provider.initialize();
    vi.clearAllMocks();

    await provider.showInterstitial();

    expect(admob.showInterstitial).not.toHaveBeenCalled();
  });

  it('resolves showRewarded false while consent is unresolved', async () => {
    admob.requestConsentInfo.mockRejectedValue(new Error('network down'));
    const provider = new AdMobProvider();
    await provider.initialize();
    vi.clearAllMocks();

    await expect(provider.showRewarded()).resolves.toBe(false);
    expect(admob.prepareRewardVideoAd).not.toHaveBeenCalled();
  });
});

describe('AdMobProvider privacy options', () => {
  it('reports the privacy options entry as required when Google says so', async () => {
    admob.requestConsentInfo.mockResolvedValue({
      status: 'OBTAINED', isConsentFormAvailable: true,
      canRequestAds: true, privacyOptionsRequirementStatus: 'REQUIRED',
    });

    const provider = new AdMobProvider();
    await provider.initialize();

    expect(provider.privacyOptionsRequired).toBe(true);
  });

  it('reports the privacy options entry as not required outside regulated regions', async () => {
    const provider = new AdMobProvider();
    await provider.initialize();

    expect(provider.privacyOptionsRequired).toBe(false);
  });

  it('opens Google\'s privacy options form on request', async () => {
    const provider = new AdMobProvider();
    await provider.initialize();

    await provider.showPrivacyOptions();

    expect(admob.showPrivacyOptionsForm).toHaveBeenCalled();
  });

  it('reports a failed privacy options form rather than swallowing it', async () => {
    admob.showPrivacyOptionsForm.mockRejectedValue(new Error('no form'));
    const provider = new AdMobProvider();
    await provider.initialize();

    await provider.showPrivacyOptions();

    expect(warnedMessages()).toContain('ads: showPrivacyOptions failed');
  });
});

describe('AdMobProvider consent revocation', () => {
  it('re-reads consent after the player changes it in the privacy form', async () => {
    const provider = new AdMobProvider();
    await provider.initialize();
    expect(provider.canRequestAds).toBe(true);

    // Player withdraws consent in Google's form.
    admob.requestConsentInfo.mockResolvedValue({
      status: 'REQUIRED', isConsentFormAvailable: true,
      canRequestAds: false, privacyOptionsRequirementStatus: 'REQUIRED',
    });

    await provider.showPrivacyOptions();

    expect(provider.canRequestAds).toBe(false);
  });

  it('stops serving ads immediately once consent is withdrawn', async () => {
    const provider = new AdMobProvider();
    await provider.initialize();
    admob.requestConsentInfo.mockResolvedValue({
      status: 'REQUIRED', isConsentFormAvailable: true,
      canRequestAds: false, privacyOptionsRequirementStatus: 'REQUIRED',
    });
    await provider.showPrivacyOptions();
    vi.clearAllMocks();

    await provider.showInterstitial();

    expect(admob.showInterstitial).not.toHaveBeenCalled();
  });

  it('does not reopen the consent form while re-reading', async () => {
    const provider = new AdMobProvider();
    await provider.initialize();
    admob.requestConsentInfo.mockResolvedValue({
      status: 'REQUIRED', isConsentFormAvailable: true,
      canRequestAds: false, privacyOptionsRequirementStatus: 'REQUIRED',
    });
    vi.clearAllMocks();

    await provider.showPrivacyOptions();

    // The player just answered the privacy form; stacking the consent form on
    // top of it would be a second dialog they did not ask for.
    expect(admob.showConsentForm).not.toHaveBeenCalled();
  });
});

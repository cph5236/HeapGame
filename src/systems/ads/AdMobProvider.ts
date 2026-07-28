import {
  AdMob,
  AdOptions,
  RewardAdOptions,
  RewardAdPluginEvents,
} from '@capacitor-community/admob';
import type { AdProvider } from './AdProvider';
import { normalizeAdId } from './adId';
import { getLogger } from '../../logging';

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Ad failures are never fatal, but they must not be silent either: every path
 *  here used to swallow into an empty catch, which hid a malformed ad unit ID in
 *  production for weeks. Warn level — non-crash, but always transmitted. */
function warn(message: string, context: Record<string, unknown>): void {
  try { getLogger().warn(message, context); } catch { /* logger not ready — drop */ }
}

export class AdMobProvider implements AdProvider {
  readonly enabled = true;

  private readonly _interstitialId: string;
  private readonly _rewardedId:     string;

  /**
   * IDs are injectable purely so the normalization above can be exercised
   * without build-time env — `.env` is untracked, so `import.meta.env.VITE_*`
   * is empty in CI. Production always constructs with the defaults.
   */
  constructor(
    interstitialId: string | undefined = import.meta.env.VITE_ADMOB_INTERSTITIAL_ID as string,
    rewardedId:     string | undefined = import.meta.env.VITE_ADMOB_REWARDED_ID as string,
  ) {
    this._interstitialId = normalizeAdId(interstitialId);
    this._rewardedId     = normalizeAdId(rewardedId);
  }

  async initialize(): Promise<void> {
    try {
      await AdMob.initialize({ tagForChildDirectedTreatment: false });
      this._preloadInterstitial();
    } catch (err) {
      warn('ads: initialize failed', { reason: reason(err) });
    }
  }

  async showInterstitial(): Promise<void> {
    try {
      await AdMob.showInterstitial();
      this._preloadInterstitial(); // reload for next run
    } catch (err) {
      // Most often "not prepared" — the boot-time preload never landed.
      warn('ads: showInterstitial failed', { adId: this._interstitialId, reason: reason(err) });
    }
  }

  async showRewarded(): Promise<boolean> {
    try {
      const options: RewardAdOptions = { adId: this._rewardedId };
      await AdMob.prepareRewardVideoAd(options);

      return await new Promise<boolean>((resolve) => {
        let rewarded = false;

        const rewardedHandle = AdMob.addListener(RewardAdPluginEvents.Rewarded, () => {
          rewarded = true;
        });

        const dismissedHandle = AdMob.addListener(RewardAdPluginEvents.Dismissed, () => {
          Promise.all([rewardedHandle, dismissedHandle])
            .then(([rh, dh]) => Promise.all([rh.remove(), dh.remove()]));
          resolve(rewarded);
        });

        AdMob.showRewardVideoAd().catch((err) => {
          warn('ads: showRewarded show failed', { adId: this._rewardedId, reason: reason(err) });
          Promise.all([rewardedHandle, dismissedHandle])
            .then(([rh, dh]) => Promise.all([rh.remove(), dh.remove()]));
          resolve(false);
        });
      });
    } catch (err) {
      warn('ads: showRewarded prepare failed', { adId: this._rewardedId, reason: reason(err) });
      return false;
    }
  }

  private _preloadInterstitial(): void {
    const options: AdOptions = { adId: this._interstitialId };
    AdMob.prepareInterstitial(options).catch((err) => {
      warn('ads: prepareInterstitial failed', { adId: this._interstitialId, reason: reason(err) });
    });
  }
}

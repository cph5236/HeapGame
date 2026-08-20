import {
  AdMob,
  AdOptions,
  RewardAdOptions,
  RewardAdPluginEvents,
  AdmobConsentStatus,
} from '@capacitor-community/admob';
import type { AdProvider } from './AdProvider';
import { normalizeAdId } from './adId';
import { getLogger } from '../../logging';

/** The plugin ships PrivacyOptionsRequirementStatus but its consent/index.d.ts
 *  does not re-export it, so it cannot be imported from the package entrypoint.
 *  Compare against the enum's string value rather than reaching into dist/. */
const PRIVACY_OPTIONS_REQUIRED = 'REQUIRED';

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

  private _canRequestAds          = false;
  private _privacyOptionsRequired = false;

  get canRequestAds():          boolean { return this._canRequestAds; }
  get privacyOptionsRequired(): boolean { return this._privacyOptionsRequired; }

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

  /**
   * Consent must be settled before the GMA SDK is touched: initializing or
   * preloading first would issue an ad request without a consent decision,
   * which is the whole thing the EEA/UK/CH consent requirement forbids.
   */
  async initialize(): Promise<void> {
    if (!(await this._gatherConsent())) return;

    try {
      await AdMob.initialize({ tagForChildDirectedTreatment: false });
      this._preloadInterstitial();
    } catch (err) {
      warn('ads: initialize failed', { reason: reason(err) });
    }
  }

  /**
   * Resolves true when Google permits ad requests. Fails closed: if consent
   * cannot be gathered at all we run the session ad-free rather than guess.
   * Note that a player who declines still gets `canRequestAds: true` — the
   * ads are simply non-personalized — so this only silences genuinely
   * unresolved cases.
   */
  private async _gatherConsent(): Promise<boolean> {
    try {
      let info = await AdMob.requestConsentInfo();

      if (info.isConsentFormAvailable && info.status === AdmobConsentStatus.REQUIRED) {
        info = await AdMob.showConsentForm();
      }

      this._canRequestAds = info.canRequestAds;
      this._privacyOptionsRequired =
        String(info.privacyOptionsRequirementStatus) === PRIVACY_OPTIONS_REQUIRED;

      return this._canRequestAds;
    } catch (err) {
      warn('ads: consent failed', { reason: reason(err) });
      return false;
    }
  }

  /** Reopens the consent form so the player can change or withdraw consent.
   *  Surfaced as Settings -> Privacy options, which the privacy policy names
   *  as the revocation route. */
  async showPrivacyOptions(): Promise<void> {
    try {
      await AdMob.showPrivacyOptionsForm();
    } catch (err) {
      warn('ads: showPrivacyOptions failed', { reason: reason(err) });
    }
  }

  async showInterstitial(): Promise<void> {
    if (!this._canRequestAds) return;

    try {
      await AdMob.showInterstitial();
      this._preloadInterstitial(); // reload for next run
    } catch (err) {
      // Most often "not prepared" — the boot-time preload never landed.
      warn('ads: showInterstitial failed', { adId: this._interstitialId, reason: reason(err) });
    }
  }

  async showRewarded(): Promise<boolean> {
    if (!this._canRequestAds) return false;

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

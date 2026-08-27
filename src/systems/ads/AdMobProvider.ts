import {
  AdMob,
  AdOptions,
  RewardAdOptions,
  RewardAdPluginEvents,
  InterstitialAdPluginEvents,
  AdmobConsentStatus,
} from '@capacitor-community/admob';
import type { AdmobConsentInfo } from '@capacitor-community/admob';
import type { AdProvider } from './AdProvider';
import { normalizeAdId } from './adId';
import { getLogger } from '../../logging';

/** The plugin ships PrivacyOptionsRequirementStatus but its consent/index.d.ts
 *  does not re-export it, so it cannot be imported from the package entrypoint.
 *  Compare against the enum's string value rather than reaching into dist/. */
const PRIVACY_OPTIONS_REQUIRED = 'REQUIRED';

/** How long showInterstitial will wait on a dismissal event before giving up.
 *  Callers gate a scene transition on it, so a swallowed event must never
 *  strand the player: past this ceiling we let the game continue regardless. */
export const INTERSTITIAL_WAIT_CEILING_MS = 60_000;

/** Same ceiling for the rewarded flow, but roomier: this one can cut short an
 *  ad the player is actively watching, and the reward rides on it. Any reward
 *  already earned is honoured when it trips. */
export const REWARDED_WAIT_CEILING_MS = 120_000;

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

      this._applyConsent(info);

      return this._canRequestAds;
    } catch (err) {
      warn('ads: consent failed', { reason: reason(err) });
      return false;
    }
  }

  private _applyConsent(info: AdmobConsentInfo): void {
    this._canRequestAds = info.canRequestAds;
    this._privacyOptionsRequired =
      String(info.privacyOptionsRequirementStatus) === PRIVACY_OPTIONS_REQUIRED;
  }

  /** Reopens the consent form so the player can change or withdraw consent.
   *  Surfaced as Settings -> Privacy options, which the privacy policy names
   *  as the revocation route. */
  async showPrivacyOptions(): Promise<void> {
    try {
      await AdMob.showPrivacyOptionsForm();
      // The form writes the player's new choice into the SDK but does not hand
      // it back, so re-read it: without this the gate keeps serving ads off the
      // boot-time flag and the revocation route revokes nothing until restart.
      // requestConsentInfo only, never showConsentForm — the player has just
      // answered a dialog and must not be handed a second one.
      this._applyConsent(await AdMob.requestConsentInfo());
    } catch (err) {
      warn('ads: showPrivacyOptions failed', { reason: reason(err) });
    }
  }

  /**
   * Resolves once the interstitial is **gone**, not once it is on screen.
   *
   * The native call resolves the moment `interstitialAd.show()` returns, so
   * awaiting it still hands control back while the ad is displayed — which is
   * how the next run used to boot (audibly) underneath the ad. Dismissal is
   * only observable through the plugin's event, so wait on that instead,
   * mirroring the rewarded flow below.
   */
  async showInterstitial(): Promise<void> {
    if (!this._canRequestAds) return;

    const closed = new Promise<void>((resolve) => {
      let done = false;

      const dismissedHandle = AdMob.addListener(InterstitialAdPluginEvents.Dismissed, () => finish());
      // A broken ad never dismisses, so treat "failed to show" as closed too.
      const failedHandle    = AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, () => finish());
      const ceiling = setTimeout(() => {
        warn('ads: interstitial dismissal never arrived', {
          adId: this._interstitialId, waitedMs: INTERSTITIAL_WAIT_CEILING_MS,
        });
        finish();
      }, INTERSTITIAL_WAIT_CEILING_MS);

      function finish(): void {
        if (done) return;
        done = true;
        clearTimeout(ceiling);
        Promise.all([dismissedHandle, failedHandle])
          .then(([dh, fh]) => Promise.all([dh.remove(), fh.remove()]))
          .catch(() => { /* listener teardown is best-effort */ });
        resolve();
      }

      AdMob.showInterstitial().catch((err) => {
        // Most often "not prepared" — the boot-time preload never landed.
        warn('ads: showInterstitial failed', { adId: this._interstitialId, reason: reason(err) });
        finish();
      });
    });

    await closed;
    this._preloadInterstitial(); // reload for next run
  }

  async showRewarded(): Promise<boolean> {
    if (!this._canRequestAds) return false;

    try {
      const options: RewardAdOptions = { adId: this._rewardedId };
      await AdMob.prepareRewardVideoAd(options);

      return await new Promise<boolean>((resolve) => {
        let rewarded = false;
        let done     = false;

        const rewardedHandle = AdMob.addListener(RewardAdPluginEvents.Rewarded, () => {
          rewarded = true;
        });

        const dismissedHandle = AdMob.addListener(RewardAdPluginEvents.Dismissed, () => finish());

        // Without this the button that awaits us stays on its loading animation
        // forever if the native event is ever swallowed.
        const ceiling = setTimeout(() => {
          warn('ads: rewarded dismissal never arrived', {
            adId: this._rewardedId, waitedMs: REWARDED_WAIT_CEILING_MS,
          });
          finish();
        }, REWARDED_WAIT_CEILING_MS);

        function finish(): void {
          if (done) return;
          done = true;
          clearTimeout(ceiling);
          Promise.all([rewardedHandle, dismissedHandle])
            .then(([rh, dh]) => Promise.all([rh.remove(), dh.remove()]))
            .catch(() => { /* listener teardown is best-effort */ });
          resolve(rewarded);   // a reward already earned still counts
        }

        AdMob.showRewardVideoAd().catch((err) => {
          warn('ads: showRewarded show failed', { adId: this._rewardedId, reason: reason(err) });
          finish();
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

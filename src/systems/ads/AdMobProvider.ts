import {
  AdMob,
  AdOptions,
  RewardAdOptions,
  RewardAdPluginEvents,
} from '@capacitor-community/admob';
import type { AdProvider } from './AdProvider';

const INTERSTITIAL_ID = import.meta.env.VITE_ADMOB_INTERSTITIAL_ID as string;
const REWARDED_ID     = import.meta.env.VITE_ADMOB_REWARDED_ID as string;

export class AdMobProvider implements AdProvider {
  async initialize(): Promise<void> {
    try {
      await AdMob.initialize({ tagForChildDirectedTreatment: true });
      this._preloadInterstitial();
    } catch { /* silent — never interrupt boot */ }
  }

  async showInterstitial(): Promise<void> {
    try {
      await AdMob.showInterstitial();
      this._preloadInterstitial(); // reload for next run
    } catch { /* no fill or not loaded — silent */ }
  }

  async showRewarded(): Promise<boolean> {
    try {
      const options: RewardAdOptions = { adId: REWARDED_ID };
      await AdMob.prepareRewardVideoAd(options);

      return await new Promise<boolean>((resolve) => {
        let rewarded = false;

        const rewardedHandle = AdMob.addListener(RewardAdPluginEvents.Rewarded, () => {
          rewarded = true;
        });

        const dismissedHandle = AdMob.addListener(RewardAdPluginEvents.Dismissed, () => {
          Promise.all([rewardedHandle, dismissedHandle])
            .then(([rh, dh]) => { rh.remove(); dh.remove(); });
          resolve(rewarded);
        });

        AdMob.showRewardVideoAd().catch(() => {
          Promise.all([rewardedHandle, dismissedHandle])
            .then(([rh, dh]) => { rh.remove(); dh.remove(); });
          resolve(false);
        });
      });
    } catch {
      return false;
    }
  }

  private _preloadInterstitial(): void {
    const options: AdOptions = { adId: INTERSTITIAL_ID };
    AdMob.prepareInterstitial(options).catch(() => { /* no fill — silent */ });
  }
}

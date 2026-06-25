import { getRawSaveForCloudSync } from './SaveData';
import { PlayGamesClient } from './PlayGamesClient';

/**
 * Push the current local save to the cloud snapshot (Google Play Games).
 *
 * No-ops on non-Android / signed-out devices — `PlayGamesClient.saveSnapshot`
 * guards on platform and swallows errors, so this is safe to fire-and-forget
 * from anywhere.
 *
 * Must be called after any change that *spends* balance (store/upgrade
 * purchases). `mergeCloudSave` resolves balance with `Math.max(local, cloud)`,
 * so a stale cloud snapshot will refund spent coins on the next launch while
 * keeping the purchased upgrade/item. Keeping the cloud snapshot current closes
 * that window.
 */
export function syncSaveToCloud(): void {
  void PlayGamesClient.saveSnapshot(JSON.stringify(getRawSaveForCloudSync()));
}

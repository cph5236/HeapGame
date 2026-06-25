import { getRawSaveForCloudSync } from './SaveData';
import { PlayGamesClient } from './PlayGamesClient';

// Single-flight write state. At most one `saveSnapshot` is ever in flight; any
// request that arrives while one is running just marks the save dirty so the
// runner loops once more with the freshest snapshot. See `syncSaveToCloud`.
let inFlight: Promise<void> | null = null;
let dirty = false;

async function runSync(): Promise<void> {
  try {
    // Loop until no further change was requested mid-write. Each iteration reads
    // the snapshot at send time, so the final write always reflects the latest
    // local state and intermediate states are coalesced away.
    do {
      dirty = false;
      await PlayGamesClient.saveSnapshot(JSON.stringify(getRawSaveForCloudSync()));
    } while (dirty);
  } finally {
    inFlight = null;
  }
}

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
 *
 * Writes are serialized: only one `saveSnapshot` is in flight at a time, and a
 * request made while one is running re-runs afterwards with the freshest
 * snapshot. This prevents concurrent writes from a burst of purchases resolving
 * out of order and reverting the cloud balance to a stale value.
 */
export function syncSaveToCloud(): void {
  // A save is already running — mark dirty so its loop picks up this change.
  if (inFlight) {
    dirty = true;
    return;
  }
  inFlight = runSync();
}

/** Test helper: reset the single-flight queue state between cases. */
export function resetCloudSyncForTests(): void {
  inFlight = null;
  dirty = false;
}

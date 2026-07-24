//
// Offline-safe sync of the equipped loadout to the server. The editor batches
// every change locally and PUTs once on exit (flushLoadoutSync) — the loadout
// is only ever read back by *other* players' leaderboard/ghost views, so there
// is no reason to hit the server on each try-on. A failed or never-sent PUT
// leaves loadoutSyncPending set, so it is retried at next session start.

import { CustomizationClient } from './CustomizationClient';
import {
  getEquippedCosmetics, getEffectivePlayerId,
  getLoadoutSyncPending, setLoadoutSyncPending,
} from './SaveData';

// Coalesce concurrent syncs into one request. On editor exit the SHUTDOWN
// flush and MenuScene's session-start retry both fire before the first PUT
// resolves; without this guard they'd race into two identical PUTs.
let inFlight: Promise<boolean> | null = null;

/** PUT the current loadout now. Manages the pending flag. */
export function syncLoadoutNow(): Promise<boolean> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const ok = await CustomizationClient.putLoadout(getEffectivePlayerId(), getEquippedCosmetics());
      setLoadoutSyncPending(!ok);
      return ok;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * Record that the loadout changed without hitting the server. Persisted, so an
 * app-kill (or backgrounding) before the editor exits is still retried at next
 * session start — the change is already saved locally either way.
 */
export function markLoadoutDirty(): void {
  setLoadoutSyncPending(true);
}

/** On editor exit: PUT once if there are unsynced changes, else do nothing. */
export function flushLoadoutSync(): void {
  if (getLoadoutSyncPending()) void syncLoadoutNow();
}

/** Session-start retry for a previously failed / unsent sync. */
export function retryPendingLoadoutSync(): void {
  if (getLoadoutSyncPending()) void syncLoadoutNow();
}

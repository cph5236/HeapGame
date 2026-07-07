//
// Debounced, offline-safe sync of the equipped loadout to the server.
// Failures set a pending flag in the save; retried on next equip change or
// next session start (MenuScene.create).

import type Phaser from 'phaser';
import { CustomizationClient } from './CustomizationClient';
import {
  getEquippedCosmetics, getPlayerGuid,
  getLoadoutSyncPending, setLoadoutSyncPending,
} from './SaveData';

const DEBOUNCE_MS = 2000;

let pendingTimer: Phaser.Time.TimerEvent | null = null;

/** PUT the current loadout now. Manages the pending flag. */
export async function syncLoadoutNow(): Promise<boolean> {
  const ok = await CustomizationClient.putLoadout(getPlayerGuid(), getEquippedCosmetics());
  setLoadoutSyncPending(!ok);
  return ok;
}

/** Debounced sync — call on every equip change in the editor. */
export function scheduleLoadoutSync(scene: Phaser.Scene): void {
  pendingTimer?.remove();
  pendingTimer = scene.time.delayedCall(DEBOUNCE_MS, () => {
    pendingTimer = null;
    void syncLoadoutNow();
  });
}

/** Cancel any debounce timer and fire immediately (scene shutdown). */
export function flushLoadoutSync(): void {
  if (pendingTimer) {
    pendingTimer.remove();
    pendingTimer = null;
    void syncLoadoutNow();
  }
}

/** Session-start retry for a previously failed sync. */
export function retryPendingLoadoutSync(): void {
  if (getLoadoutSyncPending()) void syncLoadoutNow();
}

// src/systems/UpdateGate.ts
//
// Client half of the remote-config minimum-version gate. Reads the `min_version`
// key primed by ConfigClient at boot and decides whether this build is too old
// to run. LoadingScene consults it just before handing off to the menu.
//
// This is the HARD floor only — reserved for a breaking API change or a severe
// client bug. It is deliberately not a "newer version available" nudge; that is
// Play's in-app update flow, which knows the published versionCode on its own.
//
// Two questions, deliberately distinct:
//   shouldConfirmUpdateGate() — might this build be gated, per *any* config we
//       hold (possibly stale)? LoadingScene uses it to decide whether waiting on
//       the network is worth the stall.
//   isUpdateRequired()        — is it gated per config fetched *this launch*?
//       Only this one blocks.
//
// Acting on stale config would be a trap: a player who went offline while a gate
// was live would stay locked out after it was lifted, and an offline player
// can't reach the store to update anyway. So the block needs a fresh fetch, and
// everything else fails open.

import { Capacitor } from '@capacitor/core';
import { getConfigValue, isConfigFresh } from './ConfigClient';
import {
  isUpdateRequired as versionBelowFloor,
  parseMinVersionConfig,
  MIN_VERSION_KEY,
  type MinVersionConfig,
} from '../../shared/versionGate';

/** Play Store listing for the production build (matches capacitor.config.ts appId). */
const ANDROID_APP_ID = 'com.hanlinsoftware.heapgame.app';
const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_APP_ID}`;

/** This build's version, baked in from package.json by vite.config.ts. */
export function getClientVersion(): string {
  return import.meta.env.VITE_APP_VERSION ?? '0.0.0';
}

/** The live `min_version` config, or null when absent/malformed. */
export function getMinVersionConfig(): MinVersionConfig | null {
  return parseMinVersionConfig(getConfigValue(MIN_VERSION_KEY));
}

/**
 * True when the config we currently hold — fresh or last-known-good — puts this
 * build below the floor. Not a blocking signal on its own: it only tells
 * LoadingScene that confirming with the server is worth waiting for.
 */
export function shouldConfirmUpdateGate(): boolean {
  return versionBelowFloor(getClientVersion(), getConfigValue(MIN_VERSION_KEY));
}

/**
 * True when config fetched *this launch* puts this build below the floor. This
 * is the only signal that actually blocks the player. Offline, timed out, or
 * serving last-known-good → false, by design.
 */
export function isUpdateRequired(): boolean {
  if (!isConfigFresh()) return false;
  return versionBelowFloor(getClientVersion(), getConfigValue(MIN_VERSION_KEY));
}

/**
 * Send the player somewhere they can actually update.
 *
 * On Android that's the Play listing. On web there is no store — the newest
 * build is already on the CDN, so a reload is the fix (and the gate would only
 * have fired there against a stale cached bundle).
 *
 * Capacitor routes an external `window.open` to the system handler, which Android
 * resolves to the Play app. When the Play in-app update plugin lands it should
 * supersede this with a native `openAppStore()`.
 */
export function openUpdateDestination(): void {
  if (Capacitor.getPlatform() === 'android') {
    window.open(PLAY_STORE_URL, '_blank');
    return;
  }
  window.location.reload();
}

/** Label for the gate's action button, which differs by platform. */
export function updateActionLabel(): string {
  return Capacitor.getPlatform() === 'android' ? 'UPDATE' : 'RELOAD';
}

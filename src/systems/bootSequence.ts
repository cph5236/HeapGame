import type Phaser from 'phaser';
import { AudioManager } from './AudioManager';
import { beginAdConsent } from './ads/consentGate';
import { primeConfig } from './ConfigClient';
import { initLogger } from '../logging';
import { beginSignIn, signInSettled } from './gpgsSession';
import { PlayGamesClient } from './PlayGamesClient';
import { PlayerNameClient } from './PlayerNameClient';
import { validatePlayerName } from '../../shared/playerName';
import {
  getPlayerName, setPlayerName, getEffectivePlayerId,
  getRawSaveForCloudSync, applyMergedSave, mergeCloudSave, type RawSave,
} from './SaveData';

/**
 * The platform half of startup, in the order it has to happen. A game's boot
 * scene calls these two and then kicks off its own work; everything here is
 * free of game concepts, so it carries over to another game unchanged.
 *
 * Ordering constraints worth preserving:
 *  - `initPlatform` must run before any async fetch, so the logger exists to
 *    record failures in them.
 *  - `startIdentitySession` must be kicked off early: LoadingScene gates the
 *    menu on it settling, so the player id is final before the player can reach
 *    anything that writes under it. See gpgsSession.ts for why that matters.
 */

/** Emitted on the game's event bus once a cloud save has been merged into local
 *  state, so an already-open menu can refresh in place. */
export const SAVE_MERGED_EVENT = 'gpgs:save-merged';

/**
 * Synchronous platform init: audio, ad consent, remote config, logging.
 * Consent and config are kicked off here and awaited later by the loading
 * screen — neither blocks this call.
 */
export function initPlatform(scene: Phaser.Scene): void {
  AudioManager.init(scene.sound);
  beginAdConsent(); // gathers consent, then initializes ads; LoadingScene waits on it
  primeConfig();    // kicks off the remote-config fetch; LoadingScene awaits configReady()

  // Initialize the logger after SaveData is importable but before any async
  // fetch, so failures in those are recorded.
  initLogger();

  scene.game.registry.set('gameAssetsReady', false);
}

/**
 * Begin Play Games sign-in, then — once it settles — sync the display name and
 * merge the cloud save.
 *
 * The merge is deliberately NOT gated on: it only rewrites local save state,
 * nothing keyed on player id server-side, so it can safely land after the menu
 * has opened. The menu listens for {@link SAVE_MERGED_EVENT} to refresh in place.
 */
export function startIdentitySession(game: Phaser.Game): void {
  beginSignIn();
  void signInSettled().then(async (player) => {
    if (!player) return;

    // Sync the GPGS display name to the server's player_name table — score
    // submit no longer updates names, and GPGS players can't reach the rename
    // modal, so this is their only refresh path after first seed. Uses the
    // locally-stored form (setPlayerName truncates to the shared max) and only
    // when it passes the shared validator — raw GPGS names can be up to 100
    // chars and the server would 400 silently.
    const validated = validatePlayerName(getPlayerName());
    if (validated.ok) {
      void PlayerNameClient.updateName(getEffectivePlayerId(), validated.name);
    }

    const cloudJson = await PlayGamesClient.loadSnapshot();
    if (!cloudJson) return;

    let cloudSave: RawSave;
    try {
      cloudSave = JSON.parse(cloudJson) as RawSave;
    } catch {
      return; // malformed cloud data — skip merge
    }

    const localSave = getRawSaveForCloudSync();
    const merged    = mergeCloudSave(localSave, cloudSave);
    applyMergedSave(merged);
    setPlayerName(player.displayName); // GPGS name always wins after merge
    game.events.emit(SAVE_MERGED_EVENT);
  }).catch(() => { /* silent — cloud save merge is optional */ });
}

import type Phaser from 'phaser';
import { AudioManager } from './AudioManager';
import { beginAdConsent } from './ads/consentGate';
import { primeConfig } from './ConfigClient';
import { initLogger } from '../logging';
import { beginSignIn, signInSettled } from './gpgsSession';
import { PlayGamesClient } from './PlayGamesClient';
import { PlayerNameClient } from './PlayerNameClient';
import { validatePlayerName } from '../../shared/playerName';
import { syncSaveToCloud } from './cloudSave';
import {
  getPlayerName, setPlayerName, getEffectivePlayerId,
  getRawSaveForCloudSync, applyMergedSave, mergeCloudSave, type RawSave,
  reconcileMovementRefund,
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

/** Emitted once the movement-rework refund reconciliation has run to
 *  completion for this boot — win, lose, or draw (already applied, nothing
 *  owed, or a fresh payout). Task 10's announcement modal must wait on this
 *  rather than calling `reconcileMovementRefund()` itself: only this module
 *  knows whether a cloud merge is still pending, and running the reconcile
 *  before a pending merge lands reopens the double-credit bug documented at
 *  the call site below. */
export const REFUND_SETTLED_EVENT = 'save:refund-settled';

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
 *
 * The movement-refund reconciliation (see the `.finally` below) is wired into
 * this same chain — not a second, independent call site — because it is the
 * one place that knows, for every possible outcome of this boot's identity
 * session, whether a cloud merge did or did not happen.
 */
export function startIdentitySession(game: Phaser.Game): void {
  beginSignIn();
  void signInSettled().then(async (player) => {
    if (!player) return; // web/itch, or Android declined/timed-out sign-in — no merge coming

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
    if (!cloudJson) return; // signed in, but no cloud snapshot yet — no merge coming

    let cloudSave: RawSave;
    try {
      cloudSave = JSON.parse(cloudJson) as RawSave;
    } catch {
      return; // malformed cloud data — skip merge, no merge coming
    }

    const localSave = getRawSaveForCloudSync();
    const merged    = mergeCloudSave(localSave, cloudSave);
    applyMergedSave(merged); // merge has now happened — safe for the refund below to run
    setPlayerName(player.displayName); // GPGS name always wins after merge
    game.events.emit(SAVE_MERGED_EVENT);
  })
    .catch(() => { /* silent — cloud save merge is optional */ }) // merge attempt failed — no merge landed
    .finally(() => {
      // Runs exactly once per boot, after every path above has definitively
      // concluded: the merge succeeded and is already applied (immediately
      // above), or one of the three early returns fired, or the whole chain
      // rejected — in every one of those non-merge cases no merge is coming,
      // ever, for this boot. Do NOT move this call earlier or duplicate it
      // inside the `.then` above: a refund applied while a merge is still
      // pending is double-credited the instant another device has already
      // spent it — mergeGame resolves balance with Math.max, so the merge
      // would restore the pre-refund balance *and* pull in the upgrade that
      // refund money bought elsewhere. reconcileMovementRefund() is
      // idempotent (a no-op once already applied), so calling it here on
      // every completion path — including a save that never merges at all,
      // e.g. every web/itch.io player — is what actually pays them.
      const refunded = reconcileMovementRefund();
      // reconcileMovementRefund() never touches the cloud itself (that would
      // reintroduce the save/game.ts <-> cloudSave.ts import cycle); the
      // caller closes the stale-snapshot window instead, exactly once, only
      // when a payout actually happened.
      if (refunded > 0) syncSaveToCloud();
      game.events.emit(REFUND_SETTLED_EVENT);
    });
}

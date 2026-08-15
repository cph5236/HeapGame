// Owns the one moment at which this app session's player identity is decided.
//
// GPGS sign-in used to be fired fire-and-forget from BootScene, so it could
// land at any point — including after a run had already started. Because
// getEffectivePlayerId() is `gpgsPlayerId ?? playerGuid`, a late sign-in
// silently flipped the id mid-session: the run-session token was bound to the
// id read at run start, so the score submit failed as `session-mismatch`, and
// anything already written under the GUID (daily-drop streak, cosmetics
// loadout, name) was orphaned with no server-side migration path back.
//
// The fix is to settle sign-in exactly once, before the menu is reachable, and
// to make that decision FINAL for the app session. If sign-in has not landed by
// GPGS_SIGNIN_TIMEOUT_MS we do not adopt it later — the session runs on the
// GUID and the next launch, with warm Play Services credentials, picks up the
// profile. That leaves no code path that can change the effective id while the
// app is running.

import { PlayGamesClient } from './PlayGamesClient';
import { setGpgsPlayerId, setPlayerName } from './SaveData';
import { GPGS_SIGNIN_TIMEOUT_MS } from '../constants';

export interface GpgsPlayer {
  playerId:    string;
  displayName: string;
}

let settlePromise: Promise<GpgsPlayer | null> | null = null;

/**
 * Kick off the sign-in attempt. Idempotent — a second call is a no-op and does
 * not restart the attempt. Never throws; failures settle as null.
 *
 * Off Android, PlayGamesClient.signIn() resolves null synchronously, so this
 * settles immediately and web/itch builds never wait.
 */
export function beginSignIn(): void {
  if (settlePromise) return;

  settlePromise = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), GPGS_SIGNIN_TIMEOUT_MS);
    });

    try {
      const player = await Promise.race([PlayGamesClient.signIn(), deadline]);
      if (!player) return null;

      // Adoption happens here and nowhere else, so that by the time
      // signInSettled() resolves, getEffectivePlayerId() is already final.
      // A sign-in that loses the race above is simply dropped: its promise
      // settles into nothing and no adoption ever runs.
      try {
        setGpgsPlayerId(player.playerId);
        setPlayerName(player.displayName);
      } catch {
        // SaveData.persist() writes localStorage unguarded, so this throws on
        // quota-exceeded and in blocked-storage / private modes. It mutates the
        // in-memory cache *before* writing, though, so the id is adopted for
        // this session regardless — only its persistence was lost, and the next
        // launch simply signs in again. Fall through and report the player, so
        // callers stay consistent with what getEffectivePlayerId() now returns:
        // reporting null here would make BootScene skip the name sync and cloud
        // merge for a session that is already writing under the GPGS id.
      }
      return player;
    } catch {
      // This promise must never reject. LoadingScene gates the menu on it
      // settling, so a throw would leave the player stranded on the loading
      // screen. PlayGamesClient.signIn() resolves rather than rejects today, so
      // this is unreachable — it is here so that stays true by construction.
      return null;
    } finally {
      clearTimeout(timer);
    }
  })();
}

/**
 * Resolves once the identity for this app session is fixed — with the signed-in
 * player, or null if sign-in failed, was declined, timed out, or the platform
 * has no Play Games at all. Never rejects.
 *
 * LoadingScene awaits this before opening the menu, concurrently with asset
 * loading, so every per-player server call downstream reads a settled id.
 * Resolves null immediately if beginSignIn() was never called.
 */
export function signInSettled(): Promise<GpgsPlayer | null> {
  return settlePromise ?? Promise.resolve(null);
}

/** Test-only: drop the memoised attempt so each case starts from a clean slate. */
export function resetSignInForTests(): void {
  settlePromise = null;
}

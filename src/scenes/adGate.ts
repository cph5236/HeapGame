/**
 * Serialises everything that puts an ad on screen or leaves the score scene.
 *
 * Two problems live here. Both ScoreScene exits (PLAY AGAIN, and the tap or
 * keypress that returns to the menu) used to fire the interstitial and start
 * the next scene on the same tick, so the new run booted — and could be heard —
 * underneath the ad. And the rewarded offer sits on the same screen: the score
 * screen stays interactive while a rewarded ad is still loading, so an exit
 * tapped meanwhile fired a second, concurrent native ad request.
 *
 * The gate holds a transition until the ad provider reports the ad closed, and
 * hands out ownership to one ad at a time. Exits are one-shot; the rewarded
 * offer claims and releases, since the player stays on the scene afterwards.
 */
export interface AdGate {
  /** Leaves the scene, waiting out the interstitial first when one is due.
   *  Ignored if any ad already owns the gate or the scene is already leaving. */
  leave(needsAd: boolean, transition: () => void): Promise<void>;

  /** Takes the gate for an ad that is not an exit (the rewarded offer).
   *  False means something else owns it and the caller must do nothing. */
  claim(): boolean;

  /** Hands the gate back once that ad is finished with. */
  release(): void;
}

export function createAdGate(showAd: () => Promise<void>): AdGate {
  let claimed = false;   // a rewarded ad is loading or on screen
  let leaving = false;   // an exit is committed; nothing else may run

  return {
    async leave(needsAd: boolean, transition: () => void): Promise<void> {
      if (leaving || claimed) return;
      leaving = true;

      if (needsAd) {
        // An ad that fails must never cost the player their restart.
        try { await showAd(); } catch { /* ignored — the exit still happens */ }
      }

      transition();
    },

    claim(): boolean {
      if (leaving || claimed) return false;
      claimed = true;
      return true;
    },

    release(): void {
      claimed = false;
    },
  };
}

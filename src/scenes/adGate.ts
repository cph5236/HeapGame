/**
 * Sequences a scene exit behind an interstitial.
 *
 * Both ScoreScene exits (PLAY AGAIN, and the tap/keypress that returns to the
 * menu) used to fire the ad and start the next scene on the same tick, so the
 * new run booted — and could be heard — underneath the ad. The gate holds the
 * transition until the ad provider reports the ad closed, and makes the exit
 * one-shot for the whole scene so a stray tap on a different control while the
 * ad is up cannot queue a second, conflicting transition.
 */
export function createAdGate(showAd: () => Promise<void>) {
  let leaving = false;

  return async function leave(needsAd: boolean, transition: () => void): Promise<void> {
    if (leaving) return;
    leaving = true;

    if (needsAd) {
      // An ad that fails must never cost the player their restart.
      try { await showAd(); } catch { /* ignored — the exit still happens */ }
    }

    transition();
  };
}

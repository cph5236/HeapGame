// Timing model for the MenuScene entrance choreography.
//
// The full cinematic (staggered silhouette → title → buttons fade-in) spans
// ~2.3s, which looks great on the very first launch but feels sluggish when the
// player keeps returning to the menu from Game/Upgrade/Store. We keep the full
// version once per app-session and compress every subsequent visit into a brief
// window that preserves the same choreography, just faster.

/** Full first-visit span (ms): the last element fades in at ~this mark. */
export const ENTRANCE_FULL_SPAN_MS = 2300;

/** Compressed span (ms) used on every visit after the first this session. */
export const ENTRANCE_FAST_SPAN_MS = 1000;

/**
 * Multiplier applied to every entrance delay/duration. First visit plays at
 * full length (1); later visits are scaled so the whole sequence finishes
 * within {@link ENTRANCE_FAST_SPAN_MS}.
 */
export function entranceScale(firstTime: boolean): number {
  return firstTime ? 1 : ENTRANCE_FAST_SPAN_MS / ENTRANCE_FULL_SPAN_MS;
}

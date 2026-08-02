/**
 * Decides whether the browser page chrome should surface its "get it on Google
 * Play" prompt. Pure so the rules are testable without a DOM.
 *
 * The prompt is deliberately restrained: the web build's pitch is "free, no ads,
 * no install", and a nagging install interstitial erodes exactly that. So it
 * fires on RETURN to the menu (i.e. the player finished at least one run and
 * came back), never on first load, at most once per page load, and never again
 * once dismissed with the checkbox.
 */

/**
 * Completed runs required before the prompt may appear. 1 = the first time the
 * player finishes a run and heads back to the menu. Raise this to make the
 * prompt wait for more demonstrated engagement.
 */
export const MIN_RUNS_BEFORE_PROMPT = 1;

export interface InstallPromptState {
  /**
   * Runs finished this page load, counted off the score screen's return-to-menu
   * transition. Not menu entries: MenuScene re-creates on window resize.
   */
  runsFinished: number;
  /** Persisted "don't show this again" choice. */
  optedOut: boolean;
  /** Already shown once during this page load. */
  shownThisSession: boolean;
  /** Running inside the Capacitor Android shell — they already have the app. */
  isNative: boolean;
  /**
   * Embedded in someone else's page (itch.io frames the build). The host owns
   * the surrounding chrome there, so we stay out of it entirely.
   */
  inIframe: boolean;
}

export function shouldShowInstallPrompt(s: InstallPromptState): boolean {
  if (s.isNative) return false;
  if (s.inIframe) return false;
  if (s.optedOut) return false;
  if (s.shownThisSession) return false;
  return s.runsFinished >= MIN_RUNS_BEFORE_PROMPT;
}

/**
 * Whether the surrounding rails should render at all. Same host restrictions as
 * the prompt, plus a width floor: below it the dead space either side of the
 * portrait game column is too narrow to hold readable content.
 */
export const MIN_RAIL_WIDTH_PX = 260;

export function shouldShowRails(opts: {
  railWidthPx: number;
  isNative: boolean;
  inIframe: boolean;
}): boolean {
  if (opts.isNative) return false;
  if (opts.inIframe) return false;
  return opts.railWidthPx >= MIN_RAIL_WIDTH_PX;
}

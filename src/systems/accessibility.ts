import type Phaser from 'phaser';
import { getReduceMotionPref, setReduceMotionPref } from './SaveData';

/**
 * Accessibility switches shared by every scene.
 *
 * "Reduce flashing & motion" (WCAG 2.3.1 / 2.3.3): the player's explicit choice
 * wins; with no choice saved it follows the OS `prefers-reduced-motion` setting,
 * so a player who has already told their device once never has to find our
 * toggle. Every flash, shake and heavy particle effect routes through the
 * helpers below rather than checking the flag itself, so a new effect added
 * with `shakeCamera()` is covered without anyone remembering to ask.
 */

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

let _mql: MediaQueryList | null | undefined;

/** Whether the OS asks for reduced motion. False where matchMedia is absent
 *  (unit tests, very old WebViews). The MediaQueryList is created once and its
 *  live `.matches` read each call, so this is cheap enough to check per frame
 *  and still tracks an OS setting changed mid-session. */
export function osPrefersReducedMotion(): boolean {
  if (_mql === undefined) {
    try {
      _mql = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(REDUCED_MOTION_QUERY) : null;
    } catch {
      _mql = null;
    }
  }
  return _mql?.matches ?? false;
}

/** Pure resolution rule, split out so it can be tested without a DOM. */
export function resolveReducedMotion(pref: boolean | undefined, osReduced: boolean): boolean {
  return pref ?? osReduced;
}

/** True when flashes, screen shake and heavy particle effects must be toned down.
 *  Cheap (cached save + cached media query), so per-frame callers may use it to
 *  follow a setting changed mid-run. */
export function isReducedMotion(): boolean {
  return resolveReducedMotion(getReduceMotionPref(), osPrefersReducedMotion());
}

export type ReducedMotionChoice = 'auto' | 'on' | 'off';

/** The player's stored choice: 'auto' follows the OS. */
export function getReducedMotionChoice(): ReducedMotionChoice {
  const pref = getReduceMotionPref();
  return pref === undefined ? 'auto' : pref ? 'on' : 'off';
}

/** Save the player's choice. 'auto' clears the override so the OS decides. */
export function setReducedMotionChoice(choice: ReducedMotionChoice): void {
  setReduceMotionPref(choice === 'auto' ? undefined : choice === 'on');
}

/** Camera shake, skipped entirely under reduced motion. */
export function shakeCamera(cam: Phaser.Cameras.Scene2D.Camera, durationMs: number, intensity: number): void {
  if (isReducedMotion()) return;
  cam.shake(durationMs, intensity);
}

/** Full-screen colour flash, skipped entirely under reduced motion. Callers
 *  must not rely on the flash as the only cue — pair it with text or sound. */
export function flashCamera(
  cam: Phaser.Cameras.Scene2D.Camera, durationMs: number, r: number, g: number, b: number,
): void {
  if (isReducedMotion()) return;
  cam.flash(durationMs, r, g, b);
}

/**
 * Minimum time between opposing brightness changes for any repeating flicker.
 * WCAG 2.3.1 allows at most three flashes per second; a flash is a pair of
 * opposing changes, so transitions must be at least 1000 / 6 ≈ 167 ms apart.
 * 200 ms keeps a safety margin (2.5 flashes/s) even when frames jitter.
 */
export const MIN_FLICKER_INTERVAL_MS = 200;

// ── Screen-reader announcements ───────────────────────────────────────────────

const LIVE_REGION_ID = 'a11y-live';

/**
 * Speak a short, non-gameplay status message ("Paused", "Run over — score 1200")
 * through the page's polite live region. Never use this for moment-to-moment
 * gameplay: the canvas is a real-time visual experience and spamming the
 * region would drown out everything else the screen reader has to say.
 *
 * The text is cleared first and set on the next frame, so announcing the same
 * message twice in a row is still read out the second time.
 */
export function announce(message: string): void {
  if (typeof document === 'undefined') return;
  const region = document.getElementById(LIVE_REGION_ID);
  if (!region) return;
  region.textContent = '';
  const set = (): void => { region.textContent = message; };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(set);
  else set();
}

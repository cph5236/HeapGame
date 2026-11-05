import type Phaser from 'phaser';

/**
 * Accessibility wiring between the Phaser canvas and the HTML page around it.
 *
 * 1. Names the canvas for assistive tech (role, label, description) and makes
 *    it focusable, so keyboard users can Tab to it and away from it again.
 * 2. Gates Phaser's keyboard by focus. Phaser listens on `window` and calls
 *    preventDefault() on every key it has captured (arrows, WASD, Space, Shift,
 *    E) no matter where focus is — so with a link or checkbox on the page
 *    focused, Space would neither activate it nor reach it, and the keystroke
 *    would drive the game instead. Tab is never captured, so there is no
 *    keyboard trap; this closes the reverse problem.
 * 3. Auto-pauses a run when the tab is hidden, the window loses focus, or the
 *    player moves focus out of the game — the run never keeps going unseen.
 */

export const CANVAS_ID      = 'game-canvas';
export const DESCRIPTION_ID = 'game-desc';

/** A gameplay scene that can open its own pause menu. */
interface PausableRun { openPauseMenu(): void }

function isPausableRun(scene: unknown): scene is PausableRun {
  return typeof (scene as Partial<PausableRun> | null)?.openPauseMenu === 'function';
}

/** Keys that open/close the pause menu. They mean nothing to links or buttons,
 *  so they still reach the game from any non-editable focus target — otherwise
 *  a run auto-paused by Tabbing onto a link could not be resumed with the very
 *  keys the pause announcement names. */
const PAUSE_KEYS = new Set(['Escape', 'p', 'P']);

/** True for text fields, where every key (including P) belongs to the field. */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el) return false;
  const tag = el.tagName?.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

/** Whether a keydown should be handed to Phaser: game targets always, plus the
 *  pause keys from anywhere that isn't a text field. */
export function shouldGameHandleKey(key: string, target: EventTarget | null, canvas: Element | null): boolean {
  if (isGameKeyTarget(target, canvas)) return true;
  return PAUSE_KEYS.has(key) && !isEditableTarget(target);
}

/**
 * Whether a keyboard event with this target should drive the game. Keys typed
 * while the canvas, the page body, or nothing in particular is focused belong
 * to the game (players should not have to click the canvas first). Keys aimed
 * at any other element — a link, button, checkbox or text field on the page or
 * in an HTML overlay — belong to that element.
 */
export function isGameKeyTarget(target: EventTarget | null, canvas: Element | null): boolean {
  if (target === null || target === canvas) return true;
  if (typeof document === 'undefined') return true;
  return target === document.body
    || target === document.documentElement
    || target === document
    || (typeof window !== 'undefined' && target === window);
}

/** Open the pause menu on whichever gameplay scene is currently running.
 *  Paused/stopped scenes are not returned by getScenes(true), so a run that is
 *  already paused, or over (its scene paused under ScoreScene), is left alone. */
export function pauseActiveRun(game: Phaser.Game): void {
  for (const scene of game.scene.getScenes(true)) {
    if (isPausableRun(scene)) { scene.openPauseMenu(); return; }
  }
}

/** Move keyboard focus back to the game canvas if it is somewhere else. */
export function refocusGame(game: Phaser.Game): void {
  const canvas = game.canvas;
  if (!canvas || typeof document === 'undefined') return;
  if (document.activeElement !== canvas) canvas.focus({ preventScroll: true });
}

export function installGameAccessibility(game: Phaser.Game): void {
  const setup = (): void => {
    const canvas = game.canvas;
    if (!canvas) return;

    canvas.id = CANVAS_ID;
    // role="application": in play, every key is handled by the game rather than
    // by the screen reader's browse mode. Menus are drawn on the same canvas.
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label', 'Heap game');
    canvas.setAttribute('aria-describedby', DESCRIPTION_ID);
    canvas.tabIndex = 0;

    // Clicking or tapping the game focuses it, so the focus ring and the key
    // gate below agree with where the player is actually playing. Pointer focus
    // does not match :focus-visible, so no outline appears for mouse/touch.
    canvas.addEventListener('pointerdown', () => {
      if (document.activeElement !== canvas) canvas.focus({ preventScroll: true });
    });

    // Capture phase on window runs before Phaser's own (bubble-phase) window
    // listener, so the decision is made before Phaser can preventDefault().
    // Decided per event rather than tracked with focusin/focusout, which miss
    // the case of a focused overlay being removed from the DOM.
    const keyboard = game.input.keyboard;
    if (keyboard) {
      window.addEventListener('keydown', (e) => {
        keyboard.enabled = shouldGameHandleKey(e.key, e.target, canvas);
      }, true);
      // Always let key-ups through, so a key held while focus moved away is
      // released in the game rather than sticking down.
      window.addEventListener('keyup', () => { keyboard.enabled = true; }, true);
    }

    // Focus moving to something outside the game (Tab past the canvas, a click
    // on a page link) pauses the run. Focus landing back on the body — e.g.
    // after an in-game HTML overlay closes — does not.
    document.addEventListener('focusin', (e) => {
      if (!isGameKeyTarget(e.target, canvas)) pauseActiveRun(game);
    });

    // The skip link jumps straight to the game. Focus it explicitly: some
    // browsers scroll to a fragment target without moving focus there.
    document.querySelectorAll<HTMLAnchorElement>('a[data-skip-to-game]').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        canvas.focus();
      });
    });
  };

  if (game.canvas) setup();
  else game.events.once('ready', setup);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') pauseActiveRun(game);
  });
  window.addEventListener('blur', () => pauseActiveRun(game));
}

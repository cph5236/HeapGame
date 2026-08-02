/**
 * Game → page-chrome notifications. The browser chrome around the canvas
 * (see web/pageChrome.ts) is not part of the Phaser scene graph, so scenes talk
 * to it through plain window events rather than an import.
 *
 * Every emitter is a no-op when there is no window (vitest runs in the node
 * environment) and harmless in the Android WebView, where nothing subscribes.
 */

export const HEAP_RUN_FINISHED_EVENT = 'heap:run-finished';

/**
 * Fired from ScoreScene when the player leaves the score screen for the menu —
 * i.e. they completed a run and are on their way back.
 *
 * Deliberately NOT fired from MenuScene.create(): MenuScene is in
 * RESIZE_SAFE_SCENES (main.ts), so it re-creates on every window resize, and it
 * self-restarts after a settings reset. Counting menu entries would make an
 * ordinary browser resize look like a finished run.
 */
export function notifyRunFinished(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(HEAP_RUN_FINISHED_EVENT));
}

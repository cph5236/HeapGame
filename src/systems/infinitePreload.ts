// Pure math for the infinite-mode loading screen (see InfiniteGameScene preload).
// Kept Phaser-free so it can be unit-tested in isolation.

/**
 * Loading-bar fill fraction, clamped to [0, 1].
 *
 * The bar reflects the *slower* of real band generation and a minimum-duration
 * ramp, so it always animates over at least `minMs` even when generation finishes
 * in a frame or two — otherwise it would flash straight to 100%. When generation
 * is the slower of the two (heavy device / many bands), it governs instead and the
 * minimum adds no extra wait.
 */
export function preloadProgress(
  done: number, total: number, elapsedMs: number, minMs: number,
): number {
  const genFrac  = total > 0 ? done / total : 1;
  const timeFrac = minMs > 0 ? elapsedMs / minMs : 1;
  return Math.max(0, Math.min(genFrac, timeFrac, 1));
}

/** Preload is done once every band is built AND the minimum duration has elapsed. */
export function preloadComplete(
  generationPending: boolean, elapsedMs: number, minMs: number,
): boolean {
  return !generationPending && elapsedMs >= minMs;
}

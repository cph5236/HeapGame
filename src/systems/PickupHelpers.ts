// src/systems/PickupHelpers.ts
//
// Pure helpers for PickupManager — no Phaser dependency, fully unit-testable.

/** Decide whether to spawn a salvage pickup on a freshly-spawned platform.
 *
 * @param rand         A random value in [0, 1) (injected for determinism).
 * @param lastSpawnY   World Y of the previous pickup, or null if none yet.
 * @param platformTopY World Y of the candidate platform surface.
 * @param minGapPx     Minimum vertical spacing between pickups.
 * @param chance       Probability in [0, 1] of spawning when spacing allows.
 */
export function shouldSpawnPickup(
  rand:         number,
  lastSpawnY:   number | null,
  platformTopY: number,
  minGapPx:     number,
  chance:       number,
): boolean {
  if (lastSpawnY !== null && Math.abs(lastSpawnY - platformTopY) < minGapPx) {
    return false;
  }
  return rand < chance;
}

interface PickupPos { x: number; y: number; collected: boolean; }

/** Index of the nearest uncollected pickup within rangePx of the player, or -1. */
export function findNearestInRange(
  playerX: number,
  playerY: number,
  pickups: readonly PickupPos[],
  rangePx: number,
): number {
  let best = -1;
  let bestDist = rangePx;
  for (let i = 0; i < pickups.length; i++) {
    const p = pickups[i];
    if (p.collected) continue;
    const dx = p.x - playerX;
    const dy = p.y - playerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

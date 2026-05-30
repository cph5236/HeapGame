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

export type PickupPolarity = 'positive' | 'negative';

/** Choose positive vs negative polarity weighted by the two rates.
 *  P(positive) = positiveRate / (positiveRate + negativeRate). When both rates
 *  are 0 there is no preference, so default to positive (avoids /0). */
export function pickPolarity(
  rand:         number,
  positiveRate: number,
  negativeRate: number,
): PickupPolarity {
  const total = positiveRate + negativeRate;
  if (total <= 0) return 'positive';
  return rand < positiveRate / total ? 'positive' : 'negative';
}

interface Pt { x: number; y: number; }

/** Midpoints of real heap surface edges within a band, for spawning pickups along
 *  the climbable terrain. Excludes the artificial horizontal cut edges inserted at
 *  the band's top/bottom clip boundaries (these cross the heap interior, not a
 *  surface). Mirrors the edge filtering used for enemy surface spawns. */
export function surfaceSpawnCandidates(
  vertices:   readonly Pt[],
  bandTopY:   number,
  bandHeight: number,
): Pt[] {
  if (vertices.length < 2) return [];
  const bandBottomY = bandTopY + bandHeight;
  const EPS = 0.5;
  const out: Pt[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % vertices.length];
    const atTopCut    = Math.abs(v1.y - bandTopY)    < EPS && Math.abs(v2.y - bandTopY)    < EPS;
    const atBottomCut = Math.abs(v1.y - bandBottomY) < EPS && Math.abs(v2.y - bandBottomY) < EPS;
    if (atTopCut || atBottomCut) continue;
    out.push({ x: (v1.x + v2.x) / 2, y: (v1.y + v2.y) / 2 });
  }
  return out;
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

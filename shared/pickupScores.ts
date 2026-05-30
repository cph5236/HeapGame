// shared/pickupScores.ts
//
// Authoritative salvage-pickup score values, shared by client and server. The
// server is the single source of truth for leaderboard scores, so the point
// value of each pickup and the anti-cheat cap on how many can be carried both
// live here — the client references these same numbers for its local display.

/** id → score bonus awarded when the item is carried to the top. */
export const PICKUP_BONUS: Record<string, number> = {
  'spring-coil':  250,
  'worn-boot':    250,
  'balloon':      500,
  'engine-block': 1200,
  'rusty-anchor': 1800,
};

/** Minimum vertical spacing between spawned pickups (must match PickupManager). */
export const SALVAGE_MIN_SPACING_PX = 700;

/** Extra items allowed beyond the height-derived bound (rounding / edge grace). */
const SALVAGE_ITEM_GRACE = 2;

/** Sum the bonuses for a list of carried item ids. Unknown ids contribute 0. */
export function computeSalvageBonus(itemIds: readonly string[]): number {
  let total = 0;
  for (const id of itemIds) total += PICKUP_BONUS[id] ?? 0;
  return total;
}

/** Plausible upper bound on carried items for a run of the given climb height.
 *  Pickups spawn at most ~1 per SALVAGE_MIN_SPACING_PX of climb, plus grace. */
export function maxSalvageItems(baseHeightPx: number): number {
  return Math.floor(Math.max(0, baseHeightPx) / SALVAGE_MIN_SPACING_PX) + SALVAGE_ITEM_GRACE;
}

// shared/pickupScores.ts
//
// Authoritative salvage-pickup score values, shared by client and server. The
// server is the single source of truth for leaderboard scores, so the point
// value of each pickup and the anti-cheat cap on how many can be carried both
// live here — the client references these same numbers for its local display.

/** id → score bonus awarded when the item is carried to the top. */
export const PICKUP_BONUS: Record<string, number> = {
  'spring-coil':    50,
  'worn-boot':      50,
  'balloon':        100,
  'engine-block':   240,
  'rusty-anchor':   360,
  'feather':        80,
  'overclock-chip': 100,
  'concrete-boots': 260,
  'fuel-canister':  400,
  'bubble-wrap':    0,    // free instant shield — never carried, never scored
  // Mixed-tradeoff negatives (each has an upside + a downside)
  'skateboard':           220,
  'box-spring':           260,
  'greasy-pizza-box':     220,
  'leaky-helium-tank':    300,
  'outboard-motor':       340,
  'folding-lawn-chair':   280,
  'anchor-chain':         380,
  'rusted-roller-skates': 320,
  'diving-board':         240,
  'sandbag-vest':         360,
};

/** Salvage rarity tiers. Anchored at 'rare' = 1x (the existing tuned values). */
export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary' | 'mythic';

/** Multiplier applied to both effect magnitude and score bonus, per tier.
 *  Single source of truth shared by client effect-scaling and server scoring. */
export const RARITY_SCORE_MULT: Record<Rarity, number> = {
  common:    0.75,
  uncommon:  0.90,
  rare:      1.00,
  legendary: 1.40,
  mythic:    2.00,
};

/** One carried salvage item: which item, and the rarity it was found at. */
export interface SalvageItem {
  id:     string;
  rarity: Rarity;
}

/** True when `r` is a known rarity tier (used for server-side validation). */
export function isRarity(r: unknown): r is Rarity {
  return typeof r === 'string' && r in RARITY_SCORE_MULT;
}

/** Minimum vertical spacing between spawned pickups (must match PickupManager). */
export const SALVAGE_MIN_SPACING_PX = 700;

/** Extra items allowed beyond the height-derived bound (rounding / edge grace). */
const SALVAGE_ITEM_GRACE = 2;

/** Sum the rarity-scaled bonuses for a list of carried items. Unknown ids or
 *  unknown rarities contribute 0. Each item is rounded independently so client
 *  and server agree exactly. */
export function computeSalvageBonus(items: readonly SalvageItem[]): number {
  let total = 0;
  for (const it of items) {
    const base = PICKUP_BONUS[it.id];
    const mult = RARITY_SCORE_MULT[it.rarity as Rarity];
    if (base === undefined || mult === undefined) continue;
    total += Math.round(base * mult);
  }
  return total;
}

/** Plausible upper bound on carried items for a run of the given climb height.
 *  Pickups spawn at most ~1 per SALVAGE_MIN_SPACING_PX of climb, plus grace. */
export function maxSalvageItems(baseHeightPx: number): number {
  return Math.floor(Math.max(0, baseHeightPx) / SALVAGE_MIN_SPACING_PX) + SALVAGE_ITEM_GRACE;
}

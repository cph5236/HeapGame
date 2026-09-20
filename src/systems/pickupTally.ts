// src/systems/pickupTally.ts
//
// Per-run pickup tally. Pure so it can be tested without a Phaser scene —
// PickupManager owns an instance and delegates to these functions.
//
// This replaces the old per-grab `pickup:grab` event, which cost one Analytics
// Engine data point for every pickup in every run and was the single largest
// consumer of the free-tier quota once analytics defaulted on. The tally rides
// along in the `run:end` event that already fires, for zero extra data points.

import { RARITY_SCORE_MULT, type Rarity } from '../../shared/pickupScores';

export interface PickupTally {
  /** Grab count per item id. */
  pickups: Record<string, number>;
  /** Sum of the AWARDED (rarity-scaled) bonuses. */
  pickupBonus: number;
}

export function emptyTally(): PickupTally {
  return { pickups: {}, pickupBonus: 0 };
}

/**
 * Records one grab, returning a new tally.
 *
 * `scoreBonus` is the item's BASE bonus; the figure added here is the
 * rarity-scaled one the player actually received. The old `pickup:grab` event
 * logged the base instead, which made every pickup-value number come out low —
 * do not reintroduce that by dropping the multiplier.
 */
export function recordGrab(
  tally: PickupTally, itemId: string, scoreBonus: number, rarity: Rarity,
): PickupTally {
  return {
    pickups: { ...tally.pickups, [itemId]: (tally.pickups[itemId] ?? 0) + 1 },
    pickupBonus: tally.pickupBonus + Math.round(scoreBonus * RARITY_SCORE_MULT[rarity]),
  };
}

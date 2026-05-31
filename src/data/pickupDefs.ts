// src/data/pickupDefs.ts
//
// Salvage pickups: collectible trash items that spawn on heap surfaces during a
// run. Picking one up applies its effect to the player (mixed good/bad) and adds
// its scoreBonus to the run total when the player reaches the top. Carried items
// stack — effects compose and bonuses sum (see aggregateModifiers).
//
// Point values come from shared/pickupScores so the client and the
// score-authoritative server agree on every bonus.

import { PICKUP_BONUS } from '../../shared/pickupScores';

export interface PickupEffect {
  /** Multiplies PLAYER_SPEED. 1 = no change, >1 faster, <1 heavier/slower. */
  speedMult:     number;
  /** Added to the player's jumpBoost (px/s). Positive = higher jump. */
  jumpBonus:     number;
  /** Added to the player's max air-jumps. */
  extraAirJumps: number;
  /** Multiplies the player's gravity. <1 floats, >1 sinks. (default 1) */
  gravityMult?:  number;
  /** Multiplies dash + wall-jump cooldowns. <1 = faster recharge. (default 1) */
  cooldownMult?: number;
  /** Multiplies the rising trash-wall speed. >1 = wall climbs faster. (default 1) */
  wallSpeedMult?: number;
}

export type PickupPolarity = 'positive' | 'negative';

export interface PickupDef {
  id:          string;
  name:        string;
  /** Short effect summary shown in the proximity overlay. */
  description: string;
  /** Tint / fallback rectangle colour. */
  color:       number;
  /** Whether the net effect helps (positive) or hinders (negative) the player.
   *  Drives the positive/negative spawn-rate mix from the heap params. */
  polarity:    PickupPolarity;
  effect:      PickupEffect;
  /** Points cashed in when carried to the top of the heap. */
  scoreBonus:  number;
  /** Instant-use item: on grab it activates a shield and is NOT carried (no
   *  stacking effect, no score bonus, no carry-cap cost). */
  grantsShield?: boolean;
}

export interface CarryModifiers {
  speedMult:     number;
  jumpBonus:     number;
  extraAirJumps: number;
  gravityMult:   number;
  cooldownMult:  number;
  wallSpeedMult: number;
  totalBonus:    number;
}

/** Aggregate a carried stack into a single set of modifiers + total bonus.
 *  Multiplier levers compose multiplicatively (omitted = identity 1); jump,
 *  air-jumps, and bonus sum. */
export function aggregateModifiers(carried: readonly PickupDef[]): CarryModifiers {
  return carried.reduce<CarryModifiers>(
    (acc, d) => ({
      speedMult:     acc.speedMult * d.effect.speedMult,
      jumpBonus:     acc.jumpBonus + d.effect.jumpBonus,
      extraAirJumps: acc.extraAirJumps + d.effect.extraAirJumps,
      gravityMult:   acc.gravityMult * (d.effect.gravityMult ?? 1),
      cooldownMult:  acc.cooldownMult * (d.effect.cooldownMult ?? 1),
      wallSpeedMult: acc.wallSpeedMult * (d.effect.wallSpeedMult ?? 1),
      totalBonus:    acc.totalBonus + d.scoreBonus,
    }),
    { speedMult: 1, jumpBonus: 0, extraAirJumps: 0,
      gravityMult: 1, cooldownMult: 1, wallSpeedMult: 1, totalBonus: 0 },
  );
}

export const PICKUP_DEFS: PickupDef[] = [
  {
    id:          'spring-coil',
    name:        'Spring Coil',
    description: '+ Jump height',
    color:       0x66ddff,
    polarity:    'positive',
    effect:      { speedMult: 1.0, jumpBonus: 120, extraAirJumps: 0 },
    scoreBonus:  PICKUP_BONUS['spring-coil'],
  },
  {
    id:          'worn-boot',
    name:        'Worn Boot',
    description: '+ Move speed',
    color:       0xc8a060,
    polarity:    'positive',
    effect:      { speedMult: 1.25, jumpBonus: 0, extraAirJumps: 0 },
    scoreBonus:  PICKUP_BONUS['worn-boot'],
  },
  {
    id:          'balloon',
    name:        'Balloon',
    description: '+1 Air jump',
    color:       0xff77cc,
    polarity:    'positive',
    effect:      { speedMult: 1.0, jumpBonus: 0, extraAirJumps: 1 },
    scoreBonus:  PICKUP_BONUS['balloon'],
  },
  {
    id:          'engine-block',
    name:        'Engine Block',
    description: 'Heavy: − speed, big points',
    color:       0x888888,
    polarity:    'negative',
    effect:      { speedMult: 0.7, jumpBonus: 0, extraAirJumps: 0 },
    scoreBonus:  PICKUP_BONUS['engine-block'],
  },
  {
    id:          'rusty-anchor',
    name:        'Rusty Anchor',
    description: 'Heavy: − speed & jump, huge points',
    color:       0x9a5a3a,
    polarity:    'negative',
    effect:      { speedMult: 0.8, jumpBonus: -80, extraAirJumps: 0 },
    scoreBonus:  PICKUP_BONUS['rusty-anchor'],
  },
  {
    id:          'feather',
    name:        'Feather',
    description: 'Floaty: lower gravity',
    color:       0xeeeeaa,
    polarity:    'positive',
    effect:      { speedMult: 1.0, jumpBonus: 0, extraAirJumps: 0, gravityMult: 0.7 },
    scoreBonus:  PICKUP_BONUS['feather'],
  },
  {
    id:          'overclock-chip',
    name:        'Overclock Chip',
    description: 'Faster dash & wall-jump',
    color:       0x44ff44,
    polarity:    'positive',
    effect:      { speedMult: 1.0, jumpBonus: 0, extraAirJumps: 0, cooldownMult: 0.5 },
    scoreBonus:  PICKUP_BONUS['overclock-chip'],
  },
  {
    id:          'bubble-wrap',
    name:        'Bubble Wrap',
    description: 'Absorb one hit · FREE',
    color:       0xaaffff,
    polarity:    'positive',
    effect:      { speedMult: 1.0, jumpBonus: 0, extraAirJumps: 0 },
    scoreBonus:  PICKUP_BONUS['bubble-wrap'],
    grantsShield: true,
  },
  {
    id:          'concrete-boots',
    name:        'Concrete Boots',
    description: 'Heavy: sink faster',
    color:       0x777788,
    polarity:    'negative',
    effect:      { speedMult: 1.0, jumpBonus: 0, extraAirJumps: 0, gravityMult: 1.4 },
    scoreBonus:  PICKUP_BONUS['concrete-boots'],
  },
  {
    id:          'fuel-canister',
    name:        'Fuel Canister',
    description: 'Risky: trash wall rises faster!',
    color:       0xff5522,
    polarity:    'negative',
    effect:      { speedMult: 1.0, jumpBonus: 0, extraAirJumps: 0, wallSpeedMult: 1.5 },
    scoreBonus:  PICKUP_BONUS['fuel-canister'],
  },
];

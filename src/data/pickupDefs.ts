// src/data/pickupDefs.ts
//
// Salvage pickups: collectible trash items that spawn on heap surfaces during a
// run. Picking one up applies its effect to the player (mixed good/bad) and adds
// its scoreBonus to the run total when the player reaches the top. Carried items
// stack — effects compose and bonuses sum (see aggregateModifiers).

export interface PickupEffect {
  /** Multiplies PLAYER_SPEED. 1 = no change, >1 faster, <1 heavier/slower. */
  speedMult:     number;
  /** Added to the player's jumpBoost (px/s). Positive = higher jump. */
  jumpBonus:     number;
  /** Added to the player's max air-jumps. */
  extraAirJumps: number;
}

export interface PickupDef {
  id:          string;
  name:        string;
  /** Short effect summary shown in the proximity overlay. */
  description: string;
  /** Tint / fallback rectangle colour. */
  color:       number;
  effect:      PickupEffect;
  /** Points cashed in when carried to the top of the heap. */
  scoreBonus:  number;
}

export interface CarryModifiers {
  speedMult:     number;
  jumpBonus:     number;
  extraAirJumps: number;
  totalBonus:    number;
}

/** Aggregate a carried stack into a single set of modifiers + total bonus.
 *  Speed multipliers compose multiplicatively; everything else sums. */
export function aggregateModifiers(carried: readonly PickupDef[]): CarryModifiers {
  return carried.reduce<CarryModifiers>(
    (acc, d) => ({
      speedMult:     acc.speedMult * d.effect.speedMult,
      jumpBonus:     acc.jumpBonus + d.effect.jumpBonus,
      extraAirJumps: acc.extraAirJumps + d.effect.extraAirJumps,
      totalBonus:    acc.totalBonus + d.scoreBonus,
    }),
    { speedMult: 1, jumpBonus: 0, extraAirJumps: 0, totalBonus: 0 },
  );
}

export const PICKUP_DEFS: PickupDef[] = [
  {
    id:          'spring-coil',
    name:        'Spring Coil',
    description: '+ Jump height',
    color:       0x66ddff,
    effect:      { speedMult: 1.0, jumpBonus: 120, extraAirJumps: 0 },
    scoreBonus:  250,
  },
  {
    id:          'worn-boot',
    name:        'Worn Boot',
    description: '+ Move speed',
    color:       0xc8a060,
    effect:      { speedMult: 1.25, jumpBonus: 0, extraAirJumps: 0 },
    scoreBonus:  250,
  },
  {
    id:          'balloon',
    name:        'Balloon',
    description: '+1 Air jump',
    color:       0xff77cc,
    effect:      { speedMult: 1.0, jumpBonus: 0, extraAirJumps: 1 },
    scoreBonus:  500,
  },
  {
    id:          'engine-block',
    name:        'Engine Block',
    description: 'Heavy: − speed, big points',
    color:       0x888888,
    effect:      { speedMult: 0.7, jumpBonus: 0, extraAirJumps: 0 },
    scoreBonus:  1200,
  },
  {
    id:          'rusty-anchor',
    name:        'Rusty Anchor',
    description: 'Heavy: − speed & jump, huge points',
    color:       0x9a5a3a,
    effect:      { speedMult: 0.8, jumpBonus: -80, extraAirJumps: 0 },
    scoreBonus:  1800,
  },
];

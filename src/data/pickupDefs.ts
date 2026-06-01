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
  /** Punchy on-brand flavour text shown in the overlay. The mechanical effect is
   *  auto-summarised separately (see formatEffectSummary). */
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

/** Compact human-readable summary of an effect, for the proximity overlay.
 *  Multiplier levers read as words (float/heavy, fast/slow cd, wall±); speed is a
 *  signed %, jump/air are signed numbers. Empty when the item has no stat effect
 *  (e.g. the instant shield). */
export function formatEffectSummary(effect: PickupEffect): string {
  const parts: string[] = [];
  if (effect.speedMult !== 1) {
    parts.push(`${effect.speedMult > 1 ? '+' : ''}${Math.round((effect.speedMult - 1) * 100)}% spd`);
  }
  if (effect.jumpBonus !== 0)     parts.push(`${effect.jumpBonus > 0 ? '+' : ''}${effect.jumpBonus} jump`);
  if (effect.extraAirJumps !== 0) parts.push(`${effect.extraAirJumps > 0 ? '+' : ''}${effect.extraAirJumps} air`);
  if ((effect.gravityMult  ?? 1) !== 1) parts.push(effect.gravityMult!  < 1 ? 'float'   : 'heavy');
  if ((effect.cooldownMult ?? 1) !== 1) parts.push(effect.cooldownMult! < 1 ? 'fast cd' : 'slow cd');
  if ((effect.wallSpeedMult ?? 1) !== 1) parts.push(effect.wallSpeedMult! > 1 ? 'wall+' : 'wall-');
  return parts.join(' · ');
}

export const PICKUP_DEFS: PickupDef[] = [
  {
    id:          'spring-coil',
    name:        'Spring Coil',
    description: 'Still has some spring left.',
    color:       0x66ddff,
    polarity:    'positive',
    effect:      { speedMult: 1.0, jumpBonus: 50, extraAirJumps: 0 },
    scoreBonus:  PICKUP_BONUS['spring-coil'],
  },
  {
    id:          'worn-boot',
    name:        'Worn Boot',
    description: 'One careful owner. Mostly.',
    color:       0xc8a060,
    polarity:    'positive',
    effect:      { speedMult: 1.15, jumpBonus: 0, extraAirJumps: 0 },
    scoreBonus:  PICKUP_BONUS['worn-boot'],
  },
  {
    id:          'balloon',
    name:        'Balloon',
    description: "Leftover from someone's party.",
    color:       0xff77cc,
    polarity:    'positive',
    effect:      { speedMult: 1.0, jumpBonus: 0, extraAirJumps: 1 },
    scoreBonus:  PICKUP_BONUS['balloon'],
  },
  {
    id:          'engine-block',
    name:        'Engine Block',
    description: 'Heavy hunk of nope.',
    color:       0x888888,
    polarity:    'negative',
    effect:      { speedMult: 0.75, jumpBonus: 0, extraAirJumps: 0 },
    scoreBonus:  PICKUP_BONUS['engine-block'],
  },
  {
    id:          'rusty-anchor',
    name:        'Rusty Anchor',
    description: 'Going nowhere fast.',
    color:       0x9a5a3a,
    polarity:    'negative',
    effect:      { speedMult: 0.8, jumpBonus: -80, extraAirJumps: 0 },
    scoreBonus:  PICKUP_BONUS['rusty-anchor'],
  },
  {
    id:          'feather',
    name:        'Feather',
    description: 'Light as, well, a feather.',
    color:       0xeeeeaa,
    polarity:    'positive',
    effect:      { speedMult: 1.0, jumpBonus: 0, extraAirJumps: 0, gravityMult: 0.92 },
    scoreBonus:  PICKUP_BONUS['feather'],
  },
  {
    id:          'overclock-chip',
    name:        'Overclock Chip',
    description: 'Runs hot. Runs fast.',
    color:       0x44ff44,
    polarity:    'positive',
    effect:      { speedMult: 1.0, jumpBonus: 0, extraAirJumps: 0, cooldownMult: 0.25 },
    scoreBonus:  PICKUP_BONUS['overclock-chip'],
  },
  {
    id:          'bubble-wrap',
    name:        'Bubble Wrap',
    description: 'Pop in case of emergency.',
    color:       0xaaffff,
    polarity:    'positive',
    effect:      { speedMult: 1.0, jumpBonus: 0, extraAirJumps: 0 },
    scoreBonus:  PICKUP_BONUS['bubble-wrap'],
    grantsShield: true,
  },
  {
    id:          'concrete-boots',
    name:        'Concrete Boots',
    description: 'A gift from the mob.',
    color:       0x777788,
    polarity:    'negative',
    effect:      { speedMult: 1.0, jumpBonus: 0, extraAirJumps: 0, gravityMult: 1.25 },
    scoreBonus:  PICKUP_BONUS['concrete-boots'],
  },
  {
    id:          'fuel-canister',
    name:        'Fuel Canister',
    description: 'Do not expose to open flame.',
    color:       0xff5522,
    polarity:    'negative',
    effect:      { speedMult: 1.0, jumpBonus: 0, extraAirJumps: 0, wallSpeedMult: 1.5 },
    scoreBonus:  PICKUP_BONUS['fuel-canister'],
  },

  // ── Mixed-tradeoff negatives (each has an upside + a downside) ──────────────
  {
    id:          'skateboard',
    name:        'Skateboard',
    description: 'Old worn-out skateboard.',
    color:       0xcc4444,
    polarity:    'negative',
    effect:      { speedMult: 1.15, jumpBonus: -50, extraAirJumps: 0 },
    scoreBonus:  PICKUP_BONUS['skateboard'],
  },
  {
    id:          'box-spring',
    name:        'Box Spring',
    description: "Yesterday's mattress, still bouncy.",
    color:       0xbbaa66,
    polarity:    'negative',
    effect:      { speedMult: 0.85, jumpBonus: 90, extraAirJumps: 0 },
    scoreBonus:  PICKUP_BONUS['box-spring'],
  },
  {
    id:          'greasy-pizza-box',
    name:        'Greasy Pizza Box',
    description: 'Smells like pizza and a good time.',
    color:       0xddaa55,
    polarity:    'negative',
    effect:      { speedMult: 1.15, jumpBonus: 0, extraAirJumps: 0, cooldownMult: 1.5 },
    scoreBonus:  PICKUP_BONUS['greasy-pizza-box'],
  },
  {
    id:          'leaky-helium-tank',
    name:        'Leaky Helium Tank',
    description: "The party's running out of air.",
    color:       0x99ddee,
    polarity:    'negative',
    effect:      { speedMult: 1.0, jumpBonus: 0, extraAirJumps: 0, gravityMult: 0.85, wallSpeedMult: 1.2 },
    scoreBonus:  PICKUP_BONUS['leaky-helium-tank'],
  },
  {
    id:          'outboard-motor',
    name:        'Outboard Motor',
    description: 'Still runs. Wakes the whole heap.',
    color:       0x556677,
    polarity:    'negative',
    effect:      { speedMult: 1.3, jumpBonus: 0, extraAirJumps: 0, wallSpeedMult: 1.3 },
    scoreBonus:  PICKUP_BONUS['outboard-motor'],
  },
  {
    id:          'folding-lawn-chair',
    name:        'Folding Lawn Chair',
    description: 'Seen better summers.',
    color:       0x55bb88,
    polarity:    'negative',
    effect:      { speedMult: 1.0, jumpBonus: 0, extraAirJumps: 1, gravityMult: 1.15 },
    scoreBonus:  PICKUP_BONUS['folding-lawn-chair'],
  },
  {
    id:          'anchor-chain',
    name:        'Anchor Chain',
    description: 'Goes down with the ship.',
    color:       0x667788,
    polarity:    'negative',
    effect:      { speedMult: 1.0, jumpBonus: 0, extraAirJumps: 0, gravityMult: 1.3, wallSpeedMult: 0.75 },
    scoreBonus:  PICKUP_BONUS['anchor-chain'],
  },
  {
    id:          'rusted-roller-skates',
    name:        'Rusted Roller Skates',
    description: "Fast. Stopping's your problem.",
    color:       0xbb6644,
    polarity:    'negative',
    effect:      { speedMult: 1.3, jumpBonus: -90, extraAirJumps: 0 },
    scoreBonus:  PICKUP_BONUS['rusted-roller-skates'],
  },
  {
    id:          'diving-board',
    name:        'Diving Board',
    description: 'No pool for miles.',
    color:       0x88aacc,
    polarity:    'negative',
    effect:      { speedMult: 1.0, jumpBonus: 70, extraAirJumps: 0, cooldownMult: 1.5 },
    scoreBonus:  PICKUP_BONUS['diving-board'],
  },
  {
    id:          'sandbag-vest',
    name:        'Sandbag Vest',
    description: 'Heavy, but it buys you time.',
    color:       0xaa9966,
    polarity:    'negative',
    effect:      { speedMult: 0.8, jumpBonus: 0, extraAirJumps: 0, wallSpeedMult: 0.7 },
    scoreBonus:  PICKUP_BONUS['sandbag-vest'],
  },
];

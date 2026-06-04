// src/data/consumableDefs.ts
//
// Run-time behavior for store consumables, keyed by item id. Storefront data
// (name/cost/description/category) lives in itemDefs.ts; this file owns what a
// consumable DOES when activated. Adding a consumable = one ITEM_DEFS entry +
// one entry here.

import type { PickupEffect } from './pickupDefs';

export type ConsumableBehavior =
  | { kind: 'modifier'; durationMs: number | null; effect: Partial<PickupEffect> } // null = whole-run
  | { kind: 'shield' }
  | { kind: 'revive' };

export const CONSUMABLE_DEFS: Record<string, ConsumableBehavior> = {
  shield:     { kind: 'shield' },
  revive:     { kind: 'revive' },
  adrenaline: { kind: 'modifier', durationMs: 30_000, effect: { speedMult: 1.3 } },
  pogo:       { kind: 'modifier', durationMs: 30_000, effect: { jumpBonus: 75 } },
  stall:      { kind: 'modifier', durationMs: 15_000, effect: { wallSpeedMult: 0.25 } },
};

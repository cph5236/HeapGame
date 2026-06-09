// src/data/itemDefs.ts

import type { ItemId } from '../../shared/itemIds';

// 'cosmetic' is reserved for a future store category (no items/handlers yet).
export type ItemCategory = 'placeable' | 'consumable' | 'cosmetic';

export interface Item {
  id:             ItemId;
  name:           string;
  description:    string;
  cost:           number;
  category:       ItemCategory;
  persistsOnHeap: boolean;
}

export const ITEM_DEFS: Item[] = [
  {
    id:             'ladder',
    name:           'Ladder',
    description:    'Climb the heap. Place on any surface.',
    cost:           300,
    category:       'placeable',
    persistsOnHeap: true,
  },
  {
    id:             'ibeam',
    name:           'I-Beam',
    description:    'One-way platform. Jump up through it and stand on top.',
    cost:           750,
    category:       'placeable',
    persistsOnHeap: true,
  },
  {
    id:             'checkpoint',
    name:           'Checkpoint',
    description:    'Respawn here up to 5 times. Flat surfaces only. 1 active at a time.',
    cost:           1000,
    category:       'placeable',
    persistsOnHeap: true,
  },
  {
    id:             'shield',
    name:           'Shield',
    description:    'Absorb one fatal hit. Activates immediately.',
    cost:           150,
    category:       'consumable',
    persistsOnHeap: false,
  },
  {
    id:             'revive',
    name:           'Revive',
    description:    'Respawn once if a hit would kill you.',
    cost:           400,
    category:       'consumable',
    persistsOnHeap: false,
  },
  {
    id:             'adrenaline',
    name:           'Adrenaline',
    description:    'Surge of speed for 30 seconds.',
    cost:           200,
    category:       'consumable',
    persistsOnHeap: false,
  },
  {
    id:             'pogo',
    name:           'Pogo Spring',
    description:    'Higher jumps for 30 seconds.',
    cost:           200,
    category:       'consumable',
    persistsOnHeap: false,
  },
  {
    id:             'stall',
    name:           'Stall',
    description:    'Slow the rising trash for 15 seconds.',
    cost:           250,
    category:       'consumable',
    persistsOnHeap: false,
  },
];

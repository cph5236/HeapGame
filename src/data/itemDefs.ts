// src/data/itemDefs.ts

export type ItemCategory = 'placeable' | 'buff';

export interface Item {
  id:             string;
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
    cost:           200,
    category:       'placeable',
    persistsOnHeap: true,
  },
  {
    id:             'checkpoint',
    name:           'Checkpoint',
    description:    'Respawn here up to 5 times. Flat surfaces only. 1 active at a time.',
    cost:           500,
    category:       'placeable',
    persistsOnHeap: true,
  },
  {
    id:             'shield',
    name:           'Shield',
    description:    'Absorb one fatal hit. Activates immediately.',
    cost:           400,
    category:       'buff',
    persistsOnHeap: false,
  },
];

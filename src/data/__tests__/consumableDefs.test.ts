import { describe, it, expect } from 'vitest';
import { ITEM_DEFS } from '../itemDefs';
import { CONSUMABLE_DEFS } from '../consumableDefs';

describe('consumable defs ↔ item defs consistency', () => {
  const consumableIds = ITEM_DEFS.filter(i => i.category === 'consumable').map(i => i.id);

  it('every consumable store item has a behavior', () => {
    for (const id of consumableIds) {
      expect(CONSUMABLE_DEFS[id], `missing behavior for ${id}`).toBeDefined();
    }
  });

  it('every behavior maps to a consumable store item', () => {
    const ids = new Set(consumableIds as string[]);
    for (const id of Object.keys(CONSUMABLE_DEFS)) {
      expect(ids.has(id), `behavior ${id} has no consumable item`).toBe(true);
    }
  });

  it('includes the five first-batch consumables', () => {
    for (const id of ['shield', 'revive', 'adrenaline', 'pogo', 'stall']) {
      expect(CONSUMABLE_DEFS[id]).toBeDefined();
    }
  });
});

import { describe, it, expect } from 'vitest';
import { ITEM_IDS } from '../itemIds';
import { ITEM_DEFS } from '../../src/data/itemDefs';

describe('ITEM_IDS', () => {
  it('exactly matches the ids declared in ITEM_DEFS (no drift)', () => {
    const defIds = ITEM_DEFS.map(d => d.id).sort();
    const sharedIds = [...ITEM_IDS].sort();
    expect(sharedIds).toEqual(defIds);
  });
});

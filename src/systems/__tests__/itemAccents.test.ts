import { describe, it, expect } from 'vitest';
import { ACCENT_COLORS } from '../../data/itemAccents';
import { ITEM_DEFS } from '../../data/itemDefs';

describe('ACCENT_COLORS', () => {
  it('has a color for every item def', () => {
    for (const def of ITEM_DEFS) {
      expect(ACCENT_COLORS[def.id], `missing accent for ${def.id}`).toBeTypeOf('number');
    }
  });

  it('values are valid 24-bit colors', () => {
    for (const c of Object.values(ACCENT_COLORS)) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(0xffffff);
    }
  });
});

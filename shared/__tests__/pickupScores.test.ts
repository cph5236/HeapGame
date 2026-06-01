import { describe, it, expect } from 'vitest';
import {
  PICKUP_BONUS,
  SALVAGE_MIN_SPACING_PX,
  computeSalvageBonus,
  maxSalvageItems,
} from '../pickupScores';

describe('computeSalvageBonus', () => {
  it('returns 0 for an empty list', () => {
    expect(computeSalvageBonus([])).toBe(0);
  });

  it('sums known item bonuses', () => {
    const ids = ['spring-coil', 'engine-block']; // 250 + 1200
    expect(computeSalvageBonus(ids)).toBe(PICKUP_BONUS['spring-coil'] + PICKUP_BONUS['engine-block']);
  });

  it('ignores unknown ids (counts them as 0)', () => {
    expect(computeSalvageBonus(['spring-coil', 'totally-fake'])).toBe(PICKUP_BONUS['spring-coil']);
  });
});

describe('maxSalvageItems', () => {
  it('allows more items the higher you climb', () => {
    const low  = maxSalvageItems(SALVAGE_MIN_SPACING_PX);       // ~1 spacing
    const high = maxSalvageItems(SALVAGE_MIN_SPACING_PX * 10);  // ~10 spacings
    expect(high).toBeGreaterThan(low);
  });

  it('allows at least a small number of items at zero height (grace)', () => {
    expect(maxSalvageItems(0)).toBeGreaterThanOrEqual(1);
  });

  it('scales roughly with height / spacing', () => {
    // 10 spacings of climb → at least 10 items permitted
    expect(maxSalvageItems(SALVAGE_MIN_SPACING_PX * 10)).toBeGreaterThanOrEqual(10);
  });
});

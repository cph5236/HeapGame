import { describe, it, expect } from 'vitest';
import {
  PICKUP_BONUS,
  SALVAGE_MIN_SPACING_PX,
  computeSalvageBonus,
  maxSalvageItems,
  RARITY_SCORE_MULT,
} from '../pickupScores';

describe('computeSalvageBonus', () => {
  it('returns 0 for an empty list', () => {
    expect(computeSalvageBonus([])).toBe(0);
  });

  it('sums known item bonuses at Rare (1x identity)', () => {
    const items = [
      { id: 'spring-coil', rarity: 'rare' as const },
      { id: 'engine-block', rarity: 'rare' as const },
    ];
    expect(computeSalvageBonus(items)).toBe(
      PICKUP_BONUS['spring-coil'] + PICKUP_BONUS['engine-block'],
    );
  });

  it('ignores unknown ids (counts them as 0)', () => {
    const items = [
      { id: 'spring-coil', rarity: 'rare' as const },
      { id: 'totally-fake', rarity: 'rare' as const },
    ];
    expect(computeSalvageBonus(items)).toBe(PICKUP_BONUS['spring-coil']);
  });

  it('scales the bonus by rarity multiplier, rounded per item', () => {
    // spring-coil = 50. Common 0.75 -> 38 (round(37.5)); Mythic 2.0 -> 100.
    expect(computeSalvageBonus([{ id: 'spring-coil', rarity: 'common' }])).toBe(38);
    expect(computeSalvageBonus([{ id: 'spring-coil', rarity: 'mythic' }])).toBe(100);
  });

  it('treats an unknown rarity as 0 contribution', () => {
    // @ts-expect-error intentionally bad rarity to prove it is ignored, not NaN
    expect(computeSalvageBonus([{ id: 'spring-coil', rarity: 'ultra' }])).toBe(0);
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

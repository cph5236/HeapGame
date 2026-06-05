import { describe, it, expect } from 'vitest';
import {
  PICKUP_BONUS,
  SALVAGE_MIN_SPACING_PX,
  computeSalvageBonus,
  maxSalvageItems,
  isRarity,
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

  it('does not let inherited object keys poison the sum with NaN', () => {
    // 'constructor'/'toString' exist on Object.prototype; a hostile client could
    // send them. They must contribute 0, not a function-times-number NaN.
    const result = computeSalvageBonus([
      { id: 'spring-coil', rarity: 'rare' },
      // @ts-expect-error hostile rarity key from the prototype chain
      { id: 'spring-coil', rarity: 'constructor' },
      // @ts-expect-error hostile id key from the prototype chain
      { id: 'toString', rarity: 'rare' },
    ]);
    expect(result).toBe(PICKUP_BONUS['spring-coil']); // only the valid item counts
    expect(Number.isNaN(result)).toBe(false);
  });
});

describe('isRarity', () => {
  it('accepts the five known tiers', () => {
    for (const r of ['common', 'uncommon', 'rare', 'legendary', 'mythic']) {
      expect(isRarity(r)).toBe(true);
    }
  });

  it('rejects unknown strings, non-strings, and inherited proto keys', () => {
    expect(isRarity('ultra')).toBe(false);
    expect(isRarity('constructor')).toBe(false);
    expect(isRarity('toString')).toBe(false);
    expect(isRarity('hasOwnProperty')).toBe(false);
    expect(isRarity(undefined)).toBe(false);
    expect(isRarity(3)).toBe(false);
    expect(isRarity(null)).toBe(false);
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

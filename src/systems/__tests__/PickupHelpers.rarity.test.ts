import { describe, it, expect } from 'vitest';
import { pickRarity } from '../PickupHelpers';
import { RARITY_DEFS } from '../../data/pickupDefs';
import type { Rarity } from '../../../shared/pickupScores';

const WEIGHTS = (Object.keys(RARITY_DEFS) as Rarity[]).map(
  r => [r, RARITY_DEFS[r].spawnWeight] as [Rarity, number],
);

describe('pickRarity', () => {
  it('returns the first tier when rand is 0', () => {
    expect(pickRarity(0, WEIGHTS)).toBe('common');
  });

  it('returns the last tier when rand is just below 1', () => {
    expect(pickRarity(0.999999, WEIGHTS)).toBe('mythic');
  });

  it('selects the tier whose cumulative band contains rand', () => {
    // total weight 100; common band [0,0.5), uncommon [0.5,0.78), rare [0.78,0.93)
    expect(pickRarity(0.40, WEIGHTS)).toBe('common');
    expect(pickRarity(0.60, WEIGHTS)).toBe('uncommon');
    expect(pickRarity(0.85, WEIGHTS)).toBe('rare');
  });

  it('roughly matches the weight distribution over many rolls', () => {
    const counts: Record<string, number> = {};
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const r = pickRarity((i + 0.5) / N, WEIGHTS);
      counts[r] = (counts[r] ?? 0) + 1;
    }
    // common ~50% — allow a wide tolerance band
    expect(counts['common'] / N).toBeGreaterThan(0.45);
    expect(counts['common'] / N).toBeLessThan(0.55);
    expect(counts['mythic'] / N).toBeLessThan(0.03);
  });
});

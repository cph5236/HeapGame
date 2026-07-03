import { describe, it, expect } from 'vitest';
import { COSMETIC_ART, isCosmeticArtAvailable, getAvailableCosmeticDefs } from '../cosmeticArt';
import { COSMETIC_DEFS } from '../cosmeticDefs';

describe('cosmetic art manifest', () => {
  it('every manifest key follows cos-<id> and maps to a real catalog id', () => {
    const ids = new Set(COSMETIC_DEFS.map(d => d.id));
    for (const key of Object.keys(COSMETIC_ART)) {
      expect(key.startsWith('cos-')).toBe(true);
      expect(ids.has(key.slice(4)), `stray art file for unknown id ${key}`).toBe(true);
    }
  });

  it('procedural items are always available', () => {
    for (const def of COSMETIC_DEFS) {
      if (def.slot === 'tie' || def.slot === 'skin' || def.slot === 'trail') {
        expect(isCosmeticArtAvailable(def)).toBe(true);
      }
    }
  });

  it('getAvailableCosmeticDefs never returns a PNG item without art', () => {
    for (const def of getAvailableCosmeticDefs()) {
      expect(isCosmeticArtAvailable(def)).toBe(true);
    }
  });
});

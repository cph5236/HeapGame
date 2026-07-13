import { describe, it, expect } from 'vitest';
import { COSMETIC_ART, PART_EYE_WHITE, PART_PUPIL, isCosmeticArtAvailable, getAvailableCosmeticDefs } from '../cosmeticArt';
import { COSMETIC_DEFS } from '../cosmeticDefs';

// Shared rig part textures (parts/*.png) are not catalog items — they back
// the physics-driven EyeRig and are exempt from the id-mapping check below.
const SHARED_PART_KEYS = new Set([PART_EYE_WHITE, PART_PUPIL]);

describe('cosmetic art manifest', () => {
  it('every manifest key follows cos-<id> and maps to a real catalog id', () => {
    const ids = new Set(COSMETIC_DEFS.map(d => d.id));
    for (const key of Object.keys(COSMETIC_ART)) {
      if (SHARED_PART_KEYS.has(key)) continue;
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

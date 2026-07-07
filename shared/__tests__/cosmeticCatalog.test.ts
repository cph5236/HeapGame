import { describe, it, expect } from 'vitest';
import {
  COSMETIC_CATALOG, COSMETIC_SLOTS, getCatalogEntry, validateLoadout,
} from '../cosmeticCatalog';

describe('COSMETIC_CATALOG integrity', () => {
  it('has 88 entries with unique ids', () => {
    expect(COSMETIC_CATALOG.length).toBe(91);
    const ids = COSMETIC_CATALOG.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every entry has a valid slot', () => {
    for (const e of COSMETIC_CATALOG) {
      expect(COSMETIC_SLOTS).toContain(e.slot);
    }
  });

  it('per-slot counts match the design', () => {
    const count = (slot: string) => COSMETIC_CATALOG.filter(e => e.slot === slot).length;
    expect(count('tie')).toBe(12);
    expect(count('skin')).toBe(8);
    expect(count('hat')).toBe(50);
    expect(count('face')).toBe(13);
    expect(count('trail')).toBe(8);
  });

  it('getCatalogEntry finds known ids and misses unknown ones', () => {
    expect(getCatalogEntry('hat_cone')?.slot).toBe('hat');
    expect(getCatalogEntry('nope')).toBeUndefined();
  });
});

describe('validateLoadout', () => {
  it('accepts a valid loadout and returns a normalized copy', () => {
    expect(validateLoadout({ hat: 'hat_cone', tie: 'tie_gold' }))
      .toEqual({ hat: 'hat_cone', tie: 'tie_gold' });
  });

  it('accepts the empty loadout', () => {
    expect(validateLoadout({})).toEqual({});
  });

  it('rejects non-objects', () => {
    expect(validateLoadout(null)).toBeNull();
    expect(validateLoadout('hat_cone')).toBeNull();
    expect(validateLoadout(['hat_cone'])).toBeNull();
    expect(validateLoadout(undefined)).toBeNull();
  });

  it('rejects unknown slot keys', () => {
    expect(validateLoadout({ pants: 'hat_cone' })).toBeNull();
  });

  it('rejects unknown item ids', () => {
    expect(validateLoadout({ hat: 'hat_nonexistent' })).toBeNull();
  });

  it('rejects an id equipped in the wrong slot', () => {
    expect(validateLoadout({ face: 'hat_cone' })).toBeNull();
  });

  it('rejects non-string values', () => {
    expect(validateLoadout({ hat: 42 })).toBeNull();
  });
});

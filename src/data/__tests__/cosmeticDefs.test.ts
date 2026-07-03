import { describe, it, expect } from 'vitest';
import { COSMETIC_DEFS, getCosmeticDef } from '../cosmeticDefs';
import { COSMETIC_CATALOG, getCatalogEntry } from '../../../shared/cosmeticCatalog';

describe('COSMETIC_DEFS integrity', () => {
  it('covers the shared catalog exactly (same ids, same slots)', () => {
    expect(COSMETIC_DEFS.length).toBe(COSMETIC_CATALOG.length);
    for (const def of COSMETIC_DEFS) {
      const entry = getCatalogEntry(def.id);
      expect(entry, `def ${def.id} missing from shared catalog`).toBeDefined();
      expect(entry!.slot).toBe(def.slot);
    }
  });

  it('render spec kind matches the slot', () => {
    for (const def of COSMETIC_DEFS) {
      expect(def.render.kind).toBe(def.slot);
    }
  });

  it('prices are non-negative integers', () => {
    for (const def of COSMETIC_DEFS) {
      expect(Number.isInteger(def.price)).toBe(true);
      expect(def.price).toBeGreaterThanOrEqual(0);
    }
  });

  it('tie and skin slots each have at least one free item', () => {
    expect(COSMETIC_DEFS.some(d => d.slot === 'tie'  && d.price === 0)).toBe(true);
    expect(COSMETIC_DEFS.some(d => d.slot === 'skin' && d.price === 0)).toBe(true);
  });

  it('PNG items use the cos-<id> texture key convention', () => {
    for (const def of COSMETIC_DEFS) {
      if (def.render.kind === 'hat' || def.render.kind === 'face') {
        expect(def.render.textureKey).toBe(`cos-${def.id}`);
      }
    }
  });

  it('getCosmeticDef resolves ids', () => {
    expect(getCosmeticDef('tie_gold')?.price).toBeGreaterThan(0);
    expect(getCosmeticDef('missing')).toBeUndefined();
  });
});

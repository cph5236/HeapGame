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

  it('render spec kind matches the slot (eyes allowed on face)', () => {
    for (const def of COSMETIC_DEFS) {
      if (def.render.kind === 'eyes') expect(def.slot).toBe('face');
      else expect(def.render.kind).toBe(def.slot);
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
      if (def.render.kind === 'hat' || def.render.kind === 'face' || def.render.kind === 'eyes') {
        expect(def.render.textureKey).toBe(`cos-${def.id}`);
      }
    }
  });

  it('getCosmeticDef resolves ids', () => {
    expect(getCosmeticDef('tie_gold')?.price).toBeGreaterThan(0);
    expect(getCosmeticDef('missing')).toBeUndefined();
  });

  it('the four eye items use the eyes render kind', () => {
    for (const id of ['face_googly', 'face_wonkyeyes', 'face_lazyeye', 'face_walleyes']) {
      expect(getCosmeticDef(id)?.render.kind).toBe('eyes');
    }
  });

  it('eyes defs are physically valid (rest pose within track radius, 2 eyes)', () => {
    for (const def of COSMETIC_DEFS) {
      if (def.render.kind !== 'eyes') continue;
      expect(def.render.eyes.length).toBe(2);
      for (const eye of def.render.eyes) {
        expect(eye.radius).toBeGreaterThan(0);
        expect(Math.hypot(eye.restX, eye.restY)).toBeLessThanOrEqual(eye.radius);
        expect(eye.whiteScale).toBeGreaterThan(0);
        expect(eye.pupilScale).toBeGreaterThan(0);
      }
    }
  });

  it('sheet anims declare positive frame dimensions and rate', () => {
    for (const def of COSMETIC_DEFS) {
      const anim = (def.render.kind === 'hat' || def.render.kind === 'face') ? def.render.anim : undefined;
      if (anim?.type === 'sheet') {
        expect(anim.frameW).toBeGreaterThan(0);
        expect(anim.frameH).toBeGreaterThan(0);
        expect(anim.frameRate).toBeGreaterThan(0);
      }
    }
  });
});

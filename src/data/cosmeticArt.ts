//
// Auto-built manifest of cosmetic PNG art. Drop `<id>.png` (e.g. hat_cone.png)
// into src/sprites/cosmetics/{hats,face}/ and it is registered under texture
// key `cos-<id>` with no code change. Items with no file are simply filtered
// out of the store (isCosmeticArtAvailable) until their art lands.

import { COSMETIC_DEFS, type CosmeticDef } from './cosmeticDefs';

const files: Record<string, string> = {
  ...(import.meta.glob('../sprites/cosmetics/hats/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
  ...(import.meta.glob('../sprites/cosmetics/face/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
};

/** textureKey (`cos-<id>`) → asset URL */
export const COSMETIC_ART: Record<string, string> = {};
for (const [path, url] of Object.entries(files)) {
  const stem = path.split('/').pop()!.replace(/\.png$/, '');
  COSMETIC_ART[`cos-${stem}`] = url;
}

export function isCosmeticArtAvailable(def: CosmeticDef): boolean {
  if (def.render.kind === 'hat' || def.render.kind === 'face' || def.render.kind === 'eyes') {
    return def.render.textureKey in COSMETIC_ART;
  }
  return true;
}

/** The purchasable/equippable catalog: procedural items + PNG items whose art exists. */
export function getAvailableCosmeticDefs(): CosmeticDef[] {
  return COSMETIC_DEFS.filter(isCosmeticArtAvailable);
}

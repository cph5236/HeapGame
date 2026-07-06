//
// Pure loadout → render-spec resolution. No Phaser imports — unit-testable
// and shared by the in-game renderer, the avatar compositor, and the editor.

import type { EquippedLoadout } from '../../shared/cosmeticCatalog';
import {
  getCosmeticDef, DEFAULT_TIE_COLOR,
  type HatRender, type FaceRender, type TrailRender,
} from '../data/cosmeticDefs';

/** Resolved hat also carries the def's un-adjusted scale, so the renderer can
 *  keep the hat's bottom edge anchored in place as the player's dScale tweak
 *  grows/shrinks it (scaling should expand upward, not from the center). */
export interface ResolvedHatRender extends HatRender { defScale: number }

export interface ResolvedCosmetics {
  tieColor:   number;
  tieRainbow: boolean;
  skinTint:   number | null;   // null = no tint
  hat:        ResolvedHatRender | null;
  face:       FaceRender | null;
  trail:      TrailRender | null;
}

/** Player's per-hat fit tweak, relative to the def's designer defaults.
 *  dAngle in degrees, dScale a multiplier on the def's scale. */
export interface HatAdjustment { dAngle: number; dScale: number }
export type HatAdjustments = Record<string, HatAdjustment>;

export const HAT_ANGLE_LIMIT = 15;    // degrees either way from the default
export const HAT_SCALE_MIN   = 0.8;   // ×0.8 .. ×1.2 of the default size
export const HAT_SCALE_MAX   = 1.2;

export function clampHatAdjustment(adj: HatAdjustment): HatAdjustment {
  return {
    dAngle: Math.max(-HAT_ANGLE_LIMIT, Math.min(HAT_ANGLE_LIMIT, adj.dAngle)),
    dScale: Math.max(HAT_SCALE_MIN, Math.min(HAT_SCALE_MAX, adj.dScale)),
  };
}

export function resolveCosmetics(
  equipped:    EquippedLoadout,
  adjustments: HatAdjustments = {},
): ResolvedCosmetics {
  const out: ResolvedCosmetics = {
    tieColor: DEFAULT_TIE_COLOR, tieRainbow: false,
    skinTint: null, hat: null, face: null, trail: null,
  };

  const tieDef = equipped.tie ? getCosmeticDef(equipped.tie) : undefined;
  if (tieDef?.render.kind === 'tie') {
    out.tieColor   = tieDef.render.color;
    out.tieRainbow = tieDef.render.rainbow ?? false;
  }

  const skinDef = equipped.skin ? getCosmeticDef(equipped.skin) : undefined;
  if (skinDef?.render.kind === 'skin' && skinDef.render.tint !== 0xffffff) {
    out.skinTint = skinDef.render.tint;
  }

  const hatDef = equipped.hat ? getCosmeticDef(equipped.hat) : undefined;
  if (hatDef?.render.kind === 'hat') {
    const raw = equipped.hat !== undefined ? adjustments[equipped.hat] : undefined;
    if (raw) {
      const adj = clampHatAdjustment(raw);
      out.hat = {
        ...hatDef.render,
        angle: hatDef.render.angle + adj.dAngle,
        scale: hatDef.render.scale * adj.dScale,
        defScale: hatDef.render.scale,
      };
    } else {
      out.hat = { ...hatDef.render, defScale: hatDef.render.scale };
    }
  }

  const faceDef = equipped.face ? getCosmeticDef(equipped.face) : undefined;
  if (faceDef?.render.kind === 'face') out.face = faceDef.render;

  const trailDef = equipped.trail ? getCosmeticDef(equipped.trail) : undefined;
  if (trailDef?.render.kind === 'trail') out.trail = trailDef.render;

  return out;
}

const RAINBOW_PERIOD_MS = 3000;

/** Hue-cycling color for the rainbow tie. Pure HSV→RGB, no Phaser. */
export function rainbowColorAt(timeMs: number): number {
  const h = (timeMs % RAINBOW_PERIOD_MS) / RAINBOW_PERIOD_MS;   // 0..1
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const q = 1 - f;
  let r = 0, g = 0, b = 0;
  switch (i % 6) {
    case 0: r = 1; g = f; b = 0; break;
    case 1: r = q; g = 1; b = 0; break;
    case 2: r = 0; g = 1; b = f; break;
    case 3: r = 0; g = q; b = 1; break;
    case 4: r = f; g = 0; b = 1; break;
    case 5: r = 1; g = 0; b = q; break;
  }
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

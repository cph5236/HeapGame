// src/entities/cosmeticRigs/trailEmitter.ts
//
// One trail definition → one Phaser emitter config, shared by the in-game
// player (PlayerCosmetics) and the character portraits (ui/avatar). Keeping it
// in one place is what stops the shop preview from drifting away from what the
// trail actually looks like during a run.

import type Phaser from 'phaser';
import type { TrailRender } from '../../data/cosmeticDefs';
import { rainbowColorAt, RAINBOW_PERIOD_MS } from '../../systems/cosmeticsLogic';

/** Sideways scatter on top of the item's own vertical motion. */
const SPREAD_X = 20;

export interface TrailEmitterOpts {
  /** Multiplies particle size and speed — portraits render the bag several
   *  times game size, and an unscaled trail looks like dust next to it. */
  scale?: number;
  /** Constant drift added to every particle, px/s. The portraits use it to
   *  stream the trail off one shoulder; in game it stays 0 and the player's
   *  own movement does the work. */
  driftX?: number;
  driftY?: number;
  /** Stretches how long each particle lives. A portrait's character never
   *  moves away from its own wake, so the plume needs to outlive the short
   *  lifespans tuned for a player travelling at speed. */
  lifespanScale?: number;
}

/** `hueMs` is read at emit time, not build time: it's the caller's own clock,
 *  so a rainbow trail colors each particle as it is born. */
export function trailEmitterConfig(
  t: TrailRender,
  hueMs: () => number,
  opts: TrailEmitterOpts = {},
): Phaser.Types.GameObjects.Particles.ParticleEmitterConfig {
  const k  = opts.scale ?? 1;
  const dx = opts.driftX ?? 0;
  const dy = opts.driftY ?? 0;
  // Run the hue fast enough that one particle lifetime spans a full cycle.
  // Slower and the dozen particles alive at any moment share near-identical
  // hues, which reads as a plain colored trail that slowly changes.
  const lifespan = t.lifespan * (opts.lifespanScale ?? 1);
  const hueRate = RAINBOW_PERIOD_MS / lifespan;
  return {
    // `tint` is an EmitterOp, so an onEmit callback is read per particle.
    tint:      t.rainbow ? { onEmit: () => rainbowColorAt(hueMs() * hueRate) } : t.tint,
    frequency: t.frequency,
    speedX:    { min: (dx - SPREAD_X) * k,   max: (dx + SPREAD_X) * k },
    speedY:    { min: (dy + t.speedY[0]) * k, max: (dy + t.speedY[1]) * k },
    lifespan,
    scale:     { start: t.scale[0] * k, end: t.scale[1] * k },
    alpha:     { start: t.alpha, end: 0 },
  };
}

import {
  CEILING_DEFLECT_FACTOR,
  CEILING_DEFLECT_MIN_SLOPE_DEG,
  PLAYER_AIR_MAX_SPEED,
} from '../constants';

/**
 * Outward horizontal velocity for a rising player who bonks a sloped underside.
 *
 * Heap colliders are axis-aligned boxes (see HeapEdgeCollider), so there is no
 * true surface normal at the contact point. The angle is instead derived from the
 * scanline row's edge slope — 0deg is a flat flare, 90deg a vertical face — and
 * stashed on each slab at build time.
 *
 * Magnitude scales with sin(slope): a flat ceiling keeps the old dead stop (it is
 * solid rock), while a steep flank glances the player clear of it. Below
 * CEILING_DEFLECT_MIN_SLOPE_DEG the deflection is suppressed entirely rather than
 * left to taper off, so near-flat ledges never nudge the player sideways for
 * reasons they cannot see.
 *
 * @param impactVy  vertical velocity at impact; negative is rising (Arcade convention)
 * @param slopeDeg  derived edge slope in degrees, 0 (flat) .. 90 (vertical). A band
 *                  with a single scanline row has no neighbour to measure against and
 *                  yields Infinity, whose sine is NaN — guarded to 0 rather than
 *                  silently poisoning the player's momentum.
 * @param edgeSide  which heap boundary the slab belongs to; 'left' has its interior
 *                  to the right, so the player is pushed left (negative), and vice versa
 * @returns horizontal velocity to apply, negative for leftward; 0 when no deflection applies
 */
export function computeCeilingDeflection(
  impactVy: number,
  slopeDeg: number,
  edgeSide: 'left' | 'right',
): number {
  if (impactVy >= 0) return 0;                            // falling or stationary — not a head-bonk
  if (!Number.isFinite(slopeDeg)) return 0;               // no neighbouring row to measure — see below
  if (slopeDeg < CEILING_DEFLECT_MIN_SLOPE_DEG) return 0; // flat ceiling stays a dead stop

  const outward   = edgeSide === 'left' ? -1 : 1;
  const magnitude = Math.abs(impactVy)
    * CEILING_DEFLECT_FACTOR
    * Math.sin((slopeDeg * Math.PI) / 180);

  return outward * magnitude;
}

/**
 * Merge a deflection into the player's existing air momentum.
 *
 * Airborne horizontal velocity is re-driven from `momentumX` every frame
 * (Player.updateHorizontal), so a bonk must write that field rather than
 * `body.velocity.x`, which would be overwritten on the next step.
 *
 * Rule: keep whichever outward speed is greater. A player drifting into the heap
 * is thrown outward; a player already leaving faster than the glance (mid-dash,
 * say) keeps their speed instead of being slowed by clipping a ceiling.
 *
 * @param momentumX   current air momentum; negative is leftward
 * @param deflection  signed deflection from computeCeilingDeflection; 0 for none
 * @returns the momentum to apply
 */
export function blendCeilingDeflection(momentumX: number, deflection: number): number {
  if (deflection === 0) return momentumX;

  const outward      = Math.sign(deflection);
  const outwardSpeed = momentumX * outward;   // >0 when already travelling outward

  // Cap the deflection we produce, but take the max AFTER capping so pre-existing
  // over-speed passes through untouched. Clamping the blended result instead would
  // sand down momentum this function never granted: tryGroundOrAirJump assigns
  // body.velocity.x to momentumX unclamped, after updateHorizontal's own clamp has
  // run, so stacked speed salvage can legitimately carry a player past the cap.
  const cappedDeflection = Math.min(Math.abs(deflection), PLAYER_AIR_MAX_SPEED);

  return outward * Math.max(cappedDeflection, outwardSpeed);
}

import { describe, it, expect } from 'vitest';
import { computeCeilingDeflection, blendCeilingDeflection } from '../ceilingBounce';
import {
  CEILING_DEFLECT_FACTOR,
  CEILING_DEFLECT_MIN_SLOPE_DEG,
  PLAYER_AIR_MAX_SPEED,
} from '../../constants';

/*
 * Pure model for the head-bonk glance. The heap's colliders are axis-aligned
 * boxes, so there is no real surface normal at the contact point — the angle is
 * derived from the scanline row's edge slope, where 0deg is a flat flare and
 * 90deg is a vertical face (see computeRowSlopeAngleDeg in shared/heapPolygon).
 *
 * Sign convention matches Arcade: vy < 0 is rising, and the returned value is a
 * horizontal velocity where negative is leftward.
 */

/** Steep enough to always clear the deadzone, whatever it is tuned to. */
const STEEP_DEG = Math.max(60, CEILING_DEFLECT_MIN_SLOPE_DEG + 10);
const RISING_VY = -550; // a full-height jump

describe('computeCeilingDeflection', () => {
  it('returns no deflection when the player is falling rather than rising', () => {
    expect(computeCeilingDeflection(400, STEEP_DEG, 'left')).toBe(0);
  });

  it('returns no deflection when vertical velocity is zero', () => {
    expect(computeCeilingDeflection(0, STEEP_DEG, 'left')).toBe(0);
  });

  it('pushes left when bonking the heap\'s left edge, whose interior is to the right', () => {
    expect(computeCeilingDeflection(RISING_VY, STEEP_DEG, 'left')).toBeLessThan(0);
  });

  it('pushes right when bonking the heap\'s right edge', () => {
    expect(computeCeilingDeflection(RISING_VY, STEEP_DEG, 'right')).toBeGreaterThan(0);
  });

  it('is mirror-symmetric between the two edges', () => {
    const left  = computeCeilingDeflection(RISING_VY, STEEP_DEG, 'left');
    const right = computeCeilingDeflection(RISING_VY, STEEP_DEG, 'right');
    expect(left).toBeCloseTo(-right, 10);
  });

  it('dead-stops on a ceiling shallower than the deadzone', () => {
    const belowDeadzone = CEILING_DEFLECT_MIN_SLOPE_DEG - 0.001;
    expect(computeCeilingDeflection(RISING_VY, belowDeadzone, 'right')).toBe(0);
  });

  it('deflects at exactly the deadzone threshold', () => {
    expect(
      computeCeilingDeflection(RISING_VY, CEILING_DEFLECT_MIN_SLOPE_DEG, 'right'),
    ).toBeGreaterThan(0);
  });

  it('scales with sin(slope), so a near-vertical flank glances harder than a shallow one', () => {
    const shallow = computeCeilingDeflection(RISING_VY, 20, 'right');
    const steep   = computeCeilingDeflection(RISING_VY, 80, 'right');
    expect(steep).toBeGreaterThan(shallow);
  });

  it('applies CEILING_DEFLECT_FACTOR of the impact speed on a vertical flank', () => {
    // sin(90deg) === 1, so the factor is the whole story at this angle.
    expect(computeCeilingDeflection(RISING_VY, 90, 'right'))
      .toBeCloseTo(Math.abs(RISING_VY) * CEILING_DEFLECT_FACTOR, 6);
  });

  it('follows the sin curve at an intermediate angle', () => {
    const deg = 45;
    expect(computeCeilingDeflection(RISING_VY, deg, 'right')).toBeCloseTo(
      Math.abs(RISING_VY) * CEILING_DEFLECT_FACTOR * Math.sin((deg * Math.PI) / 180),
      6,
    );
  });

  it('returns no deflection for a non-finite slope', () => {
    // A band with a single scanline row has no neighbour to measure against, so
    // computeRowSlopeAngleDeg returns Math.min() of an empty list — Infinity.
    // sin(Infinity) is NaN, which would silently poison the player's momentum.
    expect(computeCeilingDeflection(RISING_VY, Infinity, 'right')).toBe(0);
    expect(computeCeilingDeflection(RISING_VY, NaN, 'right')).toBe(0);
  });

  it('scales linearly with impact speed, so a weak bonk barely deflects', () => {
    const fast = computeCeilingDeflection(-600, STEEP_DEG, 'right');
    const slow = computeCeilingDeflection(-100, STEEP_DEG, 'right');
    expect(slow).toBeCloseTo(fast / 6, 6);
  });
});

/*
 * The deflection has to merge with whatever air momentum the player already has.
 * Airborne horizontal velocity is re-driven from momentumX every frame, so this is
 * the value the bonk must write — see Player.updateHorizontal.
 */
describe('blendCeilingDeflection', () => {
  it('leaves momentum untouched when there is no deflection', () => {
    expect(blendCeilingDeflection(120, 0)).toBe(120);
  });

  it('applies the deflection to a player with no horizontal momentum', () => {
    expect(blendCeilingDeflection(0, -275)).toBe(-275);
  });

  it('reverses a player who was drifting into the heap', () => {
    // Drifting right at 200 while bonking a left edge: the glance throws them left.
    expect(blendCeilingDeflection(200, -275)).toBe(-275);
  });

  it('keeps the faster outward speed when the player already outruns the deflection', () => {
    // A dash outward at 450 should not be slowed to 275 by clipping a ceiling.
    expect(blendCeilingDeflection(-450, -275)).toBe(-450);
  });

  it('takes the deflection when it exceeds the outward speed the player had', () => {
    expect(blendCeilingDeflection(-100, -275)).toBe(-275);
  });

  it('is mirror-symmetric', () => {
    expect(blendCeilingDeflection(-200, 275)).toBe(275);
    expect(blendCeilingDeflection(200, -275)).toBe(-275);
  });

  it('clamps to the airborne speed ceiling', () => {
    const huge = blendCeilingDeflection(0, -(PLAYER_AIR_MAX_SPEED * 3));
    expect(huge).toBe(-PLAYER_AIR_MAX_SPEED);
  });

  it('does not claw back existing momentum that already exceeds the clamp', () => {
    // Pre-existing over-speed is another system's business; the bonk must not
    // become a backdoor speed limiter.
    const over = PLAYER_AIR_MAX_SPEED * 2;
    expect(blendCeilingDeflection(-over, 0)).toBe(-over);
  });
});

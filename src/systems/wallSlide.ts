import { WALL_LEAVE_NUDGE, WALL_SLIDE_PRESS_SPEED } from '../constants';

/**
 * Momentum to keep while the player grips a wall.
 *
 * The slide used to wipe `momentumX` to 0 every frame. Because applyWallSlide runs
 * after updateHorizontal, that reset landed on momentum air control had just built,
 * so each frame started from zero and a full-tilt slide was worth one frame of
 * force — about 13px/s, 5% of walk speed. Steering off a wall into an alcove was
 * effectively impossible.
 *
 * Momentum now accumulates across the slide instead. Pressed into the face it moves
 * nobody (Arcade blocks it, and wallSlidePressVelocity keeps it off the face anyway),
 * but the frame the wall ends the player already carries real speed inward.
 *
 * The into-wall component is capped at `maxSpeed` — the same ceiling
 * updateHorizontal imposes on what air control may accelerate to — so a fast
 * arrival (a 375px/s wall jump, a dash) cannot be parked against the face and
 * released as a slingshot when the wall runs out. Passing the player's boosted
 * walk speed rather than the bare constant keeps a speed item applying here too:
 * the wall should not be the one place a carried item stops mattering.
 *
 * @param momentumX  current air momentum; negative is leftward
 * @param inwardDir  toward the gripped face: -1 for a wall on the left, +1 on the right
 * @param maxSpeed   ceiling for banked inward speed — Player.moveSpeed, which folds
 *                   in the carry and buff speed multipliers
 * @returns the momentum to keep
 */
export function bankWallSlideMomentum(
  momentumX: number,
  inwardDir: -1 | 1,
  maxSpeed: number,
): number {
  const inward = momentumX * inwardDir; // >0 when pressing into the wall

  if (inward > maxSpeed) return inwardDir * maxSpeed;

  return momentumX;
}

/**
 * Horizontal velocity actually driven at the wall face this frame.
 *
 * Banked momentum must not be spent pressing into the wall. Contact only needs a
 * little overlap to keep Arcade reporting `blocked`, whereas pressing in at the full
 * banked speed would sink the body ~4px per frame into sloped slabs — which
 * depenetratePlayerFromWall then shoves back out, producing exactly the "the wall
 * pushes you away" feel this change exists to remove.
 *
 * The cap is a ceiling, never a floor: a press weaker than the cap passes through
 * untouched, so this never manufactures contact the player is not asking for. A
 * player moving outward is leaving and is not throttled at all.
 *
 * @param momentumX  banked air momentum; negative is leftward
 * @param inwardDir  toward the gripped face: -1 for a wall on the left, +1 on the right
 * @returns the velocity to apply
 */
export function wallSlidePressVelocity(momentumX: number, inwardDir: -1 | 1): number {
  // Only the into-wall direction is capped. Because inwardDir squares to 1, momentum
  // that is outward or zero survives Math.min untouched and falls out of this
  // unchanged — a player leaving the wall is never throttled.
  const inward = momentumX * inwardDir;

  return inwardDir * Math.min(inward, WALL_SLIDE_PRESS_SPEED);
}

/**
 * Momentum the frame after the player leaves a wall.
 *
 * A small outward nudge keeps a player who slid off holding nothing from dropping
 * dead-straight and immediately re-catching the same face. It used to be an
 * assignment, which meant the wall ending — the exact moment an alcove or ledge
 * opens — threw away whatever the player was steering and replaced it with 80px/s
 * back out into open air.
 *
 * It is now a floor. Any momentum worth more than the nudge, in either direction,
 * is the player's decision and survives.
 *
 * The nudge is never larger than the player's own top speed. Air control cannot
 * accelerate past Player.moveSpeed, so a fixed 80px/s floor becomes unclearable
 * once carried items drag moveSpeed beneath it — five or so slow salvage items,
 * which stack multiplicatively with neither a carry cap nor dedup in
 * PickupManager.grab. Inward steering then never counts as deliberate, and the
 * nudge reverses the player outward on every exit: the push-off-the-wall feel this
 * module exists to remove. Scaling with moveSpeed keeps the "too weak to be
 * deliberate" threshold meaningful at any speed, and nobody is ever shoved off a
 * wall faster than they could walk. Capping the bank ceiling instead does nothing —
 * momentum never reaches that ceiling to be capped by it.
 *
 * @param momentumX   momentum carried off the wall; negative is leftward
 * @param outwardDir  away from the wall just left: +1 having left a wall on the left
 * @param maxSpeed    player's top speed under their own power — Player.moveSpeed
 * @returns the momentum to apply
 */
export function applyWallLeaveNudge(
  momentumX: number,
  outwardDir: -1 | 1,
  maxSpeed: number,
): number {
  const nudge = Math.min(WALL_LEAVE_NUDGE, maxSpeed);

  if (Math.abs(momentumX) >= nudge) return momentumX;

  return outwardDir * nudge;
}

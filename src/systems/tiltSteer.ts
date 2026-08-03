/**
 * Tilt steering maths — pure, DOM-free, no Phaser.
 *
 * `DeviceOrientationEvent.gamma` must never be read on its own. The spec confines
 * it to [-90, 90), which is too narrow to describe every pose, so the browser
 * encodes the rest by flipping `beta` past 90 and mirroring gamma back through the
 * boundary. Reading gamma alone therefore *inverts* whenever the screen tips past
 * horizontal, and snaps discontinuously (a 5-degree movement can swing the reported
 * value 175 degrees). The spec itself flags this: "Describing orientation using
 * Tait-Bryan angles can have some disadvantages such as introducing gimbal lock."
 *
 * The fix is the one three.js DeviceOrientationControls uses: reconstruct the
 * orientation from ALL the angles, then extract the quantity you actually want —
 * here, the direction of gravity as it appears on the screen.
 *
 * From the spec's normative rotation matrix (Annex, "Alternate device orientation
 * representations"), the bottom row of the device->world matrix R is
 *
 *     [ -cos(b)sin(g),  sin(b),  cos(b)cos(g) ]
 *
 * Gravity points along world -Z, so in the device's own frame it is R^T * (0,0,-1),
 * i.e. the negated bottom row. The `cos(beta)` factor on x is exactly what supplies
 * the sign correction that raw gamma is missing.
 *
 * @see https://www.w3.org/TR/orientation-event/
 */

const DEG = Math.PI / 180;

export interface Vec3 { x: number; y: number; z: number; }

/**
 * Unit gravity vector in the device's own frame, derived from the spec matrix.
 * +x is the screen's right edge, +y the top, +z out through the glass. A positive
 * `x` therefore means the right edge is tilted *downward*.
 */
export function deviceGravity(betaDeg: number, gammaDeg: number): Vec3 {
  const b = betaDeg * DEG;
  const g = gammaDeg * DEG;
  return {
    x:  Math.cos(b) * Math.sin(g),
    y: -Math.sin(b),
    z: -Math.cos(b) * Math.cos(g),
  };
}

/** True when the screen faces downward — the pose that mirrors a raw-gamma read. */
export function isScreenFacingDown(betaDeg: number, gammaDeg: number): boolean {
  return deviceGravity(betaDeg, gammaDeg).z > 0;
}

/**
 * Steering angle in degrees: how far the screen's left-right axis is tipped from
 * level. Negative steers left, positive right, matching the previous gamma sign
 * convention — and for a flat phone (beta = 0) it reduces to exactly gamma, so
 * holds that already worked keep working.
 *
 * `screenAngleDeg` is `screen.orientation.angle` — the rotation of the displayed
 * content relative to the device's natural orientation. Compensating for it is
 * what makes left/right mean *screen* left/right whatever way the phone is held,
 * mirroring the Z-axis correction three.js applies.
 *
 * Well-conditioned at every pose: it reads the tilt of one axis rather than the
 * direction of an in-plane projection, so there is no orientation at which it
 * has to guess, and no need for the caller to special-case anything.
 */
export function screenSteerDeg(
  betaDeg: number,
  gammaDeg: number,
  screenAngleDeg = 0,
): number {
  const g = deviceGravity(betaDeg, gammaDeg);

  // Rotate the in-plane part of gravity from device axes into screen axes, then
  // take the screen's horizontal component: how far its right edge hangs below
  // level. asin turns that back into the angle the old constants are tuned in.
  //
  // Convention assumed here: at angle 90 the device's natural top edge (+y) points
  // to the viewer's right, so the screen's right edge is the device's +y edge. That
  // matches the Z-axis correction three.js applies, and is self-consistent with the
  // tests, but has NOT been confirmed against a real browser in landscape. It only
  // affects the web build — Android is portrait-locked — and at angle 0 (every
  // portrait case) the rotation is the identity, so the untested path is the
  // landscape one alone.
  const a  = screenAngleDeg * DEG;
  const sx = g.x * Math.cos(a) + g.y * Math.sin(a);

  return Math.asin(Math.max(-1, Math.min(1, sx))) / DEG;
}

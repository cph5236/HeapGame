/** Pure, Phaser-free joystick mapping helpers. Unit-tested in isolation. */

/** Map a horizontal force (px) to a normalized −1..1 axis with dead zone + curve.
 *  Mirrors the tilt curve in InputManager so movement feel matches. */
export function axisFromForce(
  forceX: number, radius: number, deadZone: number, curveExp: number,
): number {
  const raw = Math.max(-1, Math.min(1, forceX / radius));
  const abs = Math.abs(raw);
  if (abs < deadZone) return 0;
  const t = (abs - deadZone) / (1 - deadZone);
  return Math.sign(raw) * Math.pow(t, curveExp);
}

/** Discrete horizontal zone for double-tap detection: −1, 0, or +1. */
export function zoneFromAxis(axis: number, tapThreshold: number): -1 | 0 | 1 {
  if (axis >= tapThreshold) return 1;
  if (axis <= -tapThreshold) return -1;
  return 0;
}

export interface DoubleTapState {
  prevZone:   -1 | 0 | 1; // zone last frame, to detect a rise from center
  pendingDir: -1 | 0 | 1; // direction of a first tap awaiting its partner
  pendingTime: number;    // timestamp of that first tap
}

export function initDoubleTap(): DoubleTapState {
  return { prevZone: 0, pendingDir: 0, pendingTime: 0 };
}

/** Step the double-tap machine with the current zone and time.
 *  A "tap" is a rise from center (0 → ±1). Two same-direction taps within
 *  `windowMs` fire a dash. Mutates `state`. */
export function stepDoubleTap(
  state: DoubleTapState, zone: -1 | 0 | 1, now: number, windowMs: number,
): { fired: boolean; dir: -1 | 1 } {
  let fired = false;
  let dir: -1 | 1 = 1;
  const engaged = zone !== 0 && state.prevZone === 0;

  if (engaged) {
    if (state.pendingDir === zone && now - state.pendingTime <= windowMs) {
      fired = true;
      dir = zone as -1 | 1;
      state.pendingDir = 0;
      state.pendingTime = 0;
    } else {
      state.pendingDir = zone;
      state.pendingTime = now;
    }
  } else if (state.pendingDir !== 0 && now - state.pendingTime > windowMs) {
    state.pendingDir = 0; // expire a stale first tap
  }

  state.prevZone = zone;
  return { fired, dir };
}

// src/systems/eyePhysics.ts
//
// Pure pupil simulation for the googly-eye cosmetic family. No Phaser imports
// (same pattern as rainbowColorAt) — the EyeRig calls stepPupil per frame.
//
// Model: damped point mass constrained to a circular track. Player
// acceleration displaces the spring's target opposite to the motion
// (inertia); hitting the rim keeps tangential velocity, so hard impulses
// send the pupil orbiting — the googly "spin" emerges from the model.

export interface PupilState  { x: number; y: number; vx: number; vy: number }
export interface PupilParams {
  restX: number; restY: number;   // rest pose relative to the eye center
  radius: number;                 // max pupil travel from the eye center (logical px)
  stiffness: number;              // spring accel per px of displacement (1/s²)
  damping: number;                // velocity decay rate (1/s)
  accelScale: number;             // px of target displacement per px/s² of player accel
}

/** Tight default character; Googly overrides these to be loose and floppy. */
export const DEFAULT_EYE_PHYSICS = { stiffness: 90, damping: 9, accelScale: 0.008 };

/** Sub-step ceiling keeps the explicit integration stable on slow frames. */
const MAX_STEP_MS   = 32;
/** Total simulated time cap — a 5s tab-switch shouldn't burn 300 sub-steps. */
const MAX_TOTAL_MS  = 100;

export function stepPupil(
  s: PupilState, p: PupilParams, ax: number, ay: number, dtMs: number,
): PupilState {
  let { x, y, vx, vy } = s;
  // Inertia: player acceleration shifts the spring target the opposite way.
  const tx = p.restX - p.accelScale * ax;
  const ty = p.restY - p.accelScale * ay;

  let remaining = Math.min(dtMs, MAX_TOTAL_MS);
  while (remaining > 0) {
    const dt = Math.min(remaining, MAX_STEP_MS) / 1000;
    remaining -= MAX_STEP_MS;

    // Semi-implicit Euler: update velocity first, then position.
    vx += (p.stiffness * (tx - x) - p.damping * vx) * dt;
    vy += (p.stiffness * (ty - y) - p.damping * vy) * dt;
    x += vx * dt;
    y += vy * dt;

    // Rim constraint: clamp to the track, kill the outward velocity
    // component, keep the tangential one (orbiting).
    const d = Math.hypot(x, y);
    if (d > p.radius) {
      const nx = x / d, ny = y / d;
      x = nx * p.radius;
      y = ny * p.radius;
      const vn = vx * nx + vy * ny;
      if (vn > 0) { vx -= vn * nx; vy -= vn * ny; }
    }
  }
  return { x, y, vx, vy };
}

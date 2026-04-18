export const INFINITE_HEAP_ID = 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF';

export const INFINITE_MAX_RAMP_HEIGHT  = 40_000;  // px climbed for full height difficulty
export const INFINITE_MAX_RAMP_TIME    = 600_000; // ms (10 min) for full time difficulty
export const INFINITE_HEIGHT_WEIGHT    = 0.7;
export const INFINITE_TIME_WEIGHT      = 0.3;

export const INFINITE_MIN_SPAWN_MULT   = 1.0;
export const INFINITE_MAX_SPAWN_MULT   = 3.0;

export const INFINITE_SURFACE_SNAP_THRESHOLD = 100; // px — placed item surface tolerance

/** 0 at start, approaches 1.0 as height and time increase. */
export function computeDifficultyFactor(heightClimbed: number, timeElapsed: number): number {
  const heightFactor = Math.min(1, Math.max(0, heightClimbed / INFINITE_MAX_RAMP_HEIGHT));
  const timeFactor   = Math.min(1, Math.max(0, timeElapsed   / INFINITE_MAX_RAMP_TIME));
  return heightFactor * INFINITE_HEIGHT_WEIGHT + timeFactor * INFINITE_TIME_WEIGHT;
}

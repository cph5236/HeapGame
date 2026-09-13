import { STAMINA_REGEN_GROUND_MS as GROUND_MS } from '../constants';

/**
 * Pure stamina arithmetic. No Phaser, no globals — everything the player's
 * pool does is a function of its previous value and this frame's delta, so it
 * can be tested without a scene. Follows wallSlide.ts / buffMath.ts.
 *
 * Stamina is a FLOAT, not a set of per-bar timers. Partial progress carries
 * across frames, which is what lets the HUD show an honest partial fill and
 * what makes grounded contact a duration rather than a toggle.
 */

/** Advance the pool by one frame. Returns the new value, clamped to [0, max]. */
export function regenStamina(
  current: number, max: number, deltaMs: number,
  grounded: boolean, airRegenMs: number,
): number {
  const perBarMs = grounded ? GROUND_MS : airRegenMs;
  const gained   = perBarMs > 0 ? deltaMs / perBarMs : 0;
  return Math.max(0, Math.min(max, current + gained));
}

/** Whole bars only: 0.9 of a bar cannot buy a 1-cost action. */
export function canSpend(current: number, cost: number): boolean {
  return current >= cost;
}

/** Deduct a cost, floored at zero. */
export function spend(current: number, cost: number): number {
  return Math.max(0, current - cost);
}

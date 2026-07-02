import { getAdRunState, setAdRunState } from '../SaveData';
import { getConfigValue } from '../ConfigClient';
import type { AdCadenceConfig } from '../../../shared/configTypes';

export const AD_CADENCE_MIN = 40;
export const AD_CADENCE_MAX = 50;

export interface AdRunState {
  runsSinceLast: number;
  target:        number;
}

/** Remote-config range if present and valid, else the hardcoded fallback. */
function currentRange(): { min: number; max: number } {
  const remote = getConfigValue<AdCadenceConfig>('ad_cadence');
  if (remote && typeof remote.min === 'number' && typeof remote.max === 'number' && remote.min <= remote.max) {
    return remote;
  }
  return { min: AD_CADENCE_MIN, max: AD_CADENCE_MAX };
}

/** Random target in the inclusive range [AD_CADENCE_MIN, AD_CADENCE_MAX] (or remote config if present). */
export function rollTarget(rand: () => number = Math.random): number {
  const { min, max } = currentRange();
  const span = max - min + 1;
  return min + Math.floor(rand() * span);
}

/**
 * Pure decision: increment the counter and decide whether THIS run is an ad run.
 * On a fire, the counter resets to 0 and the target is re-rolled.
 */
export function decideAdRun(
  state: AdRunState,
  rand: () => number = Math.random,
): { next: AdRunState; isAdRun: boolean } {
  const runsSinceLast = state.runsSinceLast + 1;
  if (runsSinceLast >= state.target) {
    return { next: { runsSinceLast: 0, target: rollTarget(rand) }, isAdRun: true };
  }
  return { next: { runsSinceLast, target: state.target }, isAdRun: false };
}

/**
 * Register a completed run and report whether an ad should appear.
 * `enabled` is passed in (AdClient.enabled) so this stays testable without the singleton.
 * Returns false without mutating state when ads are disabled (web/dev).
 */
export function registerRun(enabled: boolean, rand: () => number = Math.random): boolean {
  if (!enabled) return false;
  const raw   = getAdRunState();
  const state: AdRunState = raw.target > 0 ? raw : { runsSinceLast: 0, target: rollTarget(rand) };
  const { next, isAdRun } = decideAdRun(state, rand);
  setAdRunState(next);
  return isAdRun;
}

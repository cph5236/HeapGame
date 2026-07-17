// src/systems/dailyRunGate.ts
//
// Device-local "played today" gate for Daily Drop. Deliberately a standalone
// localStorage key, NOT part of RawSave: it describes this device's calendar
// day and must not sync through cloud saves (a stale cloud value would
// re-lock the menu can).

import { localDateKey } from '../../shared/dailyDrop';

const KEY = 'heap_last_run_ended_at';

/** Record that a run just ended (any run counts, per spec). */
export function markRunEnded(now: number = Date.now()): void {
  try { localStorage.setItem(KEY, String(now)); } catch { /* storage unavailable */ }
}

/** True when a run has ended during the current local calendar day. */
export function hasPlayedToday(offsetMin: number, now: number = Date.now()): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const t = Number(raw);
    if (!Number.isFinite(t)) return false;
    return localDateKey(t, offsetMin) === localDateKey(now, offsetMin);
  } catch {
    return false;
  }
}

/** This device's UTC offset in minutes, matching localDateKey's convention
 *  (positive = east of UTC). JS getTimezoneOffset reports the inverse sign. */
export function deviceUtcOffsetMin(d: Date = new Date()): number {
  return -d.getTimezoneOffset();
}

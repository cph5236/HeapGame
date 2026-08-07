// src/systems/dailyStatusCache.ts
//
// Device-local cache of the last GET /daily/status snapshot, so the menu
// stops calling the daily endpoint on every single load.
//
// Deliberately conservative: a cached snapshot is only reused when it says
// "already claimed today" AND the server-supplied `nextEligibleAt` is still
// in the future AND we are still inside the same local calendar day the
// snapshot was fetched in. In that window there is nothing to claim and
// nothing to show (the can icon is hidden), so a stale read cannot mislead
// the player. Anything else — claimable, lapsed streak, crossed midnight,
// changed timezone, different player — falls through to a real fetch.
//
// Like dailyRunGate this is a standalone localStorage key, NOT part of
// RawSave: it describes this device's view of the current day and must not
// sync through cloud saves.

import { localDateKey } from '../../shared/dailyDrop';
import type { DailyStatusResponse } from '../../shared/dailyTypes';

const KEY = 'heap_daily_status_cache';

interface CachedEntry {
  playerId: string;
  offsetMin: number;
  fetchedAt: number;   // unix ms
  status: DailyStatusResponse;
}

function isUsable(entry: CachedEntry, playerId: string, offsetMin: number, now: number): boolean {
  if (entry.playerId !== playerId) return false;      // signed into GPGS since
  if (entry.offsetMin !== offsetMin) return false;    // device travelled
  if (!entry.status?.claimedToday) return false;      // only "nothing to do" is cacheable
  const until = entry.status.nextEligibleAt;
  if (typeof until !== 'number' || !Number.isFinite(until)) return false;
  if (now >= until) return false;                     // claim window may have opened
  // Belt and braces: min-gap can push nextEligibleAt past local midnight, and
  // `claimedToday` stops being true there even though the claim is still
  // blocked. Re-fetch rather than reason about it.
  return localDateKey(entry.fetchedAt, offsetMin) === localDateKey(now, offsetMin);
}

/** The cached snapshot when it is still safe to serve, else null. */
export function readCachedDailyStatus(
  playerId: string,
  offsetMin: number,
  now: number = Date.now(),
): DailyStatusResponse | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CachedEntry;
    return isUsable(entry, playerId, offsetMin, now) ? entry.status : null;
  } catch {
    return null; // unparseable or storage unavailable
  }
}

/** Store a fresh snapshot. Non-cacheable states are stored too — they simply
 *  fail `isUsable` on read — so the entry always reflects the latest truth. */
export function writeCachedDailyStatus(
  playerId: string,
  offsetMin: number,
  status: DailyStatusResponse,
  now: number = Date.now(),
): void {
  const entry: CachedEntry = { playerId, offsetMin, fetchedAt: now, status };
  try { localStorage.setItem(KEY, JSON.stringify(entry)); } catch { /* storage unavailable */ }
}

/** Drop the cache — used when a claim outcome makes the snapshot unreliable. */
export function clearCachedDailyStatus(): void {
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

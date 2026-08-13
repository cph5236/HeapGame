// src/systems/dailyStatusCache.ts
//
// Device-local cache of the last GET /daily/status snapshot, so the menu
// stops calling the daily endpoint on every single load.
//
// A cached snapshot is reused until the server-declared expiry
// (`stableUntil`) — the instant at which the response could change by
// itself — capped at 24h regardless of what the server says. Different
// player or a changed UTC offset always falls through to a real fetch, and
// a clock rewound behind the fetch time is treated as stale too.
//
// Like dailyRunGate this is a standalone localStorage key, NOT part of
// RawSave: it describes this device's view of the current day and must not
// sync through cloud saves.

import type { DailyStatusResponse } from '../../shared/dailyTypes';

const KEY = 'heap_daily_status_cache';
/** Hard ceiling on any entry, even one the server called permanently stable.
 *  Bounds cross-device staleness: a claim on another device leaves this one
 *  showing a spent can until it is tapped (which 409s and clears the entry). */
const MAX_AGE_MS = 86_400_000;  // 24h

interface CachedEntry {
  playerId: string;
  offsetMin: number;
  fetchedAt: number;   // unix ms
  status: DailyStatusResponse;
}

function isUsable(entry: CachedEntry, playerId: string, offsetMin: number, now: number): boolean {
  if (entry.playerId !== playerId) return false;      // signed into GPGS since
  if (entry.offsetMin !== offsetMin) return false;    // device travelled
  const age = now - entry.fetchedAt;
  if (!(age >= 0 && age < MAX_AGE_MS)) return false;  // stale, or clock rewound

  // `stableUntil` answers "when can this response change by itself":
  //   null      → never, so serve it (subject to the cap above)
  //   number    → serve until that instant
  //   undefined → server predates the field; caching would be a guess
  const until = entry.status?.stableUntil;
  if (until === null) return true;
  if (typeof until !== 'number' || !Number.isFinite(until)) return false;
  return now < until;
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

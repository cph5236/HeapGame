// src/systems/DailyDropClient.ts

import { getEffectivePlayerId } from './SaveData';
import { fetchWithLog } from '../logging/fetchWithLog';
import { authHeaders, logIfAuthRejected } from './authToken';
import { applyReward } from './applyReward';
import { deviceUtcOffsetMin } from './dailyRunGate';
import { dayAfter } from '../../shared/dailyDrop';
import {
  readCachedDailyStatus, writeCachedDailyStatus, clearCachedDailyStatus,
} from './dailyStatusCache';
import type {
  DailyClaimResponse, DailyClaimSuccess, DailyStatusResponse,
} from '../../shared/dailyTypes';
import type { RewardPayload } from '../../shared/codeTypes';

const SERVER_URL: string =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_HEAP_SERVER_URL ??
  'http://localhost:8787';

export type DailyStatusResult =
  | { status: 'ok'; data: DailyStatusResponse }
  | { status: 'offline' };

/**
 * Streak/claim snapshot for the menu. Served from the device-local cache
 * until the server-declared `stableUntil` expiry, capped at 24h — see
 * dailyStatusCache for exactly when an entry is usable.
 */
export async function fetchDailyStatus(): Promise<DailyStatusResult> {
  const playerId = getEffectivePlayerId();
  const offsetMin = deviceUtcOffsetMin();

  const cached = readCachedDailyStatus(playerId, offsetMin);
  if (cached) return { status: 'ok', data: cached };

  try {
    const res = await fetchWithLog(
      `${SERVER_URL}/daily/status?playerGuid=${encodeURIComponent(playerId)}&utcOffsetMin=${offsetMin}`,
    );
    if (!res.ok) return { status: 'offline' };
    const data = (await res.json()) as DailyStatusResponse;
    writeCachedDailyStatus(playerId, offsetMin, data);
    return { status: 'ok', data };
  } catch {
    return { status: 'offline' };
  }
}

export type DailyClaimResult =
  | { status: 'claimed'; messages: string[]; streakDay: number; rewards: RewardPayload[] }
  | { status: 'streakBroken'; repairableDay: number }
  | { status: 'notEligible' }
  | { status: 'offline' }
  | { status: 'error' };

/** Claim today's drop server-side, then apply the granted rewards locally. */
export async function claimDaily(resolution?: 'repair' | 'reset'): Promise<DailyClaimResult> {
  const playerId = getEffectivePlayerId();
  const offsetMin = deviceUtcOffsetMin();
  const body = {
    playerGuid: playerId,
    utcOffsetMin: offsetMin,
    ...(resolution ? { resolution } : {}),
  };
  let res: Response;
  try {
    res = await fetchWithLog(`${SERVER_URL}/daily/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
  } catch {
    return { status: 'offline' };
  }

  // Any outcome other than a clean grant leaves the cached snapshot
  // untrustworthy (another device may have claimed, the streak may have
  // lapsed) — drop it so the next menu load re-reads from the server.
  if (res.status === 409) { clearCachedDailyStatus(); return { status: 'notEligible' }; }
  if (!res.ok) {
    logIfAuthRejected('daily:claim', res.status);
    clearCachedDailyStatus();
    return { status: 'error' };
  }

  const data = (await res.json()) as DailyClaimResponse;
  if (data.kind === 'streakBroken') {
    clearCachedDailyStatus();
    return { status: 'streakBroken', repairableDay: data.repairableDay };
  }
  if (data.kind === 'notEligible') { clearCachedDailyStatus(); return { status: 'notEligible' }; }
  cacheClaimedSnapshot(playerId, offsetMin, data);
  const messages = data.rewards
    .map((r) => applyReward(r))
    .filter((a) => a.ok)
    .map((a) => a.message);
  return { status: 'claimed', messages, streakDay: data.streakDay, rewards: data.rewards };
}

/** A successful claim tells us everything `/daily/status` would: the drop is
 *  claimed, the next one opens at `nextEligibleAt`, and the snapshot holds
 *  until `stableUntil` (next local midnight). Seeding here saves the status
 *  call on the menu load right after claiming — the most common menu entry.
 *  Older servers omit `stableUntil`; without it the entry could never be
 *  served, so drop the cache instead. */
function cacheClaimedSnapshot(
  playerId: string,
  offsetMin: number,
  data: DailyClaimSuccess,
): void {
  if (typeof data.stableUntil !== 'number' || !Number.isFinite(data.stableUntil)) {
    clearCachedDailyStatus();
    return;
  }
  writeCachedDailyStatus(playerId, offsetMin, {
    streakDay: data.streakDay,
    claimedToday: true,
    nextClaimDay: dayAfter(data.streakDay),
    todayGrants: data.nextRewardPreview,
    nextEligibleAt: data.nextEligibleAt,
    stableUntil: data.stableUntil,
  });
}

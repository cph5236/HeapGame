// src/systems/DailyDropClient.ts

import { getEffectivePlayerId } from './SaveData';
import { fetchWithLog } from '../logging/fetchWithLog';
import { authHeaders, logIfAuthRejected } from './authToken';
import { applyReward } from './applyReward';
import { deviceUtcOffsetMin } from './dailyRunGate';
import type { DailyClaimResponse, DailyStatusResponse } from '../../shared/dailyTypes';

const SERVER_URL: string =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_HEAP_SERVER_URL ??
  'http://localhost:8787';

export type DailyStatusResult =
  | { status: 'ok'; data: DailyStatusResponse }
  | { status: 'offline' };

export async function fetchDailyStatus(): Promise<DailyStatusResult> {
  const guid = encodeURIComponent(getEffectivePlayerId());
  try {
    const res = await fetchWithLog(
      `${SERVER_URL}/daily/status?playerGuid=${guid}&utcOffsetMin=${deviceUtcOffsetMin()}`,
    );
    if (!res.ok) return { status: 'offline' };
    return { status: 'ok', data: (await res.json()) as DailyStatusResponse };
  } catch {
    return { status: 'offline' };
  }
}

export type DailyClaimResult =
  | { status: 'claimed'; messages: string[]; streakDay: number }
  | { status: 'streakBroken'; repairableDay: number }
  | { status: 'notEligible' }
  | { status: 'offline' }
  | { status: 'error' };

/** Claim today's drop server-side, then apply the granted rewards locally. */
export async function claimDaily(resolution?: 'repair' | 'reset'): Promise<DailyClaimResult> {
  const body = {
    playerGuid: getEffectivePlayerId(),
    utcOffsetMin: deviceUtcOffsetMin(),
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

  if (res.status === 409) return { status: 'notEligible' };
  if (!res.ok) {
    logIfAuthRejected('daily:claim', res.status);
    return { status: 'error' };
  }

  const data = (await res.json()) as DailyClaimResponse;
  if (data.kind === 'streakBroken') return { status: 'streakBroken', repairableDay: data.repairableDay };
  if (data.kind === 'notEligible') return { status: 'notEligible' };
  const messages = data.rewards
    .map((r) => applyReward(r))
    .filter((a) => a.ok)
    .map((a) => a.message);
  return { status: 'claimed', messages, streakDay: data.streakDay };
}

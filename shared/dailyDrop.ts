// shared/dailyDrop.ts
//
// Pure day/streak/reward logic for Daily Drop, shared by worker and client.
// All instants are unix ms; "local" means the player's UTC offset in minutes
// (positive = east of UTC, i.e. -new Date().getTimezoneOffset()).
// Spec: docs/superpowers/specs/2026-07-16-daily-drop-design.md

import type { RewardPayload } from './codeTypes';
import type { DailyGrant, DailyRewardTable, DailyStatusResponse } from './dailyTypes';

export const DEFAULT_GRACE_HOURS = 36;    // streak survives gaps up to this
export const DEFAULT_MIN_GAP_HOURS = 10;  // anti-abuse floor between claims
export const DAILY_FALLBACK_COINS = 50;   // granted when an item pool is misconfigured

const MIN_OFFSET = -720;  // UTC-12
const MAX_OFFSET = 840;   // UTC+14
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export const DEFAULT_DAILY_REWARDS: DailyRewardTable = [
  [{ type: 'coins', amount: 50 }],
  [{ type: 'coins', amount: 75 }],
  [{ type: 'item', pool: ['ladder', 'ibeam', 'checkpoint'], amount: 1 }],
  [{ type: 'coins', amount: 100 }],
  [{ type: 'item', pool: ['shield', 'pogo', 'stall', 'adrenaline'], amount: 1 }],
  [{ type: 'coins', amount: 150 }],
  [{ type: 'coins', amount: 300 }, { type: 'item', pool: ['revive'], amount: 1 }],
];

/** Clamp a client-reported UTC offset to the real-world range; garbage → 0. */
export function clampOffsetMin(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0;
  return Math.max(MIN_OFFSET, Math.min(MAX_OFFSET, n));
}

/** Local calendar date key 'YYYY-MM-DD' for a unix-ms instant at a UTC offset. */
export function localDateKey(unixMs: number, offsetMin: number): string {
  return new Date(unixMs + offsetMin * 60_000).toISOString().slice(0, 10);
}

export interface ClaimState {
  lastClaimAt: number;  // unix ms
  streakDay: number;    // 1-7, day most recently claimed
}

export type ClaimDecision =
  | { kind: 'grant'; day: number }
  | { kind: 'broken'; repairableDay: number }
  | { kind: 'notEligible'; nextEligibleAt: number };

/**
 * Core claim rule. Eligible = different local calendar day AND at least the
 * min gap since the last claim (the gap is what stops timezone-hopping from
 * minting extra days). Within grace the streak continues; past grace the
 * caller must resolve: 'repair' keeps the streak, 'reset' restarts at day 1,
 * no resolution reports the break so the client can prompt.
 */
export function decideClaim(
  state: ClaimState | null,
  nowMs: number,
  offsetMin: number,
  resolution: 'repair' | 'reset' | undefined,
  graceHours: number,
  minGapHours: number,
): ClaimDecision {
  if (!state) return { kind: 'grant', day: 1 };

  const gapMs = nowMs - state.lastClaimAt;
  const sameLocalDay =
    localDateKey(nowMs, offsetMin) === localDateKey(state.lastClaimAt, offsetMin);
  if (sameLocalDay || gapMs < minGapHours * HOUR_MS) {
    return { kind: 'notEligible', nextEligibleAt: nextEligibleAt(state.lastClaimAt, offsetMin, minGapHours) };
  }

  const continuedDay = (state.streakDay % 7) + 1;
  if (gapMs <= graceHours * HOUR_MS) return { kind: 'grant', day: continuedDay };
  if (resolution === 'repair') return { kind: 'grant', day: continuedDay };
  if (resolution === 'reset') return { kind: 'grant', day: 1 };
  return { kind: 'broken', repairableDay: continuedDay };
}

/** Earliest instant the next claim can succeed: the later of the next local
 *  midnight and lastClaim + minGap. */
export function nextEligibleAt(lastClaimAt: number, offsetMin: number, minGapHours: number): number {
  const local = lastClaimAt + offsetMin * 60_000;
  const nextLocalMidnightUtc = (Math.floor(local / DAY_MS) + 1) * DAY_MS - offsetMin * 60_000;
  return Math.max(nextLocalMidnightUtc, lastClaimAt + minGapHours * HOUR_MS);
}

/** Table lookup with 7-day wrap (day 8 == day 1). */
export function grantsForDay(table: DailyRewardTable, day: number): DailyGrant[] {
  const idx = (((day - 1) % 7) + 7) % 7;
  return table[idx] ?? [];
}

/**
 * Resolve grants into concrete RewardPayloads. Item pools are filtered
 * through `isValidItemId`; an emptied pool falls back to coins so the server
 * never returns an invalid rewardId.
 */
export function grantsToRewards(
  grants: DailyGrant[],
  isValidItemId: (id: string) => boolean,
  rand: () => number = Math.random,
): RewardPayload[] {
  return grants.map((g): RewardPayload => {
    if (g.type === 'item') {
      const pool = g.pool.filter(isValidItemId);
      if (pool.length > 0) {
        const id = pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
        return { rewardType: 'item', rewardId: id, rewardAmount: g.amount };
      }
      return { rewardType: 'coins', rewardAmount: DAILY_FALLBACK_COINS };
    }
    return { rewardType: 'coins', rewardAmount: g.amount };
  });
}

function isGrant(v: unknown): v is DailyGrant {
  if (typeof v !== 'object' || v === null) return false;
  const g = v as Record<string, unknown>;
  if (g.type === 'coins') {
    return typeof g.amount === 'number' && Number.isFinite(g.amount) && g.amount > 0;
  }
  if (g.type === 'item') {
    return Array.isArray(g.pool) && g.pool.length > 0
      && g.pool.every((p) => typeof p === 'string')
      && typeof g.amount === 'number' && Number.isFinite(g.amount) && g.amount > 0;
  }
  return false;
}

/** Returns `value` itself when it is a well-formed 7-day table, else DEFAULT.
 *  (Identity return lets callers detect validity: sanitize(v) === v.) */
export function sanitizeRewardTable(value: unknown): DailyRewardTable {
  if (!Array.isArray(value) || value.length !== 7) return DEFAULT_DAILY_REWARDS;
  const ok = value.every((day) => Array.isArray(day) && day.length > 0 && day.every(isGrant));
  return ok ? (value as DailyRewardTable) : DEFAULT_DAILY_REWARDS;
}

/** Snapshot for GET /daily/status and the client's icon states. */
export function statusFromState(
  state: ClaimState | null,
  nowMs: number,
  offsetMin: number,
  graceHours: number,
  table: DailyRewardTable,
): DailyStatusResponse {
  if (!state) {
    return { streakDay: 0, claimedToday: false, nextClaimDay: 1, todayGrants: grantsForDay(table, 1) };
  }
  const claimedToday =
    localDateKey(nowMs, offsetMin) === localDateKey(state.lastClaimAt, offsetMin);
  const withinGrace = nowMs - state.lastClaimAt <= graceHours * HOUR_MS;
  const nextClaimDay = withinGrace ? (state.streakDay % 7) + 1 : 1;
  return { streakDay: state.streakDay, claimedToday, nextClaimDay, todayGrants: grantsForDay(table, nextClaimDay) };
}

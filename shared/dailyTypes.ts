// shared/dailyTypes.ts
//
// Types for the Daily Drop reward system. Reuses RewardPayload — the same
// grant shape reward codes ship — so the client applies both identically.
// Spec: docs/superpowers/specs/2026-07-16-daily-drop-design.md

import type { RewardPayload } from './codeTypes';

/** One grant within a day's reward. Item grants pick randomly from `pool`. */
export type DailyGrant =
  | { type: 'coins'; amount: number }
  | { type: 'item'; pool: string[]; amount: number };

/** 7 entries, index 0 = streak day 1. Each day may grant several things. */
export type DailyRewardTable = DailyGrant[][];

/** POST /daily/claim request body. */
export interface DailyClaimRequest {
  playerGuid: string;
  utcOffsetMin: number;
  /** Sent on the follow-up call after a streakBroken response. */
  resolution?: 'repair' | 'reset';
}

export interface DailyClaimSuccess {
  kind: 'ok';
  rewards: RewardPayload[];      // array: day 7 grants coins AND an item
  streakDay: number;             // day just claimed (1-7)
  nextRewardPreview: DailyGrant[];
}
export interface DailyStreakBroken { kind: 'streakBroken'; repairableDay: number }
export interface DailyNotEligible { kind: 'notEligible'; nextEligibleAt: number } // unix ms
export type DailyClaimResponse = DailyClaimSuccess | DailyStreakBroken | DailyNotEligible;

/** GET /daily/status response. */
export interface DailyStatusResponse {
  streakDay: number;        // last claimed day (1-7), 0 = never claimed
  claimedToday: boolean;    // in the requesting device's local day
  nextClaimDay: number;     // day the next claim grants (1 if streak lapsed)
  todayGrants: DailyGrant[];
}

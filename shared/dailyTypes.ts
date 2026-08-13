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
  nextEligibleAt: number;        // unix ms — lets the client cache "claimed"
  /** Unix ms this claim's status snapshot self-expires (next local midnight).
   *  Lets the client cache the claim it just made. */
  stableUntil: number;
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
  /** Unix ms the claim after `streakDay` became/becomes possible. Absent only
   *  when the player has never claimed. **Presence does not mean "locked out"**
   *  — for a player who is eligible again (new local day, or a lapsed streak)
   *  this instant is in the past, so any countdown UI must check it against
   *  `claimedToday` rather than rendering it blind. Lets the client cache a
   *  claimed-today snapshot instead of re-fetching on every menu load. */
  nextEligibleAt?: number;
  /** Unix ms this response can next change by itself, or `null` when nothing
   *  can change it without a claim (never claimed, or grace already expired).
   *  **Absent** means the server predates this field — the client must not
   *  cache at all in that case. Distinct from `nextEligibleAt`, which answers
   *  when the player may claim rather than when this response goes stale. */
  stableUntil?: number | null;
}

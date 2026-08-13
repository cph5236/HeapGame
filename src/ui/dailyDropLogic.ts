// src/ui/dailyDropLogic.ts
//
// Pure state logic for the Daily Drop menu icon + auto-popup (testable
// without Phaser, same pattern as hudLogic.ts).

import type { DailyGrant, DailyStatusResponse } from '../../shared/dailyTypes';
import type { RewardPayload } from '../../shared/codeTypes';
import { ACCENT_COLORS } from '../data/itemAccents';
import type { ItemId } from '../../shared/itemIds';

/** Orange used for coin tokens (matches the overlay ACCENT chrome). */
export const COIN_COLOR = 0xff9922;

/** Burst-token color for one reward: coins are orange, items take their store
 *  accent color so a Ladder day bursts green, a Shield day purple, etc. */
export function rewardColor(reward: RewardPayload): number {
  if (reward.rewardType === 'coins') return COIN_COLOR;
  return ACCENT_COLORS[reward.rewardId as ItemId] ?? COIN_COLOR;
}

/** `count` colors for the claim burst, cycling through the day's rewards so a
 *  mixed day (day 7: coins + item) interleaves orange and the item accent. */
export function burstColorsForRewards(rewards: RewardPayload[], count: number): number[] {
  const palette = rewards.length ? rewards.map(rewardColor) : [COIN_COLOR];
  return Array.from({ length: count }, (_, i) => palette[i % palette.length]);
}

export type DailyIconState = 'hidden' | 'locked' | 'ready' | 'waiting' | 'offline';

/** Icon visibility/state. Hidden after today's claim (spec: the can must not
 *  linger once it has no job). `waiting` covers the min-gap window, where
 *  `claimedToday` is already false but a claim would still 409 — without it the
 *  can renders `ready` and the tap dead-ends. It displaces only `ready`:
 *  when the player has not run yet, `locked` is the gate they can act on, and
 *  tapping `locked` opens a preview with no claim path, so it is not a
 *  dead-end. A server that omits `nextEligibleAt` never yields `waiting`. */
export function dailyIconState(
  status: DailyStatusResponse | null,
  playedToday: boolean,
  now: number = Date.now(),
): DailyIconState {
  if (status === null) return 'offline';
  if (status.claimedToday) return 'hidden';
  if (!playedToday) return 'locked';
  if (typeof status.nextEligibleAt === 'number' && now < status.nextEligibleAt) return 'waiting';
  return 'ready';
}

/** Coarse "time until the next drop" label for the waiting can. Minute
 *  granularity — the can ticks every 15s, and seconds would just churn. */
export function formatCountdown(msRemaining: number): string {
  const totalMin = Math.floor(msRemaining / 60_000);
  if (totalMin < 1) return '<1m';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** The claim overlay auto-opens once per local day, only when claimable. */
export function shouldAutoShowPopup(
  state: DailyIconState,
  lastShownDateKey: string | null,
  todayKey: string,
): boolean {
  return state === 'ready' && lastShownDateKey !== todayKey;
}

export type StreakChip = 'done' | 'now' | 'todo';

/** Chip states for the 7-day strip when the player is claiming `nextDay`. */
export function streakChips(nextDay: number): StreakChip[] {
  return Array.from({ length: 7 }, (_, i) =>
    i + 1 < nextDay ? 'done' : i + 1 === nextDay ? 'now' : 'todo');
}

/** Day the 7-day strip highlights. Until a claim resolves that is the day the
 *  next claim would grant; afterwards it is the day actually granted. The two
 *  differ on a lapsed streak: status reports day 1, but repairing via the ad
 *  pays out the repairable day, and the strip must follow the payout. */
export function activeStreakDay(status: DailyStatusResponse, claimedDay: number | null): number {
  return claimedDay ?? status.nextClaimDay;
}

/** Day 7 is the payoff day — the can goes golden and gains a glow. */
export function isGoldenDay(day: number): boolean {
  return day === 7;
}

/** Preview line for one grant. Item grants are randomized from `pool` at
 *  claim time server-side, so a locked-icon preview shows the whole pool
 *  rather than a single (not-yet-decided) item. */
export function grantPreviewText(grant: DailyGrant, itemName: (id: string) => string): string {
  if (grant.type === 'coins') return `+${grant.amount} coins`;
  return `${grant.amount}x ${grant.pool.map(itemName).join(' or ')}`;
}

/** Preview text for a full day's grants (one line per grant — day 7 grants
 *  both coins and an item). Used by the locked can-icon preview. */
export function dailyRewardPreview(grants: DailyGrant[], itemName: (id: string) => string): string {
  return grants.map((g) => grantPreviewText(g, itemName)).join('\n');
}

import { describe, it, expect } from 'vitest';
import {
  clampOffsetMin, localDateKey, decideClaim, nextEligibleAt,
  grantsForDay, grantsToRewards, sanitizeRewardTable, statusFromState,
  DEFAULT_DAILY_REWARDS, DEFAULT_GRACE_HOURS, DEFAULT_MIN_GAP_HOURS, DAILY_FALLBACK_COINS,
} from '../dailyDrop';
import { isItemId } from '../itemIds';

const H = 3_600_000;
// 2026-07-16T02:00:00Z — 10pm July 15 in New York (UTC-4, offset -240)
const T0 = Date.parse('2026-07-16T02:00:00Z');

describe('clampOffsetMin', () => {
  it('passes normal offsets through, truncated', () => {
    expect(clampOffsetMin(-240)).toBe(-240);
    expect(clampOffsetMin(330.7)).toBe(330);
  });
  it('clamps to the valid UTC offset range', () => {
    expect(clampOffsetMin(-100000)).toBe(-720);
    expect(clampOffsetMin(100000)).toBe(840);
  });
  it('maps garbage to 0', () => {
    expect(clampOffsetMin('x')).toBe(0);
    expect(clampOffsetMin(NaN)).toBe(0);
    expect(clampOffsetMin(undefined)).toBe(0);
  });
});

describe('localDateKey', () => {
  it('derives the local calendar date from a UTC instant + offset', () => {
    expect(localDateKey(T0, 0)).toBe('2026-07-16');     // UTC
    expect(localDateKey(T0, -240)).toBe('2026-07-15');  // New York evening
    expect(localDateKey(T0, 840)).toBe('2026-07-16');   // UTC+14
  });
});

describe('decideClaim', () => {
  const G = DEFAULT_GRACE_HOURS, M = DEFAULT_MIN_GAP_HOURS;

  it('first-ever claim grants day 1', () => {
    expect(decideClaim(null, T0, -240, undefined, G, M)).toEqual({ kind: 'grant', day: 1 });
  });

  it('east-coast case: 10pm claim then 3pm next local day is eligible (day 2)', () => {
    const state = { lastClaimAt: T0, streakDay: 1 };        // 10pm Jul 15 local
    const next = T0 + 17 * H;                                // 3pm Jul 16 local
    expect(decideClaim(state, next, -240, undefined, G, M)).toEqual({ kind: 'grant', day: 2 });
  });

  it('same local day is not eligible even after the min gap', () => {
    // Morning claim at 8am local; 12h later is 8pm the SAME local day —
    // min gap passed, but the calendar day rule still blocks it.
    const morning = Date.parse('2026-07-16T12:00:00Z');      // 8am Jul 16 in NY
    const state = { lastClaimAt: morning, streakDay: 3 };
    const out = decideClaim(state, morning + 12 * H, -240, undefined, G, M);
    expect(out.kind).toBe('notEligible');
  });

  it('a new local day within the min gap is blocked (11:55pm → 12:05am)', () => {
    const lateNight = Date.parse('2026-07-16T03:55:00Z');    // 11:55pm Jul 15 NY
    const state = { lastClaimAt: lateNight, streakDay: 2 };
    const out = decideClaim(state, lateNight + 10 * 60_000, -240, undefined, G, M);
    expect(out.kind).toBe('notEligible');
  });

  it('within grace continues the streak; wraps 7 → 1', () => {
    const state = { lastClaimAt: T0, streakDay: 7 };
    expect(decideClaim(state, T0 + 24 * H, -240, undefined, G, M)).toEqual({ kind: 'grant', day: 1 });
  });

  it('past grace with no resolution reports streakBroken', () => {
    const state = { lastClaimAt: T0, streakDay: 4 };
    expect(decideClaim(state, T0 + 40 * H, -240, undefined, G, M))
      .toEqual({ kind: 'broken', repairableDay: 5 });
  });

  it('past grace with resolution=repair continues the streak', () => {
    const state = { lastClaimAt: T0, streakDay: 4 };
    expect(decideClaim(state, T0 + 40 * H, -240, 'repair', G, M)).toEqual({ kind: 'grant', day: 5 });
  });

  it('past grace with resolution=reset grants day 1', () => {
    const state = { lastClaimAt: T0, streakDay: 4 };
    expect(decideClaim(state, T0 + 40 * H, -240, 'reset', G, M)).toEqual({ kind: 'grant', day: 1 });
  });

  it('a resolution sent when the streak is intact is ignored', () => {
    const state = { lastClaimAt: T0, streakDay: 4 };
    expect(decideClaim(state, T0 + 24 * H, -240, 'reset', G, M)).toEqual({ kind: 'grant', day: 5 });
  });
});

describe('nextEligibleAt', () => {
  it('is at least the next local midnight', () => {
    const at = nextEligibleAt(T0, -240, DEFAULT_MIN_GAP_HOURS); // claimed 10pm local
    expect(localDateKey(at, -240)).toBe('2026-07-16');           // next local day
    expect(at).toBeGreaterThanOrEqual(T0 + DEFAULT_MIN_GAP_HOURS * H);
  });
  it('is at least minGap after the last claim (morning claim)', () => {
    const morning = Date.parse('2026-07-16T12:00:00Z');          // 8am NY
    const at = nextEligibleAt(morning, -240, DEFAULT_MIN_GAP_HOURS);
    // next local midnight (16h away) dominates the 10h gap here
    expect(localDateKey(at, -240)).toBe('2026-07-17');
  });
});

describe('reward table', () => {
  it('grantsForDay wraps day 8 to day 1', () => {
    expect(grantsForDay(DEFAULT_DAILY_REWARDS, 8)).toEqual(grantsForDay(DEFAULT_DAILY_REWARDS, 1));
  });

  it('day 7 default grants coins AND a revive', () => {
    const rewards = grantsToRewards(grantsForDay(DEFAULT_DAILY_REWARDS, 7), isItemId, () => 0);
    expect(rewards).toEqual([
      { rewardType: 'coins', rewardAmount: 300 },
      { rewardType: 'item', rewardId: 'revive', rewardAmount: 1 },
    ]);
  });

  it('item grants pick from the pool with the provided rand', () => {
    const rewards = grantsToRewards(grantsForDay(DEFAULT_DAILY_REWARDS, 3), isItemId, () => 0.99);
    expect(rewards).toEqual([{ rewardType: 'item', rewardId: 'checkpoint', rewardAmount: 1 }]);
  });

  it('an all-invalid pool falls back to coins, never an invalid item id', () => {
    const rewards = grantsToRewards([{ type: 'item', pool: ['not_real'], amount: 1 }], isItemId);
    expect(rewards).toEqual([{ rewardType: 'coins', rewardAmount: DAILY_FALLBACK_COINS }]);
  });

  it('sanitizeRewardTable returns the value itself when valid, DEFAULT otherwise', () => {
    expect(sanitizeRewardTable(DEFAULT_DAILY_REWARDS)).toBe(DEFAULT_DAILY_REWARDS);
    expect(sanitizeRewardTable([[{ type: 'coins', amount: 5 }]])).toBe(DEFAULT_DAILY_REWARDS); // wrong length
    expect(sanitizeRewardTable('junk')).toBe(DEFAULT_DAILY_REWARDS);
    expect(sanitizeRewardTable([[], [], [], [], [], [], []])).toBe(DEFAULT_DAILY_REWARDS);     // empty days
  });
});

describe('statusFromState', () => {
  it('never-claimed player: day 1 preview, not claimed', () => {
    const s = statusFromState(null, T0, -240, DEFAULT_GRACE_HOURS, DEFAULT_DAILY_REWARDS);
    expect(s).toEqual({
      streakDay: 0, claimedToday: false, nextClaimDay: 1,
      todayGrants: grantsForDay(DEFAULT_DAILY_REWARDS, 1),
    });
  });
  it('claimed earlier today: claimedToday true', () => {
    const state = { lastClaimAt: T0, streakDay: 2 };
    const s = statusFromState(state, T0 + 1 * H, -240, DEFAULT_GRACE_HOURS, DEFAULT_DAILY_REWARDS); // 11pm Jul 15 NY — still same local day
    expect(s.claimedToday).toBe(true);
    expect(s.nextClaimDay).toBe(3);
  });
  it('past grace: preview drops to day 1', () => {
    const state = { lastClaimAt: T0, streakDay: 5 };
    const s = statusFromState(state, T0 + 50 * H, -240, DEFAULT_GRACE_HOURS, DEFAULT_DAILY_REWARDS);
    expect(s.claimedToday).toBe(false);
    expect(s.nextClaimDay).toBe(1);
  });
});

import { describe, it, expect } from 'vitest';
import { dailyIconState, formatCountdown, shouldAutoShowPopup, streakChips, activeStreakDay, isGoldenDay, grantPreviewText, dailyRewardPreview, COIN_COLOR, burstColorsForRewards } from '../dailyDropLogic';
import { ACCENT_COLORS } from '../../data/itemAccents';
import type { DailyStatusResponse, DailyGrant } from '../../../shared/dailyTypes';
import type { RewardPayload } from '../../../shared/codeTypes';

const base: DailyStatusResponse = { streakDay: 2, claimedToday: false, nextClaimDay: 3, todayGrants: [] };

describe('dailyIconState', () => {
  it('offline when status is unavailable', () => {
    expect(dailyIconState(null, true)).toBe('offline');
  });
  it('hidden once claimed today — the can must get out of the way', () => {
    expect(dailyIconState({ ...base, claimedToday: true }, true)).toBe('hidden');
  });
  it('locked before the first run of the day', () => {
    expect(dailyIconState(base, false)).toBe('locked');
  });
  it('ready after a run, unclaimed', () => {
    expect(dailyIconState(base, true)).toBe('ready');
  });

  const H = 3_600_000;
  const NOW = Date.parse('2026-07-16T02:00:00Z');

  it('waiting when played but the min gap has not elapsed', () => {
    const status = { ...base, nextEligibleAt: NOW + 2 * H };
    expect(dailyIconState(status, true, NOW)).toBe('waiting');
  });

  it('locked beats waiting — "play a run" is the actionable gate', () => {
    const status = { ...base, nextEligibleAt: NOW + 2 * H };
    expect(dailyIconState(status, false, NOW)).toBe('locked');
  });

  it('ready once nextEligibleAt has passed', () => {
    const status = { ...base, nextEligibleAt: NOW - 1 * H };
    expect(dailyIconState(status, true, NOW)).toBe('ready');
  });

  it('ready when the server omits nextEligibleAt', () => {
    expect(dailyIconState(base, true, NOW)).toBe('ready');
  });

  it('hidden still wins once claimed, whatever nextEligibleAt says', () => {
    const status = { ...base, claimedToday: true, nextEligibleAt: NOW + 2 * H };
    expect(dailyIconState(status, true, NOW)).toBe('hidden');
  });
});

describe('formatCountdown', () => {
  const H = 3_600_000;
  const M = 60_000;

  it('shows hours and minutes past an hour', () => {
    expect(formatCountdown(2 * H + 14 * M)).toBe('2h 14m');
  });
  it('shows minutes only under an hour', () => {
    expect(formatCountdown(14 * M)).toBe('14m');
  });
  it('shows a floor marker under a minute', () => {
    expect(formatCountdown(30_000)).toBe('<1m');
  });
  it('shows a floor marker at or below zero', () => {
    expect(formatCountdown(0)).toBe('<1m');
    expect(formatCountdown(-5000)).toBe('<1m');
  });
  it('keeps the minute component on a whole hour', () => {
    expect(formatCountdown(1 * H)).toBe('1h 0m');
  });
});

describe('shouldAutoShowPopup', () => {
  it('fires when ready and not yet shown today', () => {
    expect(shouldAutoShowPopup('ready', null, '2026-07-16')).toBe(true);
    expect(shouldAutoShowPopup('ready', '2026-07-15', '2026-07-16')).toBe(true);
  });
  it('fires at most once per day', () => {
    expect(shouldAutoShowPopup('ready', '2026-07-16', '2026-07-16')).toBe(false);
  });
  it('never fires for other states', () => {
    expect(shouldAutoShowPopup('locked', null, '2026-07-16')).toBe(false);
    expect(shouldAutoShowPopup('hidden', null, '2026-07-16')).toBe(false);
    expect(shouldAutoShowPopup('offline', null, '2026-07-16')).toBe(false);
  });
});

describe('streakChips', () => {
  it('marks earlier days done, the claiming day now, later days todo', () => {
    expect(streakChips(3)).toEqual(['done', 'done', 'now', 'todo', 'todo', 'todo', 'todo']);
  });
  it('day 1 has nothing done', () => {
    expect(streakChips(1)[0]).toBe('now');
    expect(streakChips(1).filter((c) => c === 'done')).toHaveLength(0);
  });
  it('day 7 is all done but the last', () => {
    expect(streakChips(7)).toEqual(['done', 'done', 'done', 'done', 'done', 'done', 'now']);
  });
});

describe('activeStreakDay', () => {
  it('follows the status before a claim resolves', () => {
    expect(activeStreakDay(base, null)).toBe(3);
  });

  it('follows the granted day after a streak repair, not the lapsed status', () => {
    // Lapsed streak: status says the next claim is day 1, but repairing via
    // the ad grants day 2 — the strip must highlight the day actually paid out.
    const lapsed: DailyStatusResponse = { ...base, streakDay: 1, nextClaimDay: 1 };
    expect(activeStreakDay(lapsed, 2)).toBe(2);
    expect(streakChips(activeStreakDay(lapsed, 2)))
      .toEqual(['done', 'now', 'todo', 'todo', 'todo', 'todo', 'todo']);
  });

  it('follows the granted day after a reset (start over grants day 1)', () => {
    const lapsed: DailyStatusResponse = { ...base, streakDay: 4, nextClaimDay: 1 };
    expect(activeStreakDay(lapsed, 1)).toBe(1);
  });
});

describe('isGoldenDay', () => {
  it('only day 7 is golden', () => {
    expect([1, 2, 3, 4, 5, 6].map(isGoldenDay)).toEqual(Array(6).fill(false));
    expect(isGoldenDay(7)).toBe(true);
  });

  it('a repair from day 6 goes golden even though the status predicted day 1', () => {
    const lapsed: DailyStatusResponse = { ...base, streakDay: 6, nextClaimDay: 1 };
    expect(isGoldenDay(activeStreakDay(lapsed, null))).toBe(false);  // grey while undecided
    expect(isGoldenDay(activeStreakDay(lapsed, 7))).toBe(true);      // golden once day 7 pays out
  });
});

describe('grantPreviewText', () => {
  const itemName = (id: string): string => ({ ladder: 'Ladder', ibeam: 'I-Beam' }[id] ?? id);

  it('formats a coins grant', () => {
    expect(grantPreviewText({ type: 'coins', amount: 75 }, itemName)).toBe('+75 coins');
  });

  it('formats an item grant, listing the whole pool (not yet randomized)', () => {
    const grant: DailyGrant = { type: 'item', pool: ['ladder', 'ibeam'], amount: 1 };
    expect(grantPreviewText(grant, itemName)).toBe('1x Ladder or I-Beam');
  });
});

describe('dailyRewardPreview', () => {
  const itemName = (id: string): string => ({ revive: 'Revive' }[id] ?? id);

  it('joins multiple grants one per line (e.g. day 7: coins + item)', () => {
    const grants: DailyGrant[] = [
      { type: 'coins', amount: 300 },
      { type: 'item', pool: ['revive'], amount: 1 },
    ];
    expect(dailyRewardPreview(grants, itemName)).toBe('+300 coins\n1x Revive');
  });

  it('empty grants preview to an empty string', () => {
    expect(dailyRewardPreview([], itemName)).toBe('');
  });
});

describe('burstColorsForRewards', () => {
  const coins: RewardPayload = { rewardType: 'coins', rewardAmount: 50 };
  const ladder: RewardPayload = { rewardType: 'item', rewardId: 'ladder', rewardAmount: 1 };

  it('returns exactly `count` colors', () => {
    expect(burstColorsForRewards([coins], 10)).toHaveLength(10);
  });

  it('colors a coins-only day entirely in the coin color', () => {
    expect(burstColorsForRewards([coins], 6)).toEqual(Array(6).fill(COIN_COLOR));
  });

  it('uses the item accent color for an item grant', () => {
    expect(burstColorsForRewards([ladder], 4)).toEqual(Array(4).fill(ACCENT_COLORS.ladder));
  });

  it('interleaves colors on a mixed day (day 7: coins + item)', () => {
    expect(burstColorsForRewards([coins, ladder], 4))
      .toEqual([COIN_COLOR, ACCENT_COLORS.ladder, COIN_COLOR, ACCENT_COLORS.ladder]);
  });

  it('falls back to the coin color for an unknown item id', () => {
    const mystery: RewardPayload = { rewardType: 'item', rewardId: 'not_a_real_item', rewardAmount: 1 };
    expect(burstColorsForRewards([mystery], 3)).toEqual(Array(3).fill(COIN_COLOR));
  });

  it('defaults to the coin color when there are no rewards', () => {
    expect(burstColorsForRewards([], 3)).toEqual(Array(3).fill(COIN_COLOR));
  });
});

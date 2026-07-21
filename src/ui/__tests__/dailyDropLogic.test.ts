import { describe, it, expect } from 'vitest';
import { dailyIconState, shouldAutoShowPopup, streakChips, grantPreviewText, dailyRewardPreview, COIN_COLOR, burstColorsForRewards } from '../dailyDropLogic';
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

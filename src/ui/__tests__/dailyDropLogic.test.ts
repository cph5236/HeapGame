import { describe, it, expect } from 'vitest';
import { dailyIconState, shouldAutoShowPopup, streakChips } from '../dailyDropLogic';
import type { DailyStatusResponse } from '../../../shared/dailyTypes';

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

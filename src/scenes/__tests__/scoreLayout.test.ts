import { describe, it, expect } from 'vitest';
import { bottomButtonLayout, bottomButtonRowY, leaderboardRowSlots, LB_ROW_SCALE } from '../scoreLayout';

const W = 400;

describe('bottomButtonLayout', () => {
  it('shows play-again centered full-width when no checkpoint and no ad', () => {
    const slots = bottomButtonLayout({ checkpointAvailable: false, showAd: false }, W);
    expect(slots).toEqual([
      { kind: 'playAgain', cx: W / 2, compact: false },
    ]);
  });

  it('shows checkpoint centered full-width when checkpoint and no ad', () => {
    const slots = bottomButtonLayout({ checkpointAvailable: true, showAd: false }, W);
    expect(slots).toEqual([
      { kind: 'checkpoint', cx: W / 2, compact: false },
    ]);
  });

  it('pairs play-again with the ad button, both compact, when no checkpoint and ad', () => {
    const slots = bottomButtonLayout({ checkpointAvailable: false, showAd: true }, W);
    expect(slots).toEqual([
      { kind: 'playAgain', cx: W * 0.25, compact: true },
      { kind: 'rewardedAd', cx: W * 0.75, compact: true },
    ]);
  });

  it('pairs checkpoint with the ad button, both compact, when checkpoint and ad', () => {
    const slots = bottomButtonLayout({ checkpointAvailable: true, showAd: true }, W);
    expect(slots).toEqual([
      { kind: 'checkpoint', cx: W * 0.25, compact: true },
      { kind: 'rewardedAd', cx: W * 0.75, compact: true },
    ]);
  });
});

describe('bottomButtonRowY', () => {
  const H = 800;

  it('falls back to the legacy near-bottom position when there is no leaderboard', () => {
    expect(bottomButtonRowY({ leaderboardBottom: null, screenHeight: H })).toBeCloseTo(H * 0.89);
  });

  it('anchors just below the leaderboard bottom when there is room above the menu prompt', () => {
    // Leaderboard ends high on the screen → buttons hug it, well clear of the clamp.
    const y = bottomButtonRowY({ leaderboardBottom: 500, screenHeight: H });
    expect(y).toBe(500 + 34);
    expect(y).toBeLessThan(H * 0.91);
  });

  it('clamps above the menu prompt when the leaderboard reaches too far down', () => {
    // Leaderboard ends near the very bottom → button would collide with the prompt,
    // so it is clamped to the max safe row.
    const y = bottomButtonRowY({ leaderboardBottom: 780, screenHeight: H });
    expect(y).toBe(H * 0.91);
  });
});

describe('leaderboardRowSlots', () => {
  it('enlarges the first N rows by LB_ROW_SCALE', () => {
    const { slots } = leaderboardRowSlots(7, 20, 5);
    expect(slots).toHaveLength(7);
    for (let i = 0; i < 5; i++) {
      expect(slots[i].h).toBe(20 * LB_ROW_SCALE);
      expect(slots[i].enlarged).toBe(true);
    }
    expect(slots[5].h).toBe(20);
    expect(slots[5].enlarged).toBe(false);
  });

  it('stacks y offsets cumulatively and reports totalH', () => {
    const { slots, totalH } = leaderboardRowSlots(3, 20, 2);
    expect(slots[0].y).toBe(0);
    expect(slots[1].y).toBe(28);        // 20 * 1.4
    expect(slots[2].y).toBe(56);        // 28 + 28
    expect(totalH).toBe(76);            // 28 + 28 + 20
  });

  it('handles fewer rows than the enlarge count', () => {
    const { slots, totalH } = leaderboardRowSlots(2, 20, 5);
    expect(slots.every(s => s.enlarged)).toBe(true);
    expect(totalH).toBe(56);
  });

  it('handles zero rows', () => {
    const { slots, totalH } = leaderboardRowSlots(0, 20, 5);
    expect(slots).toEqual([]);
    expect(totalH).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import { bottomButtonLayout, bottomButtonRowY } from '../scoreLayout';

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
    expect(bottomButtonRowY({ leaderboardBottom: null, screenHeight: H })).toBeCloseTo(H * 0.87);
  });

  it('anchors just below the leaderboard bottom when there is room above the menu prompt', () => {
    // Leaderboard ends high on the screen → buttons hug it, well clear of the clamp.
    const y = bottomButtonRowY({ leaderboardBottom: 500, screenHeight: H });
    expect(y).toBe(500 + 34);
    expect(y).toBeLessThan(H * 0.89);
  });

  it('clamps above the menu prompt when the leaderboard reaches too far down', () => {
    // Leaderboard ends near the very bottom → button would collide with the prompt,
    // so it is clamped to the max safe row.
    const y = bottomButtonRowY({ leaderboardBottom: 780, screenHeight: H });
    expect(y).toBe(H * 0.89);
  });
});

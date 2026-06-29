import { describe, it, expect } from 'vitest';
import { bottomButtonLayout } from '../scoreLayout';

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

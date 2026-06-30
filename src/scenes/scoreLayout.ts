// Pure layout logic for the ScoreScene bottom action buttons. Kept free of Phaser
// so the slot-selection rules can be unit-tested in isolation (see scoreLayout.test.ts).

export type BottomButtonKind = 'checkpoint' | 'playAgain' | 'rewardedAd';

export interface BottomButtonSlot {
  kind: BottomButtonKind;
  cx: number;        // logical x position
  compact: boolean;  // compact styling when sharing the row with another button
}

/**
 * Decides which bottom buttons the score screen shows and where they sit.
 *
 * There is always a primary action: RESPAWN when a checkpoint is active, otherwise
 * PLAY AGAIN. When a rewarded-ad button is also shown the two share the row (compact,
 * at quarter positions); otherwise the primary is centered full-width.
 */
export function bottomButtonLayout(
  opts: { checkpointAvailable: boolean; showAd: boolean },
  width: number,
): BottomButtonSlot[] {
  const primary: BottomButtonKind = opts.checkpointAvailable ? 'checkpoint' : 'playAgain';

  if (opts.showAd) {
    return [
      { kind: primary,      cx: width * 0.25, compact: true },
      { kind: 'rewardedAd', cx: width * 0.75, compact: true },
    ];
  }

  return [{ kind: primary, cx: width / 2, compact: false }];
}

/** Vertical center (logical y) for the bottom action-button row.
 *
 * The buttons are anchored just below the leaderboard panel rather than at a fixed
 * fraction of the screen, so a tall coins-breakdown + leaderboard stack can never
 * overrun them (the old bug: a fixed 0.87·H row rendered behind the leaderboard on
 * short screens). The result is clamped to stay clear of the "tap for menu" prompt
 * (~0.95·H). When there is no leaderboard at all, falls back to the legacy position.
 */
export function bottomButtonRowY(opts: {
  leaderboardBottom: number | null;  // logical y of the leaderboard panel's bottom edge
  screenHeight: number;              // logical viewport height
}): number {
  const GAP      = 34;                       // panel bottom → button center
  const maxY     = opts.screenHeight * 0.89; // keep clear of the menu prompt at 0.95·H
  const fallback = opts.screenHeight * 0.87;
  if (opts.leaderboardBottom == null) return fallback;
  return Math.min(opts.leaderboardBottom + GAP, maxY);
}

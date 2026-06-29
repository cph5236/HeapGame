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

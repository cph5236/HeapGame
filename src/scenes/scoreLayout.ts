// Pure layout logic for the ScoreScene bottom action buttons. Kept free of Phaser
// so the slot-selection rules can be unit-tested in isolation (see scoreLayout.test.ts).

import { PLAYER_HEIGHT } from '../constants';

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

/** Height multiplier for the showcase (avatar) rows at the top of a leaderboard. */
export const LB_ROW_SCALE = 1.4;

/**
 * Absolute height (logical px) for avatar-showcase rows. A fixed value rather
 * than a multiplier of the scene's own row height, because the avatar is
 * rendered at the same logical scale in every scene — a hat's headroom
 * requirement doesn't change with the surrounding row's baseline height.
 * Sized to fully contain the ~90% of hats with normal proportions; a handful
 * of oversized novelty hats (Traffic Cone, Cat Ears, Antlers, Banana Peel,
 * Bunny Ears, Trapper Hat) may still clip slightly at the top.
 */
export const LB_ENLARGED_ROW_H = 50;

/** Avatar `scale` for leaderboard/score-screen showcase rows (15% larger
 *  than the previous 0.5, paired with LB_ENLARGED_ROW_H). */
export const LB_AVATAR_SCALE = 0.575;

export interface LeaderboardRowSlot {
  y: number;         // top offset within the panel body
  h: number;         // row height
  enlarged: boolean; // true for the avatar-showcase rows
}

/**
 * Row layout for a leaderboard panel whose first `enlargeCount` rows are
 * enlarged to fit a mini player avatar (the "show off your cosmetics" rows).
 */
export function leaderboardRowSlots(
  rowCount: number,
  rowH: number,
  enlargeCount: number,
  enlargedRowH: number = rowH * LB_ROW_SCALE,
): { slots: LeaderboardRowSlot[]; totalH: number } {
  const slots: LeaderboardRowSlot[] = [];
  let y = 0;
  for (let i = 0; i < rowCount; i++) {
    const enlarged = i < enlargeCount;
    const h = enlarged ? enlargedRowH : rowH;
    slots.push({ y, h, enlarged });
    y += h;
  }
  return { slots, totalH: y };
}

/** Gap between the avatar's feet and the row's bottom edge, in enlarged rows. */
const AVATAR_BOTTOM_PAD = 3;

/**
 * Vertical anchor (offset within the panel body) for a row's content — the
 * avatar plus its rank/name/score text.
 *
 * Normal rows stay dead-centered. Enlarged rows anchor near the row's bottom
 * edge instead of its center: the avatar's bag is a fixed height, but hats
 * grow upward from it, so bottom-anchoring the whole row's content spends
 * the row's extra height as headroom above the avatar rather than splitting
 * it evenly above and below.
 */
export function rowContentY(
  slot: LeaderboardRowSlot,
  avatarScale: number = LB_AVATAR_SCALE,
): number {
  if (!slot.enlarged) return slot.y + slot.h / 2;
  return slot.y + slot.h - AVATAR_BOTTOM_PAD - (PLAYER_HEIGHT / 2) * avatarScale;
}

// src/ui/dailyDropLogic.ts
//
// Pure state logic for the Daily Drop menu icon + auto-popup (testable
// without Phaser, same pattern as hudLogic.ts).

import type { DailyStatusResponse } from '../../shared/dailyTypes';

export type DailyIconState = 'hidden' | 'locked' | 'ready' | 'offline';

/** Icon visibility/state. Hidden after today's claim (spec: the can must not
 *  linger once it has no job). */
export function dailyIconState(
  status: DailyStatusResponse | null,
  playedToday: boolean,
): DailyIconState {
  if (status === null) return 'offline';
  if (status.claimedToday) return 'hidden';
  return playedToday ? 'ready' : 'locked';
}

/** The claim overlay auto-opens once per local day, only when claimable. */
export function shouldAutoShowPopup(
  state: DailyIconState,
  lastShownDateKey: string | null,
  todayKey: string,
): boolean {
  return state === 'ready' && lastShownDateKey !== todayKey;
}

export type StreakChip = 'done' | 'now' | 'todo';

/** Chip states for the 7-day strip when the player is claiming `nextDay`. */
export function streakChips(nextDay: number): StreakChip[] {
  return Array.from({ length: 7 }, (_, i) =>
    i + 1 < nextDay ? 'done' : i + 1 === nextDay ? 'now' : 'todo');
}

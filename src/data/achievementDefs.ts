import { SCORE_DISPLAY_DIVISOR } from '../../shared/scoreConstants';

export interface AchievementDef {
  id:            string;
  playConsoleId: string;
  name:          string;
  incremental?:  true;
}

export const ACHIEVEMENT_DEFS: AchievementDef[] = [
  { id: 'first_climb',       playConsoleId: 'CgkIpJC3z5gSEAIQAQ', name: 'First Climb' },
  { id: 'reach_100m',        playConsoleId: 'CgkIpJC3z5gSEAIQAg', name: 'Sky High' },
  { id: 'reach_1000m',       playConsoleId: 'CgkIpJC3z5gSEAIQAw', name: 'Cloud Surfer' },
  { id: 'first_placement',   playConsoleId: 'CgkIpJC3z5gSEAIQBA', name: 'Builder' },
  { id: 'stomp_10',          playConsoleId: 'CgkIpJC3z5gSEAIQBQ', name: 'Pest Control' },
  { id: 'stomp_100_total',   playConsoleId: 'CgkIpJC3z5gSEAIQBg', name: 'Heap Exterminator', incremental: true },
];

export const LEADERBOARD_HIGH_SCORE_ID = 'CgkIpJC3z5gSEAIQBw';

/**
 * Height-achievement unlock thresholds, in raw px climbed.
 *
 * Derived from the feet shown on the HUD (100 ft and 1000 ft) via
 * SCORE_DISPLAY_DIVISOR — the same constant the HUD uses to convert px → feet —
 * so the unlock point always matches the number the player sees. These were
 * previously hardcoded as 100_000 / 1_000_000 px under a phantom 1000px/m scale,
 * which put both thresholds above the climbable height of a real heap and so
 * neither achievement could ever fire. (The IDs still read `reach_100m` /
 * `reach_1000m` for Play Console compatibility, but the achievements are in feet.)
 */
export const HEIGHT_ACHIEVEMENT_THRESHOLDS_PX = {
  reach_100m:  100  * SCORE_DISPLAY_DIVISOR,
  reach_1000m: 1000 * SCORE_DISPLAY_DIVISOR,
} as const;

export function getPlayConsoleId(achievementId: string): string | null {
  return ACHIEVEMENT_DEFS.find(a => a.id === achievementId)?.playConsoleId ?? null;
}

export function isIncrementalAchievement(achievementId: string): boolean {
  return ACHIEVEMENT_DEFS.find(a => a.id === achievementId)?.incremental === true;
}

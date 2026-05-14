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

export function getPlayConsoleId(achievementId: string): string | null {
  return ACHIEVEMENT_DEFS.find(a => a.id === achievementId)?.playConsoleId ?? null;
}

export function isIncrementalAchievement(achievementId: string): boolean {
  return ACHIEVEMENT_DEFS.find(a => a.id === achievementId)?.incremental === true;
}

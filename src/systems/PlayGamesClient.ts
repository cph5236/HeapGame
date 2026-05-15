import { registerPlugin, Capacitor } from '@capacitor/core';

interface PlayGamesPlugin {
  signIn(): Promise<{ playerId: string; displayName: string }>;
  unlockAchievement(options: { achievementId: string }): Promise<void>;
  incrementAchievement(options: { achievementId: string; steps: number }): Promise<void>;
  submitScore(options: { leaderboardId: string; score: number }): Promise<void>;
  showPlayerProfile(): Promise<void>;
  saveSnapshot(options: { data: string }): Promise<void>;
  loadSnapshot(): Promise<{ data: string | null }>;
}

const _plugin = registerPlugin<PlayGamesPlugin>('PlayGames');

function isAndroid(): boolean {
  return Capacitor.getPlatform() === 'android';
}

export const PlayGamesClient = {
  async signIn(): Promise<{ playerId: string; displayName: string } | null> {
    if (!isAndroid()) return null;
    try {
      return await _plugin.signIn();
    } catch {
      return null;
    }
  },

  async unlockAchievement(achievementId: string): Promise<void> {
    if (!isAndroid()) return;
    try {
      await _plugin.unlockAchievement({ achievementId });
    } catch { /* silent — never interrupt gameplay */ }
  },

  async incrementAchievement(achievementId: string, steps: number): Promise<void> {
    if (!isAndroid()) return;
    try {
      await _plugin.incrementAchievement({ achievementId, steps });
    } catch { /* silent */ }
  },

  async submitScore(leaderboardId: string, score: number): Promise<void> {
    if (!isAndroid()) return;
    try {
      await _plugin.submitScore({ leaderboardId, score });
    } catch { /* silent */ }
  },

  async showPlayerProfile(): Promise<void> {
    if (!isAndroid()) return;
    try {
      await _plugin.showPlayerProfile();
    } catch { /* silent */ }
  },

  async saveSnapshot(data: string): Promise<void> {
    if (!isAndroid()) return;
    try {
      await _plugin.saveSnapshot({ data });
    } catch { /* silent */ }
  },

  async loadSnapshot(): Promise<string | null> {
    if (!isAndroid()) return null;
    try {
      const result = await _plugin.loadSnapshot();
      return result.data;
    } catch {
      return null;
    }
  },
};

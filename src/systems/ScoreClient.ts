import type { LeaderboardContext, SubmitScoreResponse } from '../../shared/scoreTypes';

const SERVER_URL: string =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_HEAP_SERVER_URL ??
  'http://localhost:8787';

export class ScoreClient {
  /**
   * Submit a score for a heap. Returns the leaderboard context on success,
   * or null if the server is unreachable or returns an error.
   */
  static async submitScore(params: {
    heapId:     string;
    playerId:   string;
    playerName: string;
    score:      number;
    limit?:     number;
  }): Promise<LeaderboardContext | null> {
    try {
      const url = params.limit
        ? `${SERVER_URL}/scores?limit=${params.limit}`
        : `${SERVER_URL}/scores`;

      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          heapId:     params.heapId,
          playerId:   params.playerId,
          playerName: params.playerName,
          score:      params.score,
        }),
      });

      if (!res.ok) return null;
      const data = (await res.json()) as SubmitScoreResponse;
      return data.context;
    } catch {
      return null;
    }
  }

  /**
   * Fetch leaderboard context without submitting. Returns null on failure.
   */
  static async getContext(params: {
    heapId:    string;
    playerId:  string;
    limit?:    number;
  }): Promise<LeaderboardContext | null> {
    try {
      const limit = params.limit ?? 5;
      const res   = await fetch(
        `${SERVER_URL}/scores/${params.heapId}/context?playerId=${params.playerId}&limit=${limit}`,
      );
      if (!res.ok) return null;
      return (await res.json()) as LeaderboardContext;
    } catch {
      return null;
    }
  }
}

import type { LeaderboardContext, SubmitScoreInputs, SubmitScoreResponse, PlayerScoreEntry, PlayerScoresResponse, PaginatedLeaderboardResponse } from '../../shared/scoreTypes';
import { fetchWithLog } from '../logging/fetchWithLog';
import { authHeaders, logIfAuthRejected } from './authToken';

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
    inputs:     SubmitScoreInputs;
    limit?:     number;
  }): Promise<LeaderboardContext | null> {
    try {
      const url = params.limit
        ? `${SERVER_URL}/scores?limit=${params.limit}`
        : `${SERVER_URL}/scores`;

      const res = await fetchWithLog(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body:    JSON.stringify({
          heapId:     params.heapId,
          playerId:   params.playerId,
          playerName: params.playerName,
          inputs:     params.inputs,
        }),
      });

      if (!res.ok) {
        logIfAuthRejected('scores:submit', res.status);
        return null;
      }
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
      const res   = await fetchWithLog(
        `${SERVER_URL}/scores/${params.heapId}/context?playerId=${params.playerId}&limit=${limit}`,
      );
      if (!res.ok) return null;
      return (await res.json()) as LeaderboardContext;
    } catch {
      return null;
    }
  }

  /**
   * Fetch all of a player's high scores across heaps, ranked.
   * Returns a Map keyed by heapId, or null on failure.
   */
  static async getPlayerScores(playerId: string)
    : Promise<Map<string, PlayerScoreEntry> | null>
  {
    try {
      const url = `${SERVER_URL}/scores/player/${encodeURIComponent(playerId)}`;
      const res = await fetchWithLog(url);
      if (!res.ok) return null;
      const data = (await res.json()) as PlayerScoresResponse;
      return new Map(data.entries.map(e => [e.heapId, e]));
    } catch {
      return null;
    }
  }

  /**
   * Fetch one page of the per-heap leaderboard. Returns null on failure.
   */
  static async getLeaderboardPage(heapId: string, page: number, limit: number)
    : Promise<PaginatedLeaderboardResponse | null>
  {
    try {
      const url = `${SERVER_URL}/scores/${encodeURIComponent(heapId)}?page=${page}&limit=${limit}`;
      const res = await fetchWithLog(url);
      if (!res.ok) return null;
      return (await res.json()) as PaginatedLeaderboardResponse;
    } catch {
      return null;
    }
  }
}

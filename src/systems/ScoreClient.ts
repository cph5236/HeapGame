import type { LeaderboardContext, SubmitScoreInputs, SubmitScoreResponse, PlayerScoreEntry, PlayerScoresResponse, PaginatedLeaderboardResponse, OpenSessionResponse } from '../../shared/scoreTypes';
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
    sessionToken?: string;
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
          sessionToken: params.sessionToken,
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
   * Open a run session.
   *
   * `retryable` distinguishes a failure worth retrying from one that never
   * will be. A 404 means the server has no SESSION_SECRET configured — the
   * normal state in local dev and throughout the pre-enable deployment window
   * — and retrying it every RETRY_MS for the length of every run would
   * multiply session traffic ~20x for a result that cannot change. A 403
   * (player-token mismatch) is equally permanent. Network errors, 429s and
   * 5xx are transient and worth retrying, which is the case the retry loop
   * exists for.
   */
  static async openSession(
    playerId: string,
    heapId: string,
  ): Promise<{ token: string | null; retryable: boolean }> {
    try {
      const res = await fetchWithLog(`${SERVER_URL}/scores/session`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body:    JSON.stringify({ playerId, heapId }),
      });
      if (!res.ok) {
        logIfAuthRejected('scores:session', res.status);
        return { token: null, retryable: res.status === 429 || res.status >= 500 };
      }
      const data = (await res.json()) as OpenSessionResponse;
      return { token: data.token, retryable: false };
    } catch {
      // fetchWithLog throws on network failure — transient by nature.
      return { token: null, retryable: true };
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
      // The token proves the playerId is ours. The server only consults it when
      // it would change the answer, so this costs nothing in the common case —
      // but without it a moderated player's own board would render incomplete.
      const res   = await fetchWithLog(
        `${SERVER_URL}/scores/${params.heapId}/context?playerId=${params.playerId}&limit=${limit}`,
        { headers: authHeaders() },
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
   *
   * Always called for the caller's OWN id (see HeapSelectScene), so it sends the
   * player token. That is not optional: the server hides a shadow-banned
   * player's rows from anyone who cannot prove the id is theirs, and without the
   * token a banned player's own score history would come back empty — a visible
   * tell, which is the one thing a shadow ban must never produce. Same reason
   * getLeaderboardPage sends it.
   */
  static async getPlayerScores(playerId: string)
    : Promise<Map<string, PlayerScoreEntry> | null>
  {
    try {
      const url = `${SERVER_URL}/scores/player/${encodeURIComponent(playerId)}`;
      const res = await fetchWithLog(url, { headers: authHeaders() });
      if (!res.ok) return null;
      const data = (await res.json()) as PlayerScoresResponse;
      return new Map(data.entries.map(e => [e.heapId, e]));
    } catch {
      return null;
    }
  }

  /**
   * Fetch one page of the per-heap leaderboard. Returns null on failure.
   *
   * `playerId` identifies the viewer to the server. It must be the effective
   * player id (see getEffectivePlayerId), and it is what keeps a player's own
   * board complete regardless of any server-side moderation.
   */
  static async getLeaderboardPage(heapId: string, page: number, limit: number, playerId?: string)
    : Promise<PaginatedLeaderboardResponse | null>
  {
    try {
      const viewer = playerId ? `&playerId=${encodeURIComponent(playerId)}` : '';
      const url = `${SERVER_URL}/scores/${encodeURIComponent(heapId)}?page=${page}&limit=${limit}${viewer}`;
      // See getContext: the token is what makes the viewer id trustworthy.
      const res = await fetchWithLog(url, playerId ? { headers: authHeaders() } : undefined);
      if (!res.ok) return null;
      return (await res.json()) as PaginatedLeaderboardResponse;
    } catch {
      return null;
    }
  }
}

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SubmitScoreInputs, SubmitScoreResponse, LeaderboardContext, PlayerScoresResponse, PaginatedLeaderboardResponse } from '../../../shared/scoreTypes';

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem:    () => null,
    setItem:    () => {},
    removeItem: () => {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

const { ScoreClient } = await import('../ScoreClient');

const MOCK_CONTEXT: LeaderboardContext = {
  top:    [{ rank: 1, playerId: 'p1', name: 'Alpha', score: 5000 }],
  player: { rank: 1, playerId: 'p1', name: 'Alpha', score: 5000 },
};

// ── submitScore ───────────────────────────────────────────────────────────────

describe('ScoreClient.submitScore', () => {
  const MOCK_INPUTS: SubmitScoreInputs = {
    baseHeightPx: 500,
    kills: { percher: 3, ghost: 1 },
    elapsedMs: 45000,
    isFailure: false,
  };

  it('returns LeaderboardContext on success', async () => {
    const mockResponse: SubmitScoreResponse = { submitted: true, context: MOCK_CONTEXT };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => mockResponse,
    }));
    const result = await ScoreClient.submitScore({
      heapId: 'heap-1', playerId: 'p1', playerName: 'Alpha', inputs: MOCK_INPUTS,
    });
    expect(result).toEqual(MOCK_CONTEXT);
  });

  it('returns null on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('Network error')));
    const result = await ScoreClient.submitScore({
      heapId: 'heap-1', playerId: 'p1', playerName: 'Alpha', inputs: MOCK_INPUTS,
    });
    expect(result).toBeNull();
  });

  it('returns null on non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 500 }));
    const result = await ScoreClient.submitScore({
      heapId: 'heap-1', playerId: 'p1', playerName: 'Alpha', inputs: MOCK_INPUTS,
    });
    expect(result).toBeNull();
  });

  it('returns null on malformed JSON response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => { throw new SyntaxError('bad json'); },
    }));
    const result = await ScoreClient.submitScore({
      heapId: 'heap-1', playerId: 'p1', playerName: 'Alpha', inputs: MOCK_INPUTS,
    });
    expect(result).toBeNull();
  });

  it('passes limit query param when provided', async () => {
    const mockResponse: SubmitScoreResponse = { submitted: true, context: MOCK_CONTEXT };
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => mockResponse,
    });
    vi.stubGlobal('fetch', fetchMock);
    await ScoreClient.submitScore({
      heapId: 'heap-1', playerId: 'p1', playerName: 'Alpha', inputs: MOCK_INPUTS, limit: 10,
    });
    const calledUrl = (fetchMock.mock.calls[0] as [string])[0];
    expect(calledUrl).toContain('limit=10');
  });
});

// ── getContext ────────────────────────────────────────────────────────────────

describe('ScoreClient.getContext', () => {
  it('returns LeaderboardContext on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => MOCK_CONTEXT,
    }));
    const result = await ScoreClient.getContext({ heapId: 'heap-1', playerId: 'p1' });
    expect(result).toEqual(MOCK_CONTEXT);
  });

  it('returns null on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')));
    const result = await ScoreClient.getContext({ heapId: 'heap-1', playerId: 'p1' });
    expect(result).toBeNull();
  });

  it('returns null on non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 503 }));
    const result = await ScoreClient.getContext({ heapId: 'heap-1', playerId: 'p1' });
    expect(result).toBeNull();
  });
});

// ── getPlayerScores ───────────────────────────────────────────────────────────

describe('ScoreClient.getPlayerScores', () => {
  const MOCK_RESPONSE: PlayerScoresResponse = {
    entries: [
      { heapId: 'heap-a', rank: 2, score: 5000, name: 'Me' },
      { heapId: 'heap-b', rank: 1, score: 7000, name: 'Me' },
    ],
  };

  it('returns a Map keyed by heapId on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => MOCK_RESPONSE,
    }));
    const result = await ScoreClient.getPlayerScores('me');
    expect(result).not.toBeNull();
    expect(result!.size).toBe(2);
    expect(result!.get('heap-a')?.rank).toBe(2);
    expect(result!.get('heap-b')?.score).toBe(7000);
  });

  it('returns null on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')));
    const result = await ScoreClient.getPlayerScores('me');
    expect(result).toBeNull();
  });

  it('returns null on non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 500 }));
    const result = await ScoreClient.getPlayerScores('me');
    expect(result).toBeNull();
  });

  it('URL-encodes the playerId', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => ({ entries: [] } as PlayerScoresResponse),
    });
    vi.stubGlobal('fetch', fetchMock);
    await ScoreClient.getPlayerScores('has space/slash');
    const calledUrl = (fetchMock.mock.calls[0] as [string])[0];
    expect(calledUrl).toContain('/scores/player/has%20space%2Fslash');
  });
});

// ── getLeaderboardPage ────────────────────────────────────────────────────────

describe('ScoreClient.getLeaderboardPage', () => {
  const PAGE: PaginatedLeaderboardResponse = {
    entries: [{ rank: 1, playerId: 'p1', name: 'Alpha', score: 9000 }],
    total:   1,
    page:    0,
  };

  it('returns the page payload on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => PAGE,
    }));
    const result = await ScoreClient.getLeaderboardPage('heap-1', 0, 50);
    expect(result).toEqual(PAGE);
  });

  it('passes page and limit query params', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => PAGE,
    });
    vi.stubGlobal('fetch', fetchMock);
    await ScoreClient.getLeaderboardPage('heap-1', 3, 25);
    const url = (fetchMock.mock.calls[0] as [string])[0];
    expect(url).toContain('page=3');
    expect(url).toContain('limit=25');
  });

  it('returns null on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')));
    const result = await ScoreClient.getLeaderboardPage('heap-1', 0, 50);
    expect(result).toBeNull();
  });

  it('returns null on non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 500 }));
    const result = await ScoreClient.getLeaderboardPage('heap-1', 0, 50);
    expect(result).toBeNull();
  });
});

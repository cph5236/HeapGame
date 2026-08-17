import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SubmitScoreInputs, SubmitScoreResponse, LeaderboardContext, PlayerScoresResponse, PaginatedLeaderboardResponse } from '../../../shared/scoreTypes';

vi.mock('../authToken', () => ({
  authHeaders: () => ({ 'X-Player-Token': 'secret-test' }),
  logIfAuthRejected: vi.fn(),
}));

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
import { logIfAuthRejected } from '../authToken';

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

  it('sends the X-Player-Token header', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ submitted: true, context: MOCK_CONTEXT }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await ScoreClient.submitScore({
      heapId: 'heap-1', playerId: 'p1', playerName: 'Alpha', inputs: MOCK_INPUTS,
    });
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers['X-Player-Token']).toBe('secret-test');
  });

  it('reports a 403 rejection to the remote logger', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false, status: 403,
      clone: () => ({ text: async () => '' }),
    }));
    const result = await ScoreClient.submitScore({
      heapId: 'heap-1', playerId: 'p1', playerName: 'Alpha', inputs: MOCK_INPUTS,
    });
    expect(result).toBeNull();
    expect(vi.mocked(logIfAuthRejected)).toHaveBeenCalledWith('scores:submit', 403);
  });
});

// ── openSession ───────────────────────────────────────────────────────────────

describe('ScoreClient.openSession', () => {
  it('returns the token on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => ({ token: 'session-token-1', issuedAt: 1000 }),
    }));
    const result = await ScoreClient.openSession('p1', 'heap-1');
    expect(result).toEqual({ token: 'session-token-1', retryable: false });
  });

  it('reports a 404 as permanent (no session secret configured)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 404 }));
    const result = await ScoreClient.openSession('p1', 'heap-1');
    expect(result).toEqual({ token: null, retryable: false });
  });

  it('reports a 403 as permanent (player-token mismatch)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false, status: 403,
      clone: () => ({ text: async () => '' }),
    }));
    const result = await ScoreClient.openSession('p1', 'heap-1');
    expect(result).toEqual({ token: null, retryable: false });
    expect(vi.mocked(logIfAuthRejected)).toHaveBeenCalledWith('scores:session', 403);
  });

  it('reports a 429 as retryable (rate limited)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false, status: 429,
      clone: () => ({ text: async () => '' }),
    }));
    const result = await ScoreClient.openSession('p1', 'heap-1');
    expect(result).toEqual({ token: null, retryable: true });
  });

  it('reports a 500 as retryable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false, status: 500,
      clone: () => ({ text: async () => '' }),
    }));
    const result = await ScoreClient.openSession('p1', 'heap-1');
    expect(result).toEqual({ token: null, retryable: true });
  });

  it('reports a network failure as retryable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')));
    const result = await ScoreClient.openSession('p1', 'heap-1');
    expect(result).toEqual({ token: null, retryable: true });
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

  // The server blanks this route for a caller who cannot prove the id is theirs,
  // so dropping the token would empty a shadow-banned player's OWN history and
  // tell them they were banned. Pinned so it cannot regress silently.
  it('sends the X-Player-Token header', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => ({ entries: [] } as PlayerScoresResponse),
    });
    vi.stubGlobal('fetch', fetchMock);
    await ScoreClient.getPlayerScores('me');
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers['X-Player-Token']).toBe('secret-test');
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

describe('getLeaderboardPage viewer id', () => {
  it('sends playerId when one is supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => ({ entries: [], total: 0, page: 0 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await ScoreClient.getLeaderboardPage('heap-1', 2, 25, 'player-abc');
    const url = (fetchMock.mock.calls[0] as [string])[0];
    expect(url).toContain('page=2');
    expect(url).toContain('limit=25');
    expect(url).toContain('playerId=player-abc');
  });

  it('omits playerId entirely when none is supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => ({ entries: [], total: 0, page: 0 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await ScoreClient.getLeaderboardPage('heap-1', 0, 25);
    const url = (fetchMock.mock.calls[0] as [string])[0];
    expect(url).not.toContain('playerId');
  });

  it('url-encodes the player id', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => ({ entries: [], total: 0, page: 0 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await ScoreClient.getLeaderboardPage('heap-1', 0, 25, 'a b&c');
    const url = (fetchMock.mock.calls[0] as [string])[0];
    expect(url).toContain('playerId=a%20b%26c');
  });
});

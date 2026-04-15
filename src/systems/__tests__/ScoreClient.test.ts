import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SubmitScoreResponse, LeaderboardContext } from '../../../shared/scoreTypes';

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
  it('returns LeaderboardContext on success', async () => {
    const mockResponse: SubmitScoreResponse = { submitted: true, context: MOCK_CONTEXT };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => mockResponse,
    }));
    const result = await ScoreClient.submitScore({
      heapId: 'heap-1', playerId: 'p1', playerName: 'Alpha', score: 5000,
    });
    expect(result).toEqual(MOCK_CONTEXT);
  });

  it('returns null on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('Network error')));
    const result = await ScoreClient.submitScore({
      heapId: 'heap-1', playerId: 'p1', playerName: 'Alpha', score: 5000,
    });
    expect(result).toBeNull();
  });

  it('returns null on non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 500 }));
    const result = await ScoreClient.submitScore({
      heapId: 'heap-1', playerId: 'p1', playerName: 'Alpha', score: 5000,
    });
    expect(result).toBeNull();
  });

  it('returns null on malformed JSON response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => { throw new SyntaxError('bad json'); },
    }));
    const result = await ScoreClient.submitScore({
      heapId: 'heap-1', playerId: 'p1', playerName: 'Alpha', score: 5000,
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
      heapId: 'heap-1', playerId: 'p1', playerName: 'Alpha', score: 5000, limit: 10,
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

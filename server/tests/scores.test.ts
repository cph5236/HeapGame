// server/tests/scores.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import type { SubmitScoreResponse, PaginatedLeaderboardResponse, PlayerScoresResponse } from '../../shared/scoreTypes';

const HEAP_ID   = 'heap-test-001';
const PLAYER_A  = 'player-aaa';
const PLAYER_B  = 'player-bbb';

function makeApp(scoreDb = new MockScoreDB()) {
  return createApp(new MockHeapDB(), scoreDb);
}

async function submitScore(app: ReturnType<typeof makeApp>, body: object, limit?: number) {
  const url = limit ? `/scores?limit=${limit}` : '/scores';
  return app.request(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
}

// ── POST /scores ──────────────────────────────────────────────────────────────

describe('POST /scores — submission', () => {
  it('accepts a new score and returns submitted: true', async () => {
    const res = await submitScore(makeApp(), {
      heapId: HEAP_ID, playerId: PLAYER_A, playerName: 'Trashbag#00001', score: 5000,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as SubmitScoreResponse;
    expect(body.submitted).toBe(true);
  });

  it('returns submitted: false when score does not beat existing best', async () => {
    const db  = new MockScoreDB();
    db.seed(HEAP_ID, PLAYER_A, 'Trashbag#00001', 5000);
    const res = await submitScore(makeApp(db), {
      heapId: HEAP_ID, playerId: PLAYER_A, playerName: 'Trashbag#00001', score: 3000,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as SubmitScoreResponse;
    expect(body.submitted).toBe(false);
  });

  it('updates the record when new score beats existing', async () => {
    const db  = new MockScoreDB();
    db.seed(HEAP_ID, PLAYER_A, 'Trashbag#00001', 3000);
    const res = await submitScore(makeApp(db), {
      heapId: HEAP_ID, playerId: PLAYER_A, playerName: 'Trashbag#00001', score: 7000,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as SubmitScoreResponse;
    expect(body.submitted).toBe(true);
    expect(body.context.player?.score).toBe(7000);
  });

  it('updates player name alongside score', async () => {
    const db = new MockScoreDB();
    db.seed(HEAP_ID, PLAYER_A, 'OldName#11111', 3000);
    await submitScore(makeApp(db), {
      heapId: HEAP_ID, playerId: PLAYER_A, playerName: 'NewName#22222', score: 7000,
    });
    const row = await db.getScore(HEAP_ID, PLAYER_A);
    expect(row?.name).toBe('NewName#22222');
  });
});

describe('POST /scores — leaderboard context in response', () => {
  it('returns top entries in rank order', async () => {
    const db = new MockScoreDB();
    db.seed(HEAP_ID, 'p1', 'Alpha', 9000);
    db.seed(HEAP_ID, 'p2', 'Beta',  7000);
    db.seed(HEAP_ID, 'p3', 'Gamma', 5000);

    const res  = await submitScore(makeApp(db), {
      heapId: HEAP_ID, playerId: 'p4', playerName: 'Delta', score: 3000,
    }, 3);
    const body = await res.json() as SubmitScoreResponse;

    expect(body.context.top).toHaveLength(3);
    expect(body.context.top[0].rank).toBe(1);
    expect(body.context.top[0].score).toBe(9000);
    expect(body.context.top[1].rank).toBe(2);
    expect(body.context.top[2].rank).toBe(3);
  });

  it('returns the submitting player in context.player', async () => {
    const res  = await submitScore(makeApp(), {
      heapId: HEAP_ID, playerId: PLAYER_A, playerName: 'Trashbag#00001', score: 5000,
    });
    const body = await res.json() as SubmitScoreResponse;
    expect(body.context.player?.playerId).toBe(PLAYER_A);
    expect(body.context.player?.score).toBe(5000);
    expect(body.context.player?.rank).toBe(1);
  });

  it('returns context.player even when submitted: false', async () => {
    const db = new MockScoreDB();
    db.seed(HEAP_ID, PLAYER_A, 'Trashbag#00001', 5000);
    const res  = await submitScore(makeApp(db), {
      heapId: HEAP_ID, playerId: PLAYER_A, playerName: 'Trashbag#00001', score: 1000,
    });
    const body = await res.json() as SubmitScoreResponse;
    expect(body.submitted).toBe(false);
    expect(body.context.player?.score).toBe(5000); // existing best
  });

  it('includes player at correct rank when not in top N', async () => {
    const db = new MockScoreDB();
    for (let i = 1; i <= 5; i++) {
      db.seed(HEAP_ID, `p${i}`, `Player${i}`, i * 1000);
    }
    const res  = await submitScore(makeApp(db), {
      heapId: HEAP_ID, playerId: 'late', playerName: 'LateEntry', score: 500,
    }, 3);
    const body = await res.json() as SubmitScoreResponse;
    expect(body.context.top).toHaveLength(3);
    expect(body.context.player?.rank).toBe(6);
  });
});

describe('POST /scores — top-1000 cap', () => {
  it('enforces the 1000-entry cap after insert', async () => {
    const db = new MockScoreDB();
    // Seed 1000 players
    for (let i = 0; i < 1000; i++) {
      db.seed(HEAP_ID, `player-${i}`, `P${i}`, (i + 1) * 10);
    }
    // New player with a very low score (rank 1001)
    await submitScore(makeApp(db), {
      heapId: HEAP_ID, playerId: 'loser', playerName: 'Loser', score: 1,
    });
    const total = await db.countScores(HEAP_ID);
    expect(total).toBeLessThanOrEqual(1000);
  });
});

describe('POST /scores — validation', () => {
  it('returns 400 when heapId is missing', async () => {
    const res = await submitScore(makeApp(), { playerId: PLAYER_A, playerName: 'X', score: 100 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when playerId is missing', async () => {
    const res = await submitScore(makeApp(), { heapId: HEAP_ID, playerName: 'X', score: 100 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when playerName is missing', async () => {
    const res = await submitScore(makeApp(), { heapId: HEAP_ID, playerId: PLAYER_A, score: 100 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when score is missing', async () => {
    const res = await submitScore(makeApp(), { heapId: HEAP_ID, playerId: PLAYER_A, playerName: 'X' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when score is not a positive integer', async () => {
    const res = await submitScore(makeApp(), { heapId: HEAP_ID, playerId: PLAYER_A, playerName: 'X', score: -1 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when score is zero', async () => {
    const res = await submitScore(makeApp(), { heapId: HEAP_ID, playerId: PLAYER_A, playerName: 'X', score: 0 });
    expect(res.status).toBe(400);
  });
});

// ── GET /scores/:heapId/context ───────────────────────────────────────────────

describe('GET /scores/:heapId/context', () => {
  it('returns top N entries + player context', async () => {
    const db = new MockScoreDB();
    db.seed(HEAP_ID, PLAYER_A, 'Alpha', 9000);
    db.seed(HEAP_ID, PLAYER_B, 'Beta',  7000);

    const res  = await makeApp(db).request(
      `/scores/${HEAP_ID}/context?playerId=${PLAYER_A}&limit=5`,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { top: unknown[]; player: unknown };
    expect(body.top).toHaveLength(2);
    expect(body.player).not.toBeNull();
  });

  it('returns player: null for unknown playerId', async () => {
    const db = new MockScoreDB();
    db.seed(HEAP_ID, PLAYER_A, 'Alpha', 9000);

    const res  = await makeApp(db).request(
      `/scores/${HEAP_ID}/context?playerId=nobody&limit=5`,
    );
    const body = await res.json() as { player: null };
    expect(body.player).toBeNull();
  });

  it('returns empty top array for heap with no scores', async () => {
    const res  = await makeApp().request(
      `/scores/empty-heap/context?playerId=${PLAYER_A}&limit=5`,
    );
    const body = await res.json() as { top: unknown[]; player: null };
    expect(body.top).toHaveLength(0);
    expect(body.player).toBeNull();
  });
});

// ── GET /scores/:heapId (paginated) ──────────────────────────────────────────

describe('GET /scores/:heapId paginated', () => {
  it('returns paginated entries and total', async () => {
    const db = new MockScoreDB();
    for (let i = 0; i < 10; i++) {
      db.seed(HEAP_ID, `p${i}`, `Player${i}`, (10 - i) * 100);
    }
    const res  = await makeApp(db).request(`/scores/${HEAP_ID}?page=0&limit=3`);
    expect(res.status).toBe(200);
    const body = await res.json() as PaginatedLeaderboardResponse;
    expect(body.entries).toHaveLength(3);
    expect(body.total).toBe(10);
    expect(body.page).toBe(0);
    expect(body.entries[0].rank).toBe(1);
  });

  it('second page returns next set of entries', async () => {
    const db = new MockScoreDB();
    for (let i = 0; i < 6; i++) {
      db.seed(HEAP_ID, `p${i}`, `Player${i}`, (6 - i) * 100);
    }
    const res  = await makeApp(db).request(`/scores/${HEAP_ID}?page=1&limit=3`);
    const body = await res.json() as PaginatedLeaderboardResponse;
    expect(body.entries).toHaveLength(3);
    expect(body.entries[0].rank).toBe(4);
    expect(body.page).toBe(1);
  });
});

// ── GET /scores/player/:playerId ──────────────────────────────────────────────

describe('GET /scores/player/:playerId', () => {
  it('returns empty entries for player with no scores', async () => {
    const res  = await makeApp().request('/scores/player/nobody');
    expect(res.status).toBe(200);
    const body = await res.json() as PlayerScoresResponse;
    expect(body.entries).toEqual([]);
  });

  it('returns ranked entries across multiple heaps for a known player', async () => {
    const db = new MockScoreDB();
    db.seed('heap-a', 'top',     'Top',  9000);
    db.seed('heap-a', PLAYER_A,  'Me',   5000);
    db.seed('heap-b', PLAYER_A,  'Me',   7000);
    const res  = await makeApp(db).request(`/scores/player/${PLAYER_A}`);
    expect(res.status).toBe(200);
    const body = await res.json() as PlayerScoresResponse;
    const sorted = body.entries.sort((a, b) => a.heapId.localeCompare(b.heapId));
    expect(sorted).toEqual([
      { heapId: 'heap-a', name: 'Me', score: 5000, rank: 2 },
      { heapId: 'heap-b', name: 'Me', score: 7000, rank: 1 },
    ]);
  });

  it('handles URL-encoded playerId', async () => {
    const db   = new MockScoreDB();
    const id   = 'has space/slash';
    db.seed('heap-a', id, 'Me', 5000);
    const res  = await makeApp(db).request(`/scores/player/${encodeURIComponent(id)}`);
    expect(res.status).toBe(200);
    const body = await res.json() as PlayerScoresResponse;
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].heapId).toBe('heap-a');
  });
});

describe('POST /scores hardening', () => {
  const validBody = {
    heapId: 'h1',
    playerId: 'p1',
    playerName: 'Alice',
    score: 100,
  };

  it('rejects non-finite score', async () => {
    const res = await submitScore(makeApp(), { ...validBody, score: Number.POSITIVE_INFINITY });
    expect(res.status).toBe(400);
  });

  it('rejects score above MAX_SCORE ceiling', async () => {
    const res = await submitScore(makeApp(), { ...validBody, score: 100_000_001 });
    expect(res.status).toBe(400);
  });

  it('rejects oversized playerId', async () => {
    const res = await submitScore(makeApp(), { ...validBody, playerId: 'p'.repeat(200) });
    expect(res.status).toBe(400);
  });

  it('rejects empty playerName after trim', async () => {
    const res = await submitScore(makeApp(), { ...validBody, playerName: '   ' });
    expect(res.status).toBe(400);
  });
});

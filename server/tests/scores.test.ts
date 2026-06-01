// server/tests/scores.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockSink } from './helpers/mockSink';
import type { SubmitScoreResponse, PaginatedLeaderboardResponse, PlayerScoresResponse } from '../../shared/scoreTypes';

const HEAP_ID   = 'heap-test-001';
const PLAYER_A  = 'player-aaa';
const PLAYER_B  = 'player-bbb';

function makeApp(scoreDb = new MockScoreDB(), heapDb?: MockHeapDB, sink?: MockSink) {
  if (!heapDb) {
    heapDb = new MockHeapDB();
    heapDb.seedHeap(HEAP_ID, 1, []);
  }
  return createApp(heapDb, scoreDb, { logSink: sink });
}

async function submitScore(app: ReturnType<typeof makeApp>, body: object, limit?: number) {
  const url = limit ? `/scores?limit=${limit}` : '/scores';
  return app.request(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const VALID_INPUTS = {
  baseHeightPx: 1000,
  kills: { percher: 0, ghost: 0 },
  elapsedMs: 60_000,
  isFailure: true,
};

function validBody(overrides: {
  heapId?: string;
  playerId?: string;
  playerName?: string;
  inputs?: Partial<typeof VALID_INPUTS>;
} = {}) {
  return {
    heapId:     overrides.heapId     ?? HEAP_ID,
    playerId:   overrides.playerId   ?? PLAYER_A,
    playerName: overrides.playerName ?? 'Trashbag#00001',
    inputs:     { ...VALID_INPUTS, ...(overrides.inputs ?? {}) },
  };
}

// ── POST /scores ──────────────────────────────────────────────────────────────

describe('POST /scores — submission', () => {
  it('accepts a new score and returns submitted: true', async () => {
    const res = await submitScore(makeApp(), validBody({ inputs: { baseHeightPx: 1500 } }));
    expect(res.status).toBe(200);
    const body = await res.json() as SubmitScoreResponse;
    expect(body.submitted).toBe(true);
  });

  it('returns submitted: false when score does not beat existing best', async () => {
    const db  = new MockScoreDB();
    db.seed(HEAP_ID, PLAYER_A, 'Trashbag#00001', 1500);
    const res = await submitScore(makeApp(db), validBody({ inputs: { baseHeightPx: 1000 } }));
    expect(res.status).toBe(200);
    const body = await res.json() as SubmitScoreResponse;
    expect(body.submitted).toBe(false);
  });

  it('updates the record when new score beats existing', async () => {
    const db  = new MockScoreDB();
    db.seed(HEAP_ID, PLAYER_A, 'Trashbag#00001', 5000);
    const res = await submitScore(makeApp(db), validBody({ inputs: { baseHeightPx: 7000, elapsedMs: 17_500 } }));
    expect(res.status).toBe(200);
    const body = await res.json() as SubmitScoreResponse;
    expect(body.submitted).toBe(true);
    expect(body.context.player?.score).toBe(7000);
  });

  it('updates player name alongside score', async () => {
    const db = new MockScoreDB();
    db.seed(HEAP_ID, PLAYER_A, 'OldName#11111', 5000);
    await submitScore(makeApp(db), validBody({ playerName: 'NewName#22222', inputs: { baseHeightPx: 7000, elapsedMs: 17_500 } }));
    const row = await db.getScore(HEAP_ID, PLAYER_A);
    expect(row?.name).toBe('NewName#22222');
  });
});

describe('POST /scores — leaderboard context in response', () => {
  it('returns top entries in rank order', async () => {
    const db = new MockScoreDB();
    db.seed(HEAP_ID, 'p1', 'Alpha', 1800);
    db.seed(HEAP_ID, 'p2', 'Beta',  1500);
    db.seed(HEAP_ID, 'p3', 'Gamma', 1200);

    const res  = await submitScore(makeApp(db), validBody({ playerId: 'p4', playerName: 'Delta', inputs: { baseHeightPx: 900 } }), 3);
    const body = await res.json() as SubmitScoreResponse;

    expect(body.context.top).toHaveLength(3);
    expect(body.context.top[0].rank).toBe(1);
    expect(body.context.top[0].score).toBe(1800);
    expect(body.context.top[1].rank).toBe(2);
    expect(body.context.top[2].rank).toBe(3);
  });

  it('returns the submitting player in context.player', async () => {
    const res  = await submitScore(makeApp(), validBody({ inputs: { baseHeightPx: 5000, elapsedMs: 12_500 } }));
    const body = await res.json() as SubmitScoreResponse;
    expect(body.context.player?.playerId).toBe(PLAYER_A);
    expect(body.context.player?.score).toBe(5000);
    expect(body.context.player?.rank).toBe(1);
  });

  it('returns context.player even when submitted: false', async () => {
    const db = new MockScoreDB();
    db.seed(HEAP_ID, PLAYER_A, 'Trashbag#00001', 1500);
    const res  = await submitScore(makeApp(db), validBody({ inputs: { baseHeightPx: 1000 } }));
    const body = await res.json() as SubmitScoreResponse;
    expect(body.submitted).toBe(false);
    expect(body.context.player?.score).toBe(1500); // existing best
  });

  it('includes player at correct rank when not in top N', async () => {
    const db = new MockScoreDB();
    for (let i = 1; i <= 5; i++) {
      db.seed(HEAP_ID, `p${i}`, `Player${i}`, i * 300);
    }
    const res  = await submitScore(makeApp(db), validBody({ playerId: 'late', playerName: 'LateEntry', inputs: { baseHeightPx: 100 } }), 3);
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
    await submitScore(makeApp(db), validBody({ playerId: 'loser', playerName: 'Loser', inputs: { baseHeightPx: 1 } }));
    const total = await db.countScores(HEAP_ID);
    expect(total).toBeLessThanOrEqual(1000);
  });
});

describe('POST /scores — validation', () => {
  it('returns 400 when heapId is missing', async () => {
    const res = await submitScore(makeApp(), { playerId: PLAYER_A, playerName: 'X', inputs: VALID_INPUTS });
    expect(res.status).toBe(400);
  });

  it('returns 400 when playerId is missing', async () => {
    const res = await submitScore(makeApp(), { heapId: HEAP_ID, playerName: 'X', inputs: VALID_INPUTS });
    expect(res.status).toBe(400);
  });

  it('returns 400 when playerName is missing', async () => {
    const res = await submitScore(makeApp(), { heapId: HEAP_ID, playerId: PLAYER_A, inputs: VALID_INPUTS });
    expect(res.status).toBe(400);
  });

  it('returns 400 when inputs is missing', async () => {
    const res = await submitScore(makeApp(), { heapId: HEAP_ID, playerId: PLAYER_A, playerName: 'X' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when baseHeightPx is negative', async () => {
    const res = await submitScore(makeApp(), validBody({ playerName: 'X', inputs: { baseHeightPx: -1 } }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when baseHeightPx is zero AND no kills produces zero recomputed score', async () => {
    const heapDb = new MockHeapDB();
    heapDb.seedHeap(HEAP_ID, 1, [], HEAP_ID, 0, {
      name: 'X', difficulty: 1, spawnRateMult: 1, coinMult: 1, scoreMult: 1, worldHeight: 2000,
    });
    const res = await submitScore(makeApp(new MockScoreDB(), heapDb), validBody({ playerName: 'X', inputs: { baseHeightPx: 0 } }));
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
  it('rejects oversized playerId', async () => {
    const res = await submitScore(makeApp(), validBody({ playerId: 'p'.repeat(200) }));
    expect(res.status).toBe(400);
  });

  it('rejects empty playerName after trim', async () => {
    const res = await submitScore(makeApp(), validBody({ playerName: '   ' }));
    expect(res.status).toBe(400);
  });
});

describe('POST /scores — input validation (server-recompute)', () => {
  it('rejects baseHeightPx exceeding (worldHeight - top_y) + 200 grace', async () => {
    // worldHeight = 1000 (via DEFAULT_HEAP_PARAMS override), top_y forced to 600
    // → max possible climb = 1000 - 600 + 200 = 600
    const heapDb = new MockHeapDB();
    heapDb.seedHeap(HEAP_ID, 1, [], HEAP_ID, 0, {
      name: 'X', difficulty: 1, spawnRateMult: 1, coinMult: 1, scoreMult: 1, worldHeight: 1000,
    });
    heapDb.setTopYForTest(HEAP_ID, 600);
    const app = createApp(heapDb, new MockScoreDB());
    const res = await submitScore(app, validBody({
      inputs: { baseHeightPx: 700, elapsedMs: 10_000_000 /* climb-rate not the cause */ },
    }));
    expect(res.status).toBe(400);
  });

  it('accepts baseHeightPx up to (worldHeight - top_y) + 200 grace', async () => {
    const heapDb = new MockHeapDB();
    heapDb.seedHeap(HEAP_ID, 1, [], HEAP_ID, 0, {
      name: 'X', difficulty: 1, spawnRateMult: 1, coinMult: 1, scoreMult: 1, worldHeight: 1000,
    });
    heapDb.setTopYForTest(HEAP_ID, 600);
    const app = createApp(heapDb, new MockScoreDB());
    const res = await submitScore(app, validBody({
      inputs: { baseHeightPx: 600, elapsedMs: 10_000_000 },
    }));
    expect(res.status).toBe(200);
  });

  it('rejects climb rate above 400 Y/s', async () => {
    // 1000 Y in 1000 ms = 1000 Y/s — over the cap
    const heapDb = new MockHeapDB();
    heapDb.seedHeap(HEAP_ID, 1, [], HEAP_ID, 0, {
      name: 'X', difficulty: 1, spawnRateMult: 1, coinMult: 1, scoreMult: 1, worldHeight: 2000,
    });
    const app = createApp(heapDb, new MockScoreDB());
    const res = await submitScore(app, validBody({
      inputs: { baseHeightPx: 1000, elapsedMs: 1000 },
    }));
    expect(res.status).toBe(400);
  });

  it('accepts climb rate exactly at 400 Y/s', async () => {
    // 400 Y in 1000 ms = 400 Y/s — boundary
    const heapDb = new MockHeapDB();
    heapDb.seedHeap(HEAP_ID, 1, [], HEAP_ID, 0, {
      name: 'X', difficulty: 1, spawnRateMult: 1, coinMult: 1, scoreMult: 1, worldHeight: 2000,
    });
    const app = createApp(heapDb, new MockScoreDB());
    const res = await submitScore(app, validBody({
      inputs: { baseHeightPx: 400, elapsedMs: 1000 },
    }));
    expect(res.status).toBe(200);
  });

  it('rejects kill rate above 1/s', async () => {
    // 11 kills in 10 seconds — over 1/s
    const heapDb = new MockHeapDB();
    heapDb.seedHeap(HEAP_ID, 1, [], HEAP_ID, 0, {
      name: 'X', difficulty: 1, spawnRateMult: 1, coinMult: 1, scoreMult: 1, worldHeight: 2000,
    });
    const app = createApp(heapDb, new MockScoreDB());
    const res = await submitScore(app, validBody({
      inputs: { baseHeightPx: 100, kills: { percher: 6, ghost: 5 }, elapsedMs: 10_000 },
    }));
    expect(res.status).toBe(400);
  });

  it('rejects negative percher kill count', async () => {
    const heapDb = new MockHeapDB();
    heapDb.seedHeap(HEAP_ID, 1, [], HEAP_ID, 0, {
      name: 'X', difficulty: 1, spawnRateMult: 1, coinMult: 1, scoreMult: 1, worldHeight: 2000,
    });
    const app = createApp(heapDb, new MockScoreDB());
    const res = await submitScore(app, validBody({
      inputs: { kills: { percher: -1, ghost: 0 } },
    }));
    expect(res.status).toBe(400);
  });

  it('rejects elapsedMs of 0', async () => {
    const heapDb = new MockHeapDB();
    heapDb.seedHeap(HEAP_ID, 1, [], HEAP_ID, 0, {
      name: 'X', difficulty: 1, spawnRateMult: 1, coinMult: 1, scoreMult: 1, worldHeight: 2000,
    });
    const app = createApp(heapDb, new MockScoreDB());
    const res = await submitScore(app, validBody({
      inputs: { baseHeightPx: 0, elapsedMs: 0 },
    }));
    expect(res.status).toBe(400);
  });

  it('accepts non-integer elapsedMs (e.g., Phaser hi-res clock)', async () => {
    const heapDb = new MockHeapDB();
    heapDb.seedHeap(HEAP_ID, 1, [], HEAP_ID, 0, {
      name: 'X', difficulty: 1, spawnRateMult: 1, coinMult: 1, scoreMult: 1, worldHeight: 2000,
    });
    const app = createApp(heapDb, new MockScoreDB());
    const res = await submitScore(app, validBody({
      inputs: { baseHeightPx: 100, elapsedMs: 3720.0399999999936 },
    }));
    expect(res.status).toBe(200);
  });

  it('stores the server-recomputed score, ignoring any client-supplied score field', async () => {
    const heapDb = new MockHeapDB();
    heapDb.seedHeap(HEAP_ID, 1, [], HEAP_ID, 0, {
      name: 'X', difficulty: 1, spawnRateMult: 1, coinMult: 1, scoreMult: 1, worldHeight: 2000,
    });
    const scoreDb = new MockScoreDB();
    const app = createApp(heapDb, scoreDb);
    // Inject an extra "score" field — server should ignore it entirely.
    const body = {
      ...validBody({ inputs: { baseHeightPx: 1000, elapsedMs: 60_000, isFailure: true } }),
      score: 999_999_999,
    };
    const res = await submitScore(app, body);
    expect(res.status).toBe(200);
    const stored = await scoreDb.getScore(HEAP_ID, PLAYER_A);
    expect(stored).not.toBeNull();
    expect(stored!.score).toBe(1000); // recomputed = baseHeightPx with no kills, isFailure=true, scoreMult=1
  });
});

describe('POST /scores — remote logging', () => {
  it('emits score:rejected warn when inputs are invalid', async () => {
    const sink = new MockSink();
    const heapDb = new MockHeapDB();
    heapDb.seedHeap(HEAP_ID, 1, []);
    const app = createApp(heapDb, new MockScoreDB(), { logSink: sink });
    const res = await submitScore(app, validBody({ playerName: '   ' }));
    expect(res.status).toBe(400);
    expect(sink.written).toHaveLength(1);
    expect(sink.written[0].message).toBe('score:rejected');
    expect(sink.written[0].level).toBe('warn');
    expect(sink.written[0].payload.reason).toBe('bad playerName');
  });

  it('emits score:rejected warn when climb rate exceeds limit', async () => {
    const sink = new MockSink();
    const heapDb = new MockHeapDB();
    heapDb.seedHeap(HEAP_ID, 1, [], HEAP_ID, 0, {
      name: 'X', difficulty: 1, spawnRateMult: 1, coinMult: 1, scoreMult: 1, worldHeight: 2000,
    });
    const app = createApp(heapDb, new MockScoreDB(), { logSink: sink });
    const res = await submitScore(app, validBody({
      inputs: { baseHeightPx: 1000, elapsedMs: 1000 },
    }));
    expect(res.status).toBe(400);
    expect(sink.written).toHaveLength(1);
    expect(sink.written[0].message).toBe('score:rejected');
    expect(sink.written[0].payload.reason).toBe('climb rate too high');
    expect(typeof sink.written[0].payload.climbRatePerS).toBe('number');
  });

  it('does not emit score:rejected when score is accepted', async () => {
    const sink = new MockSink();
    const heapDb = new MockHeapDB();
    heapDb.seedHeap(HEAP_ID, 1, []);
    const app = createApp(heapDb, new MockScoreDB(), { logSink: sink });
    const res = await submitScore(app, validBody());
    expect(res.status).toBe(200);
    expect(sink.written).toHaveLength(0);
  });

  it('works when sink is undefined (gracefully ignores)', async () => {
    const heapDb = new MockHeapDB();
    heapDb.seedHeap(HEAP_ID, 1, []);
    const app = createApp(heapDb, new MockScoreDB(), {});
    const res = await submitScore(app, validBody({ playerName: '   ' }));
    expect(res.status).toBe(400);
  });
});

// ── POST /scores — salvage pickups ──────────────────────────────────────────────

describe('POST /scores — salvage pickups', () => {
  it('adds validated salvage bonuses to the recomputed score', async () => {
    // baseHeightPx 1000 (failure → no pace) + spring-coil 250 + worn-boot 250 = 1500
    const res  = await submitScore(makeApp(), validBody({
      inputs: { baseHeightPx: 1000, salvageItemIds: ['spring-coil', 'worn-boot'] },
    }));
    const body = await res.json() as SubmitScoreResponse;
    expect(body.context.player?.score).toBe(1500);
  });

  it('ignores unknown salvage ids (counts them as 0)', async () => {
    const res  = await submitScore(makeApp(), validBody({
      inputs: { baseHeightPx: 1000, salvageItemIds: ['spring-coil', 'not-a-real-item'] },
    }));
    const body = await res.json() as SubmitScoreResponse;
    expect(body.context.player?.score).toBe(1250); // 1000 + 250 only
  });

  it('scores normally when salvageItemIds is omitted', async () => {
    const res  = await submitScore(makeApp(), validBody({ inputs: { baseHeightPx: 1000 } }));
    const body = await res.json() as SubmitScoreResponse;
    expect(body.context.player?.score).toBe(1000);
  });

  it('rejects a salvage list that exceeds the height-derived cap', async () => {
    // baseHeightPx 1000 → maxSalvageItems = floor(1000/700)+2 = 3; 4 items is too many
    const res = await submitScore(makeApp(), validBody({
      inputs: { baseHeightPx: 1000, salvageItemIds: ['spring-coil', 'spring-coil', 'spring-coil', 'spring-coil'] },
    }));
    expect(res.status).toBe(400);
  });

  it('rejects salvageItemIds that is not an array of strings', async () => {
    const res = await submitScore(makeApp(), validBody({
      inputs: { baseHeightPx: 1000, salvageItemIds: [1, 2, 3] as unknown as string[] },
    }));
    expect(res.status).toBe(400);
  });
});

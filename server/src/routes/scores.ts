// server/src/routes/scores.ts

import { Hono } from 'hono';
import type { ScoreDB } from '../scoreDb';
import type {
  SubmitScoreRequest,
  SubmitScoreResponse,
  LeaderboardEntry,
  LeaderboardContext,
  PaginatedLeaderboardResponse,
  PlayerScoresResponse,
} from '../../../shared/scoreTypes';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT     = 50;
const MAX_SCORE     = 100_000_000;
const MAX_ID_LEN    = 64;
const MAX_NAME_LEN  = 32;

async function buildContext(
  db:       ScoreDB,
  heapId:   string,
  playerId: string,
  limit:    number,
): Promise<LeaderboardContext> {
  const [topRows, playerRow] = await Promise.all([
    db.getTopScores(heapId, limit),
    db.getScore(heapId, playerId),
  ]);
  const top: LeaderboardEntry[] = topRows.map((row, i) => ({
    rank:     i + 1,
    playerId: row.player_id,
    name:     row.name,
    score:    row.score,
  }));
  if (!playerRow) return { top, player: null };

  const rank: number = await db.getRank(heapId, playerRow.score);
  const player: LeaderboardEntry = {
    rank,
    playerId: playerRow.player_id,
    name:     playerRow.name,
    score:    playerRow.score,
  };
  return { top, player };
}

export function scoreRoutes(db: ScoreDB): Hono {
  const app = new Hono();

  // POST /scores — submit score; returns LeaderboardContext in response
  app.post('/', async (c) => {
    let body: SubmitScoreRequest;
    try {
      body = await c.req.json<SubmitScoreRequest>();
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    const { heapId, playerId, playerName, score } = body;

    if (typeof heapId !== 'string' || heapId.length === 0 || heapId.length > MAX_ID_LEN)
      return c.json({ error: `heapId must be a 1-${MAX_ID_LEN} char string` }, 400);
    if (typeof playerId !== 'string' || playerId.length === 0 || playerId.length > MAX_ID_LEN)
      return c.json({ error: `playerId must be a 1-${MAX_ID_LEN} char string` }, 400);
    if (typeof playerName !== 'string' || playerName.trim().length === 0)
      return c.json({ error: 'playerName must be a non-empty string' }, 400);
    if (!Number.isInteger(score) || score <= 0 || score > MAX_SCORE)
      return c.json({ error: `score must be an integer in (0, ${MAX_SCORE}]` }, 400);

    const limit = Math.min(
      parseInt(c.req.query('limit') ?? String(DEFAULT_LIMIT)) || DEFAULT_LIMIT,
      MAX_LIMIT,
    );

    const now       = new Date().toISOString();
    const submitted = await db.upsertScore(heapId, playerId, playerName.trim().slice(0, MAX_NAME_LEN), score, now);
    if (submitted) await db.pruneScores(heapId);

    const context = await buildContext(db, heapId, playerId, limit);
    return c.json({ submitted, context } satisfies SubmitScoreResponse);
  });

  // GET /scores/player/:playerId — all of a player's scores across heaps with rank
  app.get('/player/:playerId', async (c) => {
    const playerId = c.req.param('playerId');
    const rows     = await db.getPlayerScores(playerId);
    const entries  = rows.map(r => ({
      heapId: r.heapId,
      rank:   r.rank,
      score:  r.score,
      name:   r.name,
    }));
    return c.json({ entries } satisfies PlayerScoresResponse);
  });

  // GET /scores/:heapId/context — read-only context (future leaderboard screen)
  // NOTE: must be registered before /:heapId to prevent "context" matching as heapId
  app.get('/:heapId/context', async (c) => {
    const heapId   = c.req.param('heapId');
    const playerId = c.req.query('playerId') ?? '';
    const limit    = Math.min(
      parseInt(c.req.query('limit') ?? String(DEFAULT_LIMIT)) || DEFAULT_LIMIT,
      MAX_LIMIT,
    );
    const context = await buildContext(db, heapId, playerId, limit);
    return c.json(context);
  });

  // GET /scores/:heapId — paginated full leaderboard
  app.get('/:heapId', async (c) => {
    const heapId = c.req.param('heapId');
    const page   = parseInt(c.req.query('page') ?? '0') || 0;
    const limit  = Math.min(
      parseInt(c.req.query('limit') ?? String(MAX_LIMIT)) || MAX_LIMIT,
      MAX_LIMIT,
    );
    const offset = page * limit;

    const [rows, total] = await Promise.all([
      db.getScoresPaginated(heapId, offset, limit),
      db.countScores(heapId),
    ]);

    const entries: LeaderboardEntry[] = rows.map((row, i) => ({
      rank:     offset + i + 1,
      playerId: row.player_id,
      name:     row.name,
      score:    row.score,
    }));

    return c.json({ entries, total, page } satisfies PaginatedLeaderboardResponse);
  });

  return app;
}

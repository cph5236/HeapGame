// server/src/routes/scores.ts

import { Hono } from 'hono';
import type { ScoreDB } from '../scoreDb';
import type {
  SubmitScoreRequest,
  SubmitScoreResponse,
  LeaderboardEntry,
  LeaderboardContext,
  PaginatedLeaderboardResponse,
} from '../../../shared/scoreTypes';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT     = 50;

async function buildContext(
  db:       ScoreDB,
  heapId:   string,
  playerId: string,
  limit:    number,
): Promise<LeaderboardContext> {
  const topRows = await db.getTopScores(heapId, limit);
  const top: LeaderboardEntry[] = topRows.map((row, i) => ({
    rank:     i + 1,
    playerId: row.player_id,
    name:     row.name,
    score:    row.score,
  }));

  const playerRow = await db.getScore(heapId, playerId);
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

    if (!heapId || typeof heapId !== 'string')         return c.json({ error: 'heapId is required' }, 400);
    if (!playerId || typeof playerId !== 'string')     return c.json({ error: 'playerId is required' }, 400);
    if (!playerName || typeof playerName !== 'string') return c.json({ error: 'playerName is required' }, 400);
    if (!Number.isInteger(score) || score <= 0)        return c.json({ error: 'score must be a positive integer' }, 400);

    const limit = Math.min(
      parseInt(c.req.query('limit') ?? String(DEFAULT_LIMIT)) || DEFAULT_LIMIT,
      MAX_LIMIT,
    );

    const now       = new Date().toISOString();
    const submitted = await db.upsertScore(heapId, playerId, playerName, score, now);
    if (submitted) await db.pruneScores(heapId);

    const context = await buildContext(db, heapId, playerId, limit);
    return c.json({ submitted, context } satisfies SubmitScoreResponse);
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
      parseInt(c.req.query('limit') ?? '50') || 50,
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

// server/src/routes/scores.ts

import { Hono } from 'hono';
import type { ScoreDB } from '../scoreDb';
import type { HeapDB } from '../db';
import type {
  SubmitScoreRequest,
  SubmitScoreResponse,
  LeaderboardEntry,
  LeaderboardContext,
  PaginatedLeaderboardResponse,
  PlayerScoresResponse,
} from '../../../shared/scoreTypes';
import { buildRunScore } from '../../../shared/buildRunScore';
import { ENEMY_DEFS } from '../../../shared/enemyDefs';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT     = 50;
const MAX_ID_LEN    = 64;
const MAX_NAME_LEN  = 32;

// Plausibility caps (per second of run)
const MAX_CLIMB_RATE_Y_PER_S = 400;
const MAX_KILLS_PER_S        = 1;
const HEIGHT_GRACE_PX        = 200;

async function buildContext(
  scoreDb:  ScoreDB,
  heapId:   string,
  playerId: string,
  limit:    number,
): Promise<LeaderboardContext> {
  const [topRows, playerRow] = await Promise.all([
    scoreDb.getTopScores(heapId, limit),
    scoreDb.getScore(heapId, playerId),
  ]);
  const top: LeaderboardEntry[] = topRows.map((row, i) => ({
    rank:     i + 1,
    playerId: row.player_id,
    name:     row.name,
    score:    row.score,
  }));
  if (!playerRow) return { top, player: null };

  const rank: number = await scoreDb.getRank(heapId, playerRow.score);
  const player: LeaderboardEntry = {
    rank,
    playerId: playerRow.player_id,
    name:     playerRow.name,
    score:    playerRow.score,
  };
  return { top, player };
}

export function scoreRoutes(scoreDb: ScoreDB, heapDb: HeapDB): Hono {
  const app = new Hono();

  // POST /scores — submit raw inputs; server recomputes the score and returns leaderboard context
  app.post('/', async (c) => {
    let body: SubmitScoreRequest;
    try {
      body = await c.req.json<SubmitScoreRequest>();
    } catch {
      console.warn('[scores] reject: invalid JSON');
      return c.json({ error: 'invalid score submission' }, 400);
    }

    const { heapId, playerId, playerName, inputs } = body;

    // Identity / name validation
    if (typeof heapId !== 'string' || heapId.length === 0 || heapId.length > MAX_ID_LEN) {
      console.warn(`[scores] reject: bad heapId (${typeof heapId}, len=${(heapId as any)?.length ?? 'N/A'})`);
      return c.json({ error: 'invalid score submission' }, 400);
    }
    if (typeof playerId !== 'string' || playerId.length === 0 || playerId.length > MAX_ID_LEN) {
      console.warn(`[scores] reject: bad playerId (${typeof playerId}, len=${(playerId as any)?.length ?? 'N/A'})`);
      return c.json({ error: 'invalid score submission' }, 400);
    }
    if (typeof playerName !== 'string' || playerName.trim().length === 0) {
      console.warn(`[scores] reject: bad playerName (${typeof playerName})`);
      return c.json({ error: 'invalid score submission' }, 400);
    }

    // Inputs shape
    if (!inputs || typeof inputs !== 'object') {
      console.warn(`[scores] reject: bad inputs (${typeof inputs})`);
      return c.json({ error: 'invalid score submission' }, 400);
    }

    const { baseHeightPx, kills, elapsedMs, isFailure } = inputs;

    if (!Number.isInteger(baseHeightPx) || baseHeightPx < 0) {
      console.warn(`[scores] reject: bad baseHeightPx (${baseHeightPx})`);
      return c.json({ error: 'invalid score submission' }, 400);
    }
    if (!(typeof elapsedMs === 'number' && Number.isFinite(elapsedMs) && elapsedMs >= 1)) {
      console.warn(`[scores] reject: bad elapsedMs (${elapsedMs})`);
      return c.json({ error: 'invalid score submission' }, 400);
    }
    if (typeof isFailure !== 'boolean') {
      console.warn(`[scores] reject: bad isFailure (${typeof isFailure})`);
      return c.json({ error: 'invalid score submission' }, 400);
    }
    if (!kills || typeof kills !== 'object') {
      console.warn(`[scores] reject: bad kills (${typeof kills})`);
      return c.json({ error: 'invalid score submission' }, 400);
    }
    const percher = kills.percher;
    const ghost   = kills.ghost;
    if (!Number.isInteger(percher) || percher < 0) {
      console.warn(`[scores] reject: bad percher (${percher})`);
      return c.json({ error: 'invalid score submission' }, 400);
    }
    if (!Number.isInteger(ghost) || ghost < 0) {
      console.warn(`[scores] reject: bad ghost (${ghost})`);
      return c.json({ error: 'invalid score submission' }, 400);
    }

    // Heap-relative validation — needs the heap row
    const heap = await heapDb.getHeap(heapId);
    if (!heap) {
      console.warn(`[scores] reject: heap not found (${heapId})`);
      return c.json({ error: 'invalid score submission' }, 404);
    }

    const maxClimbPx = (heap.world_height - heap.top_y) + HEIGHT_GRACE_PX;
    if (baseHeightPx > maxClimbPx) {
      console.warn(`[scores] reject: baseHeightPx ${baseHeightPx} exceeds max ${maxClimbPx} (heapId=${heapId})`);
      return c.json({ error: 'invalid score submission' }, 400);
    }

    // Climb-rate cap (integer arithmetic to avoid FP rounding at the boundary)
    if (baseHeightPx * 1000 > MAX_CLIMB_RATE_Y_PER_S * elapsedMs) {
      console.warn(`[scores] reject: climb rate ${(baseHeightPx * 1000) / elapsedMs} Y/s exceeds ${MAX_CLIMB_RATE_Y_PER_S} (heapId=${heapId})`);
      return c.json({ error: 'invalid score submission' }, 400);
    }

    // Kill-rate cap
    if ((percher + ghost) * 1000 > MAX_KILLS_PER_S * elapsedMs) {
      console.warn(`[scores] reject: kill rate ${((percher + ghost) * 1000) / elapsedMs} /s exceeds ${MAX_KILLS_PER_S} (heapId=${heapId})`);
      return c.json({ error: 'invalid score submission' }, 400);
    }

    // Recompute score server-side — single source of truth
    const { finalScore } = buildRunScore(
      { baseHeightPx, kills: { percher, ghost }, elapsedMs },
      ENEMY_DEFS,
      isFailure,
      heap.score_mult,
    );

    if (finalScore <= 0) {
      console.warn(`[scores] reject: recomputed score is non-positive (${finalScore}), heapId=${heapId}`);
      return c.json({ error: 'invalid score submission' }, 400);
    }

    const limit = Math.min(
      parseInt(c.req.query('limit') ?? String(DEFAULT_LIMIT)) || DEFAULT_LIMIT,
      MAX_LIMIT,
    );

    const now       = new Date().toISOString();
    const submitted = await scoreDb.upsertScore(heapId, playerId, playerName.trim().slice(0, MAX_NAME_LEN), finalScore, now);
    if (submitted) await scoreDb.pruneScores(heapId);

    const context = await buildContext(scoreDb, heapId, playerId, limit);
    return c.json({ submitted, context } satisfies SubmitScoreResponse);
  });

  // GET /scores/player/:playerId — all of a player's scores across heaps with rank
  app.get('/player/:playerId', async (c) => {
    const playerId = c.req.param('playerId');
    const rows     = await scoreDb.getPlayerScores(playerId);
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
    const context = await buildContext(scoreDb, heapId, playerId, limit);
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
      scoreDb.getScoresPaginated(heapId, offset, limit),
      scoreDb.countScores(heapId),
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

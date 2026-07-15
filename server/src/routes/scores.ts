// server/src/routes/scores.ts

import { Hono } from 'hono';
import type { ScoreDB } from '../scoreDb';
import type { HeapDB } from '../db';
import type { Sink } from '../logging/Sink';
import { captureServer } from '../logging/captureServerEvent';
import type { PlayerAuthDB } from '../playerAuthDb';
import { enforcePlayerAuth } from '../playerAuth';
import type { PlayerNameDB } from '../playerNameDb';
import { validatePlayerName, generateDefaultPlayerName } from '../../../shared/playerName';
import type {
  SubmitScoreRequest,
  SubmitScoreResponse,
  LeaderboardEntry,
  LeaderboardContext,
  PaginatedLeaderboardResponse,
  PlayerScoresResponse,
} from '../../../shared/scoreTypes';
import { buildRunScore } from '../../../shared/buildRunScore';
import { MAX_ID_LEN } from '../constants';
import { ENEMY_DEFS } from '../../../shared/enemyDefs';
import { computeSalvageBonus, maxSalvageItems, isRarity, SalvageItem } from '../../../shared/pickupScores';
import { validateLoadout } from '../../../shared/cosmeticCatalog';
import type { EquippedLoadout } from '../../../shared/cosmeticCatalog';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT     = 50;

// Plausibility caps (per second of run)
const MAX_CLIMB_RATE_Y_PER_S = 400;
const MAX_KILLS_PER_S        = 1;
const HEIGHT_GRACE_PX        = 200;

/** Parse + re-validate a stored loadout blob; null on anything suspect. */
function parseLoadout(raw: string | null | undefined): EquippedLoadout | null {
  if (!raw) return null;
  try {
    return validateLoadout(JSON.parse(raw));
  } catch {
    return null;
  }
}

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
    loadout:  parseLoadout(row.loadout),
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

export function scoreRoutes(
  scoreDb: ScoreDB,
  heapDb: HeapDB,
  getSink: () => Sink | undefined,
  authDb?: PlayerAuthDB,
  playerNameDb?: PlayerNameDB,
): Hono {
  const app = new Hono();

  // POST /scores — submit raw inputs; server recomputes the score and returns leaderboard context
  app.post('/', async (c) => {
    let body: SubmitScoreRequest;
    try {
      body = await c.req.json<SubmitScoreRequest>();
    } catch {
      console.warn('[scores] reject: invalid JSON');
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'score:rejected', { reason: 'invalid JSON' });
      }
      return c.json({ error: 'invalid score submission' }, 400);
    }

    const { heapId, playerId, playerName, inputs } = body;

    // Identity / name validation
    if (typeof heapId !== 'string' || heapId.length === 0 || heapId.length > MAX_ID_LEN) {
      console.warn(`[scores] reject: bad heapId (${typeof heapId}, len=${(heapId as any)?.length ?? 'N/A'})`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'score:rejected', { reason: 'bad heapId' });
      }
      return c.json({ error: 'invalid score submission' }, 400);
    }
    if (typeof playerId !== 'string' || playerId.length === 0 || playerId.length > MAX_ID_LEN) {
      console.warn(`[scores] reject: bad playerId (${typeof playerId}, len=${(playerId as any)?.length ?? 'N/A'})`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'score:rejected', { reason: 'bad playerId' });
      }
      return c.json({ error: 'invalid score submission' }, 400);
    }
    if (playerName !== undefined && typeof playerName !== 'string') {
      console.warn(`[scores] reject: bad playerName (${typeof playerName})`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'score:rejected', { reason: 'bad playerName' });
      }
      return c.json({ error: 'invalid score submission' }, 400);
    }

    // Inputs shape
    if (!inputs || typeof inputs !== 'object') {
      console.warn(`[scores] reject: bad inputs (${typeof inputs})`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'score:rejected', { reason: 'bad inputs' });
      }
      return c.json({ error: 'invalid score submission' }, 400);
    }

    const { baseHeightPx, kills, elapsedMs, isFailure, salvageItems } = inputs;

    if (!Number.isInteger(baseHeightPx) || baseHeightPx < 0) {
      console.warn(`[scores] reject: bad baseHeightPx (${baseHeightPx})`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'score:rejected', { reason: 'bad baseHeightPx', value: baseHeightPx });
      }
      return c.json({ error: 'invalid score submission' }, 400);
    }
    if (!(typeof elapsedMs === 'number' && Number.isFinite(elapsedMs) && elapsedMs >= 1)) {
      console.warn(`[scores] reject: bad elapsedMs (${elapsedMs})`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'score:rejected', { reason: 'bad elapsedMs', value: elapsedMs });
      }
      return c.json({ error: 'invalid score submission' }, 400);
    }
    if (typeof isFailure !== 'boolean') {
      console.warn(`[scores] reject: bad isFailure (${typeof isFailure})`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'score:rejected', { reason: 'bad isFailure' });
      }
      return c.json({ error: 'invalid score submission' }, 400);
    }
    if (!kills || typeof kills !== 'object') {
      console.warn(`[scores] reject: bad kills (${typeof kills})`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'score:rejected', { reason: 'bad kills' });
      }
      return c.json({ error: 'invalid score submission' }, 400);
    }
    const percher = kills.percher;
    const ghost   = kills.ghost;
    if (!Number.isInteger(percher) || percher < 0) {
      console.warn(`[scores] reject: bad percher (${percher})`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'score:rejected', { reason: 'bad percher', value: percher });
      }
      return c.json({ error: 'invalid score submission' }, 400);
    }
    if (!Number.isInteger(ghost) || ghost < 0) {
      console.warn(`[scores] reject: bad ghost (${ghost})`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'score:rejected', { reason: 'bad ghost', value: ghost });
      }
      return c.json({ error: 'invalid score submission' }, 400);
    }

    // Heap-relative validation — needs the heap row
    const heap = await heapDb.getHeap(heapId);
    if (!heap) {
      console.warn(`[scores] reject: heap not found (${heapId})`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'score:rejected', { reason: 'heap not found', heapId });
      }
      return c.json({ error: 'invalid score submission' }, 404);
    }

    const maxClimbPx = (heap.world_height - heap.top_y) + HEIGHT_GRACE_PX;
    if (baseHeightPx > maxClimbPx) {
      console.warn(`[scores] reject: baseHeightPx ${baseHeightPx} exceeds max ${maxClimbPx} (heapId=${heapId})`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'score:rejected', { reason: 'baseHeightPx exceeds max', heapId, baseHeightPx, maxClimbPx });
      }
      return c.json({ error: 'invalid score submission' }, 400);
    }

    // Climb-rate cap (integer arithmetic to avoid FP rounding at the boundary)
    if (baseHeightPx * 1000 > MAX_CLIMB_RATE_Y_PER_S * elapsedMs) {
      console.warn(`[scores] reject: climb rate ${(baseHeightPx * 1000) / elapsedMs} Y/s exceeds ${MAX_CLIMB_RATE_Y_PER_S} (heapId=${heapId})`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'score:rejected', { reason: 'climb rate too high', heapId, climbRatePerS: (baseHeightPx * 1000) / elapsedMs });
      }
      return c.json({ error: 'invalid score submission' }, 400);
    }

    // Kill-rate cap
    if ((percher + ghost) * 1000 > MAX_KILLS_PER_S * elapsedMs) {
      console.warn(`[scores] reject: kill rate ${((percher + ghost) * 1000) / elapsedMs} /s exceeds ${MAX_KILLS_PER_S} (heapId=${heapId})`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'score:rejected', { reason: 'kill rate too high', heapId, killRatePerS: ((percher + ghost) * 1000) / elapsedMs });
      }
      return c.json({ error: 'invalid score submission' }, 400);
    }

    // Salvage pickups — validate shape (id + known rarity), cap the count by
    // plausible climb, then score from the server's own bonus table.
    let salvageBonus = 0;
    if (salvageItems !== undefined) {
      const validShape = Array.isArray(salvageItems) && salvageItems.every(
        (it: unknown) =>
          it !== null && typeof it === 'object' &&
          typeof (it as SalvageItem).id === 'string' &&
          isRarity((it as SalvageItem).rarity),
      );
      if (!validShape) {
        console.warn(`[scores] reject: bad salvageItems (heapId=${heapId})`);
        const sink = getSink();
        if (sink) {
          await captureServer(sink, 'warn', 'score:rejected', { reason: 'bad salvageItems', heapId });
        }
        return c.json({ error: 'invalid score submission' }, 400);
      }
      const cap = maxSalvageItems(baseHeightPx);
      if (salvageItems.length > cap) {
        console.warn(`[scores] reject: salvage count ${salvageItems.length} exceeds cap ${cap} (heapId=${heapId})`);
        const sink = getSink();
        if (sink) {
          await captureServer(sink, 'warn', 'score:rejected', { reason: 'salvage count exceeds cap', heapId, count: salvageItems.length, cap });
        }
        return c.json({ error: 'invalid score submission' }, 400);
      }
      salvageBonus = computeSalvageBonus(salvageItems as SalvageItem[]);
    }

    // Recompute score server-side — single source of truth
    const { finalScore } = buildRunScore(
      { baseHeightPx, kills: { percher, ghost }, elapsedMs, salvageBonus },
      ENEMY_DEFS,
      isFailure,
      heap.score_mult,
    );

    if (finalScore <= 0) {
      console.warn(`[scores] reject: recomputed score is non-positive (${finalScore}), heapId=${heapId}`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'score:rejected', { reason: 'non-positive score', heapId, finalScore });
      }
      return c.json({ error: 'invalid score submission' }, 400);
    }

    // Write-auth: verify-or-claim before any state change.
    const authRes = await enforcePlayerAuth(c, authDb, playerId, getSink, 'scores:submit');
    if (authRes) return authRes;

    const limit = Math.min(
      parseInt(c.req.query('limit') ?? String(DEFAULT_LIMIT)) || DEFAULT_LIMIT,
      MAX_LIMIT,
    );

    const now = new Date().toISOString();

    // First-seen name seeding: score submit never updates an existing name.
    // The getName→setName check-then-act is intentionally unguarded: two
    // concurrent first submits can each seed a default, but setName is an
    // idempotent upsert so last-write-wins and nothing corrupts.
    if (playerNameDb) {
      const existingName = await playerNameDb.getName(playerId);
      if (existingName === null) {
        const validated = playerName !== undefined ? validatePlayerName(playerName) : null;
        const seedName = validated && validated.ok ? validated.name : generateDefaultPlayerName();
        await playerNameDb.setName(playerId, seedName, now);
      }
    }

    const submitted = await scoreDb.upsertScore(heapId, playerId, finalScore, now);
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
      loadout:  parseLoadout(row.loadout),
    }));

    return c.json({ entries, total, page } satisfies PaginatedLeaderboardResponse);
  });

  return app;
}

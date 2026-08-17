// server/src/routes/scores.ts

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ScoreDB } from '../scoreDb';
import type { BanDB } from '../banDb';
import type { HeapDB } from '../db';
import type { Sink } from '../logging/Sink';
import { captureServer } from '../logging/captureServerEvent';
import type { PlayerAuthDB } from '../playerAuthDb';
import { enforcePlayerAuth, verifyPlayerToken, PLAYER_TOKEN_HEADER } from '../playerAuth';
import type { PlayerNameDB } from '../playerNameDb';
import { validatePlayerName, generateDefaultPlayerName } from '../../../shared/playerName';
import { signSession, verifySession, clampElapsedMs, MAX_SESSION_TOKEN_LEN } from '../runSession';
import type {
  SubmitScoreRequest,
  SubmitScoreResponse,
  LeaderboardEntry,
  LeaderboardContext,
  PaginatedLeaderboardResponse,
  PlayerScoresResponse,
  OpenSessionRequest,
  OpenSessionResponse,
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
  /**
   * The id whose shadow-ban carveout applies — `playerId` once proven theirs
   * (see resolveViewer), otherwise ''. Kept separate from `playerId` on
   * purpose: the personal rank card below is looked up by `playerId` and is
   * returned whether or not the player is banned, so it leaks nothing and must
   * keep working for an unproven caller. Blanking the whole card when the
   * carveout is denied would itself be a tell.
   */
  viewerId: string,
  limit:    number,
): Promise<LeaderboardContext> {
  const [topRows, playerRow] = await Promise.all([
    scoreDb.getTopScores(heapId, limit, viewerId),
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

  const rank: number = await scoreDb.getRank(heapId, playerRow.score, viewerId);
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
  sessionSecret?: string,
  banDb?: BanDB,
): Hono {
  const app = new Hono();

  /**
   * Decide whether a `playerId` query parameter may act as the viewer for the
   * shadow-ban self-visibility carveout.
   *
   * The carveout is what lets a banned player still see themselves. Player ids
   * are PUBLIC — every leaderboard entry returns one — so treating a raw query
   * parameter as proof of identity would let anyone who has read the board
   * replay a banned id and un-hide them, defeating the ban. Proof of identity
   * is therefore required, via the same X-Player-Token the write routes use.
   *
   * The token is only ever checked when it can change the answer, i.e. when the
   * viewer is actually banned — an unbanned player is visible with or without
   * the carveout, so ordinary traffic pays no auth read at all. `isBanned` is
   * memoised per isolate (MemoBanDB), so that gate costs microseconds.
   *
   * Returns '' — matching no player — when the claim is not proven.
   */
  async function resolveViewer(c: Context, playerId: string): Promise<string> {
    if (!playerId) return '';
    // Feature not wired (tests, or a deployment without ban/auth): legacy
    // behaviour, same as enforcePlayerAuth's `if (!db) return null`.
    if (!banDb || !authDb) return playerId;
    if (!(await banDb.isBanned(playerId))) return playerId;

    const token = c.req.header(PLAYER_TOKEN_HEADER) || undefined;
    return (await verifyPlayerToken(authDb, playerId, token)) ? playerId : '';
  }

  // POST /scores/session — open a run session. The token is a server-attested
  // timestamp, not proof of a genuine client: anyone can call this endpoint.
  // Its value is that a claimed elapsedMs can never exceed real elapsed time.
  app.post('/session', async (c) => {
    if (!sessionSecret) return c.json({ error: 'not found' }, 404);

    let body: OpenSessionRequest;
    try {
      body = await c.req.json<OpenSessionRequest>();
    } catch {
      return c.json({ error: 'invalid session request' }, 400);
    }

    const { playerId, heapId } = body;
    if (typeof playerId !== 'string' || playerId.length === 0 || playerId.length > MAX_ID_LEN) {
      return c.json({ error: 'invalid session request' }, 400);
    }
    if (typeof heapId !== 'string' || heapId.length === 0 || heapId.length > MAX_ID_LEN) {
      return c.json({ error: 'invalid session request' }, 400);
    }

    // The heap must exist before write-auth runs. enforcePlayerAuth TOFU-claims
    // an unclaimed playerId as a side effect, so a request that is going to be
    // rejected must never reach it — the same ordering POST / and
    // /heaps/:id/place already follow. Without this check a session could be
    // opened against any heapId at all, making this the cheapest claim vector
    // in the API and locking the real owner of that id out with a 403 on their
    // first genuine write. It also stops minting tokens for heaps that do not
    // exist, which the subsequent submit would only 404 on anyway.
    const heap = await heapDb.getHeap(heapId);
    if (!heap) {
      console.warn(`[scores] session reject: heap not found (${heapId})`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'session:rejected', { reason: 'heap not found', heapId });
      }
      return c.json({ error: 'invalid session request' }, 404);
    }

    // Only the owner of a player id may open a session for it.
    const authRes = await enforcePlayerAuth(c, authDb, playerId, getSink, 'scores:session');
    if (authRes) return authRes;

    const issuedAt = Date.now();
    const token    = await signSession(sessionSecret, playerId, heapId, issuedAt);
    const res: OpenSessionResponse = { token, issuedAt };
    return c.json(res);
  });

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

    const { heapId, playerId, playerName, inputs, sessionToken } = body;

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

    // sessionToken shape. Checked here, with the other identity fields, so it
    // is bounded before verifySession does any base64/HMAC work over it —
    // Workers CPU quota is account-wide, so an unbounded body field on a route
    // that runs crypto is worth capping. A non-string is rejected rather than
    // passed through: verifySession calls token.split(), which would throw out
    // of the handler as a 500 on a truthy non-string.
    if (sessionToken !== undefined
        && (typeof sessionToken !== 'string' || sessionToken.length > MAX_SESSION_TOKEN_LEN)) {
      console.warn(`[scores] reject: bad sessionToken (${typeof sessionToken}, len=${(sessionToken as any)?.length ?? 'N/A'})`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'score:rejected', { reason: 'bad sessionToken' });
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
    const jumper = kills.jumper ?? 0;
    if (!Number.isInteger(jumper) || jumper < 0) {
      console.warn(`[scores] reject: bad jumper (${jumper})`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'score:rejected', { reason: 'bad jumper', value: jumper });
      }
      return c.json({ error: 'invalid score submission' }, 400);
    }

    // Run-session verification. Inert when no secret is configured so local dev
    // and the existing test suite behave exactly as before.
    let verifiedElapsedMs = elapsedMs;
    if (sessionSecret) {
      const now     = Date.now();
      const session = await verifySession(sessionSecret, sessionToken, playerId, heapId, now);
      if (!session.ok) {
        console.warn(`[scores] reject: ${session.reason} (heapId=${heapId})`);
        const sink = getSink();
        if (sink) {
          await captureServer(sink, 'warn', 'score:rejected', { reason: session.reason, heapId, playerId });
        }
        return c.json({ error: 'invalid score submission' }, 400);
      }
      verifiedElapsedMs = clampElapsedMs(elapsedMs, session.issuedAt, now);
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

    // Climb-rate cap (integer arithmetic to avoid FP rounding at the boundary).
    // Uses verifiedElapsedMs — the elapsed time the server can vouch for.
    if (baseHeightPx * 1000 > MAX_CLIMB_RATE_Y_PER_S * verifiedElapsedMs) {
      // Log BOTH rates. The verified rate is what tripped the cap, but the
      // claimed rate is what reveals the severity: a submission clamped from
      // elapsedMs=99999999 down to a ~15s window logs an unremarkable verified
      // rate while its claimed rate is absurd. Triage needs the latter.
      const climbRatePerS       = (baseHeightPx * 1000) / verifiedElapsedMs;
      const claimedClimbRatePerS = (baseHeightPx * 1000) / elapsedMs;
      console.warn(`[scores] reject: climb rate ${climbRatePerS} Y/s exceeds ${MAX_CLIMB_RATE_Y_PER_S} (claimed ${claimedClimbRatePerS} Y/s, heapId=${heapId})`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'score:rejected', { reason: 'climb rate too high', heapId, climbRatePerS, claimedClimbRatePerS, verifiedElapsedMs, elapsedMs });
      }
      return c.json({ error: 'invalid score submission' }, 400);
    }

    // Kill-rate cap
    if ((percher + ghost + jumper) * 1000 > MAX_KILLS_PER_S * verifiedElapsedMs) {
      const totalKills          = percher + ghost + jumper;
      const killRatePerS        = (totalKills * 1000) / verifiedElapsedMs;
      const claimedKillRatePerS = (totalKills * 1000) / elapsedMs;
      console.warn(`[scores] reject: kill rate ${killRatePerS} /s exceeds ${MAX_KILLS_PER_S} (claimed ${claimedKillRatePerS} /s, heapId=${heapId})`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'score:rejected', { reason: 'kill rate too high', heapId, killRatePerS, claimedKillRatePerS, verifiedElapsedMs, elapsedMs });
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
      { baseHeightPx, kills: { percher, ghost, jumper }, elapsedMs, salvageBonus },
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

    // Identity is already proven here — enforcePlayerAuth ran above — so this
    // caller gets the carveout without a second lookup.
    const context = await buildContext(scoreDb, heapId, playerId, playerId, limit);
    return c.json({ submitted, context } satisfies SubmitScoreResponse);
  });

  // GET /scores/admin/:heapId — unfiltered page for the admin UI, ban state
  // resolved per row. Registered before /:heapId so "admin" is never parsed as
  // a heapId. Admin-gated in app.ts.
  app.get('/admin/:heapId', async (c) => {
    const heapId = c.req.param('heapId');
    const page   = parseInt(c.req.query('page') ?? '0') || 0;
    const limit  = Math.min(
      parseInt(c.req.query('limit') ?? String(MAX_LIMIT)) || MAX_LIMIT,
      MAX_LIMIT,
    );
    const offset = page * limit;

    const [rows, total] = await Promise.all([
      scoreDb.listScoresForAdmin(heapId, offset, limit),
      scoreDb.countAllScores(heapId),
    ]);

    const entries = rows.map((row, i) => ({
      rank:     offset + i + 1,
      playerId: row.player_id,
      name:     row.name,
      score:    row.score,
      banned:   row.banned,
    }));

    return c.json({ entries, total, page });
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
    const context = await buildContext(scoreDb, heapId, playerId, await resolveViewer(c, playerId), limit);
    return c.json(context);
  });

  // GET /scores/:heapId — paginated full leaderboard
  app.get('/:heapId', async (c) => {
    const heapId   = c.req.param('heapId');
    // Optional viewer. Shadow-banned players are filtered out for everyone
    // except themselves — and "themselves" must be proven, not merely asserted,
    // since player ids are public. See resolveViewer.
    const viewerId = await resolveViewer(c, c.req.query('playerId') ?? '');
    const page     = parseInt(c.req.query('page') ?? '0') || 0;
    const limit    = Math.min(
      parseInt(c.req.query('limit') ?? String(MAX_LIMIT)) || MAX_LIMIT,
      MAX_LIMIT,
    );
    const offset = page * limit;

    const [rows, total] = await Promise.all([
      scoreDb.getScoresPaginated(heapId, offset, limit, viewerId),
      scoreDb.countScores(heapId, viewerId),
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

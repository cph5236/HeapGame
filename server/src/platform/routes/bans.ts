// server/src/routes/bans.ts

import { Hono } from 'hono';
import type { BanDB } from '../banDb';
import type { ScoreDB } from '../../game/scoreDb';
import type { PlayerNameDB } from '../playerNameDb';
import { MAX_ID_LEN } from '../../constants';

/**
 * Admin-only shadow-ban surface (adminGate applied in app.ts).
 *
 * Nothing here is ever reachable by a game client, and no player-facing
 * response anywhere in the API reveals ban state — that is the whole point of a
 * shadow ban.
 */
export function banRoutes(banDb: BanDB, scoreDb: ScoreDB, nameDb?: PlayerNameDB): Hono {
  const app = new Hono();

  /** Shared id guard — same bound every other route applies. */
  function badId(playerId: string): boolean {
    return playerId.length === 0 || playerId.length > MAX_ID_LEN;
  }

  // GET /bans — every ban, newest first.
  app.get('/', async (c) => {
    return c.json({ bans: await banDb.list() });
  });

  // GET /bans/:playerId — status plus enough context to judge: who they are and
  // what they have scored. One request answers the whole question.
  app.get('/:playerId', async (c) => {
    const playerId = c.req.param('playerId');
    if (badId(playerId)) return c.json({ error: 'invalid player id' }, 400);

    const [row, scores, name] = await Promise.all([
      banDb.get(playerId),
      scoreDb.getPlayerScores(playerId),
      nameDb ? nameDb.getName(playerId) : Promise.resolve(null),
    ]);

    return c.json({
      playerId,
      name:     name ?? scores[0]?.name ?? 'Anonymous',
      banned:   row !== null,
      bannedAt: row?.banned_at ?? null,
      reason:   row?.reason ?? null,
      scores:   scores.map(s => ({ heapId: s.heapId, score: s.score, rank: s.rank })),
    });
  });

  // PUT /bans/:playerId — ban. Idempotent; re-banning overwrites the reason.
  app.put('/:playerId', async (c) => {
    const playerId = c.req.param('playerId');
    if (badId(playerId)) return c.json({ error: 'invalid player id' }, 400);

    // Body is optional — a ban with no stated reason is still a ban.
    let reason: string | null = null;
    try {
      const body = await c.req.json<{ reason?: unknown }>();
      if (typeof body?.reason === 'string' && body.reason.trim() !== '') {
        reason = body.reason.trim().slice(0, 500);
      }
    } catch {
      // no body / not JSON — leave reason null
    }

    await banDb.ban(playerId, reason, new Date().toISOString());
    // No cache invalidation: the leaderboard blob expires on its own within
    // SCORES_TTL (60s). See the note in cache/CachedScoreDB.ts.
    return c.json({ ok: true, banned: true });
  });

  // DELETE /bans/:playerId — unban. Idempotent. The player's score row was never
  // touched, so they reappear at their real rank as soon as the cache turns over.
  app.delete('/:playerId', async (c) => {
    const playerId = c.req.param('playerId');
    if (badId(playerId)) return c.json({ error: 'invalid player id' }, 400);

    await banDb.unban(playerId);
    return c.json({ ok: true, banned: false });
  });

  return app;
}

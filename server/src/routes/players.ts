// server/src/routes/players.ts

import { Hono } from 'hono';
import type { PlayerNameDB } from '../playerNameDb';
import type { PlayerAuthDB } from '../playerAuthDb';
import type { Sink } from '../logging/Sink';
import { captureServer } from '../logging/captureServerEvent';
import { enforcePlayerAuth } from '../playerAuth';
import { validatePlayerName } from '../../../shared/playerName';

export function playerRoutes(
  nameDb: PlayerNameDB,
  getSink: () => Sink | undefined,
  authDb?: PlayerAuthDB,
): Hono {
  const app = new Hono();

  // PUT /players/:playerId/name — validated, auth-gated rename
  app.put('/:playerId/name', async (c) => {
    const playerId = c.req.param('playerId');
    let body: { name?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid name', reason: 'empty' }, 400);
    }
    if (typeof body.name !== 'string') {
      return c.json({ error: 'invalid name', reason: 'empty' }, 400);
    }

    const validated = validatePlayerName(body.name);
    if (!validated.ok) {
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'name:rejected', { playerId, reason: validated.reason });
      }
      return c.json({ error: 'invalid name', reason: validated.reason }, 400);
    }

    const authRes = await enforcePlayerAuth(c, authDb, playerId, getSink, 'players:rename');
    if (authRes) return authRes;

    await nameDb.setName(playerId, validated.name, new Date().toISOString());
    return c.json({ name: validated.name });
  });

  return app;
}

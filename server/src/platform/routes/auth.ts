import { Hono } from 'hono';
import type { PlayerAuthDB } from '../playerAuthDb';

/** Admin-only rescue surface (adminGate applied in app.ts). */
export function authAdminRoutes(authDb: PlayerAuthDB): Hono {
  const app = new Hono();

  // DELETE /auth/:playerId — unclaim a hijacked GUID; next tokened write re-claims.
  app.delete('/:playerId', async (c) => {
    await authDb.delete(c.req.param('playerId'));
    return c.json({ ok: true });
  });

  return app;
}

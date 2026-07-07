import { Hono } from 'hono';
import type { CustomizationDB } from '../customizationDb';
import { validateLoadout, MAX_LOADOUT_JSON_LEN } from '../../../shared/cosmeticCatalog';

const MAX_ID_LEN = 64;

export function customizationRoutes(db: CustomizationDB): Hono {
  const app = new Hono();

  // PUT /customization/:playerId — upsert the equipped loadout (display data only).
  app.put('/:playerId', async (c) => {
    const playerId = c.req.param('playerId');
    if (playerId.length === 0 || playerId.length > MAX_ID_LEN) {
      return c.json({ error: 'invalid loadout' }, 400);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid loadout' }, 400);
    }
    const loadout = validateLoadout((body as { loadout?: unknown } | null)?.loadout);
    if (loadout === null) return c.json({ error: 'invalid loadout' }, 400);

    // Store our own serialization of the validated object — never raw input.
    const json = JSON.stringify(loadout);
    if (json.length > MAX_LOADOUT_JSON_LEN) return c.json({ error: 'invalid loadout' }, 400);

    await db.upsertLoadout(playerId, json, new Date().toISOString());
    return c.json({ ok: true });
  });

  // GET /customization/:playerId — debug/admin read.
  app.get('/:playerId', async (c) => {
    const raw = await db.getLoadout(c.req.param('playerId'));
    return c.json({ loadout: raw ? JSON.parse(raw) : null });
  });

  return app;
}

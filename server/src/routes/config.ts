// server/src/routes/config.ts

import { Hono } from 'hono';
import type { ConfigDB } from '../configDb';

/** Keys that PUT /config/:key is allowed to write. Add new keys here as they're introduced. */
const ALLOWED_KEYS: ReadonlySet<string> = new Set(['ad_cadence']);

function validateValue(key: string, value: unknown): string | null {
  if (key === 'ad_cadence') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return 'value must be an object';
    }
    const v = value as Record<string, unknown>;
    if (typeof v.min !== 'number' || typeof v.max !== 'number') {
      return 'min and max must be numbers';
    }
    if (!Number.isFinite(v.min) || !Number.isFinite(v.max)) {
      return 'min and max must be finite';
    }
    if (v.min <= 0 || v.max <= 0) {
      return 'min and max must be > 0';
    }
    if (v.min > v.max) {
      return 'min must be <= max';
    }
  }
  return null;
}

export function configRoutes(configDb: ConfigDB): Hono {
  const app = new Hono();

  // Public read — client boot fetch, no admin gate.
  app.get('/', async (c) => {
    const config = await configDb.getAll();
    return c.json({ config });
  });

  // Admin write (adminGate applied in app.ts).
  app.put('/:key', async (c) => {
    const key = c.req.param('key');
    if (!ALLOWED_KEYS.has(key)) return c.json({ error: 'unknown config key' }, 400);

    let body: { value?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid request' }, 400);
    }

    const err = validateValue(key, body.value);
    if (err) return c.json({ error: err }, 400);

    await configDb.set(key, body.value, new Date().toISOString());
    return c.json({ ok: true, key });
  });

  return app;
}

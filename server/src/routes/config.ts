// server/src/routes/config.ts

import { Hono } from 'hono';
import type { ConfigDB } from '../configDb';

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_VALUE_LENGTH = 8192;

function validateKeyFormat(key: string): string | null {
  if (!KEY_PATTERN.test(key)) {
    return 'key must be lowercase snake_case, start with a letter, max 64 characters';
  }
  return null;
}

function validateValueSize(value: unknown): string | null {
  if (JSON.stringify(value).length > MAX_VALUE_LENGTH) {
    return `value too large (max ${MAX_VALUE_LENGTH} characters of JSON)`;
  }
  return null;
}

/**
 * Extra shape checks for keys the game currently reads. This is defense in
 * depth on keys with real behavioral effect — it does not gate which keys
 * can be created; any key passing validateKeyFormat/validateValueSize can be
 * written even if it has no case here.
 */
function validateKnownKeyShape(key: string, value: unknown): string | null {
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

  // Admin write (adminGate applied in app.ts). Any key matching the naming
  // pattern is writable — there is no fixed allowlist. An unread key is
  // inert (no code consumes it), so the risk is clutter, not breakage.
  app.put('/:key', async (c) => {
    const key = c.req.param('key');
    const keyErr = validateKeyFormat(key);
    if (keyErr) return c.json({ error: keyErr }, 400);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid request' }, 400);
    }
    if (typeof body !== 'object' || body === null || !('value' in body)) {
      return c.json({ error: 'invalid request' }, 400);
    }
    const { value } = body as { value: unknown };

    const sizeErr = validateValueSize(value);
    if (sizeErr) return c.json({ error: sizeErr }, 400);

    const shapeErr = validateKnownKeyShape(key, value);
    if (shapeErr) return c.json({ error: shapeErr }, 400);

    await configDb.set(key, value, new Date().toISOString());
    return c.json({ ok: true, key });
  });

  // Admin delete (adminGate applied in app.ts). Idempotent — deleting a
  // nonexistent key is not an error. No key-format check, so an
  // already-invalid/typo'd key can still be removed.
  app.delete('/:key', async (c) => {
    const key = c.req.param('key');
    await configDb.delete(key);
    return c.json({ ok: true, key });
  });

  return app;
}

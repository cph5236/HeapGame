// server/src/platform/routes/metrics.ts
//
// Admin-only metrics reads (adminGate applied in app.ts). Nothing here is ever
// reachable by a game client.

import { Hono } from 'hono';
import { type MetricsDB, isMetricsBucket } from '../metricsDb';

const DAY_MS = 86_400_000;
const DEFAULT_WINDOW_DAYS = 30;

/** Parses an ISO timestamp, returning null for anything unparseable. */
function parseIso(v: string | undefined): string | null {
  if (v === undefined) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function metricsRoutes(metricsDb: MetricsDB): Hono {
  const app = new Hono();

  // GET /metrics/new-players?bucket=hour|day|week&since=&until=
  app.get('/new-players', async (c) => {
    const rawBucket = c.req.query('bucket') ?? 'day';
    if (!isMetricsBucket(rawBucket)) {
      return c.json({ error: 'bucket must be one of: hour, day, week' }, 400);
    }

    const now = Date.now();
    const rawUntil = c.req.query('until');
    const rawSince = c.req.query('since');

    const until = rawUntil === undefined
      ? new Date(now).toISOString()
      : parseIso(rawUntil);
    if (until === null) return c.json({ error: 'until is not a valid ISO timestamp' }, 400);

    const since = rawSince === undefined
      ? new Date(Date.parse(until) - DEFAULT_WINDOW_DAYS * DAY_MS).toISOString()
      : parseIso(rawSince);
    if (since === null) return c.json({ error: 'since is not a valid ISO timestamp' }, 400);

    if (Date.parse(since) >= Date.parse(until)) {
      return c.json({ error: 'since must be before until' }, 400);
    }

    const rows = await metricsDb.newPlayersByBucket(rawBucket, since, until);
    return c.json({ bucket: rawBucket, since, until, rows });
  });

  return app;
}

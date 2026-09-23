// server/src/platform/routes/metrics.ts
//
// Admin-only metrics reads (adminGate applied in app.ts). Nothing here is ever
// reachable by a game client.

import { Hono } from 'hono';
import { type MetricsDB, isMetricsBucket } from '../metricsDb';
import { parseWindow } from './timeWindow';

const DEFAULT_COHORT_LIMIT = 500;
const MAX_COHORT_LIMIT = 1000;

/**
 * Validates a cohort `cursor` shape without parsing it as a date. It is
 * `${created_at}|${player_id}` (see D1MetricsDB.cohortMembers) — NOT a plain
 * ISO timestamp, so it must never be run through `parseIso`: an earlier
 * version of this route did exactly that, which silently discarded every
 * real cursor the endpoint itself returns (a composite string always fails
 * `Date.parse`), permanently resetting any caller that followed `nextCursor`
 * back to page 1.
 *
 * `created_at` is a fixed-format ISO timestamp and can never contain `|`, so
 * requiring exactly one `|` with non-empty parts on both sides is enough to
 * catch a malformed or hand-typed cursor without needing to validate either
 * half's contents — cohortMembers's own WHERE clause does that by producing
 * an empty result for a value it can't match.
 */
function isValidCursorShape(v: string): boolean {
  const sep = v.indexOf('|');
  return sep > 0 && sep < v.length - 1 && v.indexOf('|', sep + 1) === -1;
}

export function metricsRoutes(metricsDb: MetricsDB): Hono {
  const app = new Hono();

  // GET /metrics/new-players?bucket=hour|day|week&since=&until=
  app.get('/new-players', async (c) => {
    const rawBucket = c.req.query('bucket') ?? 'day';
    if (!isMetricsBucket(rawBucket)) {
      return c.json({ error: 'bucket must be one of: hour, day, week' }, 400);
    }

    const w = parseWindow(c);
    if ('error' in w) return c.json({ error: w.error }, 400);
    const { since, until } = w;

    const rows = await metricsDb.newPlayersByBucket(rawBucket, since, until);
    return c.json({ bucket: rawBucket, since, until, rows });
  });

  // GET /metrics/cohort?since=&until=&limit=&cursor=
  // The cohort's member ids, paged. Consumed by the funnel joins, which cannot
  // happen in SQL: player_auth is in heap_scores and the events are in
  // Analytics Engine, and there is no join across those.
  app.get('/cohort', async (c) => {
    const w = parseWindow(c);
    if ('error' in w) return c.json({ error: w.error }, 400);
    const { since, until } = w;

    const rawLimit = Number(c.req.query('limit') ?? DEFAULT_COHORT_LIMIT);
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(MAX_COHORT_LIMIT, Math.floor(rawLimit)))
      : DEFAULT_COHORT_LIMIT;

    const rawCursor = c.req.query('cursor');
    let cursor: string | null = null;
    if (rawCursor !== undefined) {
      if (!isValidCursorShape(rawCursor)) {
        return c.json({ error: 'cursor is not a valid cohort cursor' }, 400);
      }
      cursor = rawCursor;
    }

    const page = await metricsDb.cohortMembers(since, until, limit, cursor);
    return c.json({ since, until, playerIds: page.playerIds, nextCursor: page.nextCursor });
  });

  return app;
}

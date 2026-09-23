// server/src/platform/routes/metrics.ts
//
// Admin-only metrics reads (adminGate applied in app.ts). Nothing here is ever
// reachable by a game client.

import { Hono } from 'hono';
import type { MetricsDB } from '../metricsDb';
import {
  isMetricsBucket, autoBucket, bucketCount, bucketSeconds, denseSeries,
  MAX_SERIES_BUCKETS, BUCKET_ORDER,
} from '../../../../shared/metricsBuckets';
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

  // GET /metrics/new-players?bucket=auto|1m|5m|15m|1h|3h|6h|1d|1w&since=&until=
  //
  // `auto` (the default) picks the finest bucket that keeps the series near
  // ~100 points, so a 1h window comes back per minute and a year per week.
  // The response is DENSE: every bucket in the window is present, zero-filled.
  app.get('/new-players', async (c) => {
    const rawBucket = c.req.query('bucket') ?? 'auto';
    if (rawBucket !== 'auto' && !isMetricsBucket(rawBucket)) {
      return c.json({ error: `bucket must be one of: auto, ${BUCKET_ORDER.join(', ')}` }, 400);
    }

    const w = parseWindow(c);
    if ('error' in w) return c.json({ error: w.error }, 400);
    const { since, until } = w;
    const sinceMs = Date.parse(since);
    const untilMs = Date.parse(until);

    const bucket = rawBucket === 'auto' ? autoBucket(sinceMs, untilMs) : rawBucket;
    if (bucketCount(sinceMs, untilMs, bucket) > MAX_SERIES_BUCKETS) {
      return c.json({
        error: `${bucket} buckets over this window exceed ${MAX_SERIES_BUCKETS} points — use a coarser bucket or 'auto'`,
      }, 400);
    }

    const sparse = await metricsDb.newPlayersByBucket(bucket, since, until);
    const rows = denseSeries(sparse, bucket, sinceMs, untilMs);
    const total = rows.reduce((n, r) => n + r.count, 0);
    return c.json({ bucket, bucketSeconds: bucketSeconds(bucket), since, until, total, rows });
  });

  // GET /metrics/totals — all-time headline counts for the admin overview.
  app.get('/totals', async (c) => {
    return c.json({ players: await metricsDb.totalPlayers() });
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

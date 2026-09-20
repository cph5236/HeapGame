// server/src/platform/routes/analytics.ts
//
// Admin-only Analytics Engine proxy (adminGate applied in app.ts).
//
// SECURITY: this Worker holds a Cloudflare API token that can read ALL account
// analytics. The only thing keeping a caller from using it that way is that
// every query is built from the fixed set in analytics/queries.ts, from
// allowlisted parameters. NEVER add an endpoint that accepts SQL, a dataset
// name, or a column name from the request.

import { Hono } from 'hono';
import type { AeClient } from '../analytics/aeClient';
import type { MetricsDB } from '../metricsDb';
import { AE_DATASET, MAX_ID_LEN } from '../../constants';
import { parseWindow } from './timeWindow';
import {
  funnelQuery, crosstabQuery, traceQuery, isCrosstabDimension,
  type FunnelStages, type CrosstabRow, type TraceRow, CROSSTAB_DIMENSIONS,
} from '../analytics/queries';

/** Ceiling on cohort size pulled from D1 for one request. */
const MAX_COHORT_PLAYERS = 2000;
/** Ids per AE query — a day of ids will not fit in one IN (...) clause. */
const MAX_IDS_PER_QUERY = 500;
const COHORT_PAGE = 500;

const DEFAULT_TRACE_LIMIT = 200;
const MAX_TRACE_LIMIT = 1000;

/** Pages cohortMembers until exhausted or the ceiling is hit. */
async function loadCohort(
  metricsDb: MetricsDB, since: string, until: string,
): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  while (ids.length < MAX_COHORT_PLAYERS) {
    const page = await metricsDb.cohortMembers(since, until, COHORT_PAGE, cursor);
    ids.push(...page.playerIds);
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  return ids.slice(0, MAX_COHORT_PLAYERS);
}

function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

export function analyticsRoutes(ae: AeClient, metricsDb: MetricsDB): Hono {
  const app = new Hono();

  // AE transport failures surface as 502 with the upstream message, rather
  // than a 500 with a stack — callers of this route are admins troubleshooting
  // analytics, and the AE error text (e.g. a quota or query error) is exactly
  // what they need to see.
  app.onError((err, c) => {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  });

  // GET /analytics/funnel?since=&until=
  app.get('/funnel', async (c) => {
    const w = parseWindow(c);
    if ('error' in w) return c.json({ error: w.error }, 400);

    const ids = await loadCohort(metricsDb, w.since, w.until);
    const empty: FunnelStages = {
      cohort: 0, startedRun1: 0, finishedRun1: 0,
      startedRun2: 0, startedRun3: 0, returnedLater: 0,
    };
    // An empty IN () is a syntax error — and there is nothing to ask anyway.
    if (ids.length === 0) {
      return c.json({ stages: empty, sampled: false, sampleIntervalMax: 1, truncated: false });
    }

    const totals = { ...empty };
    let siMax = 1;
    for (const batch of chunk(ids, MAX_IDS_PER_QUERY)) {
      const { sql, params } = funnelQuery(AE_DATASET, batch, w.since, w.until);
      const res = await ae.query<Partial<FunnelStages>>(sql, params);
      const row = res.rows[0] ?? {};
      for (const k of Object.keys(totals) as (keyof FunnelStages)[]) {
        totals[k] += Number(row[k] ?? 0);
      }
      if (res.sampleIntervalMax > siMax) siMax = res.sampleIntervalMax;
    }

    return c.json({
      stages: totals,
      since: w.since, until: w.until,
      sampled: siMax > 1, sampleIntervalMax: siMax,
      truncated: ids.length >= MAX_COHORT_PLAYERS,
    });
  });

  // GET /analytics/crosstab?dimension=&since=&until=
  app.get('/crosstab', async (c) => {
    const dimension = c.req.query('dimension') ?? 'duration';
    if (!isCrosstabDimension(dimension)) {
      return c.json({ error: `dimension must be one of: ${CROSSTAB_DIMENSIONS.join(', ')}` }, 400);
    }
    const w = parseWindow(c);
    if ('error' in w) return c.json({ error: w.error }, 400);

    const ids = await loadCohort(metricsDb, w.since, w.until);
    if (ids.length === 0) {
      return c.json({ dimension, rows: [], sampled: false, sampleIntervalMax: 1, truncated: false });
    }

    // Buckets are summed across batches by label.
    const byBucket = new Map<string, { cohort: number; returned: number }>();
    let siMax = 1;
    for (const batch of chunk(ids, MAX_IDS_PER_QUERY)) {
      const { sql, params } = crosstabQuery(AE_DATASET, dimension, batch, w.since, w.until);
      const res = await ae.query<CrosstabRow>(sql, params);
      for (const r of res.rows) {
        const cur = byBucket.get(r.bucket) ?? { cohort: 0, returned: 0 };
        cur.cohort   += Number(r.cohort ?? 0);
        cur.returned += Number(r.returned ?? 0);
        byBucket.set(r.bucket, cur);
      }
      if (res.sampleIntervalMax > siMax) siMax = res.sampleIntervalMax;
    }

    const rows = [...byBucket.entries()]
      .map(([bucket, v]) => ({ bucket, ...v }))
      .sort((a, b) => a.bucket.localeCompare(b.bucket));

    return c.json({
      dimension, rows, since: w.since, until: w.until,
      sampled: siMax > 1, sampleIntervalMax: siMax,
      truncated: ids.length >= MAX_COHORT_PLAYERS,
    });
  });

  // GET /analytics/trace?playerId=&since=&until=&limit=
  app.get('/trace', async (c) => {
    const playerId = c.req.query('playerId');
    if (!playerId || playerId.length > MAX_ID_LEN) {
      return c.json({ error: 'playerId is required and must be at most 64 chars' }, 400);
    }
    const w = parseWindow(c);
    if ('error' in w) return c.json({ error: w.error }, 400);

    const raw = Number(c.req.query('limit') ?? DEFAULT_TRACE_LIMIT);
    const limit = Number.isFinite(raw)
      ? Math.max(1, Math.min(MAX_TRACE_LIMIT, Math.floor(raw)))
      : DEFAULT_TRACE_LIMIT;

    const { sql, params } = traceQuery(AE_DATASET, playerId, w.since, w.until, limit);
    const res = await ae.query<TraceRow>(sql, params);

    return c.json({
      playerId, rows: res.rows, since: w.since, until: w.until,
      // A sampled trace has MISSING EVENTS — it is not a complete history of
      // this player, and the UI must say so rather than imply completeness.
      sampled: res.sampleIntervalMax > 1, sampleIntervalMax: res.sampleIntervalMax,
    });
  });

  return app;
}

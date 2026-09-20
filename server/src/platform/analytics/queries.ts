// server/src/platform/analytics/queries.ts
//
// The fixed set of Analytics Engine queries. This is the security boundary:
// the Worker holds a Cloudflare API token that can read all account analytics,
// and the only thing standing between a caller and arbitrary use of it is that
// every query is built here from allowlisted inputs.
//
// AE SQL constraints these queries are written around (see the plan's Global
// Constraints, and .github/workflows/fetch-logs.yml which learned two of them
// the hard way):
//   * No JOIN, no UNION. Single table. Subqueries in FROM are supported, which
//     is how the per-player aggregations below work.
//   * `double1` is SELECTable but cannot appear in WHERE or ORDER BY. The auto
//     `timestamp` column is the reverse. So: filter on timestamp, output/order
//     on double1.
//   * No JSON functions — which is why Plan 2 promoted the run facts into
//     double2..double6 and blob8 instead of leaving them in the payload blob.
//
// Column map (fixed by AnalyticsEngineSink.ts):
//   index1  = player id            blob5 = sessionId
//   blob1   = level                blob6 = payload JSON
//   blob2   = eventType            blob7 = userAgent
//   blob3   = platform             blob8 = run cause
//   blob4   = appVersion
//   double1 = client timestamp     double4 = kills
//   double2 = score                double5 = durationMs
//   double3 = height               double6 = pickupBonus

export const CROSSTAB_DIMENSIONS = [
  'duration', 'cause', 'height', 'score', 'platform', 'appVersion', 'placed', 'submitted',
] as const;
export type CrosstabDimension = typeof CROSSTAB_DIMENSIONS[number];

export function isCrosstabDimension(v: unknown): v is CrosstabDimension {
  return typeof v === 'string' && (CROSSTAB_DIMENSIONS as readonly string[]).includes(v);
}

export interface FunnelStages {
  cohort: number; startedRun1: number; finishedRun1: number;
  startedRun2: number; startedRun3: number; returnedLater: number;
}
export interface CrosstabRow { bucket: string; cohort: number; returned: number }
export interface TraceRow {
  ts: number; level: string; eventType: string;
  platform: string; appVersion: string; sessionId: string; payload: string;
}

/** `?` placeholders for a list of ids, as positional params. */
function idPlaceholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ');
}

/**
 * Per-player stage counts for a cohort.
 *
 * Inner query: one row per player, with their run counts and first/last activity.
 * Outer query: how many players cleared each stage.
 *
 * Event counts use SUM(_sample_interval) so they stay correct under sampling.
 * The outer counts are counts of OBSERVED players — exact while
 * _sample_interval is 1, which is why the result carries it.
 */
export function funnelQuery(
  dataset: string, playerIds: string[], since: string, until: string,
): { sql: string; params: (string | number)[] } {
  const sql = `
    SELECT
      count() AS cohort,
      countIf(starts >= 1) AS startedRun1,
      countIf(ends   >= 1) AS finishedRun1,
      countIf(starts >= 2) AS startedRun2,
      countIf(starts >= 3) AS startedRun3,
      countIf(lastDay > firstDay) AS returnedLater,
      max(si) AS _sample_interval
    FROM (
      SELECT
        index1 AS player,
        SUM(_sample_interval * (blob2 = 'run:start')) AS starts,
        SUM(_sample_interval * (blob2 = 'run:end'))   AS ends,
        toDate(min(double1) / 1000) AS firstDay,
        toDate(max(double1) / 1000) AS lastDay,
        max(_sample_interval) AS si
      FROM ${dataset}
      WHERE timestamp >= toDateTime(?) AND timestamp < toDateTime(?)
        AND index1 IN (${idPlaceholders(playerIds.length)})
      GROUP BY player
    )`;
  return { sql, params: [since, until, ...playerIds] };
}

/** The per-dimension bucket expression, evaluated on each player's FIRST run. */
function bucketExpr(dimension: CrosstabDimension): string {
  switch (dimension) {
    case 'duration':
      // double5 = durationMs on the first run:end
      return `multiIf(firstDuration < 15000, '0-15s',
                      firstDuration < 45000, '15-45s',
                      firstDuration < 120000, '45-120s', '120s+')`;
    case 'height':
      return `multiIf(firstHeight < 100, '0-100', firstHeight < 500, '100-500',
                      firstHeight < 2000, '500-2000', '2000+')`;
    case 'score':
      return `multiIf(firstScore < 100, '0-100', firstScore < 1000, '100-1000',
                      firstScore < 5000, '1000-5000', '5000+')`;
    case 'cause':       return 'firstCause';
    case 'platform':    return 'platform';
    case 'appVersion':  return 'appVersion';
    case 'placed':      return `if(placements > 0, 'placed', 'never placed')`;
    case 'submitted':   return `if(submissions > 0, 'submitted', 'never submitted')`;
  }
}

/**
 * Run-2 rate split by a characteristic of the player's FIRST run.
 *
 * Three levels, because AE has no JOIN and an alias cannot be referenced in the
 * SELECT that defines it: innermost derives each player's facts, the middle
 * layer turns those into a bucket label, the outer layer aggregates by bucket.
 */
export function crosstabQuery(
  dataset: string, dimension: CrosstabDimension,
  playerIds: string[], since: string, until: string,
): { sql: string; params: (string | number)[] } {
  const sql = `
    SELECT bucket, count() AS cohort, countIf(starts >= 2) AS returned, max(si) AS _sample_interval
    FROM (
      SELECT ${bucketExpr(dimension)} AS bucket, starts, si
      FROM (
        SELECT
          index1 AS player,
          SUM(_sample_interval * (blob2 = 'run:start')) AS starts,
          SUM(_sample_interval * (blob2 = 'placement:made')) AS placements,
          SUM(_sample_interval * (blob2 = 'score:submitted')) AS submissions,
          argMinIf(double5, double1, blob2 = 'run:end') AS firstDuration,
          argMinIf(double3, double1, blob2 = 'run:end') AS firstHeight,
          argMinIf(double2, double1, blob2 = 'run:end') AS firstScore,
          argMinIf(blob8,  double1, blob2 = 'run:end') AS firstCause,
          argMin(blob3, double1) AS platform,
          argMin(blob4, double1) AS appVersion,
          max(_sample_interval) AS si
        FROM ${dataset}
        WHERE timestamp >= toDateTime(?) AND timestamp < toDateTime(?)
          AND index1 IN (${idPlaceholders(playerIds.length)})
        GROUP BY player
      )
    )
    GROUP BY bucket
    ORDER BY bucket`;
  return { sql, params: [since, until, ...playerIds] };
}

/** Every event for one player, newest first. */
export function traceQuery(
  dataset: string, playerId: string, since: string, until: string, limit: number,
): { sql: string; params: (string | number)[] } {
  // Ordering is on double1 (the client timestamp) because the auto `timestamp`
  // column cannot be SELECTed and double1 cannot be used in ORDER BY... so the
  // SELECT aliases it first and orders by the alias. fetch-logs.yml does the
  // same thing for the same reason.
  const sql = `
    SELECT
      double1 AS ts,
      blob1 AS level, blob2 AS eventType, blob3 AS platform,
      blob4 AS appVersion, blob5 AS sessionId, blob6 AS payload,
      _sample_interval
    FROM ${dataset}
    WHERE timestamp >= toDateTime(?) AND timestamp < toDateTime(?)
      AND index1 = ?
    ORDER BY ts DESC
    LIMIT ?`;
  return { sql, params: [since, until, playerId, limit] };
}

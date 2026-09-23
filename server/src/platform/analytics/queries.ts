// server/src/platform/analytics/queries.ts
//
// The fixed set of Analytics Engine queries. This is the security boundary:
// the Worker holds a Cloudflare API token that can read all account analytics,
// and the only thing standing between a caller and arbitrary use of it is that
// every query is built here from allowlisted inputs.
//
// ─── AE SQL dialect: what is actually true ───────────────────────────────────
// Every line below was verified empirically against the real SQL API on
// 2026-09-21 (staging dataset). Several beliefs this file was originally
// written around turned out to be WRONG; they are called out so nobody
// reinstates them from the old comments or from fetch-logs.yml.
//
// Verified SUPPORTED:
//   * Subqueries in FROM, nested arbitrarily. This is the only composition
//     tool — there is still no JOIN and no UNION.
//   * `if(cond, a, b)`, including nesting. Both branches must have the SAME
//     type: `if(c, blob8, NULL)` is rejected, `if(c, blob8, '')` is fine.
//   * `countIf`, `sumIf`, `avgIf`, `argMin`, `argMax`, `count(DISTINCT x)`,
//     `quantileExactWeighted(q)(x, w)`.
//   * `toDateTime('YYYY-MM-DD HH:MM:SS')` — also accepts a `T` separator, but
//     NOT fractional seconds and NOT a trailing `Z`. It also accepts a numeric
//     epoch-seconds argument, including a DOUBLE.
//   * `formatDateTime(toDateTime(<double>), '%Y-%m-%d')`.
//   * `double1` in WHERE, and the auto `timestamp` column in SELECT.
//
// Verified NOT supported — do not reach for these:
//   * `multiIf`, `argMinIf`, `minIf`, `maxIf`, `uniq`, `toUInt64`.
//   * `CASE WHEN … THEN … END` (use nested `if`).
//   * `toDate()` on a DOUBLE — it rejects the type outright.
//   * JSON functions of any kind. This is why Plan 2 promoted the run facts
//     into double2..double6 and blob8 rather than leaving them in the payload.
//   * **Bound parameters.** POSTing `{query, parameters}` is rejected with
//     "Expected an SQL statement". The API takes raw SQL text only, so values
//     are substituted locally — see `bindParams` in aeClient.ts, which is the
//     single audited place that happens.
//
// CORRECTED, previously believed and wrong: `double1` was documented here as
// unusable in WHERE/ORDER BY, and the auto `timestamp` column as unusable in
// SELECT. Both are false — each was probed directly and works. The queries
// below still filter on `timestamp` and order on a SELECT alias, because that
// is genuinely better (timestamp is the indexed column, and ordering by alias
// reads more clearly), but NOT because the alternative is forbidden.
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

/**
 * ISO-8601 (`2026-09-21T00:00:00.000Z`) to the only shape `toDateTime()`
 * accepts (`2026-09-21 00:00:00`). Fractional seconds and the trailing `Z`
 * are both rejected by the dialect, so they are dropped here rather than at
 * the call sites.
 *
 * The window is always UTC — `toISOString()` is UTC and AE stores UTC — so
 * this is a pure reformat, not a timezone conversion.
 */
export function aeDateTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`aeDateTime: unparseable timestamp: ${iso}`);
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/** `?` placeholders for a list of ids, as positional params. */
function idPlaceholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ');
}

/**
 * A sort position no real row can occupy, used to make `argMin` ignore rows
 * that fail a condition.
 *
 * The `.5` is load-bearing, not a typo. A numeric literal whose fractional
 * part is zero is parsed as UInt64 REGARDLESS of how it is written —
 * `999999999999999.0` comes back typed UInt64 — and `if()` then rejects it
 * beside the DOUBLE `double1` with an opaque "type error". A literal with a
 * non-zero fraction stays Float64 at any magnitude. Verified against the live
 * API; no unit test against a stub client can catch a regression here.
 *
 * 99999999999999.5 ms is ~year 5138, comfortably past any real timestamp.
 */
const SENTINEL = '99999999999999.5';

/**
 * The `argMaxWhere` counterpart to SENTINEL: non-matching rows must sort BELOW
 * every real row, and a millisecond client timestamp is always positive, so
 * zero is already an unreachable floor. Deliberately NOT `-${SENTINEL}`: a
 * unary minus on a literal is a parser shape this dialect has never been probed
 * for, and there is nothing to gain by being the one to find out.
 */
const ORDER_FLOOR = '0.0';

/**
 * `argMinIf(value, orderBy, cond)` does not exist in this dialect. This builds
 * the equivalent from two `if`s: rows failing `cond` are pushed to an
 * unreachable sort position, so `argMin` can never select one.
 *
 * `fallback` must have the SAME TYPE as `value` — the dialect rejects an
 * `if` whose branches disagree, which is why `NULL` cannot be used here.
 * When a player has no matching row at all, every candidate ties at the
 * sentinel and the expression yields `fallback`. Callers must therefore treat
 * `fallback` as "no such row" rather than as a real measurement — the crosstab
 * does this with an explicit `ends = 0` guard.
 */
function argMinWhere(value: string, orderBy: string, cond: string, fallback: string): string {
  return `argMin(if(${cond}, ${value}, ${fallback}), if(${cond}, ${orderBy}, ${SENTINEL}))`;
}

/**
 * The `argMax` mirror of `argMinWhere` — same construction, same caveats, with
 * non-matching rows pushed to the BOTTOM of the ordering instead of the top.
 */
function argMaxWhere(value: string, orderBy: string, cond: string, fallback: string): string {
  return `argMax(if(${cond}, ${value}, ${fallback}), if(${cond}, ${orderBy}, ${ORDER_FLOOR}))`;
}

/** A day label (`YYYY-MM-DD`) from a millisecond client timestamp. */
function dayOf(expr: string): string {
  // `toDate()` rejects a DOUBLE outright, so go via toDateTime + formatDateTime.
  return `formatDateTime(toDateTime(${expr} / 1000), '%Y-%m-%d')`;
}

/**
 * Rows that represent the player DOING something, as opposed to something going
 * wrong around them.
 *
 * `RemoteLogger.event()` is gated on the analytics opt-out, but `error()` and
 * `warn()` are NOT — diagnostics are sent regardless, and they land in this
 * same dataset carrying the same `double1` client timestamp. So any activity
 * measure built from unfiltered `double1` silently counts crash reports as
 * engagement. See `src/logging/RemoteLogger.ts`.
 */
const GAMEPLAY = `blob1 = 'event'`;

/**
 * The discriminator every `blob2` match must carry.
 *
 * The sink writes `blob2 = eventType ?? message ?? ''` for EVERY row, so an
 * error/warn row — which never sets `eventType` — puts its free-text message
 * into the same column these queries match event names against. `/log` is
 * unauthenticated, so a posted `{level:'error', message:'run:start'}` is a
 * deliberately reachable way to inflate a funnel stage, and an innocent
 * colon-namespaced warn message would do it by accident. Pairing the event
 * name with the level makes the match unambiguous.
 */
const IS_EVENT = (type: string) => `${GAMEPLAY} AND blob2 = '${type}'`;

/**
 * Per-player stage counts for a cohort.
 *
 * Inner query: one row per player, with their run counts and first/last activity.
 * Outer query: how many players cleared each stage.
 *
 * `firstDay`/`lastDay` — and therefore `returnedLater` — are computed over
 * GAMEPLAY rows only. With a bare `min(double1)`/`max(double1)` a player who
 * never started a run but whose client threw errors on two different days
 * counted as having returned, inflating exactly the stage a churn analysis
 * leans on hardest. There is no `minIf`/`maxIf` in this dialect, which is why
 * the conditional extremes go through argMin/argMaxWhere. A player with no
 * gameplay rows at all lands on the shared `0.0` fallback for both, so
 * `lastDay > firstDay` is correctly false rather than accidentally true.
 *
 * Event counts use SUM(_sample_interval) so they stay correct under sampling.
 * The outer counts are counts of OBSERVED players — exact while
 * _sample_interval is 1, which is why the result carries it.
 *
 * **Per-player stage classification is unreliable once AE samples, and this is
 * not fixable here.** `starts`/`ends` are weighted sums, so a single stored row
 * carrying a weight of 3 can push a player who started one run into the
 * `starts >= 3` stage. Counting rows instead does not fix it — it trades that
 * false positive for a false negative, because the player's other rows were
 * dropped before the query ever ran. Sampling loses the per-player detail these
 * thresholds need, whichever way the sum is spelled. The weighted form is kept
 * because it is at least unbiased in aggregate, and the result carries
 * `_sample_interval` so the admin UI can warn when it exceeds 1. Both spellings
 * are identical while it equals 1, which is the regime this dataset is in today.
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
        sumIf(_sample_interval, ${IS_EVENT('run:start')}) AS starts,
        sumIf(_sample_interval, ${IS_EVENT('run:end')})   AS ends,
        ${dayOf(argMinWhere('double1', 'double1', GAMEPLAY, '0.0'))} AS firstDay,
        ${dayOf(argMaxWhere('double1', 'double1', GAMEPLAY, '0.0'))} AS lastDay,
        max(_sample_interval) AS si
      FROM ${dataset}
      WHERE timestamp >= toDateTime(?) AND timestamp < toDateTime(?)
        AND index1 IN (${idPlaceholders(playerIds.length)})
      GROUP BY player
    )`;
  return { sql, params: [aeDateTime(since), aeDateTime(until), ...playerIds] };
}

/** Per-player aggregate expressions, inlined rather than aliased — see below. */
const EVENTS = (type: string) => `sumIf(_sample_interval, ${IS_EVENT(type)})`;
const ENDS = EVENTS('run:end');
/** The value of `col` on the player's FIRST `run:end`, or `fallback` if none. */
const FIRST_OF_RUN = (col: string, fallback: string) =>
  argMinWhere(col, 'double1', IS_EVENT('run:end'), fallback);

/**
 * The per-dimension bucket expression, evaluated on each player's FIRST run.
 *
 * **Everything here is inlined rather than referencing a SELECT alias.** The
 * dialect rejects a subquery nested inside a subquery ("cannot nest subqueries
 * inside subqueries"), so the natural three-level shape — derive per-player
 * facts, label them, aggregate the labels — is not available. Collapsing to two
 * levels means the bucket expression cannot refer to aliases defined beside it,
 * so it repeats the aggregate expressions in full. That is why this reads
 * verbosely; it is a dialect limit, not a style choice.
 *
 * The four first-run dimensions are guarded by `<ends> = 0`: a player who never
 * finished a run has no first run to describe, and `argMinWhere`'s fallback
 * would otherwise land them in the lowest bucket ('0-15s', score '0-100') as
 * though they had finished a very bad run. That would inflate exactly the
 * bucket the churn analysis cares most about.
 */
function bucketExpr(dimension: CrosstabDimension): string {
  const noRun = (inner: string) => `if(${ENDS} = 0, 'no finished run', ${inner})`;
  const dur = FIRST_OF_RUN('double5', '0.0');
  const hgt = FIRST_OF_RUN('double3', '0.0');
  const scr = FIRST_OF_RUN('double2', '0.0');
  switch (dimension) {
    case 'duration':  // double5 = durationMs on the first run:end
      return noRun(`if(${dur} < 15000, '0-15s',
                    if(${dur} < 45000, '15-45s',
                    if(${dur} < 120000, '45-120s', '120s+')))`);
    case 'height':
      return noRun(`if(${hgt} < 100, '0-100',
                    if(${hgt} < 500, '100-500',
                    if(${hgt} < 2000, '500-2000', '2000+')))`);
    case 'score':
      return noRun(`if(${scr} < 100, '0-100',
                    if(${scr} < 1000, '100-1000',
                    if(${scr} < 5000, '1000-5000', '5000+')))`);
    case 'cause':       return noRun(FIRST_OF_RUN('blob8', `''`));
    case 'platform':    return 'argMin(blob3, double1)';
    case 'appVersion':  return 'argMin(blob4, double1)';
    case 'placed':      return `if(${EVENTS('placement:made')} > 0, 'placed', 'never placed')`;
    case 'submitted':   return `if(${EVENTS('score:submitted')} > 0, 'submitted', 'never submitted')`;
  }
}

/**
 * The order buckets should be DISPLAYED in, per dimension.
 *
 * Bucket labels are strings, so sorting them as strings puts '120s+' second and
 * '2000+' third — the progression the whole crosstab exists to show, scrambled.
 * (`score` sorts correctly as a string purely by accident of digit count, which
 * is exactly the kind of coincidence that hides a bug like this.) These lists
 * are the authority; they must stay in step with `bucketExpr`.
 *
 * Dimensions whose buckets are open-ended — cause, platform, appVersion — have
 * no natural order and are absent here; those fall back to alphabetical.
 * 'no finished run' is appended by the sorter rather than listed, since every
 * ranged dimension ends with it.
 */
export const BUCKET_ORDER: Partial<Record<CrosstabDimension, readonly string[]>> = {
  duration: ['0-15s', '15-45s', '45-120s', '120s+'],
  height:   ['0-100', '100-500', '500-2000', '2000+'],
  score:    ['0-100', '100-1000', '1000-5000', '5000+'],
  placed:   ['placed', 'never placed'],
  submitted: ['submitted', 'never submitted'],
};

export const NO_RUN_BUCKET = 'no finished run';

/**
 * Compares two bucket labels for display. Known buckets sort by their position
 * in BUCKET_ORDER, `no finished run` sorts last, and anything unrecognised
 * (a new label, a cause string) sorts alphabetically after the known ones — so
 * an unexpected value is visible at the end rather than silently reordering the
 * scale.
 */
export function compareBuckets(dimension: CrosstabDimension, a: string, b: string): number {
  const order = BUCKET_ORDER[dimension];
  const rank = (x: string): number => {
    if (x === NO_RUN_BUCKET) return Number.MAX_SAFE_INTEGER;
    const i = order?.indexOf(x) ?? -1;
    return i === -1 ? Number.MAX_SAFE_INTEGER - 1 : i;
  };
  const ra = rank(a), rb = rank(b);
  return ra === rb ? a.localeCompare(b) : ra - rb;
}

/**
 * Run-2 rate split by a characteristic of the player's FIRST run.
 *
 * Two levels only: the inner query produces one row per player carrying their
 * bucket label and run count, the outer aggregates those rows by bucket. A
 * third level would be more readable but the dialect forbids it (see
 * `bucketExpr`).
 */
export function crosstabQuery(
  dataset: string, dimension: CrosstabDimension,
  playerIds: string[], since: string, until: string,
): { sql: string; params: (string | number)[] } {
  const sql = `
    SELECT bucket, count() AS cohort, countIf(starts >= 2) AS returned, max(si) AS _sample_interval
    FROM (
      SELECT
        ${bucketExpr(dimension)} AS bucket,
        ${EVENTS('run:start')} AS starts,
        max(_sample_interval) AS si
      FROM ${dataset}
      WHERE timestamp >= toDateTime(?) AND timestamp < toDateTime(?)
        AND index1 IN (${idPlaceholders(playerIds.length)})
      GROUP BY index1
    )
    GROUP BY bucket
    ORDER BY bucket`;
  return { sql, params: [aeDateTime(since), aeDateTime(until), ...playerIds] };
}

/** Every event for one player, newest first. */
export function traceQuery(
  dataset: string, playerId: string, since: string, until: string, limit: number,
): { sql: string; params: (string | number)[] } {
  // Ordering goes through the `ts` SELECT alias rather than repeating the
  // expression. (`double1` in ORDER BY would also work — see the header note
  // correcting the original claim that it would not.)
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
  return { sql, params: [aeDateTime(since), aeDateTime(until), playerId, limit] };
}

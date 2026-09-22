// server/src/platform/metricsDb.ts
//
// Read-only admin metrics over heap_scores. Platform, not game: player_auth
// knows nothing about heaps.
//
// There is deliberately no cache decorator here. These are low-frequency admin
// reads where a stale number is worse than a slow one.

/** Bucket granularities the metrics endpoints accept. */
export type MetricsBucket = 'hour' | 'day' | 'week';

/**
 * strftime format per bucket. `created_at` is written as
 * `new Date().toISOString()` (see platform/playerAuth.ts), and SQLite's date
 * functions accept both the `T` separator and the trailing `Z`.
 *
 * These strings are passed to SQLite as BIND PARAMETERS, never interpolated
 * into the SQL text — strftime accepts a bound format argument, so the
 * allowlist below is a validation aid rather than the only thing standing
 * between user input and the query.
 */
export const BUCKET_FORMATS: Record<MetricsBucket, string> = {
  hour: '%Y-%m-%dT%H:00:00Z',
  day:  '%Y-%m-%d',
  week: '%Y-W%W',
};

/** True when `v` is one of the three accepted bucket names. */
export function isMetricsBucket(v: unknown): v is MetricsBucket {
  return v === 'hour' || v === 'day' || v === 'week';
}

export interface NewPlayerBucket {
  /** The bucket label, already formatted (e.g. '2026-09-19'). */
  bucket: string;
  count: number;
}

export interface CohortPage {
  playerIds: string[];
  /**
   * `${created_at}|${player_id}` of the last row returned — NOT a plain
   * timestamp — pass back verbatim as `cursor`. Null at the end. The route
   * layer must treat this as an opaque string; see
   * `routes/metrics.ts`'s `isValidCursorShape`.
   */
  nextCursor: string | null;
}

export interface MetricsDB {
  /**
   * New players per bucket over `[since, until)` — half-open, so adjacent
   * windows never double-count a row on the boundary.
   *
   * "New player" is the first row in player_auth, which is written once per
   * player on their first AUTHENTICATED WRITE — not on first launch. A player
   * who installs and never submits a score never appears here.
   *
   * A player who later signs into GPGS mints a different effective id (see
   * getEffectivePlayerId) and gets a second player_auth row — one human, two
   * new-player events.
   */
  newPlayersByBucket(
    bucket: MetricsBucket, since: string, until: string,
  ): Promise<NewPlayerBucket[]>;

  /**
   * The player ids first seen in `[since, until)`, oldest first, paged.
   *
   * Keyset paging on `(created_at, player_id)` rather than OFFSET: OFFSET
   * silently skips rows when a concurrent insert lands between pages, which
   * would drop players out of a cohort at random. `player_id` breaks ties
   * when two rows share a millisecond `created_at`.
   */
  cohortMembers(
    since: string, until: string, limit: number, cursor: string | null,
  ): Promise<CohortPage>;
}

export class D1MetricsDB implements MetricsDB {
  constructor(private d1: D1Database) {}

  async newPlayersByBucket(
    bucket: MetricsBucket, since: string, until: string,
  ): Promise<NewPlayerBucket[]> {
    const res = await this.d1
      .prepare(
        `SELECT strftime(?1, created_at) AS bucket, COUNT(*) AS count
           FROM player_auth
          WHERE created_at >= ?2 AND created_at < ?3
          GROUP BY bucket
          ORDER BY bucket`,
      )
      .bind(BUCKET_FORMATS[bucket], since, until)
      .all<{ bucket: string; count: number }>();
    return res.results.map((r) => ({ bucket: r.bucket, count: r.count }));
  }

  async cohortMembers(
    since: string, until: string, limit: number, cursor: string | null,
  ): Promise<CohortPage> {
    // Cursor is a composite of (created_at, player_id) — `created_at` alone
    // is not unique (millisecond ISO timestamps can tie), so a plain
    // `created_at` cursor can skip a row tied with the last row of the
    // previous page. `|` cannot appear in either field, so it's a safe
    // separator.
    let cursorCreatedAt: string | null = null;
    let cursorPlayerId: string | null = null;
    if (cursor !== null) {
      const sep = cursor.indexOf('|');
      cursorCreatedAt = cursor.slice(0, sep);
      cursorPlayerId = cursor.slice(sep + 1);
    }

    // `since` stays a floor on every page — first or resumed — so a stale or
    // hand-crafted cursor that predates `since` can never leak rows outside
    // the requested window. The cursor comparison is ANDed on top of it, not
    // a replacement for it.
    const where = cursor === null
      ? 'created_at >= ?1 AND created_at < ?2'
      : 'created_at >= ?1 AND created_at < ?2 AND (created_at > ?4 OR (created_at = ?4 AND player_id > ?5))';

    const stmt = this.d1.prepare(
      `SELECT player_id, created_at
         FROM player_auth
        WHERE ${where}
        ORDER BY created_at, player_id
        LIMIT ?3`,
    );
    const bound = cursor === null
      ? stmt.bind(since, until, limit)
      : stmt.bind(since, until, limit, cursorCreatedAt, cursorPlayerId);
    const res = await bound.all<{ player_id: string; created_at: string }>();

    const rows = res.results;
    const last = rows[rows.length - 1];
    return {
      playerIds: rows.map((r) => r.player_id),
      nextCursor: rows.length === limit ? `${last.created_at}|${last.player_id}` : null,
    };
  }
}

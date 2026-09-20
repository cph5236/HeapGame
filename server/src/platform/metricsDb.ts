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
  /** `created_at` of the last row returned; pass back as `cursor`. Null at the end. */
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
   */
  newPlayersByBucket(
    bucket: MetricsBucket, since: string, until: string,
  ): Promise<NewPlayerBucket[]>;

  /**
   * The player ids first seen in `[since, until)`, oldest first, paged.
   *
   * Keyset paging on `created_at` rather than OFFSET: OFFSET silently skips
   * rows when a concurrent insert lands between pages, which would drop
   * players out of a cohort at random.
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
    const lo = cursor === null ? since : cursor;
    // `>` on a resumed page, `>=` on the first, so the cursor row is not
    // returned twice and the first row is not skipped.
    const cmp = cursor === null ? '>=' : '>';
    const res = await this.d1
      .prepare(
        `SELECT player_id, created_at
           FROM player_auth
          WHERE created_at ${cmp} ?1 AND created_at < ?2
          ORDER BY created_at
          LIMIT ?3`,
      )
      .bind(lo, until, limit)
      .all<{ player_id: string; created_at: string }>();

    const rows = res.results;
    return {
      playerIds: rows.map((r) => r.player_id),
      nextCursor: rows.length === limit ? rows[rows.length - 1].created_at : null,
    };
  }
}

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
}

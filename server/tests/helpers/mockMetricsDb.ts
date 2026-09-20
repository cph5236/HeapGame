// server/tests/helpers/mockMetricsDb.ts
//
// Route-logic double. SQL correctness is proven against real SQLite in
// metricsDb.test.ts; this only needs to record what it was asked for.

import type {
  MetricsDB, MetricsBucket, NewPlayerBucket, CohortPage,
} from '../../src/platform/metricsDb';

export class MockMetricsDB implements MetricsDB {
  /** Rows the next newPlayersByBucket call returns. */
  rows: NewPlayerBucket[] = [];
  /** Arguments of the last newPlayersByBucket call, for assertions. */
  lastCall: { bucket: MetricsBucket; since: string; until: string } | null = null;

  async newPlayersByBucket(
    bucket: MetricsBucket, since: string, until: string,
  ): Promise<NewPlayerBucket[]> {
    this.lastCall = { bucket, since, until };
    return this.rows;
  }

  /** Page the next cohortMembers call returns. */
  cohortPage: CohortPage = { playerIds: [], nextCursor: null };
  lastCohortCall: { since: string; until: string; limit: number; cursor: string | null } | null = null;

  async cohortMembers(
    since: string, until: string, limit: number, cursor: string | null,
  ): Promise<CohortPage> {
    this.lastCohortCall = { since, until, limit, cursor };
    return this.cohortPage;
  }
}

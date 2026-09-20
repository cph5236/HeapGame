import type { AeClient, AeQueryResult } from '../../src/platform/analytics/aeClient';

export class MockAeClient implements AeClient {
  /** Rows the next query returns. */
  rows: unknown[] = [];
  sampleIntervalMax = 1;
  /** Every (sql, params) pair seen, for assertions. */
  calls: { sql: string; params: (string | number)[] }[] = [];

  async query<R>(sql: string, params: (string | number)[]): Promise<AeQueryResult<R>> {
    this.calls.push({ sql, params });
    return { rows: this.rows as R[], sampleIntervalMax: this.sampleIntervalMax };
  }
}

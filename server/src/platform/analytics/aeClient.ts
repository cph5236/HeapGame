// server/src/platform/analytics/aeClient.ts
//
// Transport for the Analytics Engine SQL API. Deliberately knows nothing about
// which queries exist — that lives in queries.ts — so the query SQL can be unit
// tested against a stub client with no network.

export interface AeQueryResult<R> {
  rows: R[];
  /**
   * Largest `_sample_interval` in the result, or 1 when absent. Anything above
   * 1 means AE downsampled and the numbers are estimates — the UI surfaces this
   * rather than quietly presenting sampled counts as exact.
   */
  sampleIntervalMax: number;
}

export interface AeClient {
  query<R>(sql: string, params: (string | number)[]): Promise<AeQueryResult<R>>;
}

export class HttpAeClient implements AeClient {
  constructor(
    private accountId: string,
    private token: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async query<R>(sql: string, params: (string | number)[]): Promise<AeQueryResult<R>> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/analytics_engine/sql`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      // Cloudflare substitutes positional params server-side; never interpolate
      // them into the SQL text here.
      body: JSON.stringify({ query: sql, parameters: params }),
    });

    const text = await res.text();
    if (!res.ok) {
      // Include the body (it carries the SQL error) but never the token.
      throw new Error(`AE query failed (${res.status}): ${text.slice(0, 500)}`);
    }

    const parsed = JSON.parse(text) as { data?: R[] };
    const rows = parsed.data ?? [];
    let sampleIntervalMax = 1;
    for (const r of rows as unknown as Record<string, unknown>[]) {
      const si = Number(r?._sample_interval);
      if (Number.isFinite(si) && si > sampleIntervalMax) sampleIntervalMax = si;
    }
    return { rows, sampleIntervalMax };
  }
}

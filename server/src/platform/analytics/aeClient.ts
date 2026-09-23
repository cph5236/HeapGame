// server/src/platform/analytics/aeClient.ts
//
// Transport for the Analytics Engine SQL API. Deliberately knows nothing about
// which queries exist — that lives in queries.ts — so the query SQL can be unit
// tested against a stub client with no network.

/**
 * Substitutes positional `?` placeholders with literal values.
 *
 * **Why this exists.** The design originally assumed Cloudflare's SQL API bound
 * parameters server-side. It does not: POSTing `{query, parameters}` is
 * rejected with "Expected an SQL statement, found: {" (verified against the
 * live API, 2026-09-21). The API accepts raw SQL text only, so substitution
 * has to happen here. This function is the single place it happens, so it is
 * the single place that needs auditing.
 *
 * **Why this is safe.** The dialect refuses to parse any string literal
 * containing a single quote or a backslash at all — "backslash and
 * single-quote characters in strings are unsupported" — so there is no escape
 * sequence to get right and no escaping subtlety to get wrong. Rather than
 * attempt an escape the dialect would reject anyway, this REJECTS such values
 * outright, along with control characters and non-finite numbers. A string
 * that cannot contain a quote cannot terminate a literal, and a value that
 * cannot terminate a literal cannot inject SQL.
 *
 * Callers upstream already constrain these values (player ids are
 * length-bounded and come from D1, timestamps are re-serialised through Date,
 * limits are clamped integers). This is the backstop, not the only check.
 *
 * NOTE: placeholders are matched textually, so no query built by queries.ts
 * may contain a literal `?` inside a string literal. None do.
 */
export function bindParams(sql: string, params: (string | number)[]): string {
  const expected = (sql.match(/\?/g) ?? []).length;
  if (expected !== params.length) {
    throw new Error(`AE bind: SQL has ${expected} placeholders but ${params.length} params given`);
  }

  let i = 0;
  return sql.replace(/\?/g, () => {
    const p = params[i++];

    if (typeof p === 'number') {
      if (!Number.isFinite(p)) throw new Error('AE bind: non-finite number parameter');
      return String(p);
    }

    if (typeof p !== 'string') {
      throw new Error(`AE bind: parameter must be a string or number, got ${typeof p}`);
    }
    if (p.includes("'") || p.includes('\\')) {
      // Not escapable — the dialect rejects these characters in literals.
      throw new Error('AE bind: string parameter contains a quote or backslash');
    }
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(p)) {
      throw new Error('AE bind: string parameter contains a control character');
    }
    return `'${p}'`;
  });
}

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
  private readonly fetchImpl: typeof fetch;

  constructor(
    private accountId: string,
    private token: string,
    fetchImpl: typeof fetch = fetch,
  ) {
    // `.bind(globalThis)` is load-bearing. `fetch` must be invoked with
    // globalThis as its receiver; storing it as a property and calling
    // `this.fetchImpl(...)` sets `this` to this instance instead, and the
    // Workers runtime rejects that at request time with:
    //   "Illegal invocation: function called with incorrect `this` reference"
    // Neither unit tests nor local Node catch this — a vi.fn() mock does not
    // care about its receiver, and Node's fetch is lenient. It only fails in
    // the real Workers runtime, which is where it was found.
    this.fetchImpl = fetchImpl.bind(globalThis);
  }

  async query<R>(sql: string, params: (string | number)[]): Promise<AeQueryResult<R>> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/analytics_engine/sql`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        // Raw SQL text — this API has no parameter-binding form. See bindParams.
        'Content-Type': 'text/plain',
      },
      body: bindParams(sql, params),
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

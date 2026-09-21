import { describe, it, expect, vi } from 'vitest';
import { HttpAeClient, bindParams } from '../src/platform/analytics/aeClient';

function fakeFetch(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  })) as unknown as typeof fetch;
}

describe('HttpAeClient', () => {
  it('posts to the account SQL endpoint with a bearer token', async () => {
    const f = fakeFetch({ data: [], meta: [] });
    await new HttpAeClient('acct123', 'tok456', f).query('SELECT 1', []);
    const [url, init] = (f as any).mock.calls[0];
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acct123/analytics_engine/sql');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok456');
  });

  it('returns the data rows', async () => {
    const f = fakeFetch({ data: [{ n: 3 }, { n: 4 }] });
    const res = await new HttpAeClient('a', 't', f).query<{ n: number }>('SELECT 1', []);
    expect(res.rows).toEqual([{ n: 3 }, { n: 4 }]);
  });

  it('reports the largest _sample_interval seen, defaulting to 1', async () => {
    const f = fakeFetch({ data: [{ _sample_interval: 1 }, { _sample_interval: 8 }] });
    const res = await new HttpAeClient('a', 't', f).query('SELECT 1', []);
    expect(res.sampleIntervalMax).toBe(8);

    const f2 = fakeFetch({ data: [{ n: 1 }] });
    const res2 = await new HttpAeClient('a', 't', f2).query('SELECT 1', []);
    expect(res2.sampleIntervalMax).toBe(1);
  });

  it('throws with the response body on a non-2xx, without leaking the token', async () => {
    const f = fakeFetch({ errors: ['bad sql'] }, 400);
    await expect(new HttpAeClient('a', 'sekrit', f).query('SELECT bogus', []))
      .rejects.toThrow(/bad sql/);
    await expect(new HttpAeClient('a', 'sekrit', f).query('SELECT bogus', []))
      .rejects.not.toThrow(/sekrit/);
  });

  it('posts raw SQL text, not a JSON {query, parameters} envelope', async () => {
    // The SQL API has NO parameter-binding form: POSTing {query, parameters}
    // is rejected with "Expected an SQL statement, found: {" (verified against
    // the live API). If this ever regresses to a JSON body, every query 422s.
    const f = fakeFetch({ data: [] });
    await new HttpAeClient('a', 't', f).query('SELECT ? AS x', ['hi']);
    const [, init] = (f as any).mock.calls[0];
    expect(init.headers['Content-Type']).toBe('text/plain');
    expect(init.body).toBe("SELECT 'hi' AS x");
    expect(() => JSON.parse(init.body)).toThrow();
  });
});

describe('bindParams', () => {
  it('substitutes positionally, quoting strings and emitting bare numbers', () => {
    expect(bindParams('SELECT ? , ? , ?', ['a', 2, 'c'])).toBe("SELECT 'a' , 2 , 'c'");
  });

  it('rejects a placeholder/param count mismatch rather than mis-binding', () => {
    expect(() => bindParams('SELECT ?, ?', ['only-one'])).toThrow(/placeholders/);
    expect(() => bindParams('SELECT ?', ['a', 'b'])).toThrow(/placeholders/);
  });

  it('rejects quotes and backslashes instead of trying to escape them', () => {
    // The dialect refuses to parse ANY string literal containing these, so
    // there is no escape sequence to get right. Rejecting is the whole of the
    // injection defence: a value that cannot contain a quote cannot terminate
    // a literal.
    expect(() => bindParams('WHERE index1 = ?', ["a' OR '1'='1"])).toThrow(/quote or backslash/);
    expect(() => bindParams('WHERE index1 = ?', ['a\\b'])).toThrow(/quote or backslash/);
  });

  it('rejects control characters', () => {
    expect(() => bindParams('WHERE index1 = ?', ['a\nb'])).toThrow(/control character/);
    expect(() => bindParams('WHERE index1 = ?', ['a\u0000b'])).toThrow(/control character/);
  });

  it('rejects non-finite numbers and non-scalar params', () => {
    expect(() => bindParams('LIMIT ?', [NaN])).toThrow(/non-finite/);
    expect(() => bindParams('LIMIT ?', [Infinity])).toThrow(/non-finite/);
    expect(() => bindParams('LIMIT ?', [{} as never])).toThrow(/string or number/);
    expect(() => bindParams('LIMIT ?', [null as never])).toThrow(/string or number/);
  });
});

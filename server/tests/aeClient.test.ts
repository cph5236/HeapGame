import { describe, it, expect, vi } from 'vitest';
import { HttpAeClient } from '../src/platform/analytics/aeClient';

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
});

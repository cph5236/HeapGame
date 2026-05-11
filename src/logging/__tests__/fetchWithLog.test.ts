import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchWithLog } from '../fetchWithLog';
import { setLogger, _resetLoggerForTests } from '../index';

function spy() {
  const errors: any[] = []; const warns: any[] = [];
  setLogger({
    error: (m, c) => errors.push([m, c]),
    warn:  (m, c) => warns.push([m, c]),
    event: () => {}, setVerbose: () => {},
  });
  return { errors, warns };
}

describe('fetchWithLog', () => {
  beforeEach(() => { _resetLoggerForTests(); vi.restoreAllMocks(); });

  it('logs an error on 5xx', async () => {
    const s = spy();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 500 })));
    await fetchWithLog('/x');
    expect(s.errors[0][0]).toBe('fetch 5xx');
    expect(s.errors[0][1].status).toBe(500);
  });

  it('logs a warn on 4xx', async () => {
    const s = spy();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    await fetchWithLog('/x');
    expect(s.warns[0][0]).toBe('fetch 4xx');
  });

  it('logs an error on network throw and rethrows', async () => {
    const s = spy();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('net'); }));
    await expect(fetchWithLog('/x')).rejects.toThrow('net');
    expect(s.errors[0][0]).toBe('fetch failed');
  });

  it('logs a warn on slow success (>3s)', async () => {
    const s = spy();
    let call = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => call++ === 0 ? 0 : 3100);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    await fetchWithLog('/x');
    expect(s.warns[0][0]).toBe('fetch slow');
    expect(s.warns[0][1].durationMs).toBe(3100);
  });

  it('extracts bodySnippet (≤256 chars) from error response', async () => {
    const s = spy();
    const longBody = 'x'.repeat(500);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(longBody, { status: 500 })));
    await fetchWithLog('/x');
    expect(s.errors[0][1].bodySnippet).toHaveLength(256);
  });

  it('still logs 5xx when body read throws', async () => {
    const s = spy();
    const badRes = new Response('ok', { status: 500 });
    vi.spyOn(badRes, 'clone').mockReturnValue({ text: async () => { throw new Error('stream'); } } as any);
    vi.stubGlobal('fetch', vi.fn(async () => badRes));
    await fetchWithLog('/x');
    expect(s.errors[0][0]).toBe('fetch 5xx');
    expect(s.errors[0][1].bodySnippet).toBe('');
  });
});

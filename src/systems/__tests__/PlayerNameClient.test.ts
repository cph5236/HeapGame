import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../authToken', () => ({
  authHeaders: () => ({ 'X-Player-Token': 'secret-test' }),
  logIfAuthRejected: vi.fn(),
}));
const fetchWithLog = vi.fn();
vi.mock('../../logging/fetchWithLog', () => ({
  fetchWithLog: (...args: unknown[]) => fetchWithLog(...args),
}));

import { PlayerNameClient } from '../PlayerNameClient';
import { logIfAuthRejected } from '../authToken';

describe('PlayerNameClient.updateName', () => {
  beforeEach(() => { fetchWithLog.mockReset(); vi.mocked(logIfAuthRejected).mockClear(); });

  it('PUTs to /players/<id>/name with JSON { name } and the X-Player-Token header', async () => {
    fetchWithLog.mockResolvedValue(new Response(JSON.stringify({ name: 'Canon' }), { status: 200 }));
    await PlayerNameClient.updateName('p1', 'Canon');
    const [url, init] = fetchWithLog.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(url).toContain('/players/p1/name');
    expect(init.method).toBe('PUT');
    expect(init.headers['X-Player-Token']).toBe('secret-test');
    expect(JSON.parse(init.body)).toEqual({ name: 'Canon' });
  });

  it('resolves the canonical name on 200', async () => {
    fetchWithLog.mockResolvedValue(new Response(JSON.stringify({ name: 'Canon' }), { status: 200 }));
    const result = await PlayerNameClient.updateName('p1', 'canon  ');
    expect(result).toBe('Canon');
  });

  it('resolves null and logs the rejection on 403', async () => {
    fetchWithLog.mockResolvedValue(new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }));
    const result = await PlayerNameClient.updateName('p1', 'Canon');
    expect(result).toBeNull();
    expect(vi.mocked(logIfAuthRejected)).toHaveBeenCalledWith('players:rename', 403);
  });

  it('resolves null on network failure', async () => {
    fetchWithLog.mockRejectedValue(new Error('offline'));
    const result = await PlayerNameClient.updateName('p1', 'Canon');
    expect(result).toBeNull();
  });
});

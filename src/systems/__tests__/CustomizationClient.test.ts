import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../authToken', () => ({
  authHeaders: () => ({ 'X-Player-Token': 'secret-test' }),
  logIfAuthRejected: vi.fn(),
}));
const fetchWithLog = vi.fn();
vi.mock('../../logging/fetchWithLog', () => ({
  fetchWithLog: (...args: unknown[]) => fetchWithLog(...args),
}));

import { CustomizationClient } from '../CustomizationClient';
import { logIfAuthRejected } from '../authToken';

describe('CustomizationClient.putLoadout', () => {
  beforeEach(() => { fetchWithLog.mockReset(); vi.mocked(logIfAuthRejected).mockClear(); });

  it('sends the X-Player-Token header and returns true on 200', async () => {
    fetchWithLog.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    const ok = await CustomizationClient.putLoadout('p1', { hat: 'hat_cone' });
    expect(ok).toBe(true);
    const init = fetchWithLog.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers['X-Player-Token']).toBe('secret-test');
  });

  it('returns false and reports the rejection on 403', async () => {
    fetchWithLog.mockResolvedValue(new Response('{"error":"forbidden"}', { status: 403 }));
    const ok = await CustomizationClient.putLoadout('p1', { hat: 'hat_cone' });
    expect(ok).toBe(false);
    expect(vi.mocked(logIfAuthRejected)).toHaveBeenCalledWith('customization:put', 403);
  });
});

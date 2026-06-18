import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../logging', () => ({
  getLogEnvelope: () => ({
    userGuid: 'guid-test', sessionId: 'sess-1', appVersion: '1.2.3',
    platform: 'web', userAgent: 'UA',
  }),
}));
const fetchWithLog = vi.fn();
vi.mock('../../logging/fetchWithLog', () => ({
  fetchWithLog: (...args: unknown[]) => fetchWithLog(...args),
}));

import { submitFeedback } from '../FeedbackClient';

function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as { body: string }).body);
}

describe('submitFeedback', () => {
  beforeEach(() => { fetchWithLog.mockReset(); });

  it('builds the full payload for a bug and reports success', async () => {
    fetchWithLog.mockResolvedValue(new Response(null, { status: 204 }));
    const result = await submitFeedback('bug', '  it broke  ', 'heap-1');
    expect(result.status).toBe('success');
    const body = bodyOf(fetchWithLog.mock.calls[0]);
    expect(body).toEqual({
      category: 'bug', message: 'it broke', playerGuid: 'guid-test',
      sessionId: 'sess-1', appVersion: '1.2.3', platform: 'web',
      userAgent: 'UA', heapId: 'heap-1',
    });
  });

  it('passes the suggestion category and null heapId through', async () => {
    fetchWithLog.mockResolvedValue(new Response(null, { status: 204 }));
    await submitFeedback('suggestion', 'idea', null);
    const body = bodyOf(fetchWithLog.mock.calls[0]);
    expect(body.category).toBe('suggestion');
    expect(body.heapId).toBeNull();
  });

  it('rejects an empty message without calling the server', async () => {
    const result = await submitFeedback('bug', '   ', null);
    expect(result.status).toBe('error');
    expect(fetchWithLog).not.toHaveBeenCalled();
  });

  it('reports offline when the request throws', async () => {
    fetchWithLog.mockRejectedValue(new Error('network'));
    expect((await submitFeedback('bug', 'x', null)).status).toBe('offline');
  });

  it('reports error on a non-ok response', async () => {
    fetchWithLog.mockResolvedValue(new Response(null, { status: 400 }));
    expect((await submitFeedback('bug', 'x', null)).status).toBe('error');
  });
});

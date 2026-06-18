import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockFeedbackDB } from './helpers/mockFeedbackDb';

function makeApp(feedbackDb = new MockFeedbackDB(), adminSecret?: string) {
  return { app: createApp(new MockHeapDB(), new MockScoreDB(), { feedbackDb, adminSecret }), feedbackDb };
}

function postReq(body: unknown): Request {
  return new Request('http://x/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const valid = {
  category: 'bug', message: 'it broke', playerGuid: 'g1', sessionId: 's1',
  appVersion: '1.0.0', platform: 'web', userAgent: 'UA', heapId: 'heap-1',
};

describe('POST /feedback', () => {
  it('accepts a valid bug submission and stores it', async () => {
    const { app, feedbackDb } = makeApp();
    const res = await app.fetch(postReq(valid));
    expect(res.status).toBe(204);
    const rows = await feedbackDb.listSince(null);
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('bug');
    expect(rows[0].message).toBe('it broke');
    expect(rows[0].heap_id).toBe('heap-1');
    expect(rows[0].session_id).toBe('s1');
  });

  it('accepts a suggestion', async () => {
    const { app, feedbackDb } = makeApp();
    const res = await app.fetch(postReq({ ...valid, category: 'suggestion' }));
    expect(res.status).toBe(204);
    expect((await feedbackDb.listSince(null))[0].category).toBe('suggestion');
  });

  it('rejects an invalid category', async () => {
    const { app, feedbackDb } = makeApp();
    const res = await app.fetch(postReq({ ...valid, category: 'spam' }));
    expect(res.status).toBe(400);
    expect(await feedbackDb.listSince(null)).toHaveLength(0);
  });

  it('rejects an empty / whitespace message', async () => {
    const { app } = makeApp();
    expect((await app.fetch(postReq({ ...valid, message: '   ' }))).status).toBe(400);
  });

  it('rejects a message over 3000 chars', async () => {
    const { app } = makeApp();
    const res = await app.fetch(postReq({ ...valid, message: 'a'.repeat(3001) }));
    expect(res.status).toBe(400);
  });

  it('trims the message and stores null heapId when absent', async () => {
    const { app, feedbackDb } = makeApp();
    await app.fetch(postReq({ ...valid, message: '  hi  ', heapId: undefined }));
    const [row] = await feedbackDb.listSince(null);
    expect(row.message).toBe('hi');
    expect(row.heap_id).toBeNull();
  });
});

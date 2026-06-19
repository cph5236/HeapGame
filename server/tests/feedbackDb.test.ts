import { describe, it, expect } from 'vitest';
import { MockFeedbackDB } from './helpers/mockFeedbackDb';
import type { NormalizedFeedback } from '../src/feedbackDb';

const base: NormalizedFeedback = {
  category: 'bug', playerGuid: 'g1', sessionId: 's1', message: 'it broke',
  appVersion: '1.0.0', platform: 'web', heapId: null, userAgent: 'UA',
};

describe('MockFeedbackDB', () => {
  it('assigns ascending ids and returns all rows for null cursor', async () => {
    const db = new MockFeedbackDB();
    await db.insert({ ...base, message: 'one' }, '2026-06-18T00:00:00.000Z');
    await db.insert({ ...base, message: 'two' }, '2026-06-18T00:00:00.000Z'); // same timestamp
    const rows = await db.listSince(null);
    expect(rows.map(r => r.id)).toEqual([1, 2]);
    expect(rows.map(r => r.message)).toEqual(['one', 'two']);
  });

  it('listSince filters strictly by id (tie-proof on equal timestamps)', async () => {
    const db = new MockFeedbackDB();
    await db.insert({ ...base, message: 'one' }, 'T');
    await db.insert({ ...base, message: 'two' }, 'T');
    await db.insert({ ...base, message: 'three' }, 'T');
    const rows = await db.listSince(1);
    expect(rows.map(r => r.id)).toEqual([2, 3]);
  });

  it('persists category and heapId', async () => {
    const db = new MockFeedbackDB();
    await db.insert({ ...base, category: 'suggestion', heapId: 'heap-7' }, 'T');
    const [row] = await db.listSince(null);
    expect(row.category).toBe('suggestion');
    expect(row.heap_id).toBe('heap-7');
  });
});

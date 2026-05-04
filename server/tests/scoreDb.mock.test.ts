import { describe, it, expect } from 'vitest';
import { MockScoreDB } from './helpers/mockScoreDb';

describe('MockScoreDB.getPlayerScores', () => {
  it('returns empty array for unknown player', async () => {
    const db = new MockScoreDB();
    db.seed('heap-a', 'other', 'Other', 1000);
    const out = await db.getPlayerScores('unknown');
    expect(out).toEqual([]);
  });

  it('returns one entry per heap the player has scored on, with correct rank', async () => {
    const db = new MockScoreDB();
    // heap-a: player ranks #2 of 3
    db.seed('heap-a', 'top', 'Top', 9000);
    db.seed('heap-a', 'me',  'Me',  5000);
    db.seed('heap-a', 'low', 'Low', 1000);
    // heap-b: player ranks #1 of 1
    db.seed('heap-b', 'me', 'Me', 7000);
    // heap-c: player not present
    db.seed('heap-c', 'other', 'Other', 100);

    const out = await db.getPlayerScores('me');
    const sorted = out.sort((a, b) => a.heapId.localeCompare(b.heapId));
    expect(sorted).toEqual([
      { heapId: 'heap-a', name: 'Me', score: 5000, rank: 2 },
      { heapId: 'heap-b', name: 'Me', score: 7000, rank: 1 },
    ]);
  });

  it('uses RANK() semantics on ties (tied scores share the lower rank)', async () => {
    const db = new MockScoreDB();
    db.seed('heap-a', 'a', 'A', 5000);
    db.seed('heap-a', 'b', 'B', 5000);
    db.seed('heap-a', 'c', 'C', 4000);

    const a = (await db.getPlayerScores('a'))[0];
    const b = (await db.getPlayerScores('b'))[0];
    const c = (await db.getPlayerScores('c'))[0];
    expect(a.rank).toBe(1);
    expect(b.rank).toBe(1);
    expect(c.rank).toBe(3);
  });
});

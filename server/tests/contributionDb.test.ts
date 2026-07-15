import { describe, it, expect } from 'vitest';
import { MockContributionDB } from './helpers/mockContributionDb';

describe('MockContributionDB', () => {
  it('getCount on empty returns 0', async () => {
    const db = new MockContributionDB();
    expect(await db.getCount('heap-a', 'player-1')).toBe(0);
  });

  it('increment once → getCount 1, twice → 2', async () => {
    const db = new MockContributionDB();
    await db.increment('heap-a', 'player-1', '2026-01-01T00:00:00.000Z');
    expect(await db.getCount('heap-a', 'player-1')).toBe(1);
    await db.increment('heap-a', 'player-1', '2026-01-01T00:00:01.000Z');
    expect(await db.getCount('heap-a', 'player-1')).toBe(2);
  });

  it('counts are isolated per (heapId, playerId) pair', async () => {
    const db = new MockContributionDB();
    await db.increment('heap-a', 'player-1', '2026-01-01T00:00:00.000Z');
    await db.increment('heap-a', 'player-2', '2026-01-01T00:00:00.000Z');
    await db.increment('heap-b', 'player-1', '2026-01-01T00:00:00.000Z');

    expect(await db.getCount('heap-a', 'player-1')).toBe(1);
    expect(await db.getCount('heap-a', 'player-2')).toBe(1);
    expect(await db.getCount('heap-b', 'player-1')).toBe(1);
    expect(await db.getCount('heap-b', 'player-2')).toBe(0);
  });
});

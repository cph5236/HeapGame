// server/tests/banDb.test.ts

import { describe, it, expect } from 'vitest';
import { MockBanDB } from './helpers/mockBanDb';

describe('BanDB contract', () => {
  it('isBanned is false for an unknown player', async () => {
    const db = new MockBanDB();
    expect(await db.isBanned('nobody')).toBe(false);
  });

  it('ban then isBanned is true, and get returns the row', async () => {
    const db = new MockBanDB();
    await db.ban('cheater', 'speed hack', '2026-08-16T00:00:00.000Z');
    expect(await db.isBanned('cheater')).toBe(true);
    const row = await db.get('cheater');
    expect(row).toEqual({
      player_id: 'cheater',
      reason:    'speed hack',
      banned_at: '2026-08-16T00:00:00.000Z',
    });
  });

  it('ban is idempotent and overwrites reason and timestamp', async () => {
    const db = new MockBanDB();
    await db.ban('cheater', 'first', '2026-08-16T00:00:00.000Z');
    await db.ban('cheater', 'second', '2026-08-17T00:00:00.000Z');
    expect((await db.list()).length).toBe(1);
    const row = await db.get('cheater');
    expect(row?.reason).toBe('second');
    expect(row?.banned_at).toBe('2026-08-17T00:00:00.000Z');
  });

  it('accepts a null reason', async () => {
    const db = new MockBanDB();
    await db.ban('cheater', null, '2026-08-16T00:00:00.000Z');
    expect((await db.get('cheater'))?.reason).toBeNull();
  });

  it('unban removes the row and is idempotent on an unbanned player', async () => {
    const db = new MockBanDB();
    await db.ban('cheater', null, '2026-08-16T00:00:00.000Z');
    await db.unban('cheater');
    expect(await db.isBanned('cheater')).toBe(false);
    expect(await db.get('cheater')).toBeNull();
    await db.unban('cheater');          // must not throw
    await db.unban('never-banned');     // must not throw
    expect(await db.list()).toEqual([]);
  });

  it('list returns every ban', async () => {
    const db = new MockBanDB();
    await db.ban('a', null, '2026-08-16T00:00:00.000Z');
    await db.ban('b', 'rude', '2026-08-16T00:00:01.000Z');
    expect((await db.list()).map(r => r.player_id).sort()).toEqual(['a', 'b']);
  });
});

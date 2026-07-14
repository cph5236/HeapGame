import { describe, it, expect } from 'vitest';
import { MockPlayerNameDB } from './helpers/mockPlayerNameDb';

describe('MockPlayerNameDB', () => {
  it('getName on unknown player returns null', async () => {
    const db = new MockPlayerNameDB();
    expect(await db.getName('player-1')).toBeNull();
  });

  it('setName then getName returns the name', async () => {
    const db = new MockPlayerNameDB();
    await db.setName('player-1', 'Alice', '2026-01-01T00:00:00.000Z');
    expect(await db.getName('player-1')).toBe('Alice');
  });

  it('setName twice → second name wins (upsert)', async () => {
    const db = new MockPlayerNameDB();
    await db.setName('player-1', 'Alice', '2026-01-01T00:00:00.000Z');
    await db.setName('player-1', 'Bob', '2026-01-01T00:00:01.000Z');
    expect(await db.getName('player-1')).toBe('Bob');
  });
});

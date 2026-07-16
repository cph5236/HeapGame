import { describe, it, expect } from 'vitest';
import { MockDailyDb } from './helpers/mockDailyDb';

describe('MockDailyDb', () => {
  it('get returns null for an unknown player', async () => {
    const db = new MockDailyDb();
    expect(await db.get('p1')).toBeNull();
  });

  it('first record inserts (expected null) and get returns the row', async () => {
    const db = new MockDailyDb();
    expect(await db.record('p1', 1000, -240, 1, null)).toBe(true);
    expect(await db.get('p1')).toEqual({
      player_id: 'p1', last_claim_at: 1000, last_claim_offset_min: -240,
      streak_day: 1, total_claims: 1,
    });
  });

  it('insert loses when a row already exists (two devices, first claim race)', async () => {
    const db = new MockDailyDb();
    await db.record('p1', 1000, 0, 1, null);
    expect(await db.record('p1', 1001, 0, 1, null)).toBe(false);
  });

  it('update succeeds when expectedLastClaimAt matches, and bumps total_claims', async () => {
    const db = new MockDailyDb();
    await db.record('p1', 1000, 0, 1, null);
    expect(await db.record('p1', 2000, 60, 2, 1000)).toBe(true);
    expect(await db.get('p1')).toEqual({
      player_id: 'p1', last_claim_at: 2000, last_claim_offset_min: 60,
      streak_day: 2, total_claims: 2,
    });
  });

  it('update loses when another claim landed in between (stale expected)', async () => {
    const db = new MockDailyDb();
    await db.record('p1', 1000, 0, 1, null);
    await db.record('p1', 2000, 0, 2, 1000);       // device A wins
    expect(await db.record('p1', 2001, 0, 2, 1000)).toBe(false); // device B stale
  });
});

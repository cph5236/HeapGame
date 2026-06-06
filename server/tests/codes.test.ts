import { describe, it, expect } from 'vitest';
import { MockCodeDB } from './helpers/mockCodeDb';

const COINS = {
  code: 'WELCOME', rewardType: 'coins' as const, rewardId: null,
  rewardAmount: 500, maxRedemptions: 0, expiresAt: null,
};

describe('MockCodeDB.redeem', () => {
  it('grants the reward on first redemption', async () => {
    const db = new MockCodeDB();
    await db.createCode(COINS, '2026-06-06T00:00:00.000Z');
    const out = await db.redeem('WELCOME', 'guid-a', '2026-06-06T00:00:01.000Z');
    expect(out).toEqual({ kind: 'ok', reward: { rewardType: 'coins', rewardId: undefined, rewardAmount: 500 } });
  });

  it('returns notFound for an unknown code', async () => {
    const db = new MockCodeDB();
    expect(await db.redeem('NOPE', 'guid-a', '2026-06-06T00:00:00.000Z')).toEqual({ kind: 'notFound' });
  });

  it('returns alreadyRedeemed when the same player redeems twice', async () => {
    const db = new MockCodeDB();
    await db.createCode(COINS, 'now');
    await db.redeem('WELCOME', 'guid-a', 'now');
    expect(await db.redeem('WELCOME', 'guid-a', 'now')).toEqual({ kind: 'alreadyRedeemed' });
  });

  it('returns expired for a past expires_at', async () => {
    const db = new MockCodeDB();
    await db.createCode({ ...COINS, code: 'OLD', expiresAt: '2026-06-01T00:00:00.000Z' }, 'now');
    expect(await db.redeem('OLD', 'guid-a', '2026-06-06T00:00:00.000Z')).toEqual({ kind: 'expired' });
  });

  it('enforces the cap across distinct players (no oversubscription)', async () => {
    const db = new MockCodeDB();
    await db.createCode({ ...COINS, code: 'CAP3', maxRedemptions: 3 }, 'now');
    const outcomes = [];
    for (const g of ['g1', 'g2', 'g3', 'g4']) {
      outcomes.push((await db.redeem('CAP3', g, 'now')).kind);
    }
    expect(outcomes).toEqual(['ok', 'ok', 'ok', 'exhausted']);
    const row = await db.getCode('CAP3');
    expect(row?.redeemed_count).toBe(3);
  });
});

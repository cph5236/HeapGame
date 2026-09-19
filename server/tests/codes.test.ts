import { describe, it, expect } from 'vitest';
import { MockCodeDB } from './helpers/mockCodeDb';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';

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

function makeApp(codeDb = new MockCodeDB(), adminSecret?: string) {
  return createApp(new MockHeapDB(), new MockScoreDB(), { codeDb, adminSecret });
}

describe('POST /codes (admin mint)', () => {
  it('mints a coins code', async () => {
    const app = makeApp();
    const res = await app.request('/codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'welcome', rewardType: 'coins', rewardAmount: 500 }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.code).toBe('WELCOME'); // normalized uppercase
  });

  it('rejects an item code with an unknown reward_id (400)', async () => {
    const app = makeApp();
    const res = await app.request('/codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'BADITEM', rewardType: 'item', rewardId: 'not_a_real_item', rewardAmount: 1 }),
    });
    expect(res.status).toBe(400);
  });

  it('accepts an item code with a valid reward_id', async () => {
    const app = makeApp();
    const res = await app.request('/codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'FREESHIELD', rewardType: 'item', rewardId: 'shield', rewardAmount: 2 }),
    });
    expect(res.status).toBe(201);
  });

  it('rejects a duplicate code (409)', async () => {
    const app = makeApp();
    const mk = () => app.request('/codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'DUP', rewardType: 'coins', rewardAmount: 100 }),
    });
    expect((await mk()).status).toBe(201);
    expect((await mk()).status).toBe(409);
  });

  it('requires the admin secret when one is configured (401)', async () => {
    const app = makeApp(new MockCodeDB(), 's3cret');
    const res = await app.request('/codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'GATED', rewardType: 'coins', rewardAmount: 100 }),
    });
    expect(res.status).toBe(401);
  });
});

describe('PATCH /codes/:code (admin update)', () => {
  async function seed(app: ReturnType<typeof makeApp>, body: object) {
    await app.request('/codes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  }

  it('updates rewardAmount, maxRedemptions and expiresAt', async () => {
    const codeDb = new MockCodeDB();
    const app = makeApp(codeDb);
    await seed(app, { code: 'EDITME', rewardType: 'coins', rewardAmount: 100 });
    const res = await app.request('/codes/EDITME', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rewardAmount: 250, maxRedemptions: 5, expiresAt: '2027-01-01T00:00:00.000Z' }),
    });
    expect(res.status).toBe(200);
    const row = await codeDb.getCode('EDITME');
    expect(row).toMatchObject({ reward_amount: 250, max_redemptions: 5, expires_at: '2027-01-01T00:00:00.000Z' });
  });

  it('leaves fields not in the patch untouched', async () => {
    const codeDb = new MockCodeDB();
    const app = makeApp(codeDb);
    await seed(app, { code: 'PARTIAL', rewardType: 'coins', rewardAmount: 100, maxRedemptions: 3 });
    const res = await app.request('/codes/PARTIAL', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rewardAmount: 999 }),
    });
    expect(res.status).toBe(200);
    const row = await codeDb.getCode('PARTIAL');
    expect(row).toMatchObject({ reward_amount: 999, max_redemptions: 3 });
  });

  it('rejects an invalid rewardAmount (400)', async () => {
    const codeDb = new MockCodeDB();
    const app = makeApp(codeDb);
    await seed(app, { code: 'BADPATCH', rewardType: 'coins', rewardAmount: 100 });
    const res = await app.request('/codes/BADPATCH', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rewardAmount: -1 }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects maxRedemptions below the already-redeemed count (400)', async () => {
    const codeDb = new MockCodeDB();
    const app = makeApp(codeDb);
    await seed(app, { code: 'CAP3', rewardType: 'coins', rewardAmount: 100, maxRedemptions: 3 });
    for (const g of ['g1', 'g2']) {
      await app.request('/codes/redeem', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'CAP3', playerGuid: g }),
      });
    }
    const res = await app.request('/codes/CAP3', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxRedemptions: 1 }),
    });
    expect(res.status).toBe(400);
    const row = await codeDb.getCode('CAP3');
    expect(row?.max_redemptions).toBe(3); // unchanged
  });

  it('returns 404 for an unknown code', async () => {
    const app = makeApp();
    const res = await app.request('/codes/NOPE', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rewardAmount: 10 }),
    });
    expect(res.status).toBe(404);
  });

  it('requires the admin secret when one is configured (401)', async () => {
    const app = makeApp(new MockCodeDB(), 's3cret');
    const res = await app.request('/codes/WHATEVER', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rewardAmount: 10 }),
    });
    expect(res.status).toBe(401);
  });
});

describe('DELETE /codes/:code (admin delete)', () => {
  it('deletes an existing code', async () => {
    const codeDb = new MockCodeDB();
    const app = makeApp(codeDb);
    await app.request('/codes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'GONE', rewardType: 'coins', rewardAmount: 50 }),
    });
    const res = await app.request('/codes/GONE', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await codeDb.getCode('GONE')).toBeNull();
  });

  it('returns 404 for an unknown code', async () => {
    const app = makeApp();
    const res = await app.request('/codes/NOPE', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('purges redemption history so a re-minted same-name code starts clean', async () => {
    const codeDb = new MockCodeDB();
    const app = makeApp(codeDb);
    await app.request('/codes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'REUSED', rewardType: 'coins', rewardAmount: 50 }),
    });
    await codeDb.redeem('REUSED', 'guid-a', 'now');
    await app.request('/codes/REUSED', { method: 'DELETE' });
    await app.request('/codes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'REUSED', rewardType: 'coins', rewardAmount: 75 }),
    });
    // Same player, same code text, but a different code row — must not be
    // treated as already-redeemed against the deleted code's history.
    expect(await codeDb.redeem('REUSED', 'guid-a', 'now')).toEqual({
      kind: 'ok', reward: { rewardType: 'coins', rewardId: undefined, rewardAmount: 75 },
    });
  });

  it('requires the admin secret when one is configured (401)', async () => {
    const app = makeApp(new MockCodeDB(), 's3cret');
    const res = await app.request('/codes/WHATEVER', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });
});

describe('POST /codes/redeem', () => {
  async function seed(app: ReturnType<typeof makeApp>, body: object) {
    await app.request('/codes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  }

  it('redeems a coins code and returns the reward', async () => {
    const codeDb = new MockCodeDB();
    const app = createApp(new MockHeapDB(), new MockScoreDB(), { codeDb });
    await seed(app, { code: 'WELCOME', rewardType: 'coins', rewardAmount: 500 });
    const res = await app.request('/codes/redeem', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'welcome', playerGuid: 'guid-a' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rewardType: 'coins', rewardAmount: 500 });
  });

  it('redeems an item code', async () => {
    const codeDb = new MockCodeDB();
    const app = createApp(new MockHeapDB(), new MockScoreDB(), { codeDb });
    await seed(app, { code: 'SHIELD2', rewardType: 'item', rewardId: 'shield', rewardAmount: 2 });
    const res = await app.request('/codes/redeem', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'SHIELD2', playerGuid: 'guid-a' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rewardType: 'item', rewardId: 'shield', rewardAmount: 2 });
  });

  it('returns 404 for an unknown code', async () => {
    const app = createApp(new MockHeapDB(), new MockScoreDB(), { codeDb: new MockCodeDB() });
    const res = await app.request('/codes/redeem', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'NOPE', playerGuid: 'guid-a' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 409 when the same player redeems twice', async () => {
    const codeDb = new MockCodeDB();
    const app = createApp(new MockHeapDB(), new MockScoreDB(), { codeDb });
    await seed(app, { code: 'ONCE', rewardType: 'coins', rewardAmount: 50 });
    const redeem = () => app.request('/codes/redeem', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ONCE', playerGuid: 'guid-a' }),
    });
    expect((await redeem()).status).toBe(200);
    expect((await redeem()).status).toBe(409);
  });
});

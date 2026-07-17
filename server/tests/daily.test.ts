import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockDailyDb } from './helpers/mockDailyDb';
import { MockConfigDB } from './helpers/mockConfigDb';
import { MockPlayerAuthDB } from './helpers/mockPlayerAuthDb';
import { hashSecret } from '../src/playerAuth';

const H = 3_600_000;
// 2026-07-16T02:00:00Z — 10pm July 15 in New York (offset -240)
const T0 = Date.parse('2026-07-16T02:00:00Z');
const NY = -240;

function makeApp(dailyDb = new MockDailyDb(), configDb?: MockConfigDB, authDb?: MockPlayerAuthDB) {
  return createApp(new MockHeapDB(), new MockScoreDB(), { dailyDb, configDb, playerAuthDb: authDb });
}

function claim(app: ReturnType<typeof createApp>, guid: string, offset: number, resolution?: string, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== undefined) headers['X-Player-Token'] = token;
  return app.request('/daily/claim', {
    method: 'POST',
    headers,
    body: JSON.stringify({ playerGuid: guid, utcOffsetMin: offset, ...(resolution ? { resolution } : {}) }),
  });
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); });
afterEach(() => { vi.useRealTimers(); });

describe('POST /daily/claim', () => {
  it('first claim grants day 1 coins', async () => {
    const app = makeApp();
    const res = await claim(app, 'p1', NY);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe('ok');
    expect(body.streakDay).toBe(1);
    expect(body.rewards).toEqual([{ rewardType: 'coins', rewardAmount: 50 }]);
    expect(body.nextRewardPreview).toEqual([{ type: 'coins', amount: 75 }]);
  });

  it('second claim the same local day is 409 notEligible with nextEligibleAt', async () => {
    const app = makeApp();
    await claim(app, 'p1', NY);
    vi.setSystemTime(T0 + 1 * H);
    const res = await claim(app, 'p1', NY);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.kind).toBe('notEligible');
    expect(typeof body.nextEligibleAt).toBe('number');
  });

  it('east-coast rhythm: 10pm then 3pm next local day grants day 2', async () => {
    const app = makeApp();
    await claim(app, 'p1', NY);
    vi.setSystemTime(T0 + 17 * H);
    const res = await claim(app, 'p1', NY);
    const body = await res.json();
    expect(body.kind).toBe('ok');
    expect(body.streakDay).toBe(2);
  });

  it('past grace: reports streakBroken without granting, then repair continues', async () => {
    const app = makeApp();
    await claim(app, 'p1', NY);
    vi.setSystemTime(T0 + 40 * H);
    const broken = await (await claim(app, 'p1', NY)).json();
    expect(broken).toEqual({ kind: 'streakBroken', repairableDay: 2 });

    const repaired = await (await claim(app, 'p1', NY, 'repair')).json();
    expect(repaired.kind).toBe('ok');
    expect(repaired.streakDay).toBe(2);
  });

  it('past grace with reset restarts at day 1', async () => {
    const app = makeApp();
    await claim(app, 'p1', NY);
    vi.setSystemTime(T0 + 40 * H);
    const body = await (await claim(app, 'p1', NY, 'reset')).json();
    expect(body.kind).toBe('ok');
    expect(body.streakDay).toBe(1);
  });

  it('day 7 grants coins AND the revive item', async () => {
    const db = new MockDailyDb();
    // Seed a player who claimed day 6 yesterday.
    await db.record('p1', T0 - 24 * H, NY, 6, null);
    const app = makeApp(db);
    const body = await (await claim(app, 'p1', NY)).json();
    expect(body.streakDay).toBe(7);
    expect(body.rewards).toHaveLength(2);
    expect(body.rewards[0]).toEqual({ rewardType: 'coins', rewardAmount: 300 });
    expect(body.rewards[1]).toEqual({ rewardType: 'item', rewardId: 'revive', rewardAmount: 1 });
  });

  it('clamps an absurd utcOffsetMin instead of trusting it', async () => {
    const app = makeApp();
    await claim(app, 'p1', NY);
    // A fake offset of 100000 minutes must not create an instant "new day".
    vi.setSystemTime(T0 + 1 * H);
    const res = await claim(app, 'p1', 100000);
    expect(res.status).toBe(409);
  });

  it('rejects a missing guid (400)', async () => {
    const app = makeApp();
    const res = await claim(app, '', NY);
    expect(res.status).toBe(400);
  });

  it('a lost write race returns 409 notEligible', async () => {
    const db = new MockDailyDb();
    // Force the conditional write to fail regardless of inputs.
    db.record = async () => false;
    const app = makeApp(db);
    const res = await claim(app, 'p1', NY);
    expect(res.status).toBe(409);
  });

  it("a lost race reports nextEligibleAt from the winner's claim, not a flat min-gap", async () => {
    const db = new MockDailyDb();
    const winnerAt = T0 + 5 * 60_000; // winner claimed 5 min after our eligibility read
    // First get: no row (we look eligible). After losing the write, the
    // re-read sees the winner's row.
    let reads = 0;
    db.get = async () => (++reads === 1 ? null : {
      player_id: 'p1', last_claim_at: winnerAt, last_claim_offset_min: NY,
      streak_day: 1, total_claims: 1,
    });
    db.record = async () => false;
    const app = makeApp(db);
    const res = await claim(app, 'p1', NY);
    expect(res.status).toBe(409);
    const body = await res.json();
    // Default 10h min gap dominates the next-local-midnight bound here.
    expect(body.nextEligibleAt).toBe(winnerAt + 10 * H);
  });

  it('uses a config-overridden reward table', async () => {
    const cfg = new MockConfigDB();
    await cfg.set('daily_rewards', [
      [{ type: 'coins', amount: 9 }], [{ type: 'coins', amount: 9 }], [{ type: 'coins', amount: 9 }],
      [{ type: 'coins', amount: 9 }], [{ type: 'coins', amount: 9 }], [{ type: 'coins', amount: 9 }],
      [{ type: 'coins', amount: 9 }],
    ], 'now');
    const app = makeApp(new MockDailyDb(), cfg);
    const body = await (await claim(app, 'p1', NY)).json();
    expect(body.rewards).toEqual([{ rewardType: 'coins', rewardAmount: 9 }]);
  });
});

describe('GET /daily/status', () => {
  it('never-claimed player previews day 1', async () => {
    const app = makeApp();
    const res = await app.request(`/daily/status?playerGuid=p1&utcOffsetMin=${NY}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      streakDay: 0, claimedToday: false, nextClaimDay: 1,
      todayGrants: [{ type: 'coins', amount: 50 }],
    });
  });

  it('after claiming, claimedToday is true and the next day previews', async () => {
    const app = makeApp();
    await claim(app, 'p1', NY);
    const body = await (await app.request(`/daily/status?playerGuid=p1&utcOffsetMin=${NY}`)).json();
    expect(body.claimedToday).toBe(true);
    expect(body.streakDay).toBe(1);
    expect(body.nextClaimDay).toBe(2);
  });

  it('rejects a missing guid (400)', async () => {
    const app = makeApp();
    const res = await app.request('/daily/status?utcOffsetMin=0');
    expect(res.status).toBe(400);
  });
});

describe('claim auth', () => {
  const PLAYER = 'player-aaa';
  const SECRET = 'secret-1';

  it('token A claims (TOFU-registers); later token B for the same guid is 403', async () => {
    const authDb = new MockPlayerAuthDB();
    const app = makeApp(new MockDailyDb(), undefined, authDb);

    const first = await claim(app, PLAYER, NY, undefined, SECRET);
    expect(first.status).toBe(200);
    expect(authDb.rows.get(PLAYER)).toBe(await hashSecret(SECRET));

    // Move past the eligibility window so the second claim isn't rejected for
    // being the same local day / within the min-gap — we want to isolate auth.
    vi.setSystemTime(T0 + 17 * H);
    const second = await claim(app, PLAYER, NY, undefined, 'secret-2');
    expect(second.status).toBe(403);
    expect(await second.json()).toEqual({ error: 'forbidden' });
  });
});

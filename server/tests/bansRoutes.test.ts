// server/tests/bansRoutes.test.ts

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockBanDB } from './helpers/mockBanDb';

const SECRET = 's3cret';
const HEAP = 'heap-1';
const AUTH = { 'X-Admin-Secret': SECRET, 'Content-Type': 'application/json' };

function makeApp() {
  const scores = new MockScoreDB();
  const bans   = new MockBanDB();
  scores.attachBanDb(bans);
  scores.seed(HEAP, 'alice',  'Alice',  9800);
  scores.seed(HEAP, 'badguy', 'BadGuy', 8900);
  const app = createApp(new MockHeapDB(), scores, { banDb: bans, adminSecret: SECRET });
  return { app, scores, bans };
}

describe('ban admin routes', () => {
  it('401s every route without the admin secret', async () => {
    const { app } = makeApp();
    expect((await app.request('/bans')).status).toBe(401);
    expect((await app.request('/bans/badguy')).status).toBe(401);
    expect((await app.request('/bans/badguy', { method: 'PUT', body: '{}' })).status).toBe(401);
    expect((await app.request('/bans/badguy', { method: 'DELETE' })).status).toBe(401);
  });

  it('PUT bans a player with a reason', async () => {
    const { app, bans } = makeApp();
    const res = await app.request('/bans/badguy', {
      method: 'PUT', headers: AUTH, body: JSON.stringify({ reason: 'aimbot' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, banned: true });
    expect(await bans.isBanned('badguy')).toBe(true);
    expect((await bans.get('badguy'))?.reason).toBe('aimbot');
  });

  it('PUT with no body bans with a null reason', async () => {
    const { app, bans } = makeApp();
    const res = await app.request('/bans/badguy', { method: 'PUT', headers: AUTH });
    expect(res.status).toBe(200);
    expect((await bans.get('badguy'))?.reason).toBeNull();
  });

  it('PUT is idempotent', async () => {
    const { app, bans } = makeApp();
    await app.request('/bans/badguy', { method: 'PUT', headers: AUTH, body: JSON.stringify({ reason: 'a' }) });
    await app.request('/bans/badguy', { method: 'PUT', headers: AUTH, body: JSON.stringify({ reason: 'b' }) });
    expect((await bans.list()).length).toBe(1);
    expect((await bans.get('badguy'))?.reason).toBe('b');
  });

  it('DELETE unbans, and is idempotent on an unbanned player', async () => {
    const { app, bans } = makeApp();
    await bans.ban('badguy', null, '2026-08-16T00:00:00.000Z');
    const res = await app.request('/bans/badguy', { method: 'DELETE', headers: AUTH });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, banned: false });
    expect(await bans.isBanned('badguy')).toBe(false);
    expect((await app.request('/bans/badguy', { method: 'DELETE', headers: AUTH })).status).toBe(200);
  });

  it('GET /bans lists every ban', async () => {
    const { app, bans } = makeApp();
    await bans.ban('badguy', 'aimbot', '2026-08-16T00:00:00.000Z');
    const res = await app.request('/bans', { headers: AUTH });
    const body = await res.json() as { bans: Array<{ player_id: string; reason: string | null }> };
    expect(body.bans.map(b => b.player_id)).toEqual(['badguy']);
    expect(body.bans[0].reason).toBe('aimbot');
  });

  it('GET /bans/:playerId reports a banned player with name and scores', async () => {
    const { app, bans } = makeApp();
    await bans.ban('badguy', 'aimbot', '2026-08-16T00:00:00.000Z');
    const res = await app.request('/bans/badguy', { headers: AUTH });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      playerId: string; name: string; banned: boolean;
      bannedAt: string | null; reason: string | null;
      scores: Array<{ heapId: string; score: number; rank: number }>;
    };
    expect(body.playerId).toBe('badguy');
    expect(body.name).toBe('BadGuy');
    expect(body.banned).toBe(true);
    expect(body.reason).toBe('aimbot');
    expect(body.bannedAt).toBe('2026-08-16T00:00:00.000Z');
    expect(body.scores).toEqual([{ heapId: HEAP, score: 8900, rank: 2 }]);
  });

  it('GET /bans/:playerId reports an unbanned player', async () => {
    const { app } = makeApp();
    const res = await app.request('/bans/alice', { headers: AUTH });
    const body = await res.json() as { banned: boolean; reason: string | null; bannedAt: string | null };
    expect(body.banned).toBe(false);
    expect(body.reason).toBeNull();
    expect(body.bannedAt).toBeNull();
  });

  it('GET /bans/:playerId works for a player with no scores at all', async () => {
    const { app } = makeApp();
    const res = await app.request('/bans/ghost-id', { headers: AUTH });
    expect(res.status).toBe(200);
    const body = await res.json() as { name: string; scores: unknown[] };
    expect(body.scores).toEqual([]);
    expect(body.name).toBe('Anonymous');
  });

  it('rejects an over-long player id', async () => {
    const { app } = makeApp();
    const long = 'x'.repeat(300);
    const res = await app.request(`/bans/${long}`, { method: 'PUT', headers: AUTH });
    expect(res.status).toBe(400);
  });

  it('is not mounted when banDb is absent', async () => {
    const app = createApp(new MockHeapDB(), new MockScoreDB(), { adminSecret: SECRET });
    expect((await app.request('/bans', { headers: AUTH })).status).toBe(404);
  });
});

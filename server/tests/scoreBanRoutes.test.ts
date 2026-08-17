// server/tests/scoreBanRoutes.test.ts

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockBanDB } from './helpers/mockBanDb';
import type {
  PaginatedLeaderboardResponse,
  LeaderboardContext,
  SubmitScoreResponse,
} from '../../shared/scoreTypes';

const HEAP = 'heap-1';

async function makeApp() {
  const scores = new MockScoreDB();
  const bans   = new MockBanDB();
  scores.attachBanDb(bans);
  scores.seed(HEAP, 'alice',  'Alice',  9800);
  scores.seed(HEAP, 'badguy', 'BadGuy', 8900);
  scores.seed(HEAP, 'carl',   'Carl',   8700);
  await bans.ban('badguy', 'aimbot', '2026-08-16T00:00:00.000Z');
  const app = createApp(new MockHeapDB(), scores, { banDb: bans });
  return { app, scores, bans };
}

describe('GET /scores/:heapId with ban filtering', () => {
  it('hides a banned player from an ordinary viewer and fixes the total', async () => {
    const { app } = await makeApp();
    const res = await app.request(`/scores/${HEAP}?playerId=carl`);
    expect(res.status).toBe(200);
    const body = await res.json() as PaginatedLeaderboardResponse;
    expect(body.entries.map(e => e.playerId)).toEqual(['alice', 'carl']);
    expect(body.total).toBe(2);
  });

  it('hides a banned player when no viewer is supplied', async () => {
    const { app } = await makeApp();
    const res = await app.request(`/scores/${HEAP}`);
    const body = await res.json() as PaginatedLeaderboardResponse;
    expect(body.entries.map(e => e.playerId)).toEqual(['alice', 'carl']);
  });

  it('shows the banned player to themselves, at their true rank', async () => {
    const { app } = await makeApp();
    const res = await app.request(`/scores/${HEAP}?playerId=badguy`);
    const body = await res.json() as PaginatedLeaderboardResponse;
    expect(body.entries.map(e => e.playerId)).toEqual(['alice', 'badguy', 'carl']);
    expect(body.entries.map(e => e.rank)).toEqual([1, 2, 3]);
    expect(body.total).toBe(3);
  });

  it('ranks close up for an ordinary viewer', async () => {
    const { app } = await makeApp();
    const res = await app.request(`/scores/${HEAP}?playerId=carl`);
    const body = await res.json() as PaginatedLeaderboardResponse;
    expect(body.entries.find(e => e.playerId === 'carl')?.rank).toBe(2);
  });
});

describe('GET /scores/:heapId/context with ban filtering', () => {
  it('hides the banned player from another player’s top list', async () => {
    const { app } = await makeApp();
    const res = await app.request(`/scores/${HEAP}/context?playerId=carl&limit=10`);
    const body = await res.json() as LeaderboardContext;
    expect(body.top.map(e => e.playerId)).toEqual(['alice', 'carl']);
    expect(body.player?.rank).toBe(2);
  });

  it('keeps the banned player in their own top list with their original rank', async () => {
    const { app } = await makeApp();
    const res = await app.request(`/scores/${HEAP}/context?playerId=badguy&limit=10`);
    const body = await res.json() as LeaderboardContext;
    expect(body.top.map(e => e.playerId)).toEqual(['alice', 'badguy', 'carl']);
    expect(body.player?.rank).toBe(2);
  });
});

describe('GET /scores/admin/:heapId', () => {
  it('401s without the admin secret when one is configured', async () => {
    const { scores, bans } = await makeApp();
    const app = createApp(new MockHeapDB(), scores, { banDb: bans, adminSecret: 's3cret' });
    const res = await app.request(`/scores/admin/${HEAP}`);
    expect(res.status).toBe(401);
  });

  it('returns every row, banned ones flagged, with the raw total', async () => {
    const { scores, bans } = await makeApp();
    const app = createApp(new MockHeapDB(), scores, { banDb: bans, adminSecret: 's3cret' });
    const res = await app.request(`/scores/admin/${HEAP}`, {
      headers: { 'X-Admin-Secret': 's3cret' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      entries: Array<{ rank: number; playerId: string; name: string; score: number; banned: boolean }>;
      total: number; page: number;
    };
    expect(body.entries.map(e => e.playerId)).toEqual(['alice', 'badguy', 'carl']);
    expect(body.entries.map(e => e.banned)).toEqual([false, true, false]);
    expect(body.total).toBe(3);
    expect(body.page).toBe(0);
  });

  it('paginates', async () => {
    const { scores, bans } = await makeApp();
    const app = createApp(new MockHeapDB(), scores, { banDb: bans, adminSecret: 's3cret' });
    const res = await app.request(`/scores/admin/${HEAP}?page=1&limit=2`, {
      headers: { 'X-Admin-Secret': 's3cret' },
    });
    const body = await res.json() as { entries: Array<{ playerId: string; rank: number }> };
    expect(body.entries.map(e => e.playerId)).toEqual(['carl']);
    expect(body.entries[0].rank).toBe(3);
  });
});

// Submission must be completely unaffected — a 4xx or a missing row here is the
// loudest possible tell that a player has been banned. Fixture mirrors
// server/tests/scores.test.ts.
describe('POST /scores from a banned player', () => {
  const SUBMIT_HEAP = 'heap-test-001';

  function submitBody(playerId: string, baseHeightPx: number) {
    return JSON.stringify({
      heapId:     SUBMIT_HEAP,
      playerId,
      playerName: 'Trashbag#00001',
      inputs: {
        baseHeightPx,
        kills:     { percher: 0, ghost: 0 },
        elapsedMs: 60_000,
        isFailure: true,
      },
    });
  }

  async function submitApp() {
    const scores = new MockScoreDB();
    const bans   = new MockBanDB();
    scores.attachBanDb(bans);
    const heapDb = new MockHeapDB();
    heapDb.seedHeap(SUBMIT_HEAP, 1, []);
    await bans.ban('badguy', 'aimbot', '2026-08-16T00:00:00.000Z');
    return { app: createApp(heapDb, scores, { banDb: bans }), scores, bans };
  }

  it('returns 200 and records the score exactly as for a clean player', async () => {
    const { app, scores } = await submitApp();
    const res = await app.request('/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: submitBody('badguy', 1500),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as SubmitScoreResponse;
    expect(body.submitted).toBe(true);
    expect(await scores.getScore(SUBMIT_HEAP, 'badguy')).not.toBeNull();
  });

  it('returns a context in which the banned player can see themselves', async () => {
    const { app, scores } = await submitApp();
    scores.seed(SUBMIT_HEAP, 'alice', 'Alice', 9800);
    const res = await app.request('/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: submitBody('badguy', 1500),
    });
    const body = await res.json() as SubmitScoreResponse;
    expect(body.context.top.map(e => e.playerId)).toContain('badguy');
    expect(body.context.player).not.toBeNull();
  });

  it('hides the banned player from another player’s submit context', async () => {
    const { app, scores } = await submitApp();
    scores.seed(SUBMIT_HEAP, 'badguy', 'BadGuy', 9800);
    const res = await app.request('/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: submitBody('alice', 1500),
    });
    const body = await res.json() as SubmitScoreResponse;
    expect(body.context.top.map(e => e.playerId)).not.toContain('badguy');
  });
});

// server/tests/scoreViewerAuth.test.ts
//
// The self-visibility carveout — a shadow-banned player still seeing themselves
// on their own board — is granted on the strength of a `playerId` query
// parameter. Player ids are PUBLIC: every leaderboard entry returns one. So
// without proof of identity, anyone who has ever read the board can replay a
// banned player's id and un-hide them, which defeats the ban outright.
//
// These tests pin the rule: the carveout is honoured only for a caller who can
// prove the id is theirs with X-Player-Token.

import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockBanDB } from './helpers/mockBanDb';
import { MockPlayerAuthDB } from './helpers/mockPlayerAuthDb';
import { hashSecret } from '../src/playerAuth';
import { __resetBanMemo } from '../src/cache/MemoBanDB';
import type { PaginatedLeaderboardResponse, LeaderboardContext } from '../../shared/scoreTypes';

const HEAP   = 'heap-1';
const SECRET = 'badguy-secret';

async function makeApp() {
  const scores = new MockScoreDB();
  const bans   = new MockBanDB();
  const auth   = new MockPlayerAuthDB();
  scores.attachBanDb(bans);
  scores.seed(HEAP, 'alice',  'Alice',  9800);
  scores.seed(HEAP, 'badguy', 'BadGuy', 8900);
  scores.seed(HEAP, 'carl',   'Carl',   8700);
  await bans.ban('badguy', 'aimbot', '2026-08-16T00:00:00.000Z');
  // badguy has claimed their id, as any real player who has submitted a score has.
  auth.rows.set('badguy', await hashSecret(SECRET));
  const app = createApp(new MockHeapDB(), scores, { banDb: bans, playerAuthDb: auth });
  return { app, scores, bans, auth };
}

function ids(body: { entries: Array<{ playerId: string }> }): string[] {
  return body.entries.map(e => e.playerId);
}

describe('self-visibility carveout requires proof of identity', () => {
  beforeEach(() => __resetBanMemo());

  it('does NOT honour a banned id supplied without a token', async () => {
    const { app } = await makeApp();
    const res  = await app.request(`/scores/${HEAP}?playerId=badguy`);
    const body = await res.json() as PaginatedLeaderboardResponse;
    expect(ids(body)).toEqual(['alice', 'carl']);
    expect(body.total).toBe(2);
  });

  it('does NOT honour a banned id supplied with the WRONG token', async () => {
    const { app } = await makeApp();
    const res = await app.request(`/scores/${HEAP}?playerId=badguy`, {
      headers: { 'X-Player-Token': 'not-the-secret' },
    });
    const body = await res.json() as PaginatedLeaderboardResponse;
    expect(ids(body)).toEqual(['alice', 'carl']);
  });

  it('DOES honour a banned id supplied with the correct token', async () => {
    const { app } = await makeApp();
    const res = await app.request(`/scores/${HEAP}?playerId=badguy`, {
      headers: { 'X-Player-Token': SECRET },
    });
    const body = await res.json() as PaginatedLeaderboardResponse;
    expect(ids(body)).toEqual(['alice', 'badguy', 'carl']);
    expect(body.total).toBe(3);
  });

  it('applies the same rule on /context', async () => {
    const { app } = await makeApp();

    const spoofed = await (await app.request(
      `/scores/${HEAP}/context?playerId=badguy&limit=10`)).json() as LeaderboardContext;
    expect(spoofed.top.map(e => e.playerId)).toEqual(['alice', 'carl']);

    const genuine = await (await app.request(
      `/scores/${HEAP}/context?playerId=badguy&limit=10`,
      { headers: { 'X-Player-Token': SECRET } })).json() as LeaderboardContext;
    expect(genuine.top.map(e => e.playerId)).toEqual(['alice', 'badguy', 'carl']);
  });

  it('leaves an ordinary viewer untouched with no token — they are visible either way', async () => {
    const { app } = await makeApp();
    const res  = await app.request(`/scores/${HEAP}?playerId=carl`);
    const body = await res.json() as PaginatedLeaderboardResponse;
    expect(ids(body)).toEqual(['alice', 'carl']);
    expect(body.entries.find(e => e.playerId === 'carl')?.rank).toBe(2);
  });

  it('costs an ordinary viewer no auth lookup', async () => {
    const { app, auth } = await makeApp();
    let reads = 0;
    const inner = auth.getSecretHash.bind(auth);
    auth.getSecretHash = async (id: string) => { reads++; return inner(id); };
    await app.request(`/scores/${HEAP}?playerId=carl`, { headers: { 'X-Player-Token': 'anything' } });
    expect(reads).toBe(0);
  });

  it('never claims an unclaimed id — a read must not have write side effects', async () => {
    const { app, auth, bans } = await makeApp();
    await bans.ban('drifter', null, '2026-08-16T00:00:00.000Z');
    expect(await auth.getSecretHash('drifter')).toBeNull();

    await app.request(`/scores/${HEAP}?playerId=drifter`, {
      headers: { 'X-Player-Token': 'attacker-chosen-secret' },
    });

    // verifyOrClaim would have TOFU-claimed this id. A read must not.
    expect(await auth.getSecretHash('drifter')).toBeNull();
  });

  it('denies the carveout to a banned player who has never claimed their id', async () => {
    const { app, scores, bans } = await makeApp();
    scores.seed(HEAP, 'drifter', 'Drifter', 9000);
    await bans.ban('drifter', null, '2026-08-16T00:00:00.000Z');
    const res = await app.request(`/scores/${HEAP}?playerId=drifter`, {
      headers: { 'X-Player-Token': 'anything' },
    });
    const body = await res.json() as PaginatedLeaderboardResponse;
    expect(ids(body)).not.toContain('drifter');
  });

  it('is inert when the ban feature is not wired — legacy behaviour', async () => {
    const scores = new MockScoreDB();
    scores.seed(HEAP, 'alice', 'Alice', 9800);
    const app  = createApp(new MockHeapDB(), scores, {});
    const res  = await app.request(`/scores/${HEAP}?playerId=alice`);
    const body = await res.json() as PaginatedLeaderboardResponse;
    expect(ids(body)).toEqual(['alice']);
  });
});

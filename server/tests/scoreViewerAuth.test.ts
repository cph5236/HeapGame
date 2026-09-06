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
import { hashSecret } from '../src/platform/playerAuth';
import { __resetBanMemo } from '../src/platform/cache/MemoBanDB';
import type {
  PaginatedLeaderboardResponse,
  LeaderboardContext,
  PlayerScoresResponse,
} from '../../shared/scoreTypes';

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

  // Latency parity. The banned and unbanned paths must issue the SAME number of
  // auth reads, or response time distinguishes them to any caller willing to
  // send a throwaway token — the tell this carveout exists to prevent. The
  // earlier version of resolveViewer skipped the read for unbanned viewers to
  // save a D1 round trip; that saving WAS the side channel. Same reasoning as
  // the /place latency-parity fix in e091494.
  function countAuthReads(auth: MockPlayerAuthDB): () => number {
    let reads = 0;
    const inner = auth.getSecretHash.bind(auth);
    auth.getSecretHash = async (id: string) => { reads++; return inner(id); };
    return () => reads;
  }

  it('costs a banned and an unbanned viewer the same auth reads', async () => {
    const a = await makeApp();
    const readsA = countAuthReads(a.auth);
    await a.app.request(`/scores/${HEAP}?playerId=carl`, { headers: { 'X-Player-Token': 'anything' } });

    __resetBanMemo();
    const b = await makeApp();
    const readsB = countAuthReads(b.auth);
    await b.app.request(`/scores/${HEAP}?playerId=badguy`, { headers: { 'X-Player-Token': 'anything' } });

    expect(readsA()).toBe(1);
    expect(readsB()).toBe(readsA());
  });

  it('costs no auth read when no token is offered, banned or not', async () => {
    const { app, auth } = await makeApp();
    const reads = countAuthReads(auth);
    await app.request(`/scores/${HEAP}?playerId=carl`);
    await app.request(`/scores/${HEAP}?playerId=badguy`);
    expect(reads()).toBe(0);
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

// GET /scores/player/:playerId is unauthenticated and takes the id straight
// from the path. It reports the subject's rank computed as if they were
// visible — deliberately, because GET /bans/:playerId reuses the same DB method
// to show an admin the true standing of the player they are judging.
//
// On the PUBLIC route that same true rank is an oracle. Ask it for a banned id
// and it answers "rank 2, score 8900"; ask the public board and rank 2 holds a
// different score and 8900 appears nowhere. Two unauthenticated requests, no
// timing measurement, and the ban is exposed for any id scraped off the board.
//
// The rule below matches the rest of the carveout: an unproven caller sees what
// they would see if the player simply had no scores, which is exactly what the
// public board already shows them.
describe('per-player score route does not leak ban state', () => {
  beforeEach(() => __resetBanMemo());

  type App = Awaited<ReturnType<typeof makeApp>>['app'];

  async function playerScores(app: App, id: string, token?: string): Promise<PlayerScoresResponse> {
    const res = await app.request(
      `/scores/player/${id}`,
      token ? { headers: { 'X-Player-Token': token } } : undefined,
    );
    return await res.json() as PlayerScoresResponse;
  }

  it('returns nothing for a banned id supplied without a token', async () => {
    const { app } = await makeApp();
    expect((await playerScores(app, 'badguy')).entries).toEqual([]);
  });

  it('returns nothing for a banned id supplied with the WRONG token', async () => {
    const { app } = await makeApp();
    expect((await playerScores(app, 'badguy', 'not-the-secret')).entries).toEqual([]);
  });

  it('returns the full self-view for a banned id with the correct token', async () => {
    const { app } = await makeApp();
    const body = await playerScores(app, 'badguy', SECRET);
    expect(body.entries).toEqual([{ heapId: HEAP, rank: 2, score: 8900, name: 'BadGuy' }]);
  });

  it('leaves an ordinary player untouched', async () => {
    const { app } = await makeApp();
    const body = await playerScores(app, 'carl');
    expect(body.entries).toEqual([{ heapId: HEAP, rank: 2, score: 8700, name: 'Carl' }]);
  });

  // The oracle itself, driven end to end: the two responses an attacker would
  // diff must not contradict each other.
  it('agrees with the public board — no rank collision to compare against', async () => {
    const { app } = await makeApp();

    const board = await (await app.request(`/scores/${HEAP}`)).json() as PaginatedLeaderboardResponse;
    const mine  = await playerScores(app, 'badguy');

    // Public board closed up over the hidden player: carl is rank 2 with 8700.
    expect(board.entries.find(e => e.rank === 2)).toMatchObject({ playerId: 'carl', score: 8700 });
    // The per-player route must not now claim rank 2 belongs to an 8900 score.
    expect(mine.entries).toEqual([]);
  });
});

// server/tests/scoreBanFilter.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockBanDB } from './helpers/mockBanDb';

const HEAP = 'heap-1';

/** Alice 9800, BadGuy 8900 (banned), Carl 8700, Dana 8200. */
async function seeded(): Promise<{ scores: MockScoreDB; bans: MockBanDB }> {
  const scores = new MockScoreDB();
  const bans   = new MockBanDB();
  scores.attachBanDb(bans);
  scores.seed(HEAP, 'alice',  'Alice',  9800);
  scores.seed(HEAP, 'badguy', 'BadGuy', 8900);
  scores.seed(HEAP, 'carl',   'Carl',   8700);
  scores.seed(HEAP, 'dana',   'Dana',   8200);
  await bans.ban('badguy', 'aimbot', '2026-08-16T00:00:00.000Z');
  return { scores, bans };
}

describe('ScoreDB ban filtering', () => {
  it('getTopScores hides a banned player from an ordinary viewer', async () => {
    const { scores } = await seeded();
    const rows = await scores.getTopScores(HEAP, 10, 'carl');
    expect(rows.map(r => r.player_id)).toEqual(['alice', 'carl', 'dana']);
  });

  it('getTopScores hides a banned player when there is no viewer at all', async () => {
    const { scores } = await seeded();
    const rows = await scores.getTopScores(HEAP, 10);
    expect(rows.map(r => r.player_id)).toEqual(['alice', 'carl', 'dana']);
  });

  it('getTopScores keeps the banned player for their own viewer id', async () => {
    const { scores } = await seeded();
    const rows = await scores.getTopScores(HEAP, 10, 'badguy');
    expect(rows.map(r => r.player_id)).toEqual(['alice', 'badguy', 'carl', 'dana']);
  });

  it('getScoresPaginated hides the banned player and does not leave a hole', async () => {
    const { scores } = await seeded();
    const page = await scores.getScoresPaginated(HEAP, 0, 2, 'carl');
    expect(page.map(r => r.player_id)).toEqual(['alice', 'carl']);
  });

  it('getScoresPaginated keeps the banned player for their own viewer id', async () => {
    const { scores } = await seeded();
    const page = await scores.getScoresPaginated(HEAP, 0, 2, 'badguy');
    expect(page.map(r => r.player_id)).toEqual(['alice', 'badguy']);
  });

  it('countScores excludes banned rows, but counts the viewer themselves', async () => {
    const { scores } = await seeded();
    expect(await scores.countScores(HEAP, 'carl')).toBe(3);
    expect(await scores.countScores(HEAP)).toBe(3);
    expect(await scores.countScores(HEAP, 'badguy')).toBe(4);
  });

  it('getRank closes up over a hidden player for everyone else', async () => {
    const { scores } = await seeded();
    // Carl (8700) sits behind Alice and BadGuy, but BadGuy is hidden -> rank 2.
    expect(await scores.getRank(HEAP, 8700, 'carl')).toBe(2);
  });

  it('getRank gives the banned player their original rank', async () => {
    const { scores } = await seeded();
    expect(await scores.getRank(HEAP, 8900, 'badguy')).toBe(2);
  });

  it('getPlayerScores ranks the banned player as if they were visible', async () => {
    const { scores } = await seeded();
    const rows = await scores.getPlayerScores('badguy');
    expect(rows).toEqual([{ heapId: HEAP, name: 'BadGuy', score: 8900, rank: 2 }]);
  });

  it('getPlayerScores hides other banned players from an ordinary player', async () => {
    const { scores } = await seeded();
    const rows = await scores.getPlayerScores('carl');
    expect(rows).toEqual([{ heapId: HEAP, name: 'Carl', score: 8700, rank: 2 }]);
  });

  it('countAllScores and listScoresForAdmin see everything, flagged', async () => {
    const { scores } = await seeded();
    expect(await scores.countAllScores(HEAP)).toBe(4);
    const rows = await scores.listScoresForAdmin(HEAP, 0, 10);
    expect(rows.map(r => r.player_id)).toEqual(['alice', 'badguy', 'carl', 'dana']);
    expect(rows.map(r => r.banned)).toEqual([false, true, false, false]);
  });

  it('unbanning restores the player for everyone', async () => {
    const { scores, bans } = await seeded();
    await bans.unban('badguy');
    const rows = await scores.getTopScores(HEAP, 10, 'carl');
    expect(rows.map(r => r.player_id)).toEqual(['alice', 'badguy', 'carl', 'dana']);
  });
});

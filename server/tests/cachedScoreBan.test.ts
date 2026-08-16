// server/tests/cachedScoreBan.test.ts
//
// Verifies CachedScoreDB.getTopScores bypasses the shared KV cache only for a
// viewer who is themselves banned, and that the cached public blob never
// contains a banned player.

import { describe, it, expect, beforeEach } from 'vitest';
import { CachedScoreDB } from '../src/cache/CachedScoreDB';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockBanDB } from './helpers/mockBanDb';
import { MockKV } from './helpers/mockKv';
import { __resetBanMemo } from '../src/cache/MemoBanDB';

// Mirror the KV fake used in cacheDecorators.test.ts.
const noWait = (_p: Promise<unknown>) => {};

const HEAP = 'heap-1';

function seeded() {
  const scores = new MockScoreDB();
  const bans   = new MockBanDB();
  scores.attachBanDb(bans);
  scores.seed(HEAP, 'alice',  'Alice',  9800);
  scores.seed(HEAP, 'badguy', 'BadGuy', 8900);
  scores.seed(HEAP, 'carl',   'Carl',   8700);
  return { scores, bans };
}

describe('CachedScoreDB ban awareness', () => {
  beforeEach(() => __resetBanMemo());

  it('serves an ordinary viewer from the shared cache', async () => {
    const { scores, bans } = seeded();
    const kv = new MockKV();
    const cached = new CachedScoreDB(scores, kv.asKV(), noWait, bans);
    await cached.getTopScores(HEAP, 10, 'carl');       // populates
    const rows = await cached.getTopScores(HEAP, 10, 'carl');
    expect(rows.map(r => r.player_id)).toEqual(['alice', 'badguy', 'carl']);
    expect(kv.store.size).toBe(1);                     // the public blob exists
  });

  it('a banned viewer bypasses the cache and sees themselves', async () => {
    const { scores, bans } = seeded();
    await bans.ban('badguy', 'aimbot', '2026-08-16T00:00:00.000Z');
    const kv = new MockKV();
    const cached = new CachedScoreDB(scores, kv.asKV(), noWait, bans);
    // Warm the public blob from an ordinary viewer first.
    await cached.getTopScores(HEAP, 10, 'carl');
    const rows = await cached.getTopScores(HEAP, 10, 'badguy');
    expect(rows.map(r => r.player_id)).toEqual(['alice', 'badguy', 'carl']);
  });

  it('the cached public blob never contains a banned player', async () => {
    const { scores, bans } = seeded();
    await bans.ban('badguy', 'aimbot', '2026-08-16T00:00:00.000Z');
    const kv = new MockKV();
    const cached = new CachedScoreDB(scores, kv.asKV(), noWait, bans);
    const rows = await cached.getTopScores(HEAP, 10, 'carl');
    expect(rows.map(r => r.player_id)).toEqual(['alice', 'carl']);
  });

  it('an anonymous read still uses the cache', async () => {
    const { scores, bans } = seeded();
    const kv = new MockKV();
    const cached = new CachedScoreDB(scores, kv.asKV(), noWait, bans);
    await cached.getTopScores(HEAP, 10);
    expect(kv.store.size).toBe(1);
  });
});

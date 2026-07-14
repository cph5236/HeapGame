// Route-level tests for player_contribution ticking on POST /heaps/:id/place.
// Mirrors the app/heap seeding pattern in placeAuth.test.ts.

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockPlayerAuthDB } from './helpers/mockPlayerAuthDb';
import { MockContributionDB } from './helpers/mockContributionDb';
import { MockSink } from './helpers/mockSink';
import { DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';
import type { ContributionDB } from '../src/contributionDb';

const HEAP_ID = 'h1';
const PLAYER = 'player-aaa';
const SECRET = 'secret-1';

// ghostPointCount: 0 keeps placements deterministic — see placeAuth.test.ts.
const NO_GHOST_PARAMS = { ...DEFAULT_HEAP_PARAMS, ghostPointCount: 0 };

function makeApp(opts: {
  authDb?: MockPlayerAuthDB | undefined;
  contributionDb?: ContributionDB | undefined;
} = {}) {
  const authDb = 'authDb' in opts ? opts.authDb : new MockPlayerAuthDB();
  const contributionDb = 'contributionDb' in opts ? opts.contributionDb : new MockContributionDB();
  const sink = new MockSink();
  const heapDb = new MockHeapDB();
  heapDb.seedHeap(HEAP_ID, 1, [], 'base-1', 0, NO_GHOST_PARAMS);
  heapDb.seedBase('base-1', HEAP_ID, []);
  const app = createApp(heapDb, new MockScoreDB(), {
    playerAuthDb: authDb,
    contributionDb,
    logSink: sink,
  });
  return { app, heapDb, authDb, contributionDb, sink };
}

function placeBody(extra: Record<string, unknown> = {}) {
  return { x: 400, y: 100, ...extra };
}

async function place(app: ReturnType<typeof makeApp>['app'], body: unknown, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== undefined) headers['X-Player-Token'] = token;
  return app.request(`/heaps/${HEAP_ID}/place`, { method: 'POST', headers, body: JSON.stringify(body) });
}

describe('POST /heaps/:id/place contribution tick', () => {
  it('guid + token accepted placement → count 1; second valid placement → count 2', async () => {
    const { app, contributionDb } = makeApp();
    const res1 = await place(app, placeBody({ playerGuid: PLAYER }), SECRET);
    expect(res1.status).toBe(200);
    expect(await (contributionDb as MockContributionDB).getCount(HEAP_ID, PLAYER)).toBe(1);

    // The active zone's bottom bound shrinks to the first placement's y, so
    // the second placement must sit above it (mirrors placeAuth.test.ts).
    const res2 = await place(app, placeBody({ playerGuid: PLAYER, x: 420, y: 90 }), SECRET);
    expect(res2.status).toBe(200);
    expect(await (contributionDb as MockContributionDB).getCount(HEAP_ID, PLAYER)).toBe(2);
  });

  it('guid, no token, unclaimed (legacy allow) → accepted, count stays 0', async () => {
    const { app, contributionDb } = makeApp();
    const res = await place(app, placeBody({ playerGuid: PLAYER }));
    expect(res.status).toBe(200);
    expect(await (contributionDb as MockContributionDB).getCount(HEAP_ID, PLAYER)).toBe(0);
  });

  it('no guid at all → accepted, count 0', async () => {
    const { app, contributionDb } = makeApp();
    const res = await place(app, placeBody());
    expect(res.status).toBe(200);
    expect(await (contributionDb as MockContributionDB).getCount(HEAP_ID, PLAYER)).toBe(0);
  });

  it('placement rejected 400 (x out of zone) with guid+token → count 0', async () => {
    const { app, contributionDb } = makeApp();
    const res = await place(app, placeBody({ playerGuid: PLAYER, x: 10 }), SECRET);
    expect(res.status).toBe(400);
    expect(await (contributionDb as MockContributionDB).getCount(HEAP_ID, PLAYER)).toBe(0);
  });

  it('accepted:false (point inside existing polygon) → no tick', async () => {
    // Seed the live zone as a closed square (mirrors routes.test.ts's
    // "rejects a point inside the polygon" pattern) so a single placement
    // request lands inside it deterministically — no reliance on a prior
    // accepted placement or ghost-point jitter.
    const square = [
      { x: 200, y: 0 }, { x: 400, y: 0 },
      { x: 400, y: 100 }, { x: 200, y: 100 },
    ];
    const heapDb = new MockHeapDB();
    heapDb.seedHeap(HEAP_ID, 1, square, 'base-1', 0, NO_GHOST_PARAMS);
    heapDb.seedBase('base-1', HEAP_ID, []);
    const contributionDb = new MockContributionDB();
    const app = createApp(heapDb, new MockScoreDB(), {
      playerAuthDb: new MockPlayerAuthDB(),
      contributionDb,
      logSink: new MockSink(),
    });

    const res = await place(app, placeBody({ playerGuid: PLAYER, x: 300, y: 50 }), SECRET);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ accepted: false });
    expect(await contributionDb.getCount(HEAP_ID, PLAYER)).toBe(0);
  });

  it('app built WITHOUT authDb → guid+token place accepted but count stays 0 (unverified token must not tick)', async () => {
    const { app, contributionDb } = makeApp({ authDb: undefined });
    const res = await place(app, placeBody({ playerGuid: PLAYER }), SECRET);
    expect(res.status).toBe(200);
    expect(await contributionDb!.getCount(HEAP_ID, PLAYER)).toBe(0);
  });

  it('app built WITHOUT contributionDb → guid+token place still 200 accepted', async () => {
    const { app } = makeApp({ contributionDb: undefined });
    const res = await place(app, placeBody({ playerGuid: PLAYER }), SECRET);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ accepted: true });
  });

  it('increment throwing → place still returns 200 accepted:true', async () => {
    const throwing: ContributionDB = {
      async increment() { throw new Error('boom'); },
      async getCount() { return 0; },
    };
    const { app } = makeApp({ contributionDb: throwing });
    const res = await place(app, placeBody({ playerGuid: PLAYER }), SECRET);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ accepted: true });
  });
});

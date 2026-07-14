// Route-level tests for player write-auth on POST /heaps/:id/place.
// Mirrors the verifyOrClaim matrix already covered for /scores and
// /customization in authEnforcement.test.ts — see that file for the pattern.

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockPlayerAuthDB } from './helpers/mockPlayerAuthDb';
import { MockSink } from './helpers/mockSink';
import { hashSecret } from '../src/playerAuth';
import { DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';

const HEAP_ID = 'h1';
const PLAYER = 'player-aaa';
const SECRET = 'secret-1';

// ghostPointCount: 0 keeps placements deterministic — the route jitters in a
// random extra point per accepted placement otherwise, which can shift the
// live zone bounds and make a second hardcoded placement flakily rejected.
const NO_GHOST_PARAMS = { ...DEFAULT_HEAP_PARAMS, ghostPointCount: 0 };

function makeApp(authDb: MockPlayerAuthDB | undefined = new MockPlayerAuthDB(), sink = new MockSink()) {
  const heapDb = new MockHeapDB();
  heapDb.seedHeap(HEAP_ID, 1, [], 'base-1', 0, NO_GHOST_PARAMS);
  heapDb.seedBase('base-1', HEAP_ID, []);
  const app = createApp(heapDb, new MockScoreDB(), {
    playerAuthDb: authDb,
    logSink: sink,
  });
  return { app, heapDb, authDb, sink };
}

function placeBody(extra: Record<string, unknown> = {}) {
  return { x: 400, y: 100, ...extra };
}

async function place(app: ReturnType<typeof makeApp>['app'], body: unknown, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== undefined) headers['X-Player-Token'] = token;
  return app.request(`/heaps/${HEAP_ID}/place`, { method: 'POST', headers, body: JSON.stringify(body) });
}

describe('POST /heaps/:id/place auth', () => {
  it('guid + token, unclaimed: claims and accepts', async () => {
    const { app, authDb } = makeApp();
    const res = await place(app, placeBody({ playerGuid: PLAYER }), SECRET);
    expect(res.status).toBe(200);
    expect(authDb!.rows.get(PLAYER)).toBe(await hashSecret(SECRET));
  });

  it('guid + token, claimed match: accepts', async () => {
    const { app } = makeApp();
    await place(app, placeBody({ playerGuid: PLAYER, x: 400, y: 100 }), SECRET);
    // The active zone's bottom bound shrinks to the first placement's y (its
    // only live-zone vertex so far), so the second placement must sit above it.
    const res = await place(app, placeBody({ playerGuid: PLAYER, x: 420, y: 90 }), SECRET);
    expect(res.status).toBe(200);
  });

  it('guid + token, claimed mismatch: 403 forbidden', async () => {
    const { app } = makeApp();
    await place(app, placeBody({ playerGuid: PLAYER, x: 400, y: 100 }), SECRET);
    // y must stay above the shrunken active zone (see 'claimed match' note):
    // auth now runs after placement validation, so an out-of-zone coordinate
    // would 400 before the mismatch could 403.
    const res = await place(app, placeBody({ playerGuid: PLAYER, x: 420, y: 90 }), 'secret-2');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('guid, no token, unclaimed: accepts (legacy row of matrix)', async () => {
    const { app } = makeApp();
    const res = await place(app, placeBody({ playerGuid: PLAYER }));
    expect(res.status).toBe(200);
  });

  it('guid, no token, claimed: 403', async () => {
    const { app } = makeApp();
    await place(app, placeBody({ playerGuid: PLAYER, x: 400, y: 100 }), SECRET);
    const res = await place(app, placeBody({ playerGuid: PLAYER, x: 420, y: 90 }));
    expect(res.status).toBe(403);
  });

  it('no guid at all: accepts (legacy passthrough, auth DB untouched)', async () => {
    const { app, authDb } = makeApp();
    const res = await place(app, placeBody());
    expect(res.status).toBe(200);
    expect(authDb!.rows.size).toBe(0);
  });

  it("playerGuid: '' → 400", async () => {
    const { app } = makeApp();
    const res = await place(app, placeBody({ playerGuid: '' }));
    expect(res.status).toBe(400);
  });

  it('playerGuid too long (65 chars) → 400', async () => {
    const { app } = makeApp();
    const res = await place(app, placeBody({ playerGuid: 'x'.repeat(65) }));
    expect(res.status).toBe(400);
  });

  it('playerGuid non-string → 400', async () => {
    const { app } = makeApp();
    const res = await place(app, placeBody({ playerGuid: 123 }));
    expect(res.status).toBe(400);
  });

  it('no authDb wired + guid+token: accepts (feature not wired = legacy)', async () => {
    const { app } = makeApp(undefined);
    const res = await place(app, placeBody({ playerGuid: PLAYER }), SECRET);
    expect(res.status).toBe(200);
  });

  // Claim ordering: a request that fails placement validation must never claim
  // the playerGuid as a side effect (mirrors the /scores "verify-or-claim
  // before any state change" ordering).
  it('nonexistent heap + fresh guid+token: 404 and NO claim', async () => {
    const { app, authDb } = makeApp();
    const res = await app.request('/heaps/no-such-heap/place', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Player-Token': SECRET },
      body:    JSON.stringify(placeBody({ playerGuid: PLAYER })),
    });
    expect(res.status).toBe(404);
    expect(authDb!.rows.size).toBe(0);
  });

  it('x out of center zone + fresh guid+token: 400 and NO claim', async () => {
    const { app, authDb } = makeApp();
    const res = await place(app, placeBody({ playerGuid: PLAYER, x: 10 }), SECRET);
    expect(res.status).toBe(400);
    expect(authDb!.rows.size).toBe(0);
  });

  it('y below active zone + fresh guid+token: 400 and NO claim', async () => {
    const { app, authDb } = makeApp();
    const res = await place(app, placeBody({ playerGuid: PLAYER, y: 9000 }), SECRET);
    expect(res.status).toBe(400);
    expect(authDb!.rows.size).toBe(0);
  });
});

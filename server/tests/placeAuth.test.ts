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

const HEAP_ID = 'h1';
const PLAYER = 'player-aaa';
const SECRET = 'secret-1';

function makeApp(authDb: MockPlayerAuthDB | undefined = new MockPlayerAuthDB(), sink = new MockSink()) {
  const heapDb = new MockHeapDB();
  heapDb.seedHeap(HEAP_ID, 1, [], 'base-1');
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
    const res = await place(app, placeBody({ playerGuid: PLAYER, x: 420, y: 110 }), SECRET);
    expect(res.status).toBe(200);
  });

  it('guid + token, claimed mismatch: 403 forbidden', async () => {
    const { app } = makeApp();
    await place(app, placeBody({ playerGuid: PLAYER, x: 400, y: 100 }), SECRET);
    const res = await place(app, placeBody({ playerGuid: PLAYER, x: 420, y: 110 }), 'secret-2');
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
    const res = await place(app, placeBody({ playerGuid: PLAYER, x: 420, y: 110 }));
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
});

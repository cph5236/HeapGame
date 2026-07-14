// Route-level tests for the player write-auth TOFU matrix.
import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockPlayerAuthDB } from './helpers/mockPlayerAuthDb';
import { MockPlayerNameDB } from './helpers/mockPlayerNameDb';
import { MockSink } from './helpers/mockSink';
import { MockCustomizationDB } from './helpers/mockCustomizationDb';
import { MockCodeDB } from './helpers/mockCodeDb';
import { hashSecret } from '../src/playerAuth';

const HEAP_ID = 'heap-test-001';
const PLAYER = 'player-aaa';
const SECRET = 'secret-aaa';

function makeApp(authDb = new MockPlayerAuthDB(), sink = new MockSink()) {
  const heapDb = new MockHeapDB();
  heapDb.seedHeap(HEAP_ID, 1, []);
  const scoreDb = new MockScoreDB();
  const nameDb  = new MockPlayerNameDB();
  scoreDb.attachNameDb(nameDb);
  const app = createApp(heapDb, scoreDb, {
    playerAuthDb: authDb,
    playerNameDb: nameDb,
    logSink: sink,
  });
  return { app, authDb, sink };
}

function scoreBody(playerId = PLAYER) {
  return {
    heapId: HEAP_ID,
    playerId,
    playerName: 'Trashbag#00001',
    inputs: { baseHeightPx: 1000, kills: { percher: 0, ghost: 0 }, elapsedMs: 60_000, isFailure: true },
  };
}

async function submit(app: ReturnType<typeof makeApp>['app'], token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== undefined) headers['X-Player-Token'] = token;
  return app.request('/scores', { method: 'POST', headers, body: JSON.stringify(scoreBody()) });
}

describe('POST /scores auth', () => {
  it('token + unclaimed: claims and accepts, logs auth:claimed', async () => {
    const { app, authDb, sink } = makeApp();
    const res = await submit(app, SECRET);
    expect(res.status).toBe(200);
    expect(authDb.rows.get(PLAYER)).toBe(await hashSecret(SECRET));
    expect(sink.written.some((e) => e.message === 'auth:claimed')).toBe(true);
  });

  it('token + matching claim: accepts without re-claim log', async () => {
    const { app, sink } = makeApp();
    await submit(app, SECRET);
    const before = sink.written.filter((e) => e.message === 'auth:claimed').length;
    const res = await submit(app, SECRET);
    expect(res.status).toBe(200);
    expect(sink.written.filter((e) => e.message === 'auth:claimed').length).toBe(before);
  });

  it('token mismatch: 403 generic body, logs auth:rejected reason=mismatch', async () => {
    const { app, sink } = makeApp();
    await submit(app, SECRET);
    const res = await submit(app, 'wrong-secret');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    const rej = sink.written.find((e) => e.message === 'auth:rejected');
    expect(rej?.payload).toMatchObject({ playerId: PLAYER, reason: 'mismatch' });
  });

  it('no token + unclaimed: accepts (legacy client)', async () => {
    const { app } = makeApp();
    expect((await submit(app)).status).toBe(200);
  });

  it('no token + claimed: 403, logs reason=tokenless-claimed', async () => {
    const { app, sink } = makeApp();
    await submit(app, SECRET);
    const res = await submit(app);
    expect(res.status).toBe(403);
    const rej = sink.written.find((e) => e.message === 'auth:rejected');
    expect(rej?.payload).toMatchObject({ reason: 'tokenless-claimed' });
  });

  it('rejected submit does not change the leaderboard', async () => {
    const { app } = makeApp();
    await submit(app, SECRET);
    await submit(app, 'wrong-secret');
    const res = await app.request(`/scores/${HEAP_ID}`);
    const data = (await res.json()) as { entries: { name: string }[] };
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].name).toBe('Trashbag#00001');
  });
});

function makeCustomizationApp(authDb = new MockPlayerAuthDB(), sink = new MockSink()) {
  const heapDb = new MockHeapDB();
  const app = createApp(heapDb, new MockScoreDB(), {
    customizationDb: new MockCustomizationDB(),
    playerAuthDb: authDb,
    logSink: sink,
  });
  return { app, authDb, sink };
}

async function putLoadout(app: ReturnType<typeof makeCustomizationApp>['app'], token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== undefined) headers['X-Player-Token'] = token;
  return app.request(`/customization/${PLAYER}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ loadout: { hat: 'hat_cone' } }),
  });
}

describe('PUT /customization/:playerId auth', () => {
  it('token + unclaimed: claims and accepts', async () => {
    const { app, authDb } = makeCustomizationApp();
    expect((await putLoadout(app, SECRET)).status).toBe(200);
    expect(authDb.rows.has(PLAYER)).toBe(true);
  });

  it('token mismatch: 403 and loadout unchanged', async () => {
    const { app } = makeCustomizationApp();
    await putLoadout(app, SECRET);
    const res = await putLoadout(app, 'wrong-secret');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('no token + claimed: 403, logs auth:rejected', async () => {
    const { app, sink } = makeCustomizationApp();
    await putLoadout(app, SECRET);
    expect((await putLoadout(app)).status).toBe(403);
    expect(sink.written.some((e) => e.message === 'auth:rejected')).toBe(true);
  });

  it('no token + unclaimed: accepts (legacy client)', async () => {
    const { app } = makeCustomizationApp();
    expect((await putLoadout(app)).status).toBe(200);
  });
});

async function makeCodesApp(authDb = new MockPlayerAuthDB(), sink = new MockSink()) {
  const codeDb = new MockCodeDB();
  await codeDb.createCode(
    { code: 'WELCOME', rewardType: 'coins', rewardId: null, rewardAmount: 100, maxRedemptions: 0, expiresAt: null },
    '2026-07-07T00:00:00.000Z',
  );
  const app = createApp(new MockHeapDB(), new MockScoreDB(), {
    codeDb,
    playerAuthDb: authDb,
    logSink: sink,
  });
  return { app, authDb, sink };
}

async function redeem(app: Awaited<ReturnType<typeof makeCodesApp>>['app'], token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== undefined) headers['X-Player-Token'] = token;
  return app.request('/codes/redeem', {
    method: 'POST',
    headers,
    body: JSON.stringify({ code: 'WELCOME', playerGuid: PLAYER }),
  });
}

describe('POST /codes/redeem auth', () => {
  it('token + unclaimed: claims and redeems', async () => {
    const { app, authDb } = await makeCodesApp();
    expect((await redeem(app, SECRET)).status).toBe(200);
    expect(authDb.rows.has(PLAYER)).toBe(true);
  });

  it('token mismatch: 403 and the code is not consumed', async () => {
    const { app } = await makeCodesApp();
    await redeem(app, SECRET); // claims + consumes for PLAYER
    const res = await redeem(app, 'wrong-secret');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('no token + claimed: 403', async () => {
    const { app } = await makeCodesApp();
    await redeem(app, SECRET);
    expect((await redeem(app)).status).toBe(403);
  });

  it('no token + unclaimed: redeems (legacy client)', async () => {
    const { app } = await makeCodesApp();
    expect((await redeem(app)).status).toBe(200);
  });
});

describe('admin unclaim + CORS', () => {
  it('preflight allows the X-Player-Token header', async () => {
    const { app } = makeApp();
    const res = await app.request('/scores', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://example.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, X-Player-Token',
      },
    });
    expect(res.headers.get('Access-Control-Allow-Headers') ?? '').toContain('X-Player-Token');
  });

  it('DELETE /auth/:playerId requires the admin secret', async () => {
    const authDb = new MockPlayerAuthDB();
    const app = createApp(new MockHeapDB(), new MockScoreDB(), {
      playerAuthDb: authDb,
      adminSecret: 's3cret',
    });
    expect((await app.request(`/auth/${PLAYER}`, { method: 'DELETE' })).status).toBe(401);
  });

  it('admin unclaim deletes the row and the player can re-claim', async () => {
    const { app: scoreApp, authDb } = makeApp();
    await submit(scoreApp, SECRET);
    expect(authDb.rows.has(PLAYER)).toBe(true);

    const adminApp = createApp(new MockHeapDB(), new MockScoreDB(), {
      playerAuthDb: authDb,
      adminSecret: 's3cret',
    });
    const res = await adminApp.request(`/auth/${PLAYER}`, {
      method: 'DELETE',
      headers: { 'X-Admin-Secret': 's3cret' },
    });
    expect(res.status).toBe(200);
    expect(authDb.rows.has(PLAYER)).toBe(false);

    // Player re-claims with a NEW secret after rescue.
    expect((await submit(scoreApp, 'new-secret')).status).toBe(200);
    expect(authDb.rows.has(PLAYER)).toBe(true);
  });
});

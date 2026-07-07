// Route-level tests for the player write-auth TOFU matrix.
import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockPlayerAuthDB } from './helpers/mockPlayerAuthDb';
import { MockSink } from './helpers/mockSink';
import { hashSecret } from '../src/playerAuth';

const HEAP_ID = 'heap-test-001';
const PLAYER = 'player-aaa';
const SECRET = 'secret-aaa';

function makeApp(authDb = new MockPlayerAuthDB(), sink = new MockSink()) {
  const heapDb = new MockHeapDB();
  heapDb.seedHeap(HEAP_ID, 1, []);
  const app = createApp(heapDb, new MockScoreDB(), {
    playerAuthDb: authDb,
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

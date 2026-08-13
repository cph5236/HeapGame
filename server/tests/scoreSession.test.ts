// server/tests/scoreSession.test.ts

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockPlayerAuthDB } from './helpers/mockPlayerAuthDb';
import type { OpenSessionResponse } from '../../shared/scoreTypes';

const HEAP_ID = 'heap-test-001';
const PLAYER  = 'player-aaa';
const SECRET  = 'test-session-secret';

function makeApp(opts: { sessionSecret?: string; authDb?: MockPlayerAuthDB } = {}) {
  const heapDb = new MockHeapDB();
  heapDb.seedHeap(HEAP_ID, 1, []);
  return createApp(heapDb, new MockScoreDB(), {
    sessionSecret: opts.sessionSecret,
    playerAuthDb:  opts.authDb,
  });
}

function openSession(
  app: ReturnType<typeof makeApp>,
  body: object,
  token?: string,
) {
  return app.request('/scores/session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Player-Token': token } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('POST /scores/session', () => {
  it('issues a token for a valid request', async () => {
    const app = makeApp({ sessionSecret: SECRET });
    const res = await openSession(app, { playerId: PLAYER, heapId: HEAP_ID });
    expect(res.status).toBe(200);
    const body = await res.json() as OpenSessionResponse;
    expect(typeof body.token).toBe('string');
    expect(body.token.split('.')).toHaveLength(2);
    expect(typeof body.issuedAt).toBe('number');
  });

  it('404s when no session secret is configured', async () => {
    const app = makeApp({});
    const res = await openSession(app, { playerId: PLAYER, heapId: HEAP_ID });
    expect(res.status).toBe(404);
  });

  it('rejects a missing playerId', async () => {
    const app = makeApp({ sessionSecret: SECRET });
    const res = await openSession(app, { heapId: HEAP_ID });
    expect(res.status).toBe(400);
  });

  it('rejects a missing heapId', async () => {
    const app = makeApp({ sessionSecret: SECRET });
    const res = await openSession(app, { playerId: PLAYER });
    expect(res.status).toBe(400);
  });

  it('rejects an over-long playerId', async () => {
    const app = makeApp({ sessionSecret: SECRET });
    const res = await openSession(app, { playerId: 'x'.repeat(200), heapId: HEAP_ID });
    expect(res.status).toBe(400);
  });

  it('403s when the player token does not match a claimed id', async () => {
    const authDb = new MockPlayerAuthDB();
    const app    = makeApp({ sessionSecret: SECRET, authDb });
    // First call claims the id with 'right-token'.
    const first = await openSession(app, { playerId: PLAYER, heapId: HEAP_ID }, 'right-token');
    expect(first.status).toBe(200);
    // A different secret for the same id must be refused.
    const second = await openSession(app, { playerId: PLAYER, heapId: HEAP_ID }, 'wrong-token');
    expect(second.status).toBe(403);
  });
});

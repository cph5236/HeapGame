// server/tests/players.test.ts
//
// Route-level tests for PUT /players/:playerId/name — validated, auth-gated rename.

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockPlayerAuthDB } from './helpers/mockPlayerAuthDb';
import { MockPlayerNameDB } from './helpers/mockPlayerNameDb';
import { MockSink } from './helpers/mockSink';
import { hashSecret } from '../src/playerAuth';

const PLAYER = 'player-aaa';
const SECRET = 'secret-aaa';

function makeApp(authDb = new MockPlayerAuthDB(), nameDb = new MockPlayerNameDB(), sink = new MockSink()) {
  const app = createApp(new MockHeapDB(), new MockScoreDB(), {
    playerAuthDb: authDb,
    playerNameDb: nameDb,
    logSink:      sink,
  });
  return { app, authDb, nameDb, sink };
}

async function rename(
  app: ReturnType<typeof makeApp>['app'],
  name: unknown,
  token?: string,
  playerId = PLAYER,
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== undefined) headers['X-Player-Token'] = token;
  return app.request(`/players/${playerId}/name`, {
    method:  'PUT',
    headers,
    body:    JSON.stringify({ name }),
  });
}

describe('PUT /players/:playerId/name', () => {
  it('valid rename with token on an unclaimed guid: 200, name row updated, auth row claimed', async () => {
    const { app, authDb, nameDb } = makeApp();
    const res = await rename(app, 'NewName', SECRET);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'NewName' });
    expect(await nameDb.getName(PLAYER)).toBe('NewName');
    expect(authDb.rows.get(PLAYER)).toBe(await hashSecret(SECRET));
  });

  it('rename with matching token on a claimed guid: 200', async () => {
    const { app } = makeApp();
    await rename(app, 'First', SECRET);
    const res = await rename(app, 'Second', SECRET);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'Second' });
  });

  it('rename with wrong token on a claimed guid: 403, name unchanged', async () => {
    const { app, nameDb } = makeApp();
    await rename(app, 'First', SECRET);
    const res = await rename(app, 'Hacker', 'wrong-secret');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(await nameDb.getName(PLAYER)).toBe('First');
  });

  it('tokenless rename on a claimed guid: 403', async () => {
    const { app, nameDb } = makeApp();
    await rename(app, 'First', SECRET);
    const res = await rename(app, 'NoToken');
    expect(res.status).toBe(403);
    expect(await nameDb.getName(PLAYER)).toBe('First');
  });

  it('profane name: 400 with reason profanity, nothing written', async () => {
    const { app, nameDb, authDb } = makeApp();
    const res = await rename(app, 'shithead', SECRET);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid name', reason: 'profanity' });
    expect(await nameDb.getName(PLAYER)).toBeNull();
    expect(authDb.rows.has(PLAYER)).toBe(false);
  });

  it('21-char name: 400 with reason too-long', async () => {
    const { app } = makeApp();
    const res = await rename(app, 'a'.repeat(21), SECRET);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid name', reason: 'too-long' });
  });

  it('trims padded names to their canonical form before storing', async () => {
    const { app, nameDb } = makeApp();
    const res = await rename(app, '  Padded  ', SECRET);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'Padded' });
    expect(await nameDb.getName(PLAYER)).toBe('Padded');
  });

  it('playerId over MAX_ID_LEN (65 chars): 400, nothing written', async () => {
    const { app, nameDb, authDb } = makeApp();
    const res = await rename(app, 'FineName', SECRET, 'x'.repeat(65));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid player id' });
    expect(await nameDb.getName('x'.repeat(65))).toBeNull();
    expect(authDb.rows.size).toBe(0);
  });

  it('invalid JSON body: 400', async () => {
    const { app } = makeApp();
    const res = await app.request(`/players/${PLAYER}/name`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Player-Token': SECRET },
      body:    '{not json',
    });
    expect(res.status).toBe(400);
  });
});

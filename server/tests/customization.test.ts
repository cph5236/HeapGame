import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockCustomizationDB } from './helpers/mockCustomizationDb';

const PLAYER = 'player-aaa';

function makeApp(customizationDb = new MockCustomizationDB()) {
  const heapDb = new MockHeapDB();
  return { app: createApp(heapDb, new MockScoreDB(), { customizationDb }), customizationDb };
}

async function put(app: ReturnType<typeof makeApp>['app'], playerId: string, body: unknown) {
  return app.request(`/customization/${playerId}`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('PUT /customization/:playerId', () => {
  it('upserts a valid loadout and GET returns it', async () => {
    const { app } = makeApp();
    const res = await put(app, PLAYER, { loadout: { hat: 'hat_cone', tie: 'tie_gold' } });
    expect(res.status).toBe(200);

    const get = await app.request(`/customization/${PLAYER}`);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ loadout: { hat: 'hat_cone', tie: 'tie_gold' } });
  });

  it('overwrites an existing loadout', async () => {
    const { app } = makeApp();
    await put(app, PLAYER, { loadout: { hat: 'hat_cone' } });
    await put(app, PLAYER, { loadout: { face: 'face_googly' } });
    const get = await app.request(`/customization/${PLAYER}`);
    expect(await get.json()).toEqual({ loadout: { face: 'face_googly' } });
  });

  it('accepts an empty loadout (clears cosmetics)', async () => {
    const { app } = makeApp();
    const res = await put(app, PLAYER, { loadout: {} });
    expect(res.status).toBe(200);
  });

  it('rejects malformed JSON with 400', async () => {
    const { app } = makeApp();
    const res = await put(app, PLAYER, '{not json');
    expect(res.status).toBe(400);
  });

  it('rejects a missing loadout field with 400', async () => {
    const { app } = makeApp();
    expect((await put(app, PLAYER, {})).status).toBe(400);
  });

  it('rejects unknown slots, unknown ids, and wrong-slot ids with 400', async () => {
    const { app } = makeApp();
    expect((await put(app, PLAYER, { loadout: { pants: 'hat_cone' } })).status).toBe(400);
    expect((await put(app, PLAYER, { loadout: { hat: 'hat_nonexistent' } })).status).toBe(400);
    expect((await put(app, PLAYER, { loadout: { face: 'hat_cone' } })).status).toBe(400);
    expect((await put(app, PLAYER, { loadout: ['hat_cone'] })).status).toBe(400);
  });

  it('rejects an oversized playerId with 400', async () => {
    const { app } = makeApp();
    expect((await put(app, 'x'.repeat(65), { loadout: {} })).status).toBe(400);
  });

  it('stores re-serialized JSON, never raw input', async () => {
    const { app, customizationDb } = makeApp();
    await put(app, PLAYER, { loadout: { hat: 'hat_cone' } });
    const raw = await customizationDb.getLoadout(PLAYER);
    expect(raw).toBe(JSON.stringify({ hat: 'hat_cone' }));
  });
});

describe('GET /customization/:playerId', () => {
  it('returns null loadout for an unknown player', async () => {
    const { app } = makeApp();
    const res = await app.request(`/customization/${PLAYER}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ loadout: null });
  });
});

// server/tests/placeBan.test.ts

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockBanDB } from './helpers/mockBanDb';
import type { PlaceResponse } from '../../shared/heapTypes';

/** Empty heap at version 1 — the fixture routes.test.ts uses for an accepted place. */
function appWithHeap(bans: MockBanDB) {
  const db = new MockHeapDB();
  db.seedHeap('h1', 1, [], 'base-1');
  db.seedBase('base-1', 'h1', []);
  const app = createApp(db, new MockScoreDB(), { banDb: bans });
  return { app, db, heapId: 'h1' };
}

async function place(
  app: ReturnType<typeof createApp>,
  heapId: string,
  playerGuid?: string,
) {
  const body: Record<string, unknown> = { x: 200, y: 200 };
  if (playerGuid !== undefined) body.playerGuid = playerGuid;
  const res = await app.request(`/heaps/${heapId}/place`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as PlaceResponse };
}

describe('POST /heaps/:id/place with a shadow-banned player', () => {
  it('accepts the placement for a clean player (control)', async () => {
    const { app, heapId } = appWithHeap(new MockBanDB());
    const { status, body } = await place(app, heapId, 'clean-player');
    expect(status).toBe(200);
    expect(body.accepted).toBe(true);
    expect(body.version).toBe(2);
  });

  it('returns accepted:false for a banned player, with 200 and the unchanged version', async () => {
    const bans = new MockBanDB();
    await bans.ban('badguy', 'griefing', '2026-08-16T00:00:00.000Z');
    const { app, heapId } = appWithHeap(bans);
    const { status, body } = await place(app, heapId, 'badguy');
    expect(status).toBe(200);
    expect(body.accepted).toBe(false);
    expect(body.version).toBe(1);          // still the seeded version — nothing was written
    expect(body.bonusCoins).toBeUndefined();
  });

  it('leaves the heap version untouched across repeated banned placements', async () => {
    const bans = new MockBanDB();
    await bans.ban('badguy', null, '2026-08-16T00:00:00.000Z');
    const { app, heapId } = appWithHeap(bans);
    await place(app, heapId, 'badguy');
    await place(app, heapId, 'badguy');
    const res = await app.request(`/heaps/${heapId}`);
    const heap = await res.json() as { version: number };
    expect(heap.version).toBe(1);
  });

  it('accepts again once the player is unbanned', async () => {
    const bans = new MockBanDB();
    await bans.ban('badguy', null, '2026-08-16T00:00:00.000Z');
    const { app, heapId } = appWithHeap(bans);
    expect((await place(app, heapId, 'badguy')).body.accepted).toBe(false);
    await bans.unban('badguy');
    expect((await place(app, heapId, 'badguy')).body.accepted).toBe(true);
  });

  it('leaves anonymous placements (no playerGuid) untouched', async () => {
    const bans = new MockBanDB();
    await bans.ban('badguy', null, '2026-08-16T00:00:00.000Z');
    const { app, heapId } = appWithHeap(bans);
    expect((await place(app, heapId)).body.accepted).toBe(true);
  });

  it('is byte-identical, whole-body, to the containment no-op it impersonates', async () => {
    // Fixture mirrors routes.test.ts's "rejects a point that does not widen
    // its band": band 2 covers y in [40,60) with x extents [200,400], and
    // x=300,y=50 sits strictly inside those extents — the same
    // already-widened band a real player would bounce off routinely.
    function seedHeap() {
      const db = new MockHeapDB();
      db.seedHeap('h1', 1, [], 'base-1');
      db.seedBase('base-1', 'h1', []);
      return db;
    }

    const bannedDb = seedHeap();
    await bannedDb.upsertBands('h1', [{ band: 2, minX: 200, maxX: 400 }], 1);
    const bans = new MockBanDB();
    await bans.ban('badguy', 'griefing', '2026-08-16T00:00:00.000Z');
    const bannedApp = createApp(bannedDb, new MockScoreDB(), { banDb: bans });
    const bannedRes = await bannedApp.request('/heaps/h1/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 300, y: 50, playerGuid: 'badguy' }),
    });

    const containmentDb = seedHeap();
    await containmentDb.upsertBands('h1', [{ band: 2, minX: 200, maxX: 400 }], 1);
    const containmentApp = createApp(containmentDb, new MockScoreDB(), { banDb: new MockBanDB() });
    const containmentRes = await containmentApp.request('/heaps/h1/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 300, y: 50, playerGuid: 'clean-player' }),
    });

    expect(bannedRes.status).toBe(containmentRes.status);
    const bannedBody = await bannedRes.json();
    const containmentBody = await containmentRes.json();
    // Whole-body deep-equal, not field-by-field: this is the check that must
    // fail if a future edit adds a field to only one branch.
    expect(bannedBody).toEqual(containmentBody);
  });
});

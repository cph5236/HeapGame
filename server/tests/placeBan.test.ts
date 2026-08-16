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
});

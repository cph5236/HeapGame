// server/tests/freezeRace.test.ts
//
// The regression guard for the HIGH-severity freeze race found in the PR #126
// review. Freeze used to decide on one D1 round trip (getAllBands +
// checkFreezeBands) and apply on another (createBase + a blind UPDATE in
// setFreeze). Two placements crossing the threshold together both read the same
// pre-freeze base_id, both built a new base from it, and the loser's bands were
// deleted by its own DELETE while surviving only in its orphaned base — which
// the heap no longer pointed at. That geometry was unrecoverable.
//
// These run against real SQLite (see helpers/d1Sqlite.ts), not MockHeapDB,
// because every part of the fix lives in SQL: the CAS predicate, the correlated
// subqueries that make a losing batch a no-op, and meta.changes.

import { describe, it, expect } from 'vitest';
import { D1HeapDB } from '../src/db';
import { createTestD1 } from './helpers/d1Sqlite';
import { DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';
import { BAND_SIZE_PX } from '../../shared/heapPolygon/bandEnvelope';

const NOW = '2026-07-28T00:00:00.000Z';

/** A heap with bands 100..104, each stamped at version 1. */
async function seeded() {
  const db = new D1HeapDB(createTestD1());
  await db.createHeap('h1', 'b1', [{ x: 480, y: 49000 }], 'hash-b1', NOW, {
    ...DEFAULT_HEAP_PARAMS, worldHeight: 50000,
  });
  await db.upsertBands('h1', [100, 101, 102, 103, 104].map((band) => ({ band, minX: 400, maxX: 500 })), 1);
  return db;
}

describe('freezeAtomic', () => {
  it('applies when the freeze line is unchanged', async () => {
    const db = await seeded();
    const applied = await db.freezeAtomic({
      heapId: 'h1', expectedFreezeY: 0,
      newBaseId: 'b2', baseVertices: [{ x: 400, y: 102 * BAND_SIZE_PX }], baseHash: 'hash-b2',
      newFreezeY: 102 * BAND_SIZE_PX, versionWatermark: 1, now: NOW,
    });
    expect(applied).toBe(true);

    const row = (await db.getHeap('h1'))!;
    expect(row.base_id).toBe('b2');
    expect(row.freeze_y).toBe(102 * BAND_SIZE_PX);
    // Bands 102..104 are buried; 100 and 101 stay live.
    expect((await db.getAllBands('h1')).map((b) => b.band)).toEqual([100, 101]);
  });

  it('is a TOTAL no-op when another request froze first', async () => {
    const db = await seeded();
    // Winner.
    await db.freezeAtomic({
      heapId: 'h1', expectedFreezeY: 0,
      newBaseId: 'b2', baseVertices: [{ x: 400, y: 102 * BAND_SIZE_PX }], baseHash: 'hash-b2',
      newFreezeY: 102 * BAND_SIZE_PX, versionWatermark: 1, now: NOW,
    });
    // Loser: computed from the SAME pre-freeze snapshot, so it still expects
    // freeze_y === 0 and still picks a line of its own. This is the interleaving
    // that used to destroy geometry.
    const applied = await db.freezeAtomic({
      heapId: 'h1', expectedFreezeY: 0,
      newBaseId: 'b3', baseVertices: [{ x: 400, y: 101 * BAND_SIZE_PX }], baseHash: 'hash-b3',
      newFreezeY: 101 * BAND_SIZE_PX, versionWatermark: 1, now: NOW,
    });

    expect(applied).toBe(false);
    const row = (await db.getHeap('h1'))!;
    expect(row.base_id).toBe('b2');                       // winner still owns the heap
    expect(row.freeze_y).toBe(102 * BAND_SIZE_PX);        // line not moved
    expect(await db.getBaseVerticesById('b3')).toBeNull(); // no orphaned base row
    expect((await db.getAllBands('h1')).map((b) => b.band)).toEqual([100, 101]); // band 101 NOT deleted
  });

  it('leaves a row stamped above the watermark as a straggler', async () => {
    const db = await seeded();
    // A concurrent placement widens band 103 after the freeze read the bands.
    await db.upsertBands('h1', [{ band: 103, minX: 100, maxX: 900 }], 9);

    await db.freezeAtomic({
      heapId: 'h1', expectedFreezeY: 0,
      newBaseId: 'b2', baseVertices: [{ x: 400, y: 102 * BAND_SIZE_PX }], baseHash: 'hash-b2',
      newFreezeY: 102 * BAND_SIZE_PX, versionWatermark: 1, now: NOW,
    });

    // 102 and 104 buried (version 1 <= watermark); 103 survives because the base
    // this freeze built never captured its new width.
    const bands = await db.getAllBandsVersioned('h1');
    expect(bands.map((b) => b.band)).toEqual([100, 101, 103]);
    expect(bands.find((b) => b.band === 103)).toMatchObject({ minX: 100, maxX: 900 });
  });

  it('a later freeze buries a straggler once its base captures it', async () => {
    const db = await seeded();
    await db.upsertBands('h1', [{ band: 103, minX: 100, maxX: 900 }], 9);
    await db.freezeAtomic({
      heapId: 'h1', expectedFreezeY: 0,
      newBaseId: 'b2', baseVertices: [], baseHash: 'hash-b2',
      newFreezeY: 102 * BAND_SIZE_PX, versionWatermark: 1, now: NOW,
    });
    // Next freeze reads the straggler, so its watermark covers version 9.
    const applied = await db.freezeAtomic({
      heapId: 'h1', expectedFreezeY: 102 * BAND_SIZE_PX,
      newBaseId: 'b3', baseVertices: [{ x: 100, y: 101 * BAND_SIZE_PX }], baseHash: 'hash-b3',
      newFreezeY: 101 * BAND_SIZE_PX, versionWatermark: 9, now: NOW,
    });

    expect(applied).toBe(true);
    expect((await db.getAllBands('h1')).map((b) => b.band)).toEqual([100]);
  });

  it('two racers computing the SAME line still leave one clean winner', async () => {
    const db = await seeded();
    const args = {
      heapId: 'h1', expectedFreezeY: 0,
      baseVertices: [{ x: 400, y: 102 * BAND_SIZE_PX }],
      newFreezeY: 102 * BAND_SIZE_PX, versionWatermark: 1, now: NOW,
    };
    const first = await db.freezeAtomic({ ...args, newBaseId: 'b2', baseHash: 'h2' });
    const second = await db.freezeAtomic({ ...args, newBaseId: 'b3', baseHash: 'h3' });
    expect([first, second]).toEqual([true, false]);
    expect((await db.getHeap('h1'))!.base_id).toBe('b2');
    expect(await db.getBaseVerticesById('b3')).toBeNull();
  });

  it('advances the line on a heap that is already frozen', async () => {
    const db = await seeded();
    await db.freezeAtomic({
      heapId: 'h1', expectedFreezeY: 0, newBaseId: 'b2', baseVertices: [], baseHash: 'h2',
      newFreezeY: 104 * BAND_SIZE_PX, versionWatermark: 1, now: NOW,
    });
    const applied = await db.freezeAtomic({
      heapId: 'h1', expectedFreezeY: 104 * BAND_SIZE_PX, newBaseId: 'b3', baseVertices: [], baseHash: 'h3',
      newFreezeY: 102 * BAND_SIZE_PX, versionWatermark: 1, now: NOW,
    });
    expect(applied).toBe(true);
    expect((await db.getHeap('h1'))!.freeze_y).toBe(102 * BAND_SIZE_PX);
    expect((await db.getAllBands('h1')).map((b) => b.band)).toEqual([100, 101]);
  });
});

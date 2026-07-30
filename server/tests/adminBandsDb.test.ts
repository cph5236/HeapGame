// server/tests/adminBandsDb.test.ts
//
// Runs against real SQLite (helpers/d1Sqlite.ts), not MockHeapDB, because every
// part of adminReplaceBands' correctness lives in SQL: the CAS predicate on both
// version and base_id, the correlated subqueries that make a losing batch a
// complete no-op, the replace-not-MIN/MAX upsert, and meta.changes.

import { describe, it, expect } from 'vitest';
import { D1HeapDB } from '../src/db';
import { createTestD1 } from './helpers/d1Sqlite';
import { DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';

const NOW = '2026-07-29T00:00:00.000Z';

/** Heap h1 at version 1 on base b1, with band 50 spanning [-900, 900]. */
async function seeded() {
  const db = new D1HeapDB(createTestD1());
  await db.createHeap('h1', 'b1', [{ x: 480, y: 49000 }], 'hash-b1', NOW, {
    ...DEFAULT_HEAP_PARAMS, worldHeight: 50000,
  });
  await db.upsertBands('h1', [{ band: 50, minX: -900, maxX: 900 }], 1);
  return db;
}

const ARGS = {
  heapId: 'h1',
  expectedVersion: 1,
  expectedBaseId: 'b1',
  newBaseId: 'b2',
  baseVertices: [{ x: 10, y: 49010 }],
  baseHash: 'hash-b2',
  liveRows: [{ band: 50, minX: -100, maxX: 100 }],
  now: NOW,
};

describe('adminReplaceBands', () => {
  it('NARROWS a band — the case upsertBands structurally cannot do', async () => {
    const db = await seeded();
    expect(await db.adminReplaceBands(ARGS)).toBe(true);
    expect(await db.getBand('h1', 50)).toEqual({ band: 50, minX: -100, maxX: 100 });
  });

  it('mints the new base, repoints the heap, and bumps the version', async () => {
    const db = await seeded();
    await db.adminReplaceBands(ARGS);
    const row = await db.getHeapFresh('h1');
    expect(row!.base_id).toBe('b2');
    expect(row!.version).toBe(2);
    expect(await db.getBaseVerticesById('b2')).toEqual([{ x: 10, y: 49010 }]);
  });

  it('stamps written bands with the NEW version so deltas pick them up', async () => {
    const db = await seeded();
    await db.adminReplaceBands(ARGS);
    expect(await db.getBandsSince('h1', 1)).toEqual([{ band: 50, minX: -100, maxX: 100 }]);
  });

  it('loses on a stale version and writes NOTHING', async () => {
    const db = await seeded();
    expect(await db.adminReplaceBands({ ...ARGS, expectedVersion: 99 })).toBe(false);
    const row = await db.getHeapFresh('h1');
    expect(row!.base_id).toBe('b1');
    expect(row!.version).toBe(1);
    expect(await db.getBand('h1', 50)).toEqual({ band: 50, minX: -900, maxX: 900 });
    // No orphan base row: a loser must not leave a b2 behind.
    expect(await db.getBaseVerticesById('b2')).toBeNull();
  });

  it('loses on a stale base id — a freeze landing mid-edit — and writes NOTHING', async () => {
    const db = await seeded();
    expect(await db.adminReplaceBands({ ...ARGS, expectedBaseId: 'someOtherBase' })).toBe(false);
    const row = await db.getHeapFresh('h1');
    expect(row!.base_id).toBe('b1');
    expect(row!.version).toBe(1);
    expect(await db.getBand('h1', 50)).toEqual({ band: 50, minX: -900, maxX: 900 });
    expect(await db.getBaseVerticesById('b2')).toBeNull();
  });

  it('creates a band row that did not exist', async () => {
    const db = await seeded();
    await db.adminReplaceBands({ ...ARGS, liveRows: [{ band: 77, minX: -3, maxX: 3 }] });
    expect(await db.getBand('h1', 77)).toEqual({ band: 77, minX: -3, maxX: 3 });
  });

  it('mints a new base id even when no live row changes', async () => {
    const db = await seeded();
    expect(await db.adminReplaceBands({ ...ARGS, liveRows: [] })).toBe(true);
    const row = await db.getHeapFresh('h1');
    expect(row!.base_id).toBe('b2');
    expect(row!.version).toBe(2);
  });

  it('returns false for a heap that does not exist', async () => {
    const db = await seeded();
    expect(await db.adminReplaceBands({ ...ARGS, heapId: 'nope' })).toBe(false);
  });
});

describe('MockHeapDB.adminReplaceBands mirrors D1', () => {
  it('narrows, repoints, bumps, and refuses a stale version', async () => {
    const { MockHeapDB } = await import('./helpers/mockDb');
    const db = new MockHeapDB();
    await db.createHeap('h1', 'b1', [{ x: 480, y: 49000 }], 'hash-b1', NOW, {
      ...DEFAULT_HEAP_PARAMS, worldHeight: 50000,
    });
    await db.upsertBands('h1', [{ band: 50, minX: -900, maxX: 900 }], 1);

    expect(await db.adminReplaceBands(ARGS)).toBe(true);
    expect(await db.getBand('h1', 50)).toEqual({ band: 50, minX: -100, maxX: 100 });
    const row = await db.getHeapFresh('h1');
    expect(row!.base_id).toBe('b2');
    expect(row!.version).toBe(2);

    // Now stale — the CAS must refuse.
    expect(await db.adminReplaceBands(ARGS)).toBe(false);
  });
});

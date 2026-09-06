// server/tests/bandDb.test.ts
import { describe, it, expect } from 'vitest';
import { MockHeapDB } from './helpers/mockDb';
import { D1HeapDB } from '../src/game/db';
import { createTestD1 } from './helpers/d1Sqlite';

async function seeded() {
  const db = new MockHeapDB();
  await db.createHeap('h1', 'b1', [{ x: 400, y: 100 }], 'hash', new Date().toISOString());
  return db;
}

describe('HeapDB band methods', () => {
  it('returns null for an absent band and the row for a present one', async () => {
    const db = await seeded();
    expect(await db.getBand('h1', 5)).toBeNull();
    await db.upsertBands('h1', [{ band: 5, minX: 300, maxX: 500 }], 2);
    expect(await db.getBand('h1', 5)).toEqual({ band: 5, minX: 300, maxX: 500 });
  });

  it('widens with MIN/MAX instead of replacing', async () => {
    const db = await seeded();
    await db.upsertBands('h1', [{ band: 5, minX: 300, maxX: 500 }], 2);
    await db.upsertBands('h1', [{ band: 5, minX: 400, maxX: 600 }], 3);
    expect(await db.getBand('h1', 5)).toEqual({ band: 5, minX: 300, maxX: 600 });
  });

  it('is conflict-free — two writers in the same band both land', async () => {
    const db = await seeded();
    await Promise.all([
      db.upsertBands('h1', [{ band: 5, minX: 200, maxX: 400 }], 2),
      db.upsertBands('h1', [{ band: 5, minX: 450, maxX: 700 }], 3),
    ]);
    expect(await db.getBand('h1', 5)).toEqual({ band: 5, minX: 200, maxX: 700 });
  });

  it('lists all bands ascending', async () => {
    const db = await seeded();
    await db.upsertBands('h1', [{ band: 9, minX: 1, maxX: 2 }, { band: 3, minX: 3, maxX: 4 }], 2);
    expect((await db.getAllBands('h1')).map((r) => r.band)).toEqual([3, 9]);
  });

  it('selects only bands changed strictly after a version', async () => {
    const db = await seeded();
    await db.upsertBands('h1', [{ band: 1, minX: 1, maxX: 2 }], 5);
    await db.upsertBands('h1', [{ band: 2, minX: 3, maxX: 4 }], 6);
    expect((await db.getBandsSince('h1', 5)).map((r) => r.band)).toEqual([2]);
    expect((await db.getBandsSince('h1', 4)).map((r) => r.band)).toEqual([1, 2]);
    expect(await db.getBandsSince('h1', 6)).toEqual([]);
  });

  it('reports the highest occupied band, or null when there are none', async () => {
    const db = await seeded();
    expect(await db.getMaxBand('h1')).toBeNull();
    await db.upsertBands('h1', [{ band: 4, minX: 1, maxX: 2 }, { band: 11, minX: 3, maxX: 4 }], 2);
    expect(await db.getMaxBand('h1')).toBe(11);
  });

  it('scopes bands per heap', async () => {
    const db = await seeded();
    await db.createHeap('h2', 'b2', [{ x: 400, y: 100 }], 'hash', new Date().toISOString());
    await db.upsertBands('h1', [{ band: 1, minX: 1, maxX: 2 }], 2);
    expect(await db.getAllBands('h2')).toEqual([]);
  });
});

describe('getAllBandsVersioned', () => {
  it('returns each band with the version it was stamped with, ascending', async () => {
    const db = new MockHeapDB();
    await db.upsertBands('h1', [{ band: 12, minX: 100, maxX: 200 }], 5);
    await db.upsertBands('h1', [{ band: 10, minX: 400, maxX: 500 }], 7);
    expect(await db.getAllBandsVersioned('h1')).toEqual([
      { band: 10, minX: 400, maxX: 500, version: 7 },
      { band: 12, minX: 100, maxX: 200, version: 5 },
    ]);
  });

  it('returns [] for a heap with no bands', async () => {
    const db = new MockHeapDB();
    expect(await db.getAllBandsVersioned('nope')).toEqual([]);
  });

  it('keeps the OLD version on a row that did not widen', async () => {
    // The watermark depends on this: an unwidened row's geometry is unchanged,
    // so it is safe to bury even though a later placement touched it.
    const db = new MockHeapDB();
    await db.upsertBands('h1', [{ band: 10, minX: 400, maxX: 500 }], 3);
    await db.upsertBands('h1', [{ band: 10, minX: 450, maxX: 480 }], 9);
    expect(await db.getAllBandsVersioned('h1')).toEqual([
      { band: 10, minX: 400, maxX: 500, version: 3 },
    ]);
  });

  it('D1HeapDB projects the version column', async () => {
    const db = new D1HeapDB(createTestD1());
    await db.upsertBands('h1', [{ band: 10, minX: 400, maxX: 500 }], 7);
    expect(await db.getAllBandsVersioned('h1')).toEqual([
      { band: 10, minX: 400, maxX: 500, version: 7 },
    ]);
  });
});

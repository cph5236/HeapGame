// server/tests/d1Sqlite.test.ts
//
// Tests for the test harness. The freeze fix rests on three D1 behaviours that
// MockHeapDB cannot express: a batch is one transaction, meta.changes reports
// rows actually touched, and correlated subqueries resolve against the
// transaction's own state. If the harness got any of them wrong, every test
// built on it would be vacuously green.

import { describe, it, expect } from 'vitest';
import { createTestD1 } from './helpers/d1Sqlite';

describe('d1Sqlite harness', () => {
  it('applies the real heap_core schema', async () => {
    const d1 = createTestD1();
    await d1.prepare("INSERT INTO heap_base (id, heap_id, vertices, vertex_hash, created_at) VALUES ('b1','h1','[]','hash','now')").run();
    const row = await d1.prepare('SELECT id FROM heap_base WHERE id = ?1').bind('b1').first<{ id: string }>();
    expect(row?.id).toBe('b1');
  });

  it('reports rows changed per statement', async () => {
    const d1 = createTestD1();
    await d1.prepare("INSERT INTO heap_band (heap_id, band, min_x, max_x, version) VALUES ('h1', 10, 0, 100, 1)").run();
    const hit = await d1.prepare('UPDATE heap_band SET max_x = 200 WHERE heap_id = ?1 AND band = ?2').bind('h1', 10).run();
    const miss = await d1.prepare('UPDATE heap_band SET max_x = 200 WHERE heap_id = ?1 AND band = ?2').bind('h1', 99).run();
    expect(hit.meta.changes).toBe(1);
    expect(miss.meta.changes).toBe(0);
  });

  it('runs a batch as one transaction and returns per-statement meta', async () => {
    const d1 = createTestD1();
    const results = await d1.batch([
      d1.prepare("INSERT INTO heap_band (heap_id, band, min_x, max_x, version) VALUES ('h1', 10, 0, 100, 1)"),
      d1.prepare("INSERT INTO heap_band (heap_id, band, min_x, max_x, version) VALUES ('h1', 11, 0, 100, 1)"),
      d1.prepare('DELETE FROM heap_band WHERE heap_id = ?1 AND band = ?2').bind('h1', 10),
    ]);
    expect(results.map((r) => r.meta.changes)).toEqual([1, 1, 1]);
    const rows = await d1.prepare('SELECT band FROM heap_band ORDER BY band').all<{ band: number }>();
    expect(rows.results.map((r) => r.band)).toEqual([11]);
  });

  it('rolls a batch back when a statement fails', async () => {
    const d1 = createTestD1();
    await expect(d1.batch([
      d1.prepare("INSERT INTO heap_band (heap_id, band, min_x, max_x, version) VALUES ('h1', 10, 0, 100, 1)"),
      d1.prepare("INSERT INTO heap_band (heap_id, band, min_x, max_x, version) VALUES ('h1', 10, 0, 100, 1)"), // PK conflict
    ])).rejects.toThrow();
    const rows = await d1.prepare('SELECT band FROM heap_band').all<{ band: number }>();
    expect(rows.results).toHaveLength(0);
  });

  it('resolves a correlated subquery against uncommitted state inside the batch', async () => {
    const d1 = createTestD1();
    await d1.batch([
      d1.prepare("INSERT INTO heap_base (id, heap_id, vertices, vertex_hash, created_at) VALUES ('b1','h1','[]','hash','now')"),
      // Every other heap column carries a schema default.
      d1.prepare("INSERT INTO heap (id, base_id, created_at) VALUES ('h1','b1','now')"),
      d1.prepare("INSERT INTO heap_band (heap_id, band, min_x, max_x, version) VALUES ('h1', 10, 0, 100, 1)"),
    ]);
    // Statement 2 sees the base_id statement 1 just wrote, not the pre-batch one.
    const results = await d1.batch([
      d1.prepare('UPDATE heap SET base_id = ?1 WHERE id = ?2').bind('b2', 'h1'),
      d1.prepare('DELETE FROM heap_band WHERE heap_id = ?1 AND (SELECT base_id FROM heap WHERE id = ?1) = ?2').bind('h1', 'b2'),
    ]);
    expect(results[1].meta.changes).toBe(1);
  });

  it('binds numbered ?NNN params positionally, including a reused index', async () => {
    // Every statement in server/src/db.ts uses ?NNN, and several reuse an index
    // (freezeAtomic's DELETE binds heap_id once but references ?1 twice). If the
    // harness got this wrong, statements would bind to the wrong columns and
    // fail in ways that look like logic bugs.
    const d1 = createTestD1();
    await d1.prepare("INSERT INTO heap_band (heap_id, band, min_x, max_x, version) VALUES ('h1', 10, 0, 100, 1)").run();
    const res = await d1
      .prepare('DELETE FROM heap_band WHERE heap_id = ?1 AND band = ?2 AND (SELECT COUNT(*) FROM heap_band WHERE heap_id = ?1) = ?3')
      .bind('h1', 10, 1)
      .run();
    expect(res.meta.changes).toBe(1);
  });

  it('returns rows from a RETURNING mutation inside a batch', async () => {
    // commitPlacement reads results[0].results[0].version from exactly this shape.
    const d1 = createTestD1();
    await d1.batch([
      d1.prepare("INSERT INTO heap_base (id, heap_id, vertices, vertex_hash, created_at) VALUES ('b1','h1','[]','hash','now')"),
      // Every other heap column carries a schema default.
      d1.prepare("INSERT INTO heap (id, base_id, created_at) VALUES ('h1','b1','now')"),
    ]);
    const results = await d1.batch<{ version: number }>([
      d1.prepare('UPDATE heap SET version = version + 1 WHERE id = ?1 RETURNING version').bind('h1'),
    ]);
    expect(results[0].results[0].version).toBe(2);
  });

  it('does not silently swallow a mutation passed through the read path', async () => {
    // Regression guard for the harness itself: node:sqlite executes an UPDATE
    // handed to .all() and returns [], so dispatching by try/catch instead of by
    // SQL text reports changes: 0 for every mutation — which would make
    // freezeAtomic's CAS verdict permanently false and every race test vacuous.
    const d1 = createTestD1();
    await d1.prepare("INSERT INTO heap_band (heap_id, band, min_x, max_x, version) VALUES ('h1', 10, 0, 100, 1)").run();
    const res = await d1.prepare('UPDATE heap_band SET max_x = 999 WHERE heap_id = ?1').bind('h1').run();
    expect(res.meta.changes).toBe(1);
    const row = await d1.prepare('SELECT max_x FROM heap_band WHERE heap_id = ?1').bind('h1').first<{ max_x: number }>();
    expect(row?.max_x).toBe(999); // and exactly once — not applied twice
  });

  it('reports a truthful meta.changes from .all() on a mutation', async () => {
    // Nothing in server/src/db.ts calls .all() on a write today, but the harness
    // must not lie if something does tomorrow. A hard-coded changes: 0 here would
    // be worse than a crash: a crash fails loudly and gets fixed, while a silent
    // 0 reads as "the CAS guard rejected this row" and would make a real freeze
    // race look like it passed when it didn't touch anything at all.
    const d1 = createTestD1();
    await d1.prepare("INSERT INTO heap_band (heap_id, band, min_x, max_x, version) VALUES ('h1', 10, 0, 100, 1)").run();
    const res = await d1.prepare('UPDATE heap_band SET max_x = 999 WHERE heap_id = ?1').bind('h1').all();
    expect(res.meta.changes).toBe(1);
  });

  it('isolates databases between calls', async () => {
    const a = createTestD1();
    const b = createTestD1();
    await a.prepare("INSERT INTO heap_base (id, heap_id, vertices, vertex_hash, created_at) VALUES ('b1','h1','[]','hash','now')").run();
    const rows = await b.prepare('SELECT id FROM heap_base').all<{ id: string }>();
    expect(rows.results).toHaveLength(0);
  });
});

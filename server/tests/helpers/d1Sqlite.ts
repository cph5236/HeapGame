// server/tests/helpers/d1Sqlite.ts
//
// A real-SQLite D1Database for tests, over node:sqlite (ships with Node — no
// native build, no new dependency). MockHeapDB proves route logic; this proves
// SQL. Anything whose correctness lives in a WHERE clause — CAS guards,
// correlated subqueries, batch atomicity, meta.changes — can only be tested
// here.
//
// It implements the subset of D1Database the server actually calls. Unused
// members are absent by design rather than stubbed, so an untested call fails
// loudly instead of silently returning something plausible.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// vitest's bundled vite-node hardcodes its Node-builtin allowlist (it only
// recognizes what's in node:module's builtinModules, plus one explicit
// exception for node:test) and does not know about node:sqlite, which is
// still experimental and absent from that list. A static `import {
// DatabaseSync } from 'node:sqlite'` gets caught by vite-node's SSR import
// resolution, which strips the "node:" prefix and tries to resolve a package
// literally named "sqlite" — failing before the file under test ever runs.
// Node itself resolves node:sqlite natively; createRequire sidesteps
// vite-node's static import rewriting entirely and hands resolution straight
// to Node, exactly as a plain `import` would if the runner recognized it.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
// The destructured DatabaseSync above is a value only (a plain variable), not
// a type the way a class import is — this alias restores its use as a type
// annotation below.
type DatabaseSync = InstanceType<typeof DatabaseSync>;

const SCHEMA_PATH = join(__dirname, '../../schema/heap_core.sql');

interface PreparedLike {
  sql: string;
  params: unknown[];
}

function makeResult(rows: unknown[], changes: number) {
  return {
    results: rows,
    success: true,
    meta: { changes, last_row_id: 0, duration: 0, rows_read: rows.length, rows_written: changes },
  };
}

/** Statements whose rows we need: plain reads, and mutations with RETURNING. */
const RETURNS_ROWS = /^\s*(SELECT|WITH)\b/i;
const HAS_RETURNING = /\bRETURNING\b/i;

function run(db: DatabaseSync, stmt: PreparedLike) {
  const prepared = db.prepare(stmt.sql);
  // Dispatch on the SQL text, NOT on try/catch. node:sqlite does not throw when
  // .all() is handed an UPDATE — it executes the update and returns [] — so a
  // try-all-then-fall-back-to-run shape would silently report changes: 0 for
  // every mutation (breaking freezeAtomic's CAS verdict outright) and would
  // double-execute anything that did fall through. .run() on a SELECT is
  // equally wrong in the other direction: it succeeds, returns no rows, and
  // reports a meaningless changes count.
  const wantsRows = RETURNS_ROWS.test(stmt.sql) || HAS_RETURNING.test(stmt.sql);
  if (wantsRows) {
    const rows = prepared.all(...(stmt.params as never[]));
    // For a RETURNING mutation the row count IS the changed-row count; a plain
    // SELECT changes nothing.
    return makeResult(rows, HAS_RETURNING.test(stmt.sql) ? rows.length : 0);
  }
  const info = prepared.run(...(stmt.params as never[]));
  return makeResult([], Number(info.changes));
}

class TestStatement {
  constructor(private db: DatabaseSync, private stmt: PreparedLike) {}

  bind(...params: unknown[]) {
    return new TestStatement(this.db, { sql: this.stmt.sql, params });
  }

  async all<T>() {
    return run(this.db, this.stmt) as unknown as { results: T[] };
  }

  async first<T>(): Promise<T | null> {
    const rows = run(this.db, this.stmt).results as T[];
    return rows[0] ?? null;
  }

  async run() {
    return run(this.db, this.stmt);
  }

  /** Internal: used by batch, which must not open its own transaction per statement. */
  execInBatch() {
    return run(this.db, this.stmt);
  }
}

/**
 * A fresh in-memory database with the production heap_core schema applied.
 * Reading the real .sql file (rather than restating the DDL here) is what keeps
 * these tests from drifting away from production when a column is added.
 */
export function createTestD1(): D1Database {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));

  const api = {
    prepare(sql: string) {
      return new TestStatement(db, { sql, params: [] });
    },
    async batch(statements: TestStatement[]) {
      // One batch = one transaction, matching D1. A throw inside rolls the
      // whole thing back, which is the property the freeze fix depends on.
      db.exec('BEGIN');
      try {
        const results = statements.map((s) => s.execInBatch());
        db.exec('COMMIT');
        return results;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    async exec(sql: string) {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
  };

  return api as unknown as D1Database;
}

// server/tests/metricsDb.test.ts
//
// Bucketing correctness lives entirely in a strftime expression, so this is
// tested against real SQLite rather than a mock — a mock would only prove that
// the mock buckets the way the mock buckets.

import { describe, it, expect } from 'vitest';
import { createTestD1 } from './helpers/d1Sqlite';
import { D1MetricsDB } from '../src/platform/metricsDb';
import { BUCKET_ORDER, bucketStartMs } from '../../shared/metricsBuckets';

async function seed(d1: D1Database, timestamps: string[]): Promise<void> {
  let n = 0;
  for (const ts of timestamps) {
    await d1.prepare(
      'INSERT INTO player_auth (player_id, secret_hash, created_at) VALUES (?1, ?2, ?3)',
    ).bind(`p${n++}`, 'hash', ts).run();
  }
}

const iso = (ms: number) => new Date(ms).toISOString();

describe('D1MetricsDB.newPlayersByBucket', () => {
  it('groups by day across the ISO T separator and Z suffix', async () => {
    const d1 = createTestD1('heap_scores');
    await seed(d1, [
      '2026-09-19T12:34:56.789Z',
      '2026-09-19T23:59:59.999Z',
      '2026-09-20T00:00:00.000Z',
    ]);
    const rows = await new D1MetricsDB(d1).newPlayersByBucket(
      '1d', '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z',
    );
    expect(rows.map(r => ({ t: iso(r.startMs), count: r.count }))).toEqual([
      { t: '2026-09-19T00:00:00.000Z', count: 2 },
      { t: '2026-09-20T00:00:00.000Z', count: 1 },
    ]);
  });

  it('groups by sub-hour buckets', async () => {
    const d1 = createTestD1('heap_scores');
    await seed(d1, [
      '2026-09-19T12:00:01.000Z',
      '2026-09-19T12:14:59.999Z',
      '2026-09-19T12:15:00.000Z',
    ]);
    const rows = await new D1MetricsDB(d1).newPlayersByBucket(
      '15m', '2026-09-19T00:00:00.000Z', '2026-09-20T00:00:00.000Z',
    );
    expect(rows.map(r => ({ t: iso(r.startMs), count: r.count }))).toEqual([
      { t: '2026-09-19T12:00:00.000Z', count: 2 },
      { t: '2026-09-19T12:15:00.000Z', count: 1 },
    ]);
  });

  it('agrees with shared bucketStartMs for every bucket size', async () => {
    // The route zero-fills by bucket-start key, so the SQL and the shared
    // arithmetic must produce identical starts — a mismatch would render
    // every real count as a zero beside a phantom point.
    const d1 = createTestD1('heap_scores');
    const ts = '2026-09-23T17:43:12.345Z';
    await seed(d1, [ts]);
    const db = new D1MetricsDB(d1);
    for (const b of BUCKET_ORDER) {
      const rows = await db.newPlayersByBucket(b, '2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z');
      expect(rows, b).toEqual([{ startMs: bucketStartMs(Date.parse(ts), b), count: 1 }]);
    }
  });

  it('starts weeks on Monday', async () => {
    const d1 = createTestD1('heap_scores');
    await seed(d1, ['2026-09-20T23:00:00.000Z', '2026-09-21T01:00:00.000Z']); // Sun, Mon
    const rows = await new D1MetricsDB(d1).newPlayersByBucket(
      '1w', '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z',
    );
    expect(rows.map(r => iso(r.startMs))).toEqual([
      '2026-09-14T00:00:00.000Z', '2026-09-21T00:00:00.000Z',
    ]);
  });

  it('excludes rows outside the window, half-open on until', async () => {
    const d1 = createTestD1('heap_scores');
    await seed(d1, [
      '2026-09-18T23:59:59.999Z', // before since — excluded
      '2026-09-19T00:00:00.000Z', // == since — included
      '2026-09-20T00:00:00.000Z', // == until — excluded
    ]);
    const rows = await new D1MetricsDB(d1).newPlayersByBucket(
      '1d', '2026-09-19T00:00:00.000Z', '2026-09-20T00:00:00.000Z',
    );
    expect(rows).toEqual([{ startMs: Date.parse('2026-09-19T00:00:00.000Z'), count: 1 }]);
  });

  it('returns an empty array when nothing matches', async () => {
    const d1 = createTestD1('heap_scores');
    const rows = await new D1MetricsDB(d1).newPlayersByBucket(
      '1d', '2026-09-19T00:00:00.000Z', '2026-09-20T00:00:00.000Z',
    );
    expect(rows).toEqual([]);
  });
});

describe('D1MetricsDB.totalPlayers', () => {
  it('counts every player_auth row', async () => {
    const d1 = createTestD1('heap_scores');
    const db = new D1MetricsDB(d1);
    expect(await db.totalPlayers()).toBe(0);
    await seed(d1, ['2026-09-19T00:00:00.000Z', '2026-09-20T00:00:00.000Z']);
    expect(await db.totalPlayers()).toBe(2);
  });
});

describe('D1MetricsDB.cohortMembers', () => {
  it('pages through members in created_at order', async () => {
    const d1 = createTestD1('heap_scores');
    await seed(d1, [
      '2026-09-19T01:00:00.000Z',
      '2026-09-19T02:00:00.000Z',
      '2026-09-19T03:00:00.000Z',
    ]);
    const db = new D1MetricsDB(d1);

    const first = await db.cohortMembers(
      '2026-09-19T00:00:00.000Z', '2026-09-20T00:00:00.000Z', 2, null,
    );
    expect(first.playerIds).toEqual(['p0', 'p1']);
    expect(first.nextCursor).toBe('2026-09-19T02:00:00.000Z|p1');

    const second = await db.cohortMembers(
      '2026-09-19T00:00:00.000Z', '2026-09-20T00:00:00.000Z', 2, first.nextCursor,
    );
    expect(second.playerIds).toEqual(['p2']);
    expect(second.nextCursor).toBeNull();
  });

  it('returns a null cursor when the window is empty', async () => {
    const d1 = createTestD1('heap_scores');
    const page = await new D1MetricsDB(d1).cohortMembers(
      '2026-09-19T00:00:00.000Z', '2026-09-20T00:00:00.000Z', 10, null,
    );
    expect(page).toEqual({ playerIds: [], nextCursor: null });
  });

  it('does not skip or duplicate a player when two rows share created_at', async () => {
    // p0@T1, p1@T2, p2@T2 — a page boundary between p1 and p2 with a plain
    // created_at cursor would resume at `created_at > T2`, skipping p2.
    const d1 = createTestD1('heap_scores');
    await seed(d1, [
      '2026-09-19T01:00:00.000Z',
      '2026-09-19T02:00:00.000Z',
      '2026-09-19T02:00:00.000Z',
    ]);
    const db = new D1MetricsDB(d1);

    const first = await db.cohortMembers(
      '2026-09-19T00:00:00.000Z', '2026-09-20T00:00:00.000Z', 1, null,
    );
    expect(first.playerIds).toEqual(['p0']);
    expect(first.nextCursor).not.toBeNull();

    const second = await db.cohortMembers(
      '2026-09-19T00:00:00.000Z', '2026-09-20T00:00:00.000Z', 1, first.nextCursor,
    );
    expect(second.playerIds).toEqual(['p1']);
    expect(second.nextCursor).not.toBeNull();

    const third = await db.cohortMembers(
      '2026-09-19T00:00:00.000Z', '2026-09-20T00:00:00.000Z', 1, second.nextCursor,
    );
    expect(third.playerIds).toEqual(['p2']);

    // Neither skipped nor duplicated across the three pages.
    const all = [...first.playerIds, ...second.playerIds, ...third.playerIds];
    expect(all).toEqual(['p0', 'p1', 'p2']);
  });

  it('does not return rows before since even with a stale cursor that predates it', async () => {
    const d1 = createTestD1('heap_scores');
    await seed(d1, [
      '2026-09-10T00:00:00.000Z', // before since — must never come back
      '2026-09-19T01:00:00.000Z',
      '2026-09-19T02:00:00.000Z',
    ]);
    const db = new D1MetricsDB(d1);

    // A cursor pointing at a row (or timestamp) before `since` — e.g. stale,
    // malformed, or hand-crafted — must not resurrect rows below the floor.
    const page = await db.cohortMembers(
      '2026-09-19T00:00:00.000Z', '2026-09-20T00:00:00.000Z', 10,
      '2026-09-01T00:00:00.000Z|zzz',
    );
    expect(page.playerIds).toEqual(['p1', 'p2']);
  });
});

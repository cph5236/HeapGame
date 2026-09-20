// server/tests/metricsDb.test.ts
//
// Bucketing correctness lives entirely in a strftime expression, so this is
// tested against real SQLite rather than a mock — a mock would only prove that
// the mock buckets the way the mock buckets.

import { describe, it, expect } from 'vitest';
import { createTestD1 } from './helpers/d1Sqlite';
import { D1MetricsDB } from '../src/platform/metricsDb';

async function seed(d1: D1Database, timestamps: string[]): Promise<void> {
  let n = 0;
  for (const ts of timestamps) {
    await d1.prepare(
      'INSERT INTO player_auth (player_id, secret_hash, created_at) VALUES (?1, ?2, ?3)',
    ).bind(`p${n++}`, 'hash', ts).run();
  }
}

describe('D1MetricsDB.newPlayersByBucket', () => {
  it('groups by day across the ISO T separator and Z suffix', async () => {
    const d1 = createTestD1('heap_scores');
    await seed(d1, [
      '2026-09-19T12:34:56.789Z',
      '2026-09-19T23:59:59.999Z',
      '2026-09-20T00:00:00.000Z',
    ]);
    const rows = await new D1MetricsDB(d1).newPlayersByBucket(
      'day', '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z',
    );
    expect(rows).toEqual([
      { bucket: '2026-09-19', count: 2 },
      { bucket: '2026-09-20', count: 1 },
    ]);
  });

  it('groups by hour', async () => {
    const d1 = createTestD1('heap_scores');
    await seed(d1, [
      '2026-09-19T12:00:01.000Z',
      '2026-09-19T12:59:59.000Z',
      '2026-09-19T13:00:00.000Z',
    ]);
    const rows = await new D1MetricsDB(d1).newPlayersByBucket(
      'hour', '2026-09-19T00:00:00.000Z', '2026-09-20T00:00:00.000Z',
    );
    expect(rows).toEqual([
      { bucket: '2026-09-19T12:00:00Z', count: 2 },
      { bucket: '2026-09-19T13:00:00Z', count: 1 },
    ]);
  });

  it('groups by week', async () => {
    const d1 = createTestD1('heap_scores');
    await seed(d1, ['2026-09-19T12:00:00.000Z', '2026-09-23T12:00:00.000Z']);
    const rows = await new D1MetricsDB(d1).newPlayersByBucket(
      'week', '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z',
    );
    expect(rows.map((r) => r.count)).toEqual([1, 1]);
    expect(rows[0].bucket).not.toEqual(rows[1].bucket);
  });

  it('excludes rows outside the window, half-open on until', async () => {
    const d1 = createTestD1('heap_scores');
    await seed(d1, [
      '2026-09-18T23:59:59.999Z', // before since — excluded
      '2026-09-19T00:00:00.000Z', // == since — included
      '2026-09-20T00:00:00.000Z', // == until — excluded
    ]);
    const rows = await new D1MetricsDB(d1).newPlayersByBucket(
      'day', '2026-09-19T00:00:00.000Z', '2026-09-20T00:00:00.000Z',
    );
    expect(rows).toEqual([{ bucket: '2026-09-19', count: 1 }]);
  });

  it('returns an empty array when nothing matches', async () => {
    const d1 = createTestD1('heap_scores');
    const rows = await new D1MetricsDB(d1).newPlayersByBucket(
      'day', '2026-09-19T00:00:00.000Z', '2026-09-20T00:00:00.000Z',
    );
    expect(rows).toEqual([]);
  });
});

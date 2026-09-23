// server/tests/metrics.test.ts

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockMetricsDB } from './helpers/mockMetricsDb';
import { createTestD1 } from './helpers/d1Sqlite';
import { D1MetricsDB } from '../src/platform/metricsDb';

function makeApp(metricsDb = new MockMetricsDB(), adminSecret?: string) {
  return createApp(new MockHeapDB(), new MockScoreDB(), { metricsDb, adminSecret });
}

const ADMIN = { 'X-Admin-Secret': 's3cret' };

describe('GET /metrics/new-players', () => {
  it('requires the admin secret when one is configured (401)', async () => {
    const app = makeApp(new MockMetricsDB(), 's3cret');
    const res = await app.request('/metrics/new-players?bucket=day');
    expect(res.status).toBe(401);
  });

  it('returns a dense, zero-filled series with the resolved bucket', async () => {
    const db = new MockMetricsDB();
    db.rows = [{ startMs: Date.parse('2026-09-19T00:00:00.000Z'), count: 7 }];
    const app = makeApp(db, 's3cret');

    const res = await app.request(
      '/metrics/new-players?bucket=1d&since=2026-09-18T00:00:00.000Z&until=2026-09-21T00:00:00.000Z',
      { headers: ADMIN },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      bucket: '1d',
      bucketSeconds: 86_400,
      since: '2026-09-18T00:00:00.000Z',
      until: '2026-09-21T00:00:00.000Z',
      total: 7,
      rows: [
        { t: '2026-09-18T00:00:00.000Z', count: 0 },
        { t: '2026-09-19T00:00:00.000Z', count: 7 },
        { t: '2026-09-20T00:00:00.000Z', count: 0 },
      ],
    });
    expect(db.lastCall).toEqual({
      bucket: '1d',
      since: '2026-09-18T00:00:00.000Z',
      until: '2026-09-21T00:00:00.000Z',
    });
  });

  it('defaults to auto: a 24h window resolves to 15m buckets', async () => {
    const db = new MockMetricsDB();
    const app = makeApp(db, 's3cret');
    const res = await app.request(
      '/metrics/new-players?since=2026-09-22T00:00:00.000Z&until=2026-09-23T00:00:00.000Z',
      { headers: ADMIN },
    );
    const body = await res.json();
    expect(body.bucket).toBe('15m');
    expect(body.rows).toHaveLength(96);
    expect(db.lastCall?.bucket).toBe('15m');
  });

  it('defaults to the last 30 days, resolved to 6h buckets', async () => {
    const db = new MockMetricsDB();
    const app = makeApp(db, 's3cret');

    const res = await app.request('/metrics/new-players', { headers: ADMIN });
    expect(res.status).toBe(200);
    expect(db.lastCall?.bucket).toBe('6h');

    const since = Date.parse(db.lastCall!.since);
    const until = Date.parse(db.lastCall!.until);
    const days = (until - since) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it('rejects an unknown bucket (400) without touching the db', async () => {
    const db = new MockMetricsDB();
    const app = makeApp(db, 's3cret');
    for (const bad of ['month', 'day', 'toString']) {
      const res = await app.request(`/metrics/new-players?bucket=${bad}`, { headers: ADMIN });
      expect(res.status, bad).toBe(400);
    }
    expect(db.lastCall).toBeNull();
  });

  it('rejects a bucket too fine for the window (400) instead of truncating', async () => {
    const db = new MockMetricsDB();
    const app = makeApp(db, 's3cret');
    const res = await app.request(
      '/metrics/new-players?bucket=1m&since=2026-01-01T00:00:00.000Z&until=2026-09-01T00:00:00.000Z',
      { headers: ADMIN },
    );
    expect(res.status).toBe(400);
    expect(db.lastCall).toBeNull();
  });

  it('rejects a malformed since (400)', async () => {
    const app = makeApp(new MockMetricsDB(), 's3cret');
    const res = await app.request('/metrics/new-players?since=not-a-date', { headers: ADMIN });
    expect(res.status).toBe(400);
  });

  it('rejects since >= until (400)', async () => {
    const app = makeApp(new MockMetricsDB(), 's3cret');
    const res = await app.request(
      '/metrics/new-players?since=2026-09-20T00:00:00.000Z&until=2026-09-19T00:00:00.000Z',
      { headers: ADMIN },
    );
    expect(res.status).toBe(400);
  });

  it('404s when no metricsDb is configured', async () => {
    const app = createApp(new MockHeapDB(), new MockScoreDB(), { adminSecret: 's3cret' });
    const res = await app.request('/metrics/new-players', { headers: ADMIN });
    expect(res.status).toBe(404);
  });
});

describe('GET /metrics/totals', () => {
  it('requires the admin secret (401)', async () => {
    const res = await makeApp(new MockMetricsDB(), 's3cret').request('/metrics/totals');
    expect(res.status).toBe(401);
  });

  it('returns the all-time player count', async () => {
    const db = new MockMetricsDB();
    db.total = 42;
    const res = await makeApp(db, 's3cret').request('/metrics/totals', { headers: ADMIN });
    expect(await res.json()).toEqual({ players: 42 });
  });
});

describe('GET /metrics/cohort', () => {
  it('requires the admin secret (401)', async () => {
    const app = makeApp(new MockMetricsDB(), 's3cret');
    const res = await app.request('/metrics/cohort');
    expect(res.status).toBe(401);
  });

  it('returns a page of player ids and the next cursor', async () => {
    const db = new MockMetricsDB();
    db.cohortPage = { playerIds: ['a', 'b'], nextCursor: '2026-09-19T02:00:00.000Z' };
    const app = makeApp(db, 's3cret');

    const res = await app.request(
      '/metrics/cohort?since=2026-09-19T00:00:00.000Z&until=2026-09-20T00:00:00.000Z&limit=2',
      { headers: ADMIN },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      since: '2026-09-19T00:00:00.000Z',
      until: '2026-09-20T00:00:00.000Z',
      playerIds: ['a', 'b'],
      nextCursor: '2026-09-19T02:00:00.000Z',
    });
    expect(db.lastCohortCall?.limit).toBe(2);
    expect(db.lastCohortCall?.cursor).toBeNull();
  });

  it('passes a composite cursor through opaquely, unlike since/until', async () => {
    // cohortMembers's cursor is `${created_at}|${player_id}` (see metricsDb.ts),
    // not a plain ISO timestamp. Regression test: an earlier version of this
    // route ran `cursor` through the same ISO-only parser as since/until,
    // which silently discarded any real cursor the endpoint itself returns.
    const db = new MockMetricsDB();
    const app = makeApp(db, 's3cret');
    await app.request(
      '/metrics/cohort?cursor=' + encodeURIComponent('2026-09-19T02:00:00.000Z|p7'),
      { headers: ADMIN },
    );
    expect(db.lastCohortCall?.cursor).toBe('2026-09-19T02:00:00.000Z|p7');
  });

  it('round-trips its own nextCursor into a real second page (real SQLite, not the mock)', async () => {
    // The mock only proves the route hands `cursor` to MetricsDB unmodified.
    // This proves the actual contract end to end: a client that calls the
    // route, then passes the response's own `nextCursor` straight back,
    // genuinely reaches page 2 rather than being silently reset to page 1.
    const d1 = createTestD1('heap_scores');
    await d1.prepare(
      'INSERT INTO player_auth (player_id, secret_hash, created_at) VALUES (?1, ?2, ?3)',
    ).bind('p1', 'hash', '2026-09-19T01:00:00.000Z').run();
    await d1.prepare(
      'INSERT INTO player_auth (player_id, secret_hash, created_at) VALUES (?1, ?2, ?3)',
    ).bind('p2', 'hash', '2026-09-19T02:00:00.000Z').run();
    const app = createApp(new MockHeapDB(), new MockScoreDB(), {
      metricsDb: new D1MetricsDB(d1), adminSecret: 's3cret',
    });

    const page1 = await app.request(
      '/metrics/cohort?since=2026-09-19T00:00:00.000Z&until=2026-09-20T00:00:00.000Z&limit=1',
      { headers: ADMIN },
    );
    const body1 = await page1.json();
    expect(body1.playerIds).toEqual(['p1']);
    expect(body1.nextCursor).toBe('2026-09-19T01:00:00.000Z|p1');

    const page2 = await app.request(
      '/metrics/cohort?since=2026-09-19T00:00:00.000Z&until=2026-09-20T00:00:00.000Z&limit=1'
        + '&cursor=' + encodeURIComponent(body1.nextCursor),
      { headers: ADMIN },
    );
    const body2 = await page2.json();
    expect(body2.playerIds).toEqual(['p2']);
    // A full page (1 row at limit=1) always carries a cursor — keyset paging
    // can't yet know p2 was the last row. The next request settles it.
    expect(body2.nextCursor).toBe('2026-09-19T02:00:00.000Z|p2');

    const page3 = await app.request(
      '/metrics/cohort?since=2026-09-19T00:00:00.000Z&until=2026-09-20T00:00:00.000Z&limit=1'
        + '&cursor=' + encodeURIComponent(body2.nextCursor),
      { headers: ADMIN },
    );
    const body3 = await page3.json();
    expect(body3.playerIds).toEqual([]);
    expect(body3.nextCursor).toBeNull();
  });

  it('rejects a malformed cursor (400)', async () => {
    const db = new MockMetricsDB();
    const app = makeApp(db, 's3cret');

    for (const bad of ['not-a-cursor', '|missing-timestamp', 'missing-player|', 'a|b|c']) {
      const res = await app.request('/metrics/cohort?cursor=' + encodeURIComponent(bad), { headers: ADMIN });
      expect(res.status, `cursor=${bad}`).toBe(400);
    }
    expect(db.lastCohortCall).toBeNull();
  });

  it('clamps limit to 1000 and defaults to 500', async () => {
    const db = new MockMetricsDB();
    const app = makeApp(db, 's3cret');

    await app.request('/metrics/cohort', { headers: ADMIN });
    expect(db.lastCohortCall?.limit).toBe(500);

    await app.request('/metrics/cohort?limit=99999', { headers: ADMIN });
    expect(db.lastCohortCall?.limit).toBe(1000);

    await app.request('/metrics/cohort?limit=0', { headers: ADMIN });
    expect(db.lastCohortCall?.limit).toBe(1);
  });
});

// server/tests/metrics.test.ts

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockMetricsDB } from './helpers/mockMetricsDb';

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

  it('returns bucketed rows', async () => {
    const db = new MockMetricsDB();
    db.rows = [{ bucket: '2026-09-19', count: 7 }];
    const app = makeApp(db, 's3cret');

    const res = await app.request(
      '/metrics/new-players?bucket=day&since=2026-09-01T00:00:00.000Z&until=2026-09-20T00:00:00.000Z',
      { headers: ADMIN },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      bucket: 'day',
      since: '2026-09-01T00:00:00.000Z',
      until: '2026-09-20T00:00:00.000Z',
      rows: [{ bucket: '2026-09-19', count: 7 }],
    });
    expect(db.lastCall).toEqual({
      bucket: 'day',
      since: '2026-09-01T00:00:00.000Z',
      until: '2026-09-20T00:00:00.000Z',
    });
  });

  it('defaults to day bucket over the last 30 days', async () => {
    const db = new MockMetricsDB();
    const app = makeApp(db, 's3cret');

    const res = await app.request('/metrics/new-players', { headers: ADMIN });
    expect(res.status).toBe(200);
    expect(db.lastCall?.bucket).toBe('day');

    const since = Date.parse(db.lastCall!.since);
    const until = Date.parse(db.lastCall!.until);
    const days = (until - since) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it('rejects an unknown bucket (400) without touching the db', async () => {
    const db = new MockMetricsDB();
    const app = makeApp(db, 's3cret');
    const res = await app.request('/metrics/new-players?bucket=month', { headers: ADMIN });
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

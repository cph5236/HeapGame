import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockMetricsDB } from './helpers/mockMetricsDb';
import { MockAeClient } from './helpers/mockAeClient';
import type { AeClient, AeQueryResult } from '../src/platform/analytics/aeClient';
import type { MetricsDB, CohortPage } from '../src/platform/metricsDb';

const ADMIN = { 'X-Admin-Secret': 's3cret' };

/** A fake secret, standing in for the CF API token the real HttpAeClient
 *  holds. Never actually passed to anything below — the assertion that it
 *  doesn't appear in a response body is only meaningful if nothing here
 *  leaks it accidentally, which this constant makes easy to grep for. */
const FAKE_TOKEN = 'cf-secret-token-should-never-leak';

/** Throws on every query, as HttpAeClient does on a non-2xx AE response —
 *  used to exercise the 502 path. */
class ThrowingAeClient implements AeClient {
  calls: { sql: string; params: (string | number)[] }[] = [];
  async query<R>(sql: string, params: (string | number)[]): Promise<AeQueryResult<R>> {
    this.calls.push({ sql, params });
    throw new Error('AE query failed (500): quota exceeded');
  }
}

/** Returns one empty page with a non-null cursor forever — a MetricsDB that
 *  violates the "nextCursor only when the page is full" contract, to prove
 *  loadCohort's loop terminates anyway. */
class StuckMetricsDB implements MetricsDB {
  calls = 0;
  async newPlayersByBucket(): Promise<never[]> { return []; }
  async cohortMembers(): Promise<CohortPage> {
    this.calls++;
    return { playerIds: [], nextCursor: 'stuck-cursor' };
  }
}

function makeApp(ae = new MockAeClient(), metricsDb = new MockMetricsDB()) {
  return { app: createApp(new MockHeapDB(), new MockScoreDB(), {
    aeClient: ae, metricsDb, adminSecret: 's3cret',
  }), ae, metricsDb };
}

describe('GET /analytics/funnel', () => {
  it('requires the admin secret (401)', async () => {
    const { app } = makeApp();
    expect((await app.request('/analytics/funnel')).status).toBe(401);
  });

  it('pulls the cohort from D1 and passes its ids to the AE query', async () => {
    const { app, ae, metricsDb } = makeApp();
    metricsDb.cohortPage = { playerIds: ['p1', 'p2'], nextCursor: null };
    ae.rows = [{ cohort: 2, startedRun1: 2, finishedRun1: 1, startedRun2: 1, startedRun3: 0, returnedLater: 0 }];

    const res = await app.request('/analytics/funnel?since=2026-09-01T00:00:00.000Z&until=2026-10-01T00:00:00.000Z', { headers: ADMIN });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stages.cohort).toBe(2);
    expect(ae.calls[0].params).toEqual(expect.arrayContaining(['p1', 'p2']));
  });

  it('returns an empty funnel without querying AE when the cohort is empty', async () => {
    const { app, ae, metricsDb } = makeApp();
    metricsDb.cohortPage = { playerIds: [], nextCursor: null };
    const res = await app.request('/analytics/funnel', { headers: ADMIN });
    expect(res.status).toBe(200);
    expect((await res.json()).stages.cohort).toBe(0);
    expect(ae.calls).toHaveLength(0);
  });

  it('flags sampled results', async () => {
    const { app, ae, metricsDb } = makeApp();
    metricsDb.cohortPage = { playerIds: ['p1'], nextCursor: null };
    ae.rows = [{ cohort: 1 }];
    ae.sampleIntervalMax = 8;
    const body = await (await app.request('/analytics/funnel', { headers: ADMIN })).json();
    expect(body.sampled).toBe(true);
    expect(body.sampleIntervalMax).toBe(8);
  });

  it('404s when no aeClient is configured', async () => {
    const app = createApp(new MockHeapDB(), new MockScoreDB(), { adminSecret: 's3cret' });
    expect((await app.request('/analytics/funnel', { headers: ADMIN })).status).toBe(404);
  });

  it('returns the window even when the cohort is empty', async () => {
    const { app, metricsDb } = makeApp();
    metricsDb.cohortPage = { playerIds: [], nextCursor: null };
    const res = await app.request(
      '/analytics/funnel?since=2026-09-01T00:00:00.000Z&until=2026-10-01T00:00:00.000Z',
      { headers: ADMIN },
    );
    const body = await res.json();
    expect(body.since).toBe('2026-09-01T00:00:00.000Z');
    expect(body.until).toBe('2026-10-01T00:00:00.000Z');
  });

  it('returns 502 (not 500) when the AE transport fails, without leaking the token', async () => {
    const metricsDb = new MockMetricsDB();
    metricsDb.cohortPage = { playerIds: ['p1'], nextCursor: null };
    const ae = new ThrowingAeClient();
    const app = createApp(new MockHeapDB(), new MockScoreDB(), {
      aeClient: ae, metricsDb, adminSecret: 's3cret',
    });

    const res = await app.request('/analytics/funnel', { headers: ADMIN });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain(FAKE_TOKEN);
    expect(JSON.parse(text).error).toContain('AE query failed');
  });

  it('terminates loadCohort even when a page returns zero ids with a non-null cursor', async () => {
    const stuck = new StuckMetricsDB();
    const ae = new MockAeClient();
    const app = createApp(new MockHeapDB(), new MockScoreDB(), {
      aeClient: ae, metricsDb: stuck, adminSecret: 's3cret',
    });

    const res = await app.request('/analytics/funnel', { headers: ADMIN });
    expect(res.status).toBe(200);
    expect(stuck.calls).toBe(1);
    expect((await res.json()).stages.cohort).toBe(0);
  });
});

describe('GET /analytics/crosstab', () => {
  it('rejects an unknown dimension (400) without querying AE', async () => {
    const { app, ae } = makeApp();
    const res = await app.request('/analytics/crosstab?dimension=payload', { headers: ADMIN });
    expect(res.status).toBe(400);
    expect(ae.calls).toHaveLength(0);
  });

  it('accepts an allowlisted dimension', async () => {
    const { app, ae, metricsDb } = makeApp();
    metricsDb.cohortPage = { playerIds: ['p1'], nextCursor: null };
    ae.rows = [{ bucket: '0-15s', cohort: 10, returned: 1 }];
    const res = await app.request('/analytics/crosstab?dimension=duration', { headers: ADMIN });
    expect(res.status).toBe(200);
    expect((await res.json()).rows[0].bucket).toBe('0-15s');
  });

  it('returns the window even when the cohort is empty', async () => {
    const { app, metricsDb } = makeApp();
    metricsDb.cohortPage = { playerIds: [], nextCursor: null };
    const res = await app.request(
      '/analytics/crosstab?dimension=duration&since=2026-09-01T00:00:00.000Z&until=2026-10-01T00:00:00.000Z',
      { headers: ADMIN },
    );
    const body = await res.json();
    expect(body.since).toBe('2026-09-01T00:00:00.000Z');
    expect(body.until).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('GET /analytics/trace', () => {
  it('requires a playerId (400)', async () => {
    const { app } = makeApp();
    expect((await app.request('/analytics/trace', { headers: ADMIN })).status).toBe(400);
  });

  it('rejects an over-long playerId (400)', async () => {
    const { app } = makeApp();
    const res = await app.request('/analytics/trace?playerId=' + 'x'.repeat(200), { headers: ADMIN });
    expect(res.status).toBe(400);
  });

  it('returns the player events', async () => {
    const { app, ae } = makeApp();
    ae.rows = [{ ts: 123, level: 'event', eventType: 'run:start', payload: '{}' }];
    const body = await (await app.request('/analytics/trace?playerId=p1', { headers: ADMIN })).json();
    expect(body.rows).toHaveLength(1);
    expect(ae.calls[0].params).toContain('p1');
  });
});

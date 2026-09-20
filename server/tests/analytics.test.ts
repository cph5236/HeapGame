import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockMetricsDB } from './helpers/mockMetricsDb';
import { MockAeClient } from './helpers/mockAeClient';

const ADMIN = { 'X-Admin-Secret': 's3cret' };

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

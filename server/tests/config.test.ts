// server/tests/config.test.ts

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockConfigDB } from './helpers/mockConfigDb';

function makeApp(configDb = new MockConfigDB(), adminSecret?: string) {
  return createApp(new MockHeapDB(), new MockScoreDB(), { configDb, adminSecret });
}

describe('GET /config', () => {
  it('returns the full config map, no admin secret required', async () => {
    const configDb = new MockConfigDB();
    configDb.seed('ad_cadence', { min: 40, max: 50 });
    const app = makeApp(configDb, 's3cret');

    const res = await app.request('/config');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ config: { ad_cadence: { min: 40, max: 50 } } });
  });

  it('returns an empty map when nothing is seeded', async () => {
    const app = makeApp();
    const res = await app.request('/config');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ config: {} });
  });
});

describe('PUT /config/:key', () => {
  it('requires the admin secret when one is configured (401)', async () => {
    const app = makeApp(new MockConfigDB(), 's3cret');
    const res = await app.request('/config/ad_cadence', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: { min: 10, max: 20 } }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects an unknown key (400)', async () => {
    const app = makeApp();
    const res = await app.request('/config/not_a_real_key', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 123 }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed ad_cadence value (400)', async () => {
    const app = makeApp();
    const res = await app.request('/config/ad_cadence', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: { min: 50, max: 40 } }), // min > max
    });
    expect(res.status).toBe(400);
  });

  it('rejects non-object ad_cadence value (400)', async () => {
    const app = makeApp();
    const res = await app.request('/config/ad_cadence', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'not an object' }),
    });
    expect(res.status).toBe(400);
  });

  it('writes a valid value and it is reflected in GET /config', async () => {
    const configDb = new MockConfigDB();
    const app = makeApp(configDb);

    const put = await app.request('/config/ad_cadence', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: { min: 10, max: 20 } }),
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ ok: true, key: 'ad_cadence' });

    const get = await app.request('/config');
    expect(await get.json()).toEqual({ config: { ad_cadence: { min: 10, max: 20 } } });
  });
});

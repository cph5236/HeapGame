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

  it('rejects a key with uppercase letters (400)', async () => {
    const app = makeApp();
    const res = await app.request('/config/Bad_Key', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 1 }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a key starting with a digit (400)', async () => {
    const app = makeApp();
    const res = await app.request('/config/1bad', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 1 }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a key longer than 64 characters (400)', async () => {
    const app = makeApp();
    const longKey = 'a'.repeat(65);
    const res = await app.request(`/config/${longKey}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 1 }),
    });
    expect(res.status).toBe(400);
  });

  it('accepts a key at exactly 64 characters (200)', async () => {
    const app = makeApp();
    const key64 = 'a' + 'b'.repeat(63); // 64 chars total, valid per ^[a-z][a-z0-9_]{0,63}$
    const res = await app.request(`/config/${key64}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 1 }),
    });
    expect(res.status).toBe(200);
  });

  it('rejects a value over the size cap (400)', async () => {
    const app = makeApp();
    const res = await app.request('/config/big_value', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(8200) }),
    });
    expect(res.status).toBe(400);
  });

  it('accepts a value at exactly the size cap (200)', async () => {
    const app = makeApp();
    const value = 'x'.repeat(8190); // JSON.stringify(value).length === 8192 exactly
    const res = await app.request('/config/boundary_key', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    expect(res.status).toBe(200);
  });

  it('rejects a negative daily_min_gap_hours value (400)', async () => {
    const app = makeApp();
    const res = await app.request('/config/daily_min_gap_hours', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: -5 }),
    });
    expect(res.status).toBe(400);
  });

  it('accepts a valid daily_min_gap_hours value (200)', async () => {
    const app = makeApp();
    const res = await app.request('/config/daily_min_gap_hours', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 10 }),
    });
    expect(res.status).toBe(200);
  });

  it('rejects a malformed JSON body (400)', async () => {
    const app = makeApp();
    const res = await app.request('/config/some_key', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    });
    expect(res.status).toBe(400);
  });

  it('rejects a well-formed JSON body missing the "value" field (400, not 500)', async () => {
    const app = makeApp();
    const res = await app.request('/config/some_key', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notValue: 1 }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a non-object top-level JSON body (400, not 500)', async () => {
    const app = makeApp();
    for (const body of ['null', '"a string"', '42', 'true']) {
      const res = await app.request('/config/some_key', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      expect(res.status).toBe(400);
    }
  });

  it('accepts an arbitrary well-formed key with no special validation (200)', async () => {
    const configDb = new MockConfigDB();
    const app = makeApp(configDb);

    const put = await app.request('/config/feature_flag_x', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: true }),
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ ok: true, key: 'feature_flag_x' });

    const get = await app.request('/config');
    expect(await get.json()).toEqual({ config: { feature_flag_x: true } });
  });
});

describe('DELETE /config/:key', () => {
  it('requires the admin secret when one is configured (401)', async () => {
    const app = makeApp(new MockConfigDB(), 's3cret');
    const res = await app.request('/config/ad_cadence', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });

  it('deletes an existing key and it no longer appears in GET /config (200)', async () => {
    const configDb = new MockConfigDB();
    configDb.seed('ad_cadence', { min: 40, max: 50 });
    configDb.seed('other_key', { foo: 'bar' });
    const app = makeApp(configDb);

    const del = await app.request('/config/ad_cadence', { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true, key: 'ad_cadence' });

    const get = await app.request('/config');
    expect(await get.json()).toEqual({ config: { other_key: { foo: 'bar' } } });
  });

  it('is idempotent — deleting a key that never existed still returns 200 (no error)', async () => {
    const app = makeApp();
    const res = await app.request('/config/never_existed', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, key: 'never_existed' });
  });
});

describe('PUT /config/min_version', () => {
  async function put(value: unknown, configDb = new MockConfigDB()) {
    const app = makeApp(configDb);
    return app.request('/config/min_version', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
  }

  it('accepts a bare version', async () => {
    const configDb = new MockConfigDB();
    const res = await put({ version: '0.2.21' }, configDb);
    expect(res.status).toBe(200);

    const get = await makeApp(configDb).request('/config');
    expect(await get.json()).toEqual({ config: { min_version: { version: '0.2.21' } } });
  });

  it('accepts a version with a player-facing message', async () => {
    const res = await put({ version: '0.2.21', message: 'Score submission is broken on this build.' });
    expect(res.status).toBe(200);
  });

  // A bad floor here locks out every player, so the write-time check is strict.
  it('rejects a partial or non-numeric version (400)', async () => {
    for (const version of ['0.2', 'v0.2.21', 'latest', '>=0.2.21', '']) {
      const res = await put({ version });
      expect(res.status).toBe(400);
    }
  });

  it('rejects a bare string instead of an object (400)', async () => {
    const res = await put('0.2.21');
    expect(res.status).toBe(400);
  });

  it('rejects a missing version (400)', async () => {
    const res = await put({ message: 'please update' });
    expect(res.status).toBe(400);
  });

  it('rejects an over-long message (400)', async () => {
    const res = await put({ version: '0.2.21', message: 'x'.repeat(201) });
    expect(res.status).toBe(400);
  });

  it('can be lifted by deleting the key', async () => {
    const configDb = new MockConfigDB();
    expect((await put({ version: '9.9.9' }, configDb)).status).toBe(200);

    const del = await makeApp(configDb).request('/config/min_version', { method: 'DELETE' });
    expect(del.status).toBe(200);

    const get = await makeApp(configDb).request('/config');
    expect(await get.json()).toEqual({ config: {} });
  });
});

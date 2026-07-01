# Generic Remote Config Key Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated admin create, edit, and delete arbitrary remote-config keys from the admin UI, instead of being limited to a single hardcoded `ad_cadence` allowlist entry.

**Architecture:** `PUT /config/:key` drops its static `ALLOWED_KEYS` allowlist in favor of generic validation (key-name pattern, JSON well-formedness, value size cap), while `ad_cadence` keeps its existing specific shape check as an extra special-cased rule. A new `DELETE /config/:key` route is added. `ConfigDB` (and its `D1`/`Mock`/`Cached` implementations) gain a `delete(key)` method. The admin UI's hardcoded "Ad Cadence" section is replaced with a generic panel: one editable row per existing key, plus an "Add new key" form. No schema, migration, or client-consumption changes — `ConfigClient`/`AdCadence.ts` are untouched.

**Tech Stack:** Cloudflare D1 (SQLite), Cloudflare Workers KV, Hono, TypeScript, Vitest.

## Global Constraints

- No new D1 database, table, or migration — `app_config`'s schema (`key`/`value`/`updated_at`) is already generic and unchanged.
- `PUT /config/:key` key format: `^[a-z][a-z0-9_]{0,63}$` (lowercase snake_case, starts with a letter, max 64 chars) — reject with 400 otherwise.
- `PUT /config/:key` value size cap: `JSON.stringify(value).length` must not exceed 8192 — reject with 400 otherwise.
- `ad_cadence` keeps its existing specific validation (object, numeric `min`/`max`, both finite, both > 0, `min <= max`) as an additional check layered on top of the generic ones — every other key only gets the generic checks.
- `GET /config` stays public (no admin gate); `PUT /config/:key` and the new `DELETE /config/:key` both require `X-Admin-Secret` via the existing `adminGate` middleware.
- `DELETE /config/:key` is idempotent (200 whether or not the key existed) and applies no key-format check (an already-invalid/typo'd key must still be deletable).
- Follow existing repo conventions exactly: `ConfigDB`/`D1ConfigDB`/`MockConfigDB`/`CachedConfigDB` all implement the same interface; JSON.stringify/JSON.parse for the blob column; `ON CONFLICT ... DO UPDATE` upserts (already in place, unchanged).
- Run `npm run build` (root) before claiming any task done.

---

## Task 1: `ConfigDB.delete()` across the data layer

**Files:**
- Modify: `server/src/configDb.ts`
- Modify: `server/tests/helpers/mockConfigDb.ts`
- Modify: `server/src/cache/CachedConfigDB.ts`
- Modify: `server/tests/cacheDecorators.test.ts`

**Interfaces:**
- Consumes: nothing new — extends the existing `ConfigDB` interface, `D1ConfigDB`, `MockConfigDB`, `CachedConfigDB` from the merged `feature/remote-config` work.
- Produces: `ConfigDB.delete(key: string): Promise<void>` (no-op if the key doesn't exist) — implemented on `D1ConfigDB`, `MockConfigDB`, and `CachedConfigDB`. Task 2's route layer calls this.

- [ ] **Step 1: Write the failing `CachedConfigDB.delete()` tests**

Read `server/tests/cacheDecorators.test.ts` first. Inside the existing `describe('CachedConfigDB', () => { ... })` block (after the existing `it('set writes through...')` test, before the closing `});` of that describe block), add:

```ts
  it('delete removes the key from the inner store and invalidates the cache', async () => {
    const { inner, kv, cached } = setup();
    inner.seed('ad_cadence', { min: 40, max: 50 });
    inner.seed('other_key', { foo: 'bar' });
    await cached.getAll(); // populate cache
    expect(kv.has('cache:config:all')).toBe(true);

    await cached.delete('ad_cadence');
    expect(kv.deletes).toContain('cache:config:all');

    const after = await cached.getAll();
    expect(after).toEqual({ other_key: { foo: 'bar' } });
  });

  it('delete is a no-op (not an error) for a key that does not exist', async () => {
    const { inner, kv, cached } = setup();
    inner.seed('ad_cadence', { min: 40, max: 50 });

    await expect(cached.delete('nonexistent_key')).resolves.toBeUndefined();
    const after = await cached.getAll();
    expect(after).toEqual({ ad_cadence: { min: 40, max: 50 } });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npx vitest run tests/cacheDecorators.test.ts`
Expected: FAIL — `cached.delete is not a function`.

- [ ] **Step 3: Add `delete()` to the `ConfigDB` interface and `D1ConfigDB`**

In `server/src/configDb.ts`, add to the `ConfigDB` interface (after the existing `set` method):

```ts
  /** Remove a key. No-op (not an error) if the key doesn't exist. */
  delete(key: string): Promise<void>;
```

Add to the `D1ConfigDB` class (after the existing `set` method):

```ts
  async delete(key: string): Promise<void> {
    await this.d1.prepare('DELETE FROM app_config WHERE key = ?1').bind(key).run();
  }
```

- [ ] **Step 4: Add `delete()` to `MockConfigDB`**

In `server/tests/helpers/mockConfigDb.ts`, add to the `MockConfigDB` class (after the existing `set` method):

```ts
  async delete(key: string): Promise<void> {
    this.rows.delete(key);
  }
```

- [ ] **Step 5: Add `delete()` to `CachedConfigDB`**

In `server/src/cache/CachedConfigDB.ts`, add to the `CachedConfigDB` class (after the existing `set` method):

```ts
  async delete(key: string): Promise<void> {
    await this.inner.delete(key);
    await this.kv.delete(CONFIG_KEY);
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd server && npx vitest run tests/cacheDecorators.test.ts`
Expected: PASS, all tests including the two new `delete()` tests.

- [ ] **Step 7: Commit**

```bash
git add server/src/configDb.ts server/tests/helpers/mockConfigDb.ts server/src/cache/CachedConfigDB.ts server/tests/cacheDecorators.test.ts
git commit -m "feat(config): add ConfigDB.delete() across D1/Mock/Cached implementations"
```

---

## Task 2: Generic PUT validation + DELETE route

**Files:**
- Modify: `server/src/routes/config.ts`
- Modify: `server/src/app.ts`
- Modify: `server/tests/config.test.ts`

**Interfaces:**
- Consumes: `ConfigDB.delete(key)` from Task 1.
- Produces: no new exports for other tasks — `configRoutes(configDb: ConfigDB): Hono` keeps its existing signature; the routes it returns change behavior (generic PUT validation, new DELETE handler). Task 3 (admin UI) is the only remaining consumer, calling these routes over HTTP, not importing anything from this file.

- [ ] **Step 1: Rewrite `server/tests/config.test.ts` with the new failing tests**

Read the current `server/tests/config.test.ts` first. Replace its entire contents with:

```ts
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

  it('rejects a value over the size cap (400)', async () => {
    const app = makeApp();
    const res = await app.request('/config/big_value', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(8200) }),
    });
    expect(res.status).toBe(400);
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npx vitest run tests/config.test.ts`
Expected: FAIL — the generic-key tests fail because `feature_flag_x`/`big_value`/etc. are rejected by the old `ALLOWED_KEYS` check (or the DELETE tests fail with 404-routing/`configDb.delete is not a function`, since the DELETE route doesn't exist yet).

- [ ] **Step 3: Rewrite `server/src/routes/config.ts`**

Read the current file first, then replace its entire contents with:

```ts
// server/src/routes/config.ts

import { Hono } from 'hono';
import type { ConfigDB } from '../configDb';

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_VALUE_LENGTH = 8192;

function validateKeyFormat(key: string): string | null {
  if (!KEY_PATTERN.test(key)) {
    return 'key must be lowercase snake_case, start with a letter, max 64 characters';
  }
  return null;
}

function validateValueSize(value: unknown): string | null {
  if (JSON.stringify(value).length > MAX_VALUE_LENGTH) {
    return `value too large (max ${MAX_VALUE_LENGTH} characters of JSON)`;
  }
  return null;
}

/**
 * Extra shape checks for keys the game currently reads. This is defense in
 * depth on keys with real behavioral effect — it does not gate which keys
 * can be created; any key passing validateKeyFormat/validateValueSize can be
 * written even if it has no case here.
 */
function validateKnownKeyShape(key: string, value: unknown): string | null {
  if (key === 'ad_cadence') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return 'value must be an object';
    }
    const v = value as Record<string, unknown>;
    if (typeof v.min !== 'number' || typeof v.max !== 'number') {
      return 'min and max must be numbers';
    }
    if (!Number.isFinite(v.min) || !Number.isFinite(v.max)) {
      return 'min and max must be finite';
    }
    if (v.min <= 0 || v.max <= 0) {
      return 'min and max must be > 0';
    }
    if (v.min > v.max) {
      return 'min must be <= max';
    }
  }
  return null;
}

export function configRoutes(configDb: ConfigDB): Hono {
  const app = new Hono();

  // Public read — client boot fetch, no admin gate.
  app.get('/', async (c) => {
    const config = await configDb.getAll();
    return c.json({ config });
  });

  // Admin write (adminGate applied in app.ts). Any key matching the naming
  // pattern is writable — there is no fixed allowlist. An unread key is
  // inert (no code consumes it), so the risk is clutter, not breakage.
  app.put('/:key', async (c) => {
    const key = c.req.param('key');
    const keyErr = validateKeyFormat(key);
    if (keyErr) return c.json({ error: keyErr }, 400);

    let body: { value?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid request' }, 400);
    }

    const sizeErr = validateValueSize(body.value);
    if (sizeErr) return c.json({ error: sizeErr }, 400);

    const shapeErr = validateKnownKeyShape(key, body.value);
    if (shapeErr) return c.json({ error: shapeErr }, 400);

    await configDb.set(key, body.value, new Date().toISOString());
    return c.json({ ok: true, key });
  });

  // Admin delete (adminGate applied in app.ts). Idempotent — deleting a
  // nonexistent key is not an error. No key-format check, so an
  // already-invalid/typo'd key can still be removed.
  app.delete('/:key', async (c) => {
    const key = c.req.param('key');
    await configDb.delete(key);
    return c.json({ ok: true, key });
  });

  return app;
}
```

- [ ] **Step 4: Wire the admin gate onto the new DELETE route in `app.ts`**

Read `server/src/app.ts` first. Find this existing block:

```ts
  if (opts.configDb) {
    // Public read — no admin gate.
    // Admin write — behind the admin gate.
    app.put('/config/:key', adminGate);
    app.route('/config', configRoutes(opts.configDb));
  }
```

Replace it with:

```ts
  if (opts.configDb) {
    // Public read — no admin gate.
    // Admin write/delete — behind the admin gate.
    app.put('/config/:key', adminGate);
    app.delete('/config/:key', adminGate);
    app.route('/config', configRoutes(opts.configDb));
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && npx vitest run tests/config.test.ts`
Expected: PASS, all 15 tests (2 in `GET /config` + 10 in `PUT /config/:key` + 3 in `DELETE /config/:key`).

- [ ] **Step 6: Run the full server test suite to check for regressions**

Run: `cd server && npm test`
Expected: PASS, all tests green. The server suite was at 215 passing before this task; this file goes from 7 tests to 15 (+8), and Task 1 added 2 more to `cacheDecorators.test.ts`, so the suite should land at 225.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/config.ts server/src/app.ts server/tests/config.test.ts
git commit -m "feat(config): replace static key allowlist with generic validation + add DELETE /config/:key"
```

---

## Task 3: Admin UI generic key-management panel

**Files:**
- Modify: `admin/index.html`

**Interfaces:**
- Consumes: `GET /config`, `PUT /config/:key`, `DELETE /config/:key` (Task 2); existing `adminFetch()`, `$()`, `setStatus()`, `escapeHtml()`, `serverUrl()` helpers already defined in this file.
- Produces: nothing consumed by other tasks — this is a standalone static page, and no other task depends on its internals.

No automated test exists for `admin/index.html` (consistent with the original feature — none of the existing sections have one); verification is manual/curl-based against the local `wrangler dev` server.

- [ ] **Step 1: Replace the "Remote Config" section markup**

Read `admin/index.html` first. Find this existing block (around line 196):

```html
  <div class="section section-config">
    <h2>Remote Config</h2>
    <h3 style="color: #aaa; font-size: 13px;">Ad Cadence</h3>
    <div class="row">
      <div><label>Min runs between ads</label><input type="number" step="1" min="1" id="cfg-adCadenceMin" /></div>
      <div><label>Max runs between ads</label><input type="number" step="1" min="1" id="cfg-adCadenceMax" /></div>
    </div>
    <button id="cfg-save">Save Ad Cadence</button>
  </div>
```

Replace it with:

```html
  <div class="section section-config">
    <h2>Remote Config</h2>
    <div id="cfg-rows"></div>
    <h3 style="color: #aaa; font-size: 13px;">Add New Key</h3>
    <div class="row">
      <div><label>Key name</label><input type="text" id="cfg-newKey" placeholder="my_new_key" /></div>
    </div>
    <label>Value (JSON)</label><br />
    <textarea id="cfg-newValue" rows="4" style="width:100%; font-family:monospace;"></textarea>
    <button id="cfg-create">Create</button>
  </div>
```

- [ ] **Step 2: Replace the "Remote Config" script section**

Find this existing block (around line 544):

```javascript
    // ────── Remote Config ────────────────────────────────────────────────────

    async function loadConfig() {
      try {
        const res = await fetch(serverUrl() + '/config');
        if (!res.ok) throw new Error('config load failed: ' + res.status);
        const data = await res.json();
        const cadence = (data.config && data.config.ad_cadence) || { min: '', max: '' };
        $('cfg-adCadenceMin').value = cadence.min;
        $('cfg-adCadenceMax').value = cadence.max;
      } catch (e) {
        setStatus(String(e), 'err');
      }
    }

    async function onSaveConfig() {
      const min = Number($('cfg-adCadenceMin').value);
      const max = Number($('cfg-adCadenceMax').value);
      try {
        const res = await adminFetch('/config/ad_cadence', {
          method: 'PUT',
          body: JSON.stringify({ value: { min, max } }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || ('save failed: ' + res.status));
        }
        setStatus('ad cadence saved', 'ok');
      } catch (e) {
        setStatus(String(e), 'err');
      }
    }

    function bootConfig() {
      $('cfg-save').onclick = onSaveConfig;
      loadConfig();
    }
```

Replace it with:

```javascript
    // ────── Remote Config ────────────────────────────────────────────────────

    let cachedConfig = {};

    function renderConfigRows() {
      const container = $('cfg-rows');
      const keys = Object.keys(cachedConfig).sort();
      if (!keys.length) {
        container.innerHTML = '<p class="muted">no config keys yet</p>';
        return;
      }
      container.innerHTML = keys.map(key => {
        const pretty = escapeHtml(JSON.stringify(cachedConfig[key], null, 2));
        return `<div class="cfg-row" style="margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong>${escapeHtml(key)}</strong>
            <button class="btn-sm btn-danger" onclick="onDeleteConfigKey('${key}')">Delete</button>
          </div>
          <textarea class="cfg-value" data-key="${escapeHtml(key)}" rows="4" style="width:100%; font-family:monospace;">${pretty}</textarea>
          <button onclick="onSaveConfigKey('${key}')">Save</button>
        </div>`;
      }).join('');
    }

    async function loadConfig() {
      try {
        const res = await fetch(serverUrl() + '/config');
        if (!res.ok) throw new Error('config load failed: ' + res.status);
        const data = await res.json();
        cachedConfig = data.config || {};
        renderConfigRows();
      } catch (e) {
        setStatus(String(e), 'err');
      }
    }

    async function onSaveConfigKey(key) {
      const textarea = document.querySelector('textarea.cfg-value[data-key="' + key + '"]');
      let value;
      try {
        value = JSON.parse(textarea.value);
      } catch (e) {
        setStatus('invalid JSON for ' + key, 'err');
        return;
      }
      try {
        const res = await adminFetch('/config/' + key, {
          method: 'PUT',
          body: JSON.stringify({ value }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || ('save failed: ' + res.status));
        }
        setStatus('saved ' + key, 'ok');
        loadConfig();
      } catch (e) {
        setStatus(String(e), 'err');
      }
    }

    async function onDeleteConfigKey(key) {
      if (!confirm('Delete config key "' + key + '"? This cannot be undone.')) return;
      try {
        const res = await adminFetch('/config/' + key, { method: 'DELETE' });
        if (!res.ok) throw new Error('delete failed: ' + res.status);
        setStatus('deleted ' + key, 'ok');
        loadConfig();
      } catch (e) {
        setStatus(String(e), 'err');
      }
    }

    async function onCreateConfigKey() {
      const key = $('cfg-newKey').value.trim();
      if (!key) { setStatus('key name required', 'err'); return; }
      if (Object.prototype.hasOwnProperty.call(cachedConfig, key)) {
        setStatus('key already exists — edit it in the list above instead', 'err');
        return;
      }
      let value;
      try {
        value = JSON.parse($('cfg-newValue').value);
      } catch (e) {
        setStatus('invalid JSON value', 'err');
        return;
      }
      try {
        const res = await adminFetch('/config/' + key, {
          method: 'PUT',
          body: JSON.stringify({ value }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || ('create failed: ' + res.status));
        }
        setStatus('created ' + key, 'ok');
        $('cfg-newKey').value = '';
        $('cfg-newValue').value = '';
        loadConfig();
      } catch (e) {
        setStatus(String(e), 'err');
      }
    }

    function bootConfig() {
      $('cfg-create').onclick = onCreateConfigKey;
      loadConfig();
    }
```

Note: the `DOMContentLoaded` handler at the bottom of the file already calls `bootConfig()` — its name and call site are unchanged, so no edit is needed there.

- [ ] **Step 3: Manual verification**

Start the backend worker dev server (separate from the Vite client dev server on port 3000 — do not touch anything on port 3000):

```bash
cd server && npx wrangler dev
```

In a browser, open `admin/index.html` (a `file://` path is fine), set Server URL to `http://localhost:8787` in the Settings section and save. Confirm:
1. The Remote Config section renders one row for `ad_cadence` with its current JSON value in the textarea.
2. Edit the `ad_cadence` textarea (e.g. change `max` to `55`), click its Save button, confirm the status line shows "saved ad_cadence", reload the page, confirm the change persisted.
3. In "Add New Key", enter `test_flag` as the key name and `true` as the value, click Create. Confirm a new row for `test_flag` appears after reload.
4. Click Delete on the `test_flag` row, confirm the browser `confirm()` dialog appears, accept it, confirm the row disappears after reload.
5. Try creating a key with an invalid name (e.g. `Bad Key` with a space) and confirm the server rejects it with a visible error in the status line.

Stop the `wrangler dev` process when done.

- [ ] **Step 4: Commit**

```bash
git add admin/index.html
git commit -m "feat(config): generic add/edit/delete key management in admin UI"
```

---

## Task 4: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full server test suite**

Run: `cd server && npm test`
Expected: all tests pass, including every test added in Tasks 1 and 2.

- [ ] **Step 2: Run the full client test suite**

Run: `npm test` (from repo root)
Expected: all tests pass — this change touches no client code, so this run is a regression check only.

- [ ] **Step 3: Run the production build**

Run: `npm run build` (from repo root)
Expected: no TypeScript errors, build succeeds.

- [ ] **Step 4: Confirm no schema/migration drift**

Run:
```bash
cd server && npx wrangler d1 execute heap_core --local --command "SELECT sql FROM sqlite_master WHERE name = 'app_config'"
```
Expected: unchanged from before this plan — this feature adds no migration, so the table shape must be identical to what Tasks 1-9 of the original remote-config plan left it as.

- [ ] **Step 5: Report status**

No commit for this task — it's verification-only. Summarize pass/fail for each step above to the user before considering the feature done.

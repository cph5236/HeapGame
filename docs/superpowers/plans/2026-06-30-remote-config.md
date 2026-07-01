# Remote Config System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `AD_CADENCE_MIN`/`AD_CADENCE_MAX` out of the client bundle into a server-controlled, admin-editable config store, built as a general-purpose key/value remote-config mechanism so future global tunables can reuse it.

**Architecture:** A new `app_config` table in the existing `heap_core` D1 database (`DB_HEAP` binding — no new database). `GET /config` (public, KV-cached) returns the full key→value map; `PUT /config/:key` (admin-gated, allowlisted keys) writes D1 and invalidates the cache. The client fetches once at boot into an in-memory cache with a hardcoded-default fallback; `AdCadence.ts` reads from it via a `currentRange()` accessor. A minimal panel is added to the static `admin/index.html` page to edit `ad_cadence` without crafting curl commands.

**Tech Stack:** Cloudflare D1 (SQLite), Cloudflare Workers KV, Hono, TypeScript, Vitest.

## Global Constraints

- New table lives in `heap_core` (`DB_HEAP` binding) — no new D1 database or wrangler binding.
- Config values are JSON-encoded in a `TEXT` column, one row per key — same shape as `heap_parameters.enemy_params`.
- `PUT /config/:key` only accepts keys in a server-side allowlist (starts with `['ad_cadence']`) — no free-form key creation.
- `GET /config` is public (no admin gate); `PUT /config/:key` requires `X-Admin-Secret`, same middleware as existing admin routes.
- Client fetch is fire-and-forget at boot; on failure/timeout, code must fall back to the existing hardcoded `AD_CADENCE_MIN`/`AD_CADENCE_MAX` constants — never block gameplay on this network call.
- Follow existing repo conventions exactly: `D1<Name>DB` / `Cached<Name>DB` / `Mock<Name>DB` triad, `JSON.stringify`/`JSON.parse` for blob columns, `ON CONFLICT ... DO UPDATE` upserts.
- Run `npm run build` (root) before claiming any task done — it catches TS errors tests miss.

---

## Task 1: Shared types, migration, and schema

**Files:**
- Create: `shared/configTypes.ts`
- Create: `server/migrations/heap_core/0002_app_config.sql`
- Modify: `server/schema/heap_core.sql`

**Interfaces:**
- Produces: `AppConfig = Record<string, unknown>`, `GetConfigResponse { config: AppConfig }`, `UpdateConfigRequest { value: unknown }`, `AdCadenceConfig { min: number; max: number }` — all later tasks (server routes, client) import these from `shared/configTypes.ts`.

This task has no independent behavior to test (pure types + SQL DDL) — verification is a clean migration apply, not a Vitest run.

- [ ] **Step 1: Create the shared types file**

`shared/configTypes.ts`:
```ts
// shared/configTypes.ts
//
// Contract shared by the worker (server/src/routes/config.ts, configDb.ts),
// the client (src/systems/ConfigClient.ts), and tests.

/** Full config map as returned by GET /config: key -> arbitrary JSON value. */
export type AppConfig = Record<string, unknown>;

/** GET /config 200 body. */
export interface GetConfigResponse {
  config: AppConfig;
}

/** PUT /config/:key request body. */
export interface UpdateConfigRequest {
  value: unknown;
}

/** Shape of the 'ad_cadence' config value. */
export interface AdCadenceConfig {
  min: number;
  max: number;
}
```

- [ ] **Step 2: Write the migration**

`server/migrations/heap_core/0002_app_config.sql`:
```sql
-- server/migrations/heap_core/0002_app_config.sql
-- Generic global config store. One row per key; value is JSON-encoded.
-- Not per-heap — this is app-wide state (e.g. ad cadence), unlike `heap`/
-- `heap_parameters` which are keyed by heap_id.

CREATE TABLE IF NOT EXISTS app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO app_config (key, value, updated_at) VALUES (
  'ad_cadence', '{"min":40,"max":50}', datetime('now')
);
```

- [ ] **Step 3: Update the reference schema file**

Read `server/schema/heap_core.sql` first, then append (after the `heap_parameters` seed `INSERT`, matching the existing "final intended state" convention):

```sql

-- Generic global config store. One row per key; value is JSON-encoded.
-- Not per-heap — this is app-wide state (e.g. ad cadence).
CREATE TABLE IF NOT EXISTS app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO app_config (key, value, updated_at) VALUES (
  'ad_cadence', '{"min":40,"max":50}', datetime('now')
);
```

- [ ] **Step 4: Apply the migration locally and verify**

Run:
```bash
cd server && npx wrangler d1 migrations apply heap_core --local
```
Expected: migration `0002_app_config.sql` listed as applied, no errors.

Then verify the seed row landed:
```bash
cd server && npx wrangler d1 execute heap_core --local --command "SELECT * FROM app_config"
```
Expected: one row, `key = ad_cadence`, `value = {"min":40,"max":50}`.

- [ ] **Step 5: Commit**

```bash
git add shared/configTypes.ts server/migrations/heap_core/0002_app_config.sql server/schema/heap_core.sql
git commit -m "feat(config): add app_config table and shared types"
```

---

## Task 2: ConfigDB + CachedConfigDB (server data layer)

**Files:**
- Create: `server/src/configDb.ts`
- Create: `server/tests/helpers/mockConfigDb.ts`
- Create: `server/src/cache/CachedConfigDB.ts`
- Modify: `server/tests/cacheDecorators.test.ts`

**Interfaces:**
- Consumes: `AppConfig` from `shared/configTypes.ts` (Task 1).
- Produces: `ConfigDB` interface (`getAll(): Promise<AppConfig>`, `set(key: string, value: unknown, now: string): Promise<void>`), `D1ConfigDB implements ConfigDB`, `MockConfigDB implements ConfigDB` (test helper, has a `seed(key, value)` method for direct seeding), `CachedConfigDB implements ConfigDB`. Task 3 (routes) constructs `configDb: ConfigDB` and calls `getAll()`/`set()`. Task 4 (worker entrypoint) constructs `new CachedConfigDB(new D1ConfigDB(env.DB_HEAP), env.CACHE, w)`.

- [ ] **Step 1: Write `ConfigDB` interface and `D1ConfigDB`**

`server/src/configDb.ts`:
```ts
// server/src/configDb.ts

import type { AppConfig } from '../../shared/configTypes';

/** Abstraction over D1 for global config key/value storage. Allows MockConfigDB in tests. */
export interface ConfigDB {
  /** All config rows as a key -> parsed-JSON-value map. */
  getAll(): Promise<AppConfig>;

  /** Upsert a single key's value (JSON-encoded on write). */
  set(key: string, value: unknown, now: string): Promise<void>;
}

/** Production implementation backed by Cloudflare D1. */
export class D1ConfigDB implements ConfigDB {
  constructor(private d1: D1Database) {}

  async getAll(): Promise<AppConfig> {
    const res = await this.d1
      .prepare('SELECT key, value FROM app_config')
      .all<{ key: string; value: string }>();

    const out: AppConfig = {};
    for (const row of res.results) {
      try {
        out[row.key] = JSON.parse(row.value);
      } catch {
        // Malformed row (should not happen via our own writes) — skip it
        // rather than failing the whole config fetch.
      }
    }
    return out;
  }

  async set(key: string, value: unknown, now: string): Promise<void> {
    await this.d1
      .prepare(
        `INSERT INTO app_config (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .bind(key, JSON.stringify(value), now)
      .run();
  }
}
```

- [ ] **Step 2: Write `MockConfigDB` test helper**

`server/tests/helpers/mockConfigDb.ts`:
```ts
// server/tests/helpers/mockConfigDb.ts

import type { ConfigDB } from '../../src/configDb';
import type { AppConfig } from '../../../shared/configTypes';

/** In-memory ConfigDB for tests. Same get/set semantics as D1ConfigDB. */
export class MockConfigDB implements ConfigDB {
  private rows = new Map<string, unknown>();

  async getAll(): Promise<AppConfig> {
    return Object.fromEntries(this.rows);
  }

  async set(key: string, value: unknown, _now: string): Promise<void> {
    this.rows.set(key, value);
  }

  /** Test helper — seed a row directly without going through set(). */
  seed(key: string, value: unknown): void {
    this.rows.set(key, value);
  }
}
```

- [ ] **Step 3: Write the failing `CachedConfigDB` test**

Read `server/tests/cacheDecorators.test.ts` first (it's the file being modified). Add these imports at the top alongside the existing ones:
```ts
import { CachedConfigDB } from '../src/cache/CachedConfigDB';
import { MockConfigDB } from './helpers/mockConfigDb';
```

Then append this new `describe` block at the end of the file, before the final closing (i.e. as a new top-level block after the existing `describe('CachedScoreDB', ...)` block):
```ts
describe('CachedConfigDB', () => {
  function setup() {
    const inner = new MockConfigDB();
    const kv = new MockKV();
    const cached = new CachedConfigDB(inner, kv.asKV(), noWait);
    return { inner, kv, cached };
  }

  it('getAll populates the cache on a miss, then serves the cached map on a hit', async () => {
    const { inner, kv, cached } = setup();
    inner.seed('ad_cadence', { min: 40, max: 50 });

    const first = await cached.getAll();
    expect(first).toEqual({ ad_cadence: { min: 40, max: 50 } });
    expect(kv.has('cache:config:all')).toBe(true);

    // Mutate the inner map directly (no invalidation) — a cache hit must
    // still return the stale cached value, proving the second read didn't
    // hit the inner store.
    inner.seed('ad_cadence', { min: 1, max: 2 });
    const second = await cached.getAll();
    expect(second).toEqual({ ad_cadence: { min: 40, max: 50 } });
  });

  it('set writes through to the inner store and invalidates the cache', async () => {
    const { inner, kv, cached } = setup();
    inner.seed('ad_cadence', { min: 40, max: 50 });
    await cached.getAll(); // populate cache
    expect(kv.has('cache:config:all')).toBe(true);

    await cached.set('ad_cadence', { min: 10, max: 20 }, 'now');
    expect(kv.deletes).toContain('cache:config:all');
    expect(kv.has('cache:config:all')).toBe(false);

    const after = await cached.getAll();
    expect(after).toEqual({ ad_cadence: { min: 10, max: 20 } });
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd server && npx vitest run tests/cacheDecorators.test.ts`
Expected: FAIL — `Cannot find module '../src/cache/CachedConfigDB'`.

- [ ] **Step 5: Implement `CachedConfigDB`**

`server/src/cache/CachedConfigDB.ts`:
```ts
// server/src/cache/CachedConfigDB.ts
//
// Workers KV decorator over a ConfigDB. The whole config map is small (a
// handful of keys), so it's cached as a single KV entry rather than one key
// per config key — mirrors CachedScoreDB's single-key-per-heap approach,
// simplified further since there's no per-request variability (no limit
// param) to slice around.

import type { ConfigDB } from '../configDb';
import type { AppConfig } from '../../../shared/configTypes';

const CONFIG_KEY = 'cache:config:all';
/** Config tolerates brief staleness; write-invalidation is the primary path. */
const CONFIG_TTL = 300;

export class CachedConfigDB implements ConfigDB {
  constructor(
    private inner: ConfigDB,
    private kv: KVNamespace,
    private waitUntil: (p: Promise<unknown>) => void,
  ) {}

  async getAll(): Promise<AppConfig> {
    const hit = await this.kv.get<AppConfig>(CONFIG_KEY, 'json');
    if (hit) return hit;

    const all = await this.inner.getAll();
    this.waitUntil(this.kv.put(CONFIG_KEY, JSON.stringify(all), { expirationTtl: CONFIG_TTL }));
    return all;
  }

  async set(key: string, value: unknown, now: string): Promise<void> {
    await this.inner.set(key, value, now);
    await this.kv.delete(CONFIG_KEY);
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd server && npx vitest run tests/cacheDecorators.test.ts`
Expected: PASS, all tests including the two new `CachedConfigDB` tests.

- [ ] **Step 7: Commit**

```bash
git add server/src/configDb.ts server/tests/helpers/mockConfigDb.ts server/src/cache/CachedConfigDB.ts server/tests/cacheDecorators.test.ts
git commit -m "feat(config): add ConfigDB and CachedConfigDB data layer"
```

---

## Task 3: Config routes + admin-gated write

**Files:**
- Create: `server/src/routes/config.ts`
- Modify: `server/src/app.ts`
- Create: `server/tests/config.test.ts`

**Interfaces:**
- Consumes: `ConfigDB` (`getAll`, `set`) from Task 2; `GetConfigResponse`, `UpdateConfigRequest` from Task 1; `requireAdminSecret` from `server/src/middleware/adminAuth.ts` (existing).
- Produces: `configRoutes(configDb: ConfigDB): Hono` mounted at `/config`; `AppOptions.configDb?: ConfigDB` added to `createApp`'s options. Task 4 passes `configDb` when constructing the app in `index.ts`.

- [ ] **Step 1: Write the failing route tests**

`server/tests/config.test.ts`:
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npx vitest run tests/config.test.ts`
Expected: FAIL — `Cannot find module '../src/routes/config'` (or `configDb` not a recognized `AppOptions` key, since `app.ts` hasn't been touched yet).

- [ ] **Step 3: Write the route implementation**

`server/src/routes/config.ts`:
```ts
// server/src/routes/config.ts

import { Hono } from 'hono';
import type { ConfigDB } from '../configDb';

/** Keys that PUT /config/:key is allowed to write. Add new keys here as they're introduced. */
const ALLOWED_KEYS: ReadonlySet<string> = new Set(['ad_cadence']);

function validateValue(key: string, value: unknown): string | null {
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

  // Admin write (adminGate applied in app.ts).
  app.put('/:key', async (c) => {
    const key = c.req.param('key');
    if (!ALLOWED_KEYS.has(key)) return c.json({ error: 'unknown config key' }, 400);

    let body: { value?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid request' }, 400);
    }

    const err = validateValue(key, body.value);
    if (err) return c.json({ error: err }, 400);

    await configDb.set(key, body.value, new Date().toISOString());
    return c.json({ ok: true, key });
  });

  return app;
}
```

- [ ] **Step 4: Wire the route into `app.ts`**

Read `server/src/app.ts` first. Add the import near the other route imports:
```ts
import { configRoutes } from './routes/config';
```

Add to the `ConfigDB` type import and `AppOptions` interface (near the `codeDb`/`feedbackDb` options):
```ts
import type { ConfigDB } from './configDb';
```
```ts
  /** Config D1 access. If unset, /config is not mounted. */
  configDb?: ConfigDB;
```

Add the mounting block (after the existing `if (opts.feedbackDb) { ... }` block, before `if (opts.logSink)`):
```ts
  if (opts.configDb) {
    // Public read — no admin gate.
    // Admin write — behind the admin gate.
    app.put('/config/:key', adminGate);
    app.route('/config', configRoutes(opts.configDb));
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && npx vitest run tests/config.test.ts`
Expected: PASS, all 7 tests.

- [ ] **Step 6: Run the full server test suite to check for regressions**

Run: `cd server && npm test`
Expected: PASS, all existing + new tests green.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/config.ts server/src/app.ts server/tests/config.test.ts
git commit -m "feat(config): add GET/PUT /config routes with admin gate"
```

---

## Task 4: Worker entrypoint wiring

**Files:**
- Modify: `server/src/index.ts`

**Interfaces:**
- Consumes: `D1ConfigDB`, `CachedConfigDB` from Task 2; `configDb` option on `createApp` from Task 3.
- Produces: `/config` live when the worker runs locally (`wrangler dev`) or deployed — no new exported symbols for other tasks to consume.

- [ ] **Step 1: Wire `D1ConfigDB`/`CachedConfigDB` into the worker**

Read `server/src/index.ts` first. Add the import:
```ts
import { D1ConfigDB } from './configDb';
import { CachedConfigDB } from './cache/CachedConfigDB';
```

In the `fetch` handler, add alongside the existing `heapDb`/`scoreDb` construction:
```ts
    const configDb = new CachedConfigDB(new D1ConfigDB(env.DB_HEAP), env.CACHE, w);
```

Pass it into `createApp`'s options object (alongside `codeDb`, `feedbackDb`):
```ts
      configDb,
```

- [ ] **Step 2: Build to confirm no TS errors**

Run: `cd server && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual smoke test against local wrangler dev**

Run (in one terminal, leave running):
```bash
cd server && npx wrangler dev
```

In another terminal:
```bash
curl -s http://localhost:8787/config
```
Expected: `{"config":{"ad_cadence":{"min":40,"max":50}}}` (assuming Task 1's local migration was applied).

```bash
curl -s -X PUT http://localhost:8787/config/ad_cadence -H 'Content-Type: application/json' -d '{"value":{"min":10,"max":20}}'
```
Expected: `{"ok":true,"key":"ad_cadence"}` if the worker has no `ADMIN_SECRET` configured locally (matches existing local-dev behavior for `/heaps`/`/codes` admin routes — `requireAdminSecret` is a no-op when `secret` is unset).

```bash
curl -s http://localhost:8787/config
```
Expected: reflects the updated value, `{"config":{"ad_cadence":{"min":10,"max":20}}}`.

Stop the `wrangler dev` process when done.

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(config): wire ConfigDB into the worker entrypoint"
```

---

## Task 5: Client ConfigClient

**Files:**
- Create: `src/systems/ConfigClient.ts`
- Create: `src/systems/__tests__/ConfigClient.test.ts`

**Interfaces:**
- Consumes: `fetchWithLog` from `src/logging/fetchWithLog.ts` (existing); `GetConfigResponse`, `AppConfig` from `shared/configTypes.ts` (Task 1).
- Produces: `primeConfig(): void`, `getConfigValue<T>(key: string): T | undefined`, `resetConfigCacheForTests(): void`. Task 6 (`AdCadence.ts`) calls `getConfigValue<AdCadenceConfig>('ad_cadence')`. Task 7 (`BootScene.ts`) calls `primeConfig()`.

- [ ] **Step 1: Write the failing test**

`src/systems/__tests__/ConfigClient.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchWithLog = vi.fn();
vi.mock('../../logging/fetchWithLog', () => ({
  fetchWithLog: (...args: unknown[]) => fetchWithLog(...args),
}));

import { primeConfig, getConfigValue, resetConfigCacheForTests } from '../ConfigClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// primeConfig() is fire-and-forget; flush microtasks so its promise chain settles.
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('ConfigClient', () => {
  beforeEach(() => {
    fetchWithLog.mockReset();
    resetConfigCacheForTests();
  });

  it('getConfigValue returns undefined before primeConfig resolves', () => {
    expect(getConfigValue('ad_cadence')).toBeUndefined();
  });

  it('primeConfig populates the cache on a successful fetch', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, { config: { ad_cadence: { min: 10, max: 20 } } }));
    primeConfig();
    await flush();
    expect(getConfigValue('ad_cadence')).toEqual({ min: 10, max: 20 });
  });

  it('getConfigValue returns undefined for a key not present in the fetched config', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, { config: {} }));
    primeConfig();
    await flush();
    expect(getConfigValue('ad_cadence')).toBeUndefined();
  });

  it('leaves the cache empty on a non-ok response', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(500, { error: 'boom' }));
    primeConfig();
    await flush();
    expect(getConfigValue('ad_cadence')).toBeUndefined();
  });

  it('leaves the cache empty on a network throw', async () => {
    fetchWithLog.mockRejectedValue(new Error('offline'));
    primeConfig();
    await flush();
    expect(getConfigValue('ad_cadence')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/systems/__tests__/ConfigClient.test.ts`
Expected: FAIL — `Cannot find module '../ConfigClient'`.

- [ ] **Step 3: Implement `ConfigClient`**

`src/systems/ConfigClient.ts`:
```ts
// src/systems/ConfigClient.ts

import { fetchWithLog } from '../logging/fetchWithLog';
import type { GetConfigResponse, AppConfig } from '../../shared/configTypes';

const SERVER_URL: string =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_HEAP_SERVER_URL ??
  'http://localhost:8787';

let cached: AppConfig | null = null;

/**
 * Fire-and-forget fetch of the global config map. Never throws — on failure
 * `cached` stays null and getConfigValue() returns undefined for every key,
 * so callers fall back to their own hardcoded defaults.
 */
export function primeConfig(): void {
  fetchWithLog(`${SERVER_URL}/config`)
    .then((res) => (res.ok ? (res.json() as Promise<GetConfigResponse>) : null))
    .then((body) => { cached = body?.config ?? null; })
    .catch(() => { /* cached stays null */ });
}

export function getConfigValue<T>(key: string): T | undefined {
  return cached?.[key] as T | undefined;
}

/** Test-only: reset the in-memory cache between tests. */
export function resetConfigCacheForTests(): void {
  cached = null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/systems/__tests__/ConfigClient.test.ts`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/systems/ConfigClient.ts src/systems/__tests__/ConfigClient.test.ts
git commit -m "feat(config): add client ConfigClient with boot-fetch and fallback"
```

---

## Task 6: AdCadence reads from remote config

**Files:**
- Modify: `src/systems/ads/AdCadence.ts`
- Modify: `src/systems/ads/__tests__/AdCadence.test.ts`

**Interfaces:**
- Consumes: `getConfigValue` from `src/systems/ConfigClient.ts` (Task 5); `AdCadenceConfig` from `shared/configTypes.ts` (Task 1).
- Produces: no new exports for other tasks — `AD_CADENCE_MIN`/`AD_CADENCE_MAX`/`rollTarget`/`decideAdRun`/`registerRun` keep their existing signatures (Task 8's `BootScene.ts` doesn't touch this file).

- [ ] **Step 1: Write the failing test**

Read `src/systems/ads/__tests__/AdCadence.test.ts` first (it's the file being modified). Add this import at the top:
```ts
vi.mock('../../ConfigClient', () => ({
  getConfigValue: vi.fn(() => undefined),
}));
import { getConfigValue } from '../../ConfigClient';
```

Note: this `vi.mock` call must come before the existing `import { rollTarget, decideAdRun, registerRun, ... } from '../AdCadence'` line, matching vitest's hoisting requirement (see `CodeClient.test.ts` for the same ordering).

Add this new `describe` block at the end of the file:
```ts
describe('rollTarget with remote config', () => {
  const mockGetConfigValue = vi.mocked(getConfigValue);

  beforeEach(() => { mockGetConfigValue.mockReset(); });

  it('uses the remote min/max when config is present', () => {
    mockGetConfigValue.mockReturnValue({ min: 5, max: 5 });
    expect(rollTarget(() => 0.5)).toBe(5);
  });

  it('falls back to AD_CADENCE_MIN/MAX when config is absent', () => {
    mockGetConfigValue.mockReturnValue(undefined);
    expect(rollTarget(() => 0)).toBe(AD_CADENCE_MIN);
    expect(rollTarget(() => 0.999)).toBe(AD_CADENCE_MAX);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/systems/ads/__tests__/AdCadence.test.ts`
Expected: FAIL — the remote-config test returns `AD_CADENCE_MIN`/`AD_CADENCE_MAX` regardless of the mocked `getConfigValue`, since `rollTarget` doesn't consult it yet (assertion `expect(rollTarget(() => 0.5)).toBe(5)` fails since it'll be `40`).

- [ ] **Step 3: Implement `currentRange()` and wire it into `rollTarget`**

Read `src/systems/ads/AdCadence.ts` first. Add the import at the top:
```ts
import { getConfigValue } from '../ConfigClient';
import type { AdCadenceConfig } from '../../../shared/configTypes';
```

Add this function after the `AdRunState` interface:
```ts
/** Remote-config range if present and valid, else the hardcoded fallback. */
function currentRange(): { min: number; max: number } {
  const remote = getConfigValue<AdCadenceConfig>('ad_cadence');
  if (remote && typeof remote.min === 'number' && typeof remote.max === 'number' && remote.min <= remote.max) {
    return remote;
  }
  return { min: AD_CADENCE_MIN, max: AD_CADENCE_MAX };
}
```

Replace `rollTarget`'s body to use it:
```ts
export function rollTarget(rand: () => number = Math.random): number {
  const { min, max } = currentRange();
  const span = max - min + 1;
  return min + Math.floor(rand() * span);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/systems/ads/__tests__/AdCadence.test.ts`
Expected: PASS, all tests including the two new ones and the pre-existing `rollTarget`/`decideAdRun`/`registerRun` tests (which mock `getConfigValue` to return `undefined`, exercising the fallback path — same behavior as before this change).

- [ ] **Step 5: Commit**

```bash
git add src/systems/ads/AdCadence.ts src/systems/ads/__tests__/AdCadence.test.ts
git commit -m "feat(config): AdCadence reads min/max from remote config with fallback"
```

---

## Task 7: BootScene wiring

**Files:**
- Modify: `src/scenes/BootScene.ts`

**Interfaces:**
- Consumes: `primeConfig` from `src/systems/ConfigClient.ts` (Task 5).
- Produces: nothing consumed by other tasks — this is the final integration point.

No automated test exists for `BootScene.ts` today (it has no test file); verification is `npm run build` + a manual dev-server smoke check.

- [ ] **Step 1: Add the import and boot call**

Read `src/scenes/BootScene.ts` first. Add the import alongside the other system imports:
```ts
import { primeConfig } from '../systems/ConfigClient';
```

In `create()`, add the call right after `AdClient.initialize().catch(...)` (both are boot-time, fire-and-forget, non-blocking optional inits):
```ts
    AdClient.initialize().catch(() => { /* silent — ad init is optional */ });
    primeConfig(); // fire-and-forget — AdCadence falls back to hardcoded defaults until this resolves
```

- [ ] **Step 2: Build to confirm no TS errors**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 3: Manual smoke test**

With the local `wrangler dev` server running (`cd server && npx wrangler dev`) and the Vite dev server running on port 3000 (per project convention, this is expected to already be running — do not start/stop it), open the game in a browser, open devtools Network tab, and confirm a `GET /config` request fires during boot and returns 200. Confirm no console errors.

- [ ] **Step 4: Commit**

```bash
git add src/scenes/BootScene.ts
git commit -m "feat(config): prime remote config at boot"
```

---

## Task 8: Admin UI panel

**Files:**
- Modify: `admin/index.html`

**Interfaces:**
- Consumes: `GET /config`, `PUT /config/:key` (Task 3); existing `adminFetch()`, `$()`, `setStatus()`, `escapeHtml()` helpers already defined in this file.
- Produces: nothing consumed by other tasks — this is a standalone static page.

No automated test exists for `admin/index.html` (none of the existing sections have one); verification is manual, against the local `wrangler dev` server.

- [ ] **Step 1: Add the "Remote Config" section markup**

Read `admin/index.html` first. Add this new section after the existing `<div class="section section-codes">...</div>` block (Reward Codes) and before `<div id="status"></div>`:
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

- [ ] **Step 2: Add the section's CSS class**

In the `<style>` block, add alongside the existing `.section-codes` (find the sibling `.section-*` border-color rules, e.g. `.section-create { border-left-color: #fa0; }`) a new rule:
```css
    .section-config { border-left-color: #a0f; }
```

- [ ] **Step 3: Add the load/save script logic**

In the `<script>` block, add this new section after the existing `// ────── Reward Codes ─────────────────────────────────────────────────────` block's functions (i.e. right before `// ────── Boot ───────────────────────────────────────────────────────────`):
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

Update the `DOMContentLoaded` handler at the bottom to call it:
```javascript
    document.addEventListener('DOMContentLoaded', () => {
      bootSettings();
      bootHeapsList();
      bootEditHeap();
      bootCreateHeap();
      bootRewardCodes();
      bootConfig();
    });
```

- [ ] **Step 4: Manual verification**

With `cd server && npx wrangler dev` running, open `admin/index.html` directly in a browser (`file://` path is fine, or serve it statically). Set Server URL to `http://localhost:8787` in the Settings section and save. Confirm the "Remote Config" section loads `min: 40, max: 50` (or whatever Task 4's manual smoke test left it at). Change the values, click "Save Ad Cadence", confirm the status line shows "ad cadence saved", then reload the page and confirm the new values persist.

- [ ] **Step 5: Commit**

```bash
git add admin/index.html
git commit -m "feat(config): add Remote Config panel to admin UI"
```

---

## Task 9: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full server test suite**

Run: `cd server && npm test`
Expected: all tests pass, including every test added in Tasks 2 and 3.

- [ ] **Step 2: Run the full client test suite**

Run: `npm test`
Expected: all tests pass, including every test added in Tasks 5 and 6.

- [ ] **Step 3: Run the production build**

Run: `npm run build`
Expected: no TypeScript errors, build succeeds.

- [ ] **Step 4: Confirm the migration story is clean for a fresh install**

Run:
```bash
cd server && npx wrangler d1 execute heap_core --local --command "SELECT sql FROM sqlite_master WHERE name = 'app_config'"
```
Expected: schema matches what's in `server/schema/heap_core.sql` (both define the same `app_config` table shape).

- [ ] **Step 5: Report status**

No commit for this task — it's verification-only. Summarize pass/fail for each step above to the user before considering the feature done.

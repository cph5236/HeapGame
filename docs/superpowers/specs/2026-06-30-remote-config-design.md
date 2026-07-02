# Remote Config System — Design

## Problem

`AD_CADENCE_MIN`/`AD_CADENCE_MAX` (`src/systems/ads/AdCadence.ts`) are hardcoded
client constants controlling how often the score-screen ad fires. Tuning them
today requires a full app release. The Todo item asks for these to become
DB-controlled.

Ad cadence is a **global** app setting, not tied to any heap — it doesn't fit
`heap_core`'s per-heap `heap` table (difficulty/spawn/coin/score mults are
per-heap columns, fetched via `GET /heaps/:id`). None of the four existing
domain DBs (`heap_core` = heap objects, `heap_scores`, `heap_rewards` = reward
codes, `heap_telemetry` = append-only logs, "never cached") are a semantic fit
for global app config either. Rather than build a single-purpose fix, this
design adds a small general-purpose remote-config mechanism, with ad cadence
as its first entry — future global tunables (feature flags, other constants)
reuse it without another migration.

## Architecture

A new `app_config` table lives in the existing `heap_core` DB (`DB_HEAP`
binding) — no new D1 database, no new wrangler binding. It's a generic
`key → JSON value` store, following the same pattern as
`heap_parameters.enemy_params` already in that schema.

- **Read**: `GET /config` (public, no admin gate) returns the full map
  `{ config: { key: value, ... } }`. Wrapped in a KV cache-aside decorator
  (`CachedConfigDB`), mirroring `CachedScoreDB` — one KV entry for the whole
  map, TTL as backstop, synchronous invalidation on write.
- **Write**: `PUT /config/:key` (admin-gated via the existing
  `X-Admin-Secret` middleware, same as heap params / reward codes) validates
  `key` against a small allowlist, upserts the row, invalidates the KV key.
- **Client**: `BootScene.create()` fires a non-blocking fetch into a new
  `ConfigClient` at app start. `AdCadence.ts`'s `AD_CADENCE_MIN`/`MAX` remain
  as hardcoded fallback constants; a `currentRange()` accessor reads the
  fetched config if present, else falls back. Since `AdCadence.registerRun()`
  isn't called until the score screen, the fetch has the whole first run to
  resolve — the fallback exists for offline/cold-start/fetch-failure cases,
  not as the expected steady-state path.

## Schema

`server/migrations/heap_core/0002_app_config.sql`:

```sql
CREATE TABLE IF NOT EXISTS app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,   -- JSON-encoded
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO app_config (key, value, updated_at) VALUES (
  'ad_cadence', '{"min":40,"max":50}', datetime('now')
);
```

`server/schema/heap_core.sql` gets the same table + seed row added (final
intended state for fresh installs).

## Shared types

`shared/configTypes.ts`:

```ts
export type AppConfig = Record<string, unknown>;
export interface GetConfigResponse { config: AppConfig; }
export interface UpdateConfigRequest { value: unknown; }
```

## Server

**`server/src/configDb.ts`** — thin D1 wrapper (mirrors `codeDb.ts` /
`feedbackDb.ts`): `getAll(): Promise<AppConfig>`, `set(key, value, now): Promise<void>`.

**`server/src/cache/CachedConfigDB.ts`** — KV decorator over `ConfigDB`
(mirrors `CachedScoreDB`):
- Single key `cache:config:all`.
- `getAll()`: cache-aside, TTL ~300s.
- `set()`: writes through to D1, then synchronously deletes the cache key.

**`server/src/routes/config.ts`** (mounted in `app.ts`):
- `GET /config` — public. Returns `{ config }` via `ConfigDB.getAll()`.
- `PUT /config/:key` — admin-gated (`adminGate` applied in `app.ts`, same
  pattern as `/heaps` mutating routes and `/codes` admin routes). Body
  `{ value }`. Rejects unknown `key` (not in the allowlist — starts as just
  `['ad_cadence']`) with 400, same spirit as `resolveParams` validation in
  `routes/heap.ts`. Upserts, invalidates cache, returns `{ ok: true }`.

`app.ts` wiring: identical shape to how `codeDb`/`feedbackDb` are threaded
through `AppOptions` — a `configDb` option, `GET`/`PUT /config` routes only
mounted when it's set.

## Client

**`src/systems/ConfigClient.ts`** (new, `fetchWithLog` pattern like
`CodeClient.ts`):

```ts
let cached: Record<string, unknown> | null = null;

export function primeConfig(): void {
  fetchWithLog(`${SERVER_URL}/config`)
    .then(r => r.ok ? r.json() : null)
    .then(body => { cached = (body as GetConfigResponse | null)?.config ?? null; })
    .catch(() => { /* cached stays null; callers fall back */ });
}

export function getConfigValue<T>(key: string): T | undefined {
  return cached?.[key] as T | undefined;
}
```

**`AdCadence.ts`**: `AD_CADENCE_MIN`/`AD_CADENCE_MAX` stay exported as
fallback constants (existing tests keep passing unmodified). New:

```ts
function currentRange(): { min: number; max: number } {
  const remote = getConfigValue<{ min: number; max: number }>('ad_cadence');
  return remote ?? { min: AD_CADENCE_MIN, max: AD_CADENCE_MAX };
}
```

`rollTarget()` reads `currentRange()` instead of the module constants
directly.

**`BootScene.ts`**: calls `primeConfig()` once in `create()`, fire-and-forget
— boot flow never blocks on it.

## Admin UI

Add a "Remote Config" section to `admin/index.html`, following the existing
`Reward Codes` section's structure and reusing the existing `adminFetch()`
helper (already attaches `X-Admin-Secret`):

- On load: `GET /config` (public, no secret) → render each known key as
  labeled inputs.
- v1 scope: just `ad_cadence` — two number inputs (min/max) populated from
  the JSON blob.
- Save button: `adminFetch('/config/ad_cadence', { method: 'PUT', body:
  JSON.stringify({ value: { min, max } }) })`.
- The panel does not support adding arbitrary new keys — new config keys
  require a code change (allowlist entry + corresponding UI field), which
  keeps the store from accumulating typo'd/undocumented keys.

## Testing

- **Server**: `ConfigDB` unit tests (get/set/upsert semantics);
  `CachedConfigDB` tests (cache hit/miss, invalidation-on-write, TTL
  backstop) mirroring existing `CachedScoreDB` tests; route tests for
  `GET /config` (200, seeded row present) and `PUT /config/:key` (401
  without secret, 400 on unknown key / malformed value, 200 + persisted on
  valid write).
- **Client**: `AdCadence.ts` tests extended to cover `currentRange()` —
  remote value present vs. absent (fallback path) — matching the existing
  `decideAdRun`/`rollTarget` test style. New `ConfigClient` tests for fetch
  success / failure / offline (mock `fetchWithLog`).
- **Migration**: apply `0002_app_config.sql` locally
  (`cd server && npx wrangler d1 migrations apply heap_core --local`),
  confirm the seed row, confirm `npm run build`.
- No `scene-preview` needed — no in-game visual surface; only the admin
  static page, checked by eye.

## Out of scope

- Per-heap config (already covered by `heap_parameters`/`heap` columns).
- Arbitrary free-form config keys from the admin UI (allowlist-only, by
  design — see Admin UI section).
- Any config value beyond `ad_cadence` for this pass; the schema/API/client
  plumbing is general-purpose, but no other constants are being migrated in
  this change.

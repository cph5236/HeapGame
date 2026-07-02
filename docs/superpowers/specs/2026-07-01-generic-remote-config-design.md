# Generic Remote Config Key Management — Design

## Problem

The remote-config system built in `feature/remote-config` (PR #90) has a schema
and data layer (`app_config` table, `ConfigDB`) that are already fully generic
— any `key`/JSON-`value` pair. But the *admin UI and API* are not: `PUT
/config/:key` only accepts keys on a hardcoded server-side allowlist
(currently just `['ad_cadence']`), and the admin page has a single hardcoded
"Ad Cadence" section. There's no way to create a new config value without a
code change to both the allowlist and the admin UI.

This design makes **key management** (create/edit/delete arbitrary config
keys) fully generic through the admin UI. It does **not** make constants
elsewhere in the codebase automatically remote-controlled — a game constant
(e.g. `PLAYER_JUMP_VELOCITY`) still needs its own explicit accessor
(`currentX()`-style, mirroring `AdCadence.currentRange()`) before a config key
of the same name has any effect. That opt-in boundary was a deliberate choice
during brainstorming: JS module-level `export const` values are evaluated
once at import time, before the async boot-time config fetch resolves, so a
generic `tunable('key', default)` wrapper used as a constant's initializer
would always read its fallback — the only way to get a *live* value is a
function re-evaluated per read, which every call site would need to switch
to. That's a much larger, separate effort and out of scope here.

## What changes vs. what stays the same

**Unchanged:**
- `app_config` schema (`key`/`value`/`updated_at`) — already generic, no
  migration needed.
- `ConfigDB` / `D1ConfigDB` / `CachedConfigDB` / `MockConfigDB` layer, except
  for the new `delete()` method (below).
- `GET /config` (public, KV-cached).
- Client `ConfigClient` (`primeConfig`/`getConfigValue<T>`) and the
  `AdCadence.currentRange()` opt-in pattern — no client-side changes at all.

**Changes:**
- `PUT /config/:key` drops the static `ALLOWED_KEYS` allowlist. Any key
  matching a generic naming pattern is writable by an authenticated admin.
- `ad_cadence` keeps its existing specific shape validation (object, numeric
  `min`/`max`, `min <= max`) as an extra special-cased check — defense in
  depth on the one key that currently drives real gameplay behavior. Every
  other key only gets the generic checks below.
- New `DELETE /config/:key` (admin-gated).
- Admin UI: the hardcoded "Ad Cadence" section becomes a generic panel
  listing every existing key with an editable JSON textarea, plus an
  "Add new key" form.

## API

### `PUT /config/:key`

1. Validate `key` against `^[a-z][a-z0-9_]{0,63}$` (lowercase snake_case,
   starts with a letter, max 64 chars) → 400 `{ error: 'invalid key format' }`
   on failure.
2. Parse the request body `{ value: unknown }` → 400
   `{ error: 'invalid request' }` on malformed JSON.
3. Reject if `JSON.stringify(value).length` exceeds 8192 bytes → 400
   `{ error: 'value too large' }`. (Bounds growth of the single KV cache
   entry that holds the whole config map.)
4. If `key === 'ad_cadence'`, additionally run the existing specific
   validator (object shape, numeric `min`/`max`, `min <= max`) → 400 with the
   specific reason on failure.
5. Upsert via `ConfigDB.set()`, invalidate the cache, return
   `{ ok: true, key }`.

### `DELETE /config/:key` (new)

- Admin-gated (same `adminGate` middleware as `PUT`).
- No key-format check — deleting an already-invalid/typo'd key must still be
  possible.
- `ConfigDB.delete(key): Promise<void>` — plain
  `DELETE FROM app_config WHERE key = ?1`, implemented identically across
  `D1ConfigDB`, `MockConfigDB`, and `CachedConfigDB` (write-through delete +
  cache-key invalidation, same pattern as `set()`).
- Idempotent: returns `{ ok: true, key }` whether or not the key existed.

### `GET /config`

Unchanged.

### Removed

The `ALLOWED_KEYS` set and its lookup in `server/src/routes/config.ts`.

## Admin UI

`admin/index.html`'s "Remote Config" section becomes fully generic:

```
REMOTE CONFIG
┌─────────────────────────────────────────────┐
│ ad_cadence                          [Delete] │
│ ┌───────────────────────────────────────┐   │
│ │ {                                      │   │
│ │   "min": 40,                           │   │
│ │   "max": 50                            │   │
│ │ }                                       │   │
│ └───────────────────────────────────────┘   │
│                              [Save]          │
├─────────────────────────────────────────────┤
│ (...one such row per existing key...)        │
├─────────────────────────────────────────────┤
│ Add new key                                  │
│ Key name: [___________________]              │
│ Value (JSON):                                │
│ ┌───────────────────────────────────────┐   │
│ │                                        │   │
│ └───────────────────────────────────────┘   │
│                              [Create]        │
└─────────────────────────────────────────────┘
```

- On load: `GET /config` (public), render one row per key — read-only key
  label, `<textarea>` pre-filled with `JSON.stringify(value, null, 2)`, Save
  button, Delete button.
- Save: `adminFetch('/config/' + key, { method: 'PUT', body:
  JSON.stringify({ value: JSON.parse(textarea.value) }) })`. `JSON.parse`
  failures are caught client-side and shown via the existing `setStatus(...,
  'err')` pattern before any network call.
- Delete: confirm via a browser `confirm()` dialog, then `adminFetch('/config/'
  + key, { method: 'DELETE' })`, then re-render the list from a fresh
  `GET /config`.
- Add new key: separate form — key-name text input + JSON textarea + Create
  button. Client-side check that the entered key doesn't already appear in
  the rendered list (avoid an accidental overwrite via the "create" flow —
  use the row's own Save button to edit an existing key instead).
- Every Save/Delete/Create reloads the full list from `GET /config` afterward
  to reflect authoritative state (no local-only optimistic updates).

## Testing

**Server (`server/tests/config.test.ts`):**
- Generic `PUT` validation: rejects malformed key names (uppercase, leading
  digit, symbols, >64 chars) with 400; rejects values over 8192 bytes with
  400; rejects malformed JSON bodies with 400; accepts arbitrary well-formed
  keys/values with 200, verified persisted via a follow-up `GET /config`.
- `ad_cadence`'s existing specific-validation tests (non-object, min>max,
  non-numeric) are kept, now reached through the special-case branch rather
  than the allowlist branch.
- New `DELETE /config/:key` tests: 401 without the admin secret; 200 + key
  absent from a subsequent `GET /config`; 200 (idempotent, no error) when
  deleting a key that never existed.
- Removed: the old "unknown config key" 400 test (no allowlist to reject
  against anymore).

**`ConfigDB` / `CachedConfigDB` (`server/src/configDb.ts`,
`server/tests/cacheDecorators.test.ts`):**
- New `delete(key)` on the `ConfigDB` interface, `D1ConfigDB`, `MockConfigDB`.
- `CachedConfigDB.delete()` test: writes through to the inner store and
  invalidates the cache — same shape as the existing `set()` cache test.

**Admin UI (`admin/index.html`):** manual verification only (no test infra
exists for this static page, consistent with the original feature) — against
local `wrangler dev`: confirm the existing `ad_cadence` row renders, create a
new test key, edit it, delete it, confirm each step round-trips through
`GET /config`.

**Client (`ConfigClient.ts`, `AdCadence.ts`):** no changes, no new tests —
this design doesn't touch the client consumption path.

## Out of scope

- Automatic binding between a DB config key and a same-named code constant
  (the `tunable()` idea) — remains a manual per-constant opt-in via an
  explicit accessor function, as established in the original design.
- Type-aware admin UI inputs (number spinners, checkboxes) — the raw-JSON-
  textarea approach was chosen for full genericity with no per-key UI code.
- Any additional config values beyond `ad_cadence` being wired into actual
  game behavior — this change only makes key *storage/management* generic.

## Branching

This work continues on `feature/remote-config` (PR #90, not yet merged)
rather than a new branch off `main`, since it touches the same files
(`server/src/routes/config.ts`, `server/src/configDb.ts`,
`server/src/cache/CachedConfigDB.ts`, `admin/index.html`) added by that PR
and hasn't merged yet.

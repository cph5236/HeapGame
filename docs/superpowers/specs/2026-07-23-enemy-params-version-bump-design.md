# Enemy-Params Version Bump — Design

**Date:** 2026-07-23
**Status:** Approved (design), pending implementation
**Bug:** `Todo/Bugs.md` — "Editing a heap's enemy params in the Admin UI updates the DB but does NOT bump the heap's version."

## Problem

Editing a heap's enemy params via the Admin UI (`PUT /heaps/:id/enemy-params`)
writes the `heap_parameters` table but does **not** change the heap's `version`.

Base-heap clients load via `HeapClient.load()` → `GET /heaps/:id?version=N`, which
is version-gated:

- On a version match the server returns `{ changed: false }` and the client keeps
  its stale cached `enemyParams` (`src/systems/HeapClient.ts:114`).
- Only the `changed: true` branch carries `enemyParams` and refreshes the cache
  (`server/src/routes/heap.ts:294`, `src/systems/HeapClient.ts:130`).

Result: an enemy-param edit is never picked up by an already-loaded client, and
even a client restart stays stale until the heap's version changes for some other
reason (e.g. a block placement).

The procedural **infinite** heap is unaffected: it uses `primeEnemyParams()`, an
unconditional `GET /heaps/:id/enemy-params` (`src/systems/HeapClient.ts:196`).

## Decision

**Bump the heap's `version` inside the `PUT /heaps/:id/enemy-params` handler.**

Version then honestly represents *all* heap state (matching how `place` and
`updateHeapParams` already behave). The next base-heap `load()` sees
`changed: true`, and the existing `GET /:id` delta returns the fresh `enemyParams`
(read straight from D1, uncached) — no client change required.

### Alternative considered — rejected

**Client-side unconditional prime** (fetch `GET /:id/enemy-params` on every
base-heap load, like the infinite heap). Rejected because it adds a permanent
extra request to a hot path (players switch heaps often), whereas the version
bump adds effectively zero ongoing traffic — the bump happens once per (rare)
admin edit, and normal loads still short-circuit on `{ changed: false }`.

## Implementation

Server-only. No migration, no client change, no DB-interface change.

### 1. Route change — `server/src/routes/heap.ts`

In the `PUT /:id/enemy-params` handler (`heap.ts:240`), after the existing
`db.upsertEnemyParams(id, body)`, bump the version by reusing the existing
`updateHeap`, passing all other fields unchanged:

```ts
await db.upsertEnemyParams(id, body);
// Bump version so version-gated clients re-fetch fresh enemy params on next load.
await db.updateHeap(
  id,
  row.base_id,
  row.version + 1,
  JSON.parse(row.live_zone) as Vertex[],
  row.freeze_y,
  row.version,               // CAS guard (expectedVersion)
);
return c.json({ ok: true });
```

`row` is already fetched at the top of the handler and contains `base_id`,
`live_zone`, `freeze_y`, and `version` (`db.ts:97`).

### Why this is correct

- `updateHeap` exists on all three DB variants (D1 / Mock / Cached) and, in
  `CachedHeapDB`, invalidates `cache:heap:${id}` + the list cache on success
  (`CachedHeapDB.ts:81`) — so the KV-cached version cannot go stale.
- `getEnemyParams` reads directly from D1 (not KV-cached), so the `changed: true`
  response after the bump always carries the freshly-written params.
- The bump keeps `base_id`, `live_zone`, and `freeze_y` identical — only `version`
  advances.

### Concurrency

CAS with `expectedVersion = row.version`. If a concurrent `place` wins the race,
our bump no-ops — but that `place` already advanced the version, so the client
still sees `changed` and refreshes the enemy params we already wrote via
`upsertEnemyParams`. Safe to ignore the CAS miss. Admin edits are rare and
effectively never concurrent, so this is belt-and-suspenders.

### 2. Tests — `server/tests/routes.test.ts`

Extend the existing `PUT /heaps/:id/enemy-params` suite (`routes.test.ts:758`):

- After a successful `PUT`, `GET /:id?version=<oldVersion>` returns
  `changed: true` and its `enemyParams` reflect the edit.
- The heap's `version` strictly increases across the `PUT`.
- (Regression) A `GET /:id?version=<newVersion>` still returns `{ changed: false }`
  once the client is caught up.

## Out of scope

- No change to the infinite-heap `primeEnemyParams` path.
- No change to `PUT /heaps/:id/enemy-params` request/response shape.
- No mid-session live push — the fix takes effect on the client's next `load()`
  (scene re-entry / restart), which matches existing param-edit behaviour.

## Verification

- `npm test` (server + shared suites green).
- `npm run build`.
- Manual: edit enemy params in Admin UI, reload a base heap in the client, confirm
  the new params take effect (smoke test per `smoke-testing-heap` if warranted).

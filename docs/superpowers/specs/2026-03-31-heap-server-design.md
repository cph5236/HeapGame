# Heap Server Design

**Date:** 2026-03-31
**Status:** Approved

## Overview

A Hono + Cloudflare Workers + D1 backend that stores the community heap as a polygon and serves it to clients incrementally. Players who summit place a block via `AppendHeap`; the server validates and integrates it into the polygon. Clients use a version number to avoid re-downloading data they already have.

---

## Architecture

**Stack:** Hono, Cloudflare Workers, Cloudflare D1 (SQLite), Wrangler, TypeScript 5

**Location:** `server/` at repo root. Shared types live in `shared/` and are consumed by both client and server.

**Three endpoints:**
- `GET /heap?version=N` — returns heap delta since client's version
- `GET /heap/base/:hash` — returns frozen base vertices by hash (client caches permanently)
- `POST /heap/place` — accepts a player's block placement `{ x, y }`

**Testability:** `db.ts` exports a `HeapDB` interface with a `D1HeapDB` production implementation. Tests inject a `MockHeapDB`. This keeps all unit and integration tests runnable locally with Vitest — no Workers runtime required.

**Concurrency:** D1's serialized write model handles concurrent `AppendHeap` calls naturally.

**`nodejs_compat` flag:** Enabled in `wrangler.toml` so `polygon.ts` can use `import { createHash } from 'crypto'` in both Workers and local Node test environments.

---

## Data Model

### Polygon Split

The heap polygon is divided into two regions:

- **Frozen base** — lower vertices that never change. Stored in `heap_base` keyed by SHA-256 hash. Clients cache this permanently — once downloaded for a given hash, it never needs to be fetched again.
- **Live zone** — upper vertices near the summit. Changes with each accepted block placement. Returned on every version mismatch.

A `freeze_threshold_y` marks the boundary. When the live zone exceeds **500 vertices**, the server freezes the bottom 250 into the base: serializes them, computes a new `base_hash`, upserts into `heap_base`, and removes them from the live zone. `freeze_threshold_y` is ratcheted upward accordingly.

Full vertex detail is preserved — no simplification is applied.

### D1 Schema

```sql
CREATE TABLE IF NOT EXISTS heap_polygon (
  id        INTEGER PRIMARY KEY CHECK (id = 1),
  version   INTEGER NOT NULL DEFAULT 0,
  base_hash TEXT    NOT NULL DEFAULT '',
  live_zone TEXT    NOT NULL DEFAULT '[]',
  freeze_y  REAL    NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS heap_base (
  hash     TEXT PRIMARY KEY,
  vertices TEXT NOT NULL
);

INSERT OR IGNORE INTO heap_polygon (id, version, base_hash, live_zone, freeze_y)
VALUES (1, 0, '', '[]', 0);
```

### Shared Wire Types (`shared/heapTypes.ts`)

```ts
interface Vertex {
  x: number;
  y: number;
}

type GetHeapResponse =
  | { changed: false; version: number }
  | { changed: true; version: number; baseHash: string; liveZone: Vertex[] };

interface AppendHeapRequest {
  x: number;
  y: number;
}

interface AppendHeapResponse {
  accepted: boolean;
  version:  number;
}
```

---

## Endpoint Behavior

### `GET /heap?version=N`

1. Load singleton row from `heap_polygon`.
2. If `N === current version` → return `{ changed: false, version: N }`.
3. Otherwise → return `{ changed: true, version, baseHash, liveZone }`.
4. Cloudflare edge handles compression automatically.

### `GET /heap/base/:hash`

1. Look up `hash` in `heap_base`.
2. Return the JSON `Vertex[]` directly.
3. 404 if not found (client should treat as a full re-sync).

### `POST /heap/place`

1. Parse `{ x, y }` from request body.
2. Load full polygon (base vertices + live zone vertices).
3. Run ray-casting point-in-polygon test against full polygon.
4. If **inside** → return `{ accepted: false, version: currentVersion }`. No write.
5. If **outside** → append `{ x, y }` to the live zone vertex array (insertion position: sorted by Y ascending so the summit is always at the front), run freeze check, bump version, persist in a single D1 batch.
6. Return `{ accepted: true, version: newVersion }`.

---

## Server File Structure

```
server/
  src/
    index.ts          // Workers entry point — export default { fetch }
    app.ts            // Hono app factory — createApp(db: HeapDB): Hono
    db.ts             // HeapDB interface + D1HeapDB implementation
    polygon.ts        // Point-in-polygon (ray casting), freeze logic
    routes/
      heap.ts         // Hono route handlers for all three endpoints
  tests/
    helpers/
      mockDb.ts       // MockHeapDB for unit/integration tests
    polygon.test.ts   // Unit tests for polygon math
    routes.test.ts    // Integration tests using Hono test client + MockHeapDB
  package.json
  tsconfig.json
  vitest.config.ts
  wrangler.toml       // Wrangler config — D1 binding, nodejs_compat flag

shared/
  heapTypes.ts        // Vertex, GetHeapResponse, AppendHeapRequest, AppendHeapResponse
```

---

## Client Integration

### On Game Load

1. Read cached `{ version, baseHash, liveZone }` from `localStorage`.
2. Call `GET /heap?version=N` (`version=0` if no cache).
3. If `changed: false` — use cached data.
4. If `changed: true` and `baseHash` differs from cached — fetch `GET /heap/base/:hash`, cache permanently in `localStorage`.
5. Reconstruct full polygon: frozen base + live zone.
6. Feed into `HeapGenerator` replacing the current mock `HeapState`.

### On Summit — Block Placement

1. Player summits; client records `{ x, y }` of placement.
2. `POST /heap/place` fires in the background — does not block gameplay or reward.
3. `accepted: true` → update local cached version to match response version.
4. `accepted: false` → silently ignored. Player's run is still counted locally.

### `HeapClient` Service (`src/systems/HeapClient.ts`)

A thin service class wrapping all fetch logic and `localStorage` caching. The rest of the game only calls:
- `HeapClient.load()` — resolves with the full polygon on game start
- `HeapClient.append(x, y)` — fire-and-forget on summit

No fetch logic leaks into scenes or other systems.

### Error Handling

- Network failure on load → fall back to last cached data, or local mock if no cache exists.
- Network failure on `POST /heap/place` → silently dropped. The game never depends on the server for local progression.

---

## Deployment

```bash
# One-time setup
npx wrangler d1 create heap               # creates the D1 database, outputs database_id
# Fill database_id into wrangler.toml
npx wrangler d1 execute heap --local --file=schema.sql   # apply schema locally
npx wrangler d1 execute heap --file=schema.sql           # apply schema to production

# Deploy
npx wrangler deploy                       # deploys server/ as a Cloudflare Worker
```

The frontend (Vite build + `npx wrangler deploy` via Cloudflare Pages) is configured separately in the Cloudflare dashboard as shown in the project setup screenshot.

---

## Out of Scope (Future)

- Authentication / anti-cheat (verifying the player actually summited)
- Paginated base chunks (upgrade path if single base blob becomes very large)

# Heap Server Design

**Date:** 2026-03-31
**Status:** Approved

## Overview

A Node.js + Express + SQLite backend that stores the community heap as a polygon and serves it to clients incrementally. Players who summit place a block via `AppendHeap`; the server validates and integrates it into the polygon. Clients use a version number to avoid re-downloading data they already have.

---

## Architecture

**Stack:** Node.js, Express, TypeScript, `better-sqlite3`

**Location:** `server/` at repo root. Shared types live in `shared/` and are consumed by both client and server.

**Three endpoints:**
- `GET /heap?version=N` — returns heap delta since client's version
- `GET /heap/base/:hash` — returns frozen base vertices by hash (client caches permanently)
- `POST /heap` — accepts a player's block placement `{ x, y }`

**Concurrency:** `better-sqlite3` is synchronous; SQLite's write lock serializes concurrent `AppendHeap` calls naturally with no additional locking.

---

## Data Model

### Polygon Split

The heap polygon is divided into two regions:

- **Frozen base** — lower vertices that never change. Stored in `heap_base` keyed by SHA-256 hash. Clients cache this permanently — once downloaded for a given hash, it never needs to be fetched again.
- **Live zone** — upper vertices near the summit. Changes with each accepted block placement. Returned on every version mismatch.

A `freeze_threshold_y` marks the boundary. When the live zone exceeds **500 vertices**, the server freezes the bottom 250 into the base: serializes them, computes a new `base_hash`, upserts into `heap_base`, and removes them from the live zone. `freeze_threshold_y` is ratcheted upward accordingly.

Full vertex detail is preserved — no simplification is applied.

### SQLite Schema

```sql
CREATE TABLE heap_polygon (
  id        INTEGER PRIMARY KEY CHECK (id = 1),  -- singleton row
  version   INTEGER NOT NULL DEFAULT 0,
  base_hash TEXT    NOT NULL DEFAULT '',
  live_zone TEXT    NOT NULL DEFAULT '[]',        -- JSON Vertex[]
  freeze_y  REAL    NOT NULL DEFAULT 0            -- freeze_threshold_y
);

CREATE TABLE heap_base (
  hash     TEXT PRIMARY KEY,
  vertices TEXT NOT NULL                          -- JSON Vertex[]
);
```

### Shared Wire Types (`shared/heapTypes.ts`)

```ts
interface Vertex {
  x: number;
  y: number;
}

interface GetHeapResponse {
  version:  number;
  baseHash: string;
  liveZone: Vertex[];
  changed:  boolean;   // false = client is current; liveZone/baseHash omitted
}

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
4. Response is gzip compressed (Express middleware).

### `GET /heap/base/:hash`

1. Look up `hash` in `heap_base`.
2. Return the JSON `Vertex[]` directly.
3. 404 if not found (client should treat as a full re-sync).
4. Response is gzip compressed.

### `POST /heap`

1. Parse `{ x, y }` from request body.
2. Load full polygon (base vertices + live zone vertices).
3. Run ray-casting point-in-polygon test against full polygon.
4. If **inside** → return `{ accepted: false, version: currentVersion }`. No write.
5. If **outside** → append `{ x, y }` to the live zone vertex array (insertion position: sorted by Y ascending so the summit is always at the front), run freeze check, bump version, persist in a single SQLite transaction.
6. Return `{ accepted: true, version: newVersion }`.

---

## Server File Structure

```
server/
  src/
    index.ts          // Express app setup, middleware, route registration
    routes/heap.ts    // Route handlers for all three endpoints
    db.ts             // SQLite connection, schema init, singleton accessors
    polygon.ts        // Point-in-polygon (ray casting), freeze logic
  package.json
  tsconfig.json

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
2. `POST /heap` fires in the background — does not block gameplay or reward.
3. `accepted: true` → update local cached version to match response version.
4. `accepted: false` → silently ignored. Player's run is still counted locally.

### `HeapClient` Service (`src/systems/HeapClient.ts`)

A thin service class wrapping all fetch logic and `localStorage` caching. The rest of the game only calls:
- `HeapClient.load()` — resolves with the full polygon on game start
- `HeapClient.append(x, y)` — fire-and-forget on summit

No fetch logic leaks into scenes or other systems.

### Error Handling

- Network failure on load → fall back to last cached data, or local mock if no cache exists.
- Network failure on `POST /heap` → silently dropped. The game never depends on the server for local progression.

---

## Out of Scope (Future)

- Authentication / anti-cheat (verifying the player actually summited)
- Cloudflare Workers migration (straightforward — same endpoints, KV replaces SQLite)
- Paginated base chunks (upgrade path if single base blob exceeds ~1MB gzip)

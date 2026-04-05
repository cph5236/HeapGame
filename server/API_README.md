# Heap Server API

Base URL (local): `http://localhost:8787`

---

## POST /heaps

Create a new heap from a polygon defined by a vertex array. Returns a stable GUID that identifies this heap for all future operations.

**Request body**
```json
{
  "vertices": [
    { "x": 100, "y": 400 },
    { "x": 300, "y": 600 },
    { "x": 500, "y": 400 }
  ]
}
```

**Response `201`**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "baseId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  "version": 1,
  "vertexCount": 3
}
```

- `id` — heap GUID, stable across all operations including freezes. **Save this.**
- `baseId` — current base snapshot GUID. Changes when a freeze occurs.

**Errors**
- `400` — `vertices` missing, empty, fewer than 3, or contains non-`{x,y}` objects

---

## GET /heaps

List all heaps.

**Response `200`**
```json
{
  "heaps": [
    { "id": "550e8400-...", "version": 12, "createdAt": "2026-04-02T10:00:00.000Z" }
  ]
}
```

---

## GET /heaps/:id

Get the current state of a heap. Supports delta polling via the `version` query param — if the client is already up-to-date, the live zone is omitted.

**Query params**
- `version` (optional, default `0`) — the client's last known version

**Response `200` — client is up to date**
```json
{ "changed": false, "version": 12 }
```

**Response `200` — client is behind**
```json
{
  "changed": true,
  "version": 12,
  "baseId": "6ba7b810-...",
  "liveZone": [
    { "x": 120, "y": 380 }
  ]
}
```

- `baseId` changes when a freeze occurs. When `baseId` differs from the client's cached value, re-fetch `GET /heaps/:id/base`.

**Errors**
- `404` — heap not found

---

## GET /heaps/:id/base

Get the current base polygon vertices for a heap. The base is the frozen, immutable portion of the heap shape. It changes only when a freeze occurs (when the live zone grows past a threshold).

**Response `200`**
```json
[
  { "x": 100, "y": 400 },
  { "x": 300, "y": 600 },
  { "x": 500, "y": 400 }
]
```

**Errors**
- `404` — heap not found

---

## PUT /heaps/:id/reset

Clear the live zone and reset the version to 1. The base polygon is preserved. Use this to restart player activity on an existing heap without re-seeding the shape.

**Request body:** none

**Response `200`**
```json
{
  "id": "550e8400-...",
  "version": 1,
  "previousVersion": 42
}
```

**Errors**
- `404` — heap not found

---

## POST /heaps/:id/place

Add a block to the heap's live zone. The point is rejected if it falls inside the current polygon (base + live zone combined). If the live zone exceeds `LIVE_ZONE_MAX` (500) vertices, the bottom `FREEZE_BATCH` (250) are promoted to a new base snapshot and the live zone is trimmed.

**Request body**
```json
{ "x": 220, "y": 580 }
```

**Response `200` — accepted**
```json
{ "accepted": true, "version": 13 }
```

**Response `200` — rejected (point inside polygon)**
```json
{ "accepted": false, "version": 12 }
```

**Errors**
- `400` — `x` or `y` missing or not a number
- `404` — heap not found

---

## DELETE /heaps/:id

Delete a heap and all its base snapshots.

**Response `200`**
```json
{ "deleted": true }
```

**Errors**
- `404` — heap not found

---

## Seed Script

```bash
# Create a new heap (prints the GUID — save it)
npm run seed

# Create with verbose polygon stats
VERBOSE=true npm run seed

# Reset an existing heap's live zone (does not change the base polygon)
OVERWRITE=true TARGET_HEAP_ID=550e8400-e29b-41d4-a716-446655440000 npm run seed

# Target a deployed server
HEAP_SERVER_URL=https://heap-server.workers.dev npm run seed
```

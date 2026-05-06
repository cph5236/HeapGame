# Admin UI Expansion + Heap Height Display — Design

**Date:** 2026-05-06
**Status:** Approved for planning
**Scope:** Three sequential PRs covering server-side height exposure, polygon-generator extraction, and a reworked admin UI with full heap CRUD.

---

## Goals

1. Surface each heap's current "height climbed" in feet to players (HeapSelectScene) and to admins (admin UI).
2. Let an admin create, delete, and edit heaps from a browser tool — including all `HeapParams` fields and existing enemy params — without hand-editing JSON or running scripts.
3. Eliminate the need for the admin to know about base polygon vertices when creating a heap.

## Non-Goals

- Editing `worldHeight` on an existing heap (locked post-creation; changing it would invalidate the polygon coordinate space, scores, and `top_y`).
- Authenticating individual admin users; the admin secret remains a single shared key.
- Rewriting the existing `enemy-params.html` styling system; we extend its monospace look-and-feel.
- Per-heap placement X bounds (separate todo item, deferred).

---

## Architecture Summary

Three independent slices, executed in order:

| PR | Scope | Touches |
|----|-------|---------|
| 1  | Expose `topY` in list response; display feet in client UIs | `shared/heapTypes.ts`, `server/src/routes/heap.ts`, `src/scenes/HeapSelectScene.ts`, admin HTML |
| 2  | Move polygon generator to `shared/heapPolygon/`; make `vertices` optional in `POST /heaps` | `shared/heapPolygon/*`, `server/src/routes/heap.ts`, `scripts/seed-heap.ts`, `src/` import updates |
| 3  | New `PUT /heaps/:id/params` endpoint; admin UI rework | `server/src/routes/heap.ts`, `server/src/app.ts`, `admin/index.html` |

Each PR is mergeable on its own and ships value: PR-1 unblocks the height display Todo item; PR-2 makes heap creation viable from the UI; PR-3 finishes the admin tool.

---

## PR-1 — Height Display

### Shared types
Extend `HeapSummary` in `shared/heapTypes.ts`:

```ts
export interface HeapSummary {
  id: string;
  version: number;
  createdAt: string;
  topY: number;          // NEW — current heap summit y (smaller = taller)
  params: HeapParams;
}
```

### Server
`GET /heaps` already SELECTs `top_y`. Update `listHeaps()` mapping in `server/src/routes/heap.ts:124-141` to include `topY: r.top_y`. No DB or migration changes (column exists).

### Client display formula

```ts
const FT_DIVISOR = SCORE_DISPLAY_DIVISOR; // = 10, from shared/scoreConstants.ts
function heightFt(worldHeight: number, topY: number | null | undefined): string {
  if (topY == null || !Number.isFinite(topY)) return '???';
  return `${Math.floor((worldHeight - topY) / FT_DIVISOR)} ft`;
}
```

`worldHeight - topY` because the player climbs from `y=worldHeight` (floor) toward `y=0` (summit); a lower `topY` means a taller observed heap.

### HeapSelectScene
Render the height label inside each heap's card. Layout (proposed): underneath the stats row, right-aligned, same font family as the existing stat labels but slightly smaller. "???" surfaces when the row's `top_y` is null in the DB (legacy rows; backfill 0004 should have caught most).

### Admin UI
Once PR-3 is in flight the admin heap list also surfaces this string. For PR-1 alone we can optionally add a single feet readout to the existing `enemy-params.html` heap dropdown — minor polish, not required.

### Tests
- Server route test: list response includes `topY` for a seeded heap.
- Client unit test on a small `heightFt` helper (extract to `src/util/format.ts` or similar).

---

## PR-2 — Polygon Generator Extraction

### New shared module
Create `shared/heapPolygon/` with three files mirroring the existing pieces in `src/systems/`:

```
shared/heapPolygon/
  index.ts              # re-exports the public API
  state.ts              # HeapState (seeded PRNG)
  surface.ts            # findSurfaceY
  polygon.ts            # computeBandScanlines, computeBandPolygon, simplifyPolygon
  objectDefs.ts         # OBJECT_DEFS, HeapEntry type
  generate.ts           # NEW — generateDefaultPolygon(seed, worldHeight): Vertex[]
```

`generate.ts` exports the high-level helper used by both server and seed script:

```ts
export function generateDefaultPolygon(
  seed: number,
  worldHeight: number,
  opts?: { numBlocks?: number; simplifyEpsilon?: number; }
): Vertex[];
```

Internals are a straight port of the seed script's `buildHeap` → `buildPolygon` pipeline.

### Source migration
- Move logic from `src/systems/HeapState.ts`, `src/systems/HeapSurface.ts`, `src/systems/HeapPolygon.ts`, `src/data/heapObjectDefs.ts` into the new shared paths.
- Old `src/` files become re-exports from `shared/heapPolygon/*` (preserves all existing imports — zero ripple in the game client).
- Update `scripts/seed-heap.ts` to import from `shared/heapPolygon/` and call `generateDefaultPolygon` instead of inline `buildHeap` + `buildPolygon`.

### Server
In `POST /heaps`, make `vertices` optional in `CreateHeapRequest`:

```ts
export interface CreateHeapRequest {
  vertices?: Vertex[];   // optional — if absent, server generates a default polygon
  seed?: number;         // optional — only used when vertices is absent
  params?: Partial<HeapParams>;
}
```

Handler logic:
1. If `body.vertices` present → existing path.
2. Else → resolve `worldHeight` from `body.params` (or default), pick `seed = body.seed ?? Math.floor(Math.random() * 1e6)`, call `generateDefaultPolygon(seed, worldHeight)`.
3. Continue with the existing create flow.

### Tests
- Server route: `POST /heaps` with no body still creates a heap; response includes the generated `vertexCount`.
- Server route: `POST /heaps` with explicit vertices still works (regression).
- Pure-math test on `generateDefaultPolygon` for determinism given a fixed seed and `worldHeight`.

---

## PR-3 — Admin UI Rework + Params Update Endpoint

### Server — new endpoint
`PUT /heaps/:id/params` (admin-gated). Request body:

```ts
type UpdateHeapParamsRequest = Partial<Omit<HeapParams, 'worldHeight'>>;
```

`worldHeight` is rejected if present (400 with explanatory error). Validation reuses `resolveParams` semantics for the editable fields. Returns the updated `HeapSummary`.

Wire-up in `server/src/app.ts` alongside the existing admin gates:

```ts
app.put('/heaps/:id/params', adminGate);
```

### Admin UI structure
Rename `admin/enemy-params.html` → `admin/index.html`. Single page, sectioned with clear visual separation (cards with distinct accent colors, ample vertical spacing). Every mutating fetch attaches `X-Admin-Secret` from localStorage.

```
┌─ Settings ───────────────────────────────────────────────┐
│ Server URL:   [http://localhost:8787      ]              │
│ Admin Secret: [••••••••]   [Save]   ●●● status indicator │
└──────────────────────────────────────────────────────────┘

┌─ Heaps ──────────────────────────────────────────────────┐
│ Name           Difficulty  Height   Created    Actions   │
│ Downtown Dump  3.0         120 ft   2026-05-01 [Edit][×] │
│ Hoarder's Heap 2.0         ???      2026-04-28 [Edit][×] │
│ ...                                                       │
└──────────────────────────────────────────────────────────┘

┌─ Edit Heap: <name> ──────────────────────────────────────┐
│ Params section                                            │
│   Name           [____]                                   │
│   Difficulty     [1.0–5.0 step 0.5]                       │
│   spawnRateMult  [____]                                   │
│   coinMult       [____]                                   │
│   scoreMult      [____]                                   │
│   worldHeight    [50000  ] (read-only — locked on create) │
│   [Save Params]                                           │
│                                                           │
│ Enemy Params section (existing UI, moved in)              │
│   Percher / Ghost spawn fields                            │
│   [Save Enemy Params]                                     │
└──────────────────────────────────────────────────────────┘

┌─ Create New Heap ────────────────────────────────────────┐  (visually distinct — different border color)
│ Name           [____]                                     │
│ Difficulty     [1.0]                                      │
│ spawnRateMult  [1.0]                                      │
│ coinMult       [1.0]                                      │
│ scoreMult      [1.0]                                      │
│ worldHeight    [50000]                                    │
│ Seed (optional)[____] — leave blank for random            │
│ [Create Heap]                                             │
└──────────────────────────────────────────────────────────┘
```

Behaviors:
- **Settings** persists `serverUrl` and `adminSecret` to `localStorage` on Save. On load, populate from localStorage; show a colored dot indicating "secret set" / "secret missing."
- **Heaps list** auto-refreshes after create/delete/edit. Delete shows a confirm prompt (`confirm('Delete <name>? This cannot be undone.')`).
- **Edit Heap** is hidden until a row's [Edit] is clicked; populates from the list response, then fetches enemy params separately. Save Params and Save Enemy Params are independent buttons (independent endpoints).
- **Create New Heap** form posts `{ params, seed? }` (no `vertices`). On success, refreshes list and clears form.
- All mutating requests show inline status (`ok` green / `err` red), keeping the existing visual language.

### Tests
- Server route tests for `PUT /heaps/:id/params`: success, rejects `worldHeight`, requires admin secret, 404 on missing heap.
- Manual smoke testing for the admin UI itself (no automated browser tests).

---

## Data Flow

**Height display:**
```
DB.heap.top_y → listHeaps() → HeapSummaryRow.top_y → ListHeapsResponse.heaps[].topY
                                                         ├─→ HeapSelectScene → "X ft" label
                                                         └─→ admin/index.html heaps table
```

**Heap creation (admin UI):**
```
admin form → POST /heaps  { params, seed? }
                ↓
            generateDefaultPolygon(seed, worldHeight)  // shared/heapPolygon
                ↓
            existing create path → DB
```

**Heap params edit:**
```
admin Edit form → PUT /heaps/:id/params  { name, difficulty, spawnRateMult, coinMult, scoreMult }
                     ↓
                 resolveParams (rejects worldHeight) → updateHeapParams(id, merged)
```

---

## Error Handling

| Surface | Failure | Behavior |
|---------|---------|----------|
| `GET /heaps` | DB error | 500; admin UI shows red status, table empty |
| `POST /heaps` (no vertices) | Polygon generation throws | 500 with stable error message; admin form re-enables |
| `PUT /heaps/:id/params` | `worldHeight` present | 400 `{ error: 'worldHeight is locked after creation' }` |
| `PUT /heaps/:id/params` | invalid difficulty/mult | 400 with validation message (existing `resolveParams` style) |
| Admin fetch | 401 | UI surfaces "admin secret rejected"; clears `localStorage.adminSecret` |
| HeapSelectScene | `topY` missing | Renders "???" |

---

## Open Questions

None at design time. Per-heap placement X bounds (separate Todo line) explicitly out of scope.

---

## Summary

Three small, sequential PRs deliver the full set of selected Todo items:
1. Players and admins see how tall each heap actually is.
2. The polygon generator becomes a shared utility, unblocking server-side default polygons.
3. A single sectioned admin page covers create / list / delete / edit (params + enemy params), gated by a localStorage-persisted admin secret.

`worldHeight` is intentionally write-once. All other heap params are freely editable post-create.

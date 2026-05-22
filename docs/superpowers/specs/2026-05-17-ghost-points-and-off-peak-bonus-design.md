# Ghost Points + Off-Peak Bonus — Design Spec

**Date:** 2026-05-17
**Branch:** feature/GameplayImprovements

## Problem

Players always place at the very top of the heap because that is where the peak bonus applies. Over time this produces a narrow spire instead of a wide, heaping pile of trash.

## Solution

Two complementary mechanisms:

1. **Ghost points** — every accepted placement silently inserts N additional random points into the heap's live zone. Random X/Y spreads the polygon outward without requiring player action. Count is a per-heap parameter so designers can tune per-heap.
2. **Off-peak bonus coins** — the server returns a flat coin bonus when a player places below the current summit by a configurable threshold. Rewards intentional wide placement without punishing peak placement.

---

## Shared Types (`shared/heapTypes.ts`)

### `HeapParams` — add field
```typescript
ghostPointCount: number;  // random extra points added per accepted placement; default 1
```

`DEFAULT_HEAP_PARAMS` sets `ghostPointCount: 1`.

`UpdateHeapParamsRequest` is `Partial<Omit<HeapParams, 'worldHeight'>>` — `ghostPointCount` is automatically included and updatable via the admin API.

### `PlaceResponse` — add field
```typescript
bonusCoins?: number;  // present when placement qualifies for off-peak bonus
```

---

## Server: `POST /heaps/:id/place` (`server/src/routes/heap.ts`)

Two new server-local constants:
```typescript
const OFF_PEAK_THRESHOLD_PX = 100;  // px below top_y that qualifies for bonus
const OFF_PEAK_BONUS_COINS  = 10;   // flat coin amount awarded
```

After the player's point is accepted (validation passed, `isPointInside` check passed):

### Step 1 — Insert player point (existing logic, unchanged)

### Step 2 — Insert ghost points (new)
```
ghostCount = params.ghostPointCount ?? 1
for i in 0..ghostCount:
  gx = random float in [PLACE_X_MIN, PLACE_X_MAX]
  gy = random float in [top_y, liveZoneBottomY]
  insert { x: gx, y: gy } into liveZone sorted by Y ascending
```
No `isPointInside` guard — ghost points are intentional noise. If they land inside the polygon the convex shape ignores them. All points (player + ghosts) go into one `updateHeap` call — **one version bump**.

### Step 3 — Compute off-peak bonus (new)
```
bonusCoins = y > top_y + OFF_PEAK_THRESHOLD_PX ? OFF_PEAK_BONUS_COINS : undefined
```

### Step 4 — Return
```typescript
return c.json({ accepted: true, version: newVersion, bonusCoins } satisfies PlaceResponse);
```

---

## Client: `HeapClient.append` (`src/systems/HeapClient.ts`)

Change signature from `Promise<void>` to `Promise<PlaceResponse | null>`:
- Parse and return the JSON response on success
- Return `null` on network error or non-ok response (existing silent-drop behavior preserved)

---

## Client: `GameScene.placeBlock` (`src/scenes/GameScene.ts`)

Capture bonus coins from the append response:
```typescript
let bonusCoinsFromServer = 0;
const appendDone = HeapClient.append(this._heapId, px, py).then(placeResp => {
  bonusCoinsFromServer = placeResp?.bonusCoins ?? 0;
  return HeapClient.load(this._heapId);
}).then(freshPolygon => { /* existing polygon refresh logic */ });
```

Pass `bonusCoins` to `ScoreScene`:
```typescript
this.scene.launch('ScoreScene', {
  ...existingProps,
  bonusCoins: bonusCoinsFromServer,
});
```

---

## Client: `coinBreakdown` + `ScoreScene`

### `src/systems/coinBreakdown.ts`
New row type `'off_peak_bonus'`. `buildCoinBreakdown` accepts new param `offPeakBonus: number` (default 0). When > 0, pushes a flat-add row after the existing rows:
```typescript
running += offPeakBonus;
rows.push({ type: 'off_peak_bonus', multiplier: offPeakBonus, runningTotal: running });
```
(Using `multiplier` field to store the flat amount — consistent with existing row shape.)

### `src/scenes/ScoreScene.ts`
- Accept `bonusCoins` in scene init data (default 0)
- Pass it to `buildCoinBreakdown`
- Add label for `'off_peak_bonus'`: `"Off-peak bonus"`
- Add accent color for the new row type

---

## Database Migration

No migration file needed. `ghostPointCount` is stored inside the existing `params` JSON column on the `heap` table — adding a new field to `HeapParams` and `DEFAULT_HEAP_PARAMS` is sufficient. Existing heap rows that predate this change will lack the key in their stored JSON; the server's `{ ...DEFAULT_HEAP_PARAMS, ...storedParams }` merge pattern already fills in missing fields with defaults, so those heaps automatically behave as `ghostPointCount: 1` without any data backfill.

---

## Admin UI (`admin/index.html`)

Two forms need a `ghostPointCount` input:

### Edit Params form (`ep-*` IDs)
Add after the `scoreMult` row, before the locked `worldHeight` row:
```html
<div><label>ghostPointCount</label><input type="number" step="1" min="0" id="ep-ghostPointCount" /></div>
```
Populate it in `openEditPanel`: `$('ep-ghostPointCount').value = heap.params.ghostPointCount ?? 1;`
Read it in the save handler alongside the other params.

### Create Heap form (`cp-*` IDs)
Add after the `scoreMult` row:
```html
<div><label>ghostPointCount</label><input type="number" step="1" min="0" id="cp-ghostPointCount" value="1" /></div>
```
Read it in the create handler alongside the other params.

---

## Tests

- **`server/tests/routes.test.ts`**: assert ghost points appear in the returned heap after a placement; assert `bonusCoins` present when `y > top_y + 100`, absent otherwise; assert `ghostPointCount` param is respected (0 = no ghosts)
- **`src/systems/__tests__/coinBreakdown.test.ts`**: assert `off_peak_bonus` row added when `offPeakBonus > 0`, total correct; assert row absent when 0

---

## Out of scope

- Ghost point count as a runtime tunable (it's a heap param, set via admin API)
- Edge-biased X distribution for ghost points (rejected — would flatten heap sides)
- Depth multiplier for off-peak bonus (flat amount is simpler to reason about)

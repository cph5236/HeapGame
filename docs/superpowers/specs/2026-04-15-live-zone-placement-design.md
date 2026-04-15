# Live Zone Placement — Design Spec

**Date:** 2026-04-15
**Feature:** Allow block placement anywhere within the heap's active (live) zone

---

## Problem

Block placement (heap growth) is currently gated to within 300px of the heap's topmost surface (`HEAP_TOP_ZONE_PX`). Players can only contribute to the heap near the summit. The goal is to allow placement anywhere within the heap's live zone — the un-frozen portion tracked by the server.

---

## Decision

The "active zone" is defined as the server's `liveZone`: the set of vertices not yet frozen into the base polygon. Once vertices freeze they become immutable. The client already caches `liveZone: Vertex[]` in localStorage after every `load()`, so the boundary can be derived without server changes.

---

## Architecture

### 1. `HeapClient.getLiveZoneBottomY(heapId: string): number | null`

New static method on `HeapClient`. Reads the existing localStorage cache for the given heap ID and returns the maximum Y value across all `liveZone` vertices (the freeze line). Returns `null` if the cache is absent or the liveZone array is empty.

```ts
static getLiveZoneBottomY(heapId: string): number | null {
  const cache = loadCache(heapId);
  if (!cache || cache.liveZone.length === 0) return null;
  return Math.max(...cache.liveZone.map(v => v.y));
}
```

No server changes. No shared type changes.

### 2. `GameScene._liveZoneBottomY: number | null`

New private field, initialized to `null`. Refreshed in two places:

- After the initial `HeapClient.load()` call in `create()`
- After the `append()` + `load()` chain resolves in `placeBlock()`

### 3. Replace `inTopZone` with `inLiveZone`

```ts
// Before
const inTopZone = this.player.sprite.y < this.heapGenerator.topY + HEAP_TOP_ZONE_PX;

// After
const inLiveZone = this._liveZoneBottomY !== null
  ? this.player.sprite.y <= this._liveZoneBottomY   // upper bound: player can't be above topY in practice
  : this.player.sprite.y < this.heapGenerator.topY + HEAP_TOP_ZONE_PX;
```

No explicit upper bound is needed: `onHeapSurface` (body.blocked.down) already requires the player to be standing on a heap block, which is physically impossible above the summit.

The fallback (offline / mock heap with no cached liveZone) preserves the existing `HEAP_TOP_ZONE_PX` behavior so local dev and tests are unaffected.

All three references to `inTopZone` in `GameScene.update()` — the computation, `showPlaceUI`, and `canPlace` — are replaced with `inLiveZone`.

### 4. UI hint text

The desktop hint text that currently references the top zone is updated to remove the zone qualifier (e.g. `"[R] to place"`). The placement button on mobile (`placeBtnBg` / `placeBtnLabel`) is unchanged — it appears/disappears based on `inLiveZone` the same way it did for `inTopZone`.

---

## Constraints preserved

- `onHeapSurface` — player must still be standing on a block
- `inCenterZone` — player must still be in the middle 75% of world width
- `!blockPlaced` — one placement per run, unchanged

---

## Testing

New test group in `src/systems/__tests__/HeapClient.test.ts`:

| Test | Expected |
|------|----------|
| No cache for heapId | `getLiveZoneBottomY` returns `null` |
| Cache with populated liveZone | Returns `Math.max` of all vertex Y values |
| Cache with empty liveZone array | Returns `null` |

No changes required to existing tests. GameScene logic change is too thin to warrant a dedicated test.

---

## Files changed

| File | Change |
|------|--------|
| `src/systems/HeapClient.ts` | Add `getLiveZoneBottomY` static method |
| `src/scenes/GameScene.ts` | Add `_liveZoneBottomY` field; refresh after load; replace `inTopZone` → `inLiveZone`; update hint text |
| `src/systems/__tests__/HeapClient.test.ts` | Add 3 tests for `getLiveZoneBottomY` |

---

## Out of scope

- Server-side freeze boundary enforcement (server already accepts any Y vertex)
- Expanding item placement (ladders, I-beams, checkpoints) — separate feature
- Visual indicator showing the live zone boundary to the player

# Heap Locking — Design

**Date:** 2026-07-17
**Status:** Approved

## Goal

Lock harder heaps behind easier ones: a player must beat a designated
prerequisite heap before a locked heap becomes playable. The lock is
configurable per heap from the admin UI and rendered as a visually locked row
in the heap selector.

## Decisions (from brainstorming)

- **Win condition:** *any successful placement* on the prerequisite heap counts
  as beating it — a run that ends via `placeBlock()` (not a death), at any
  height. `isPeak` is not required.
- **Completion persistence:** client-side in `SaveData`
  (`beatenHeapIds: string[]`), synced across devices via the existing GPGS
  cloud-save merge. No server-side per-player completion tracking.
- **Lock modeling:** per-heap nullable pointer `locked_by_heap_id` on the
  `heap` table in heap_core — alongside its sibling `HeapParams` columns
  (NOT the `heap_parameters` table, which only holds the enemy-spawn JSON and
  has sentinel-default semantics that don't fit a lock).
- **Fail open:** if a lock's prerequisite heap no longer exists in the catalog,
  the heap is treated as unlocked.

## 1. Data model & API

- New heap_core migration `0003_locked_by_heap.sql`:
  `ALTER TABLE heap ADD COLUMN locked_by_heap_id TEXT` (nullable, no FK —
  SQLite ALTER can't add FKs and fail-open semantics are wanted anyway).
  Follow the `adding-d1-migrations` skill (two-file rule: migration + updated
  `server/schema/heap_core.sql`).
- `HeapParams` (shared/heapTypes.ts) gains `lockedByHeapId?: string | null`.
  `DEFAULT_HEAP_PARAMS` leaves it unset.
- The field rides the existing paths with no new endpoints:
  - `listHeaps` → `HeapSummary.params` (what HeapSelectScene consumes),
  - create (`CreateHeapRequest.params`),
  - update (`UpdateHeapParamsRequest` is `Partial<Omit<HeapParams,'worldHeight'>>`,
    so it picks the field up automatically).
- D1 / Mock / Cached heap repo variants all map the new column.
- Update validation (server): `lockedByHeapId`, when non-null, must
  - be an existing heap's ID,
  - not be the heap itself (no self-lock),
  - not create a direct two-heap cycle (A locked by B while B locked by A).
  Longer cycles are not validated (admin foot-gun accepted; client fails open
  only for *missing* prerequisites, so admins should keep chains sane).

## 2. Completion tracking (client)

- `SaveData` gains `beatenHeapIds: string[]` — save-version bump with a
  migration defaulting to `[]`.
- Recorded in `GameScene.placeBlock()` as soon as the run ends with a
  successful placement (before the outro plays, so a crash mid-outro doesn't
  lose it). Dedup on insert.
- Infinite mode is untouched.
- Cloud-save merge: union of local and cloud `beatenHeapIds`. The merge path
  already carries `playerSecret` per the auth convention — no auth change.

## 3. Heap selector (client)

- Pure resolver, unit-testable without Phaser (same pattern as
  `heapSelectStats.ts`):
  `isHeapLocked(heap, catalog, beatenIds)` — locked iff `lockedByHeapId` is
  set **and** that ID exists in the catalog **and** it is not in `beatenIds`.
- Locked row rendering in `HeapSelectScene`:
  - dimmed row + lock icon,
  - subtitle "Beat 〈prerequisite heap name〉 to unlock" (name resolved from the
    catalog),
  - tapping the row does not start the heap (brief shake / denial sound),
  - the leaderboard button still works so players can peek at locked heaps.

## 4. Admin UI

- Heap edit panel gains a **"Locked by"** dropdown: "None" + every *other*
  heap (by name). Saved through the existing params-update call; server
  validation above is the backstop.

## 5. Testing

- **Shared/client pure:** `isHeapLocked` unit tests incl. fail-open cases
  (missing prerequisite, null field, already beaten).
- **Server:** param-update validation tests — unknown ID rejected, self-lock
  rejected, A↔B cycle rejected, valid pointer accepted, null clears the lock;
  list/read round-trips the field.
- **SaveData:** version-migration test (old saves get `[]`), merge-union test.
- **Visual:** scene-preview screenshots of a locked row (heap-scene-preview
  skill), then a live browser smoke test (smoke-testing-heap skill): beat a
  prerequisite heap, verify the locked heap unlocks.

## Out of scope

- Server-side per-player completion records / cheat resistance.
- Multiple prerequisites per heap ("beat A and B").
- Ordered progression index; branches are expressed via the per-heap pointer.

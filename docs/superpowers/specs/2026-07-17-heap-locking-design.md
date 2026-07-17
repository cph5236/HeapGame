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
- No new endpoints: the field rides `listHeaps` → `HeapSummary.params` (what
  HeapSelectScene consumes), create (`CreateHeapRequest.params`), and update
  (`UpdateHeapParamsRequest` is `Partial<Omit<HeapParams,'worldHeight'>>`).
  The *types* accept it for free; the runtime mappings do not — see below.
- D1 and Mock heap repos map the new column (SELECT/INSERT/UPDATE SQL in the
  D1 repo, row shape in Mock). `CachedHeapDB` needs no changes — it is a pure
  KV decorator that delegates whole objects.
- **The field does NOT thread through automatically.** The TS types pick it up,
  but every runtime `HeapRow → HeapParams` mapping is a hand-written field
  list. Each must be touched explicitly or the lock silently drops:
  - `listHeaps` params literal (routes/heap.ts, GET /),
  - `getHeap` params literal (GET /:id),
  - **`reset` merged-params literal (PUT /:id/reset)** — today this literal
    omits nothing it doesn't know about; without a `lockedByHeapId` line, a
    reset would null out the lock,
  - `update-params` merged literal (PUT /:id/params).
- Validation (server), on any write that sets `lockedByHeapId` non-null:
  - must be an existing heap's ID,
  - must not be the heap itself (no self-lock),
  - **full cycle detection**: walk the `lockedByHeapId` chain starting from
    the proposed prerequisite; reject if the walk revisits the heap being
    edited (or exceeds catalog size, as a belt-and-braces bound). A two-hop
    check is NOT sufficient — three individually-valid edits can form
    A→B→C→A, which permanently locks all three heaps for every player and is
    unrecoverable (fail-open never triggers because no prerequisite is
    missing).
  - This validation is async (needs DB reads), so it cannot live in the pure
    `resolveParams` helper — it is a separate async step wired into all three
    write paths (create, update-params, reset-with-params).

## 2. Completion tracking (client)

- `SaveData` gains `beatenHeapIds: string[]` — **required with default `[]`**,
  following the `cosmeticsOwned` precedent (`parsed.beatenHeapIds ?? []` in
  load; no save-version bump needed — every optional-shaped field since v5 was
  added this way). Required-not-optional matters: `mergeCloudSave` returns a
  hand-built literal, and if the field were optional, a missed merge line
  would compile fine and silently wipe beaten heaps on every cloud merge,
  re-locking them.
- `mergeCloudSave`: union of local and cloud `beatenHeapIds`
  (same `new Set([...local, ...cloud])` shape as `cosmeticsOwned`), plus a
  regression test asserting `playerSecret` survives the merge.
- Recorded in `GameScene.placeBlock()` as soon as the run ends with a
  successful placement (before the outro plays, so a crash mid-outro doesn't
  lose it). Dedup on insert.
- Infinite mode is untouched.

## 3. Heap selector (client)

- Pure resolver, unit-testable without Phaser (same pattern as
  `heapSelectStats.ts`):
  `isHeapLocked(heap, catalog, beatenIds)` — locked iff `lockedByHeapId` is
  set **and** that ID exists in the catalog **and** it is not in `beatenIds`.
- Locked row rendering in `HeapSelectScene`:
  - dimmed row + lock icon,
  - subtitle "Beat 〈prerequisite heap name〉 to unlock" (name resolved from the
    catalog),
  - the lock guard lives **inside `select()`**, not in the tap handler —
    keyboard ENTER (`confirmSelection()`) calls `select()` directly and must
    be gated too. A locked `select()` call is a no-op plus denial feedback
    (brief shake / sound),
  - the leaderboard button still works so players can peek at locked heaps.

## 4. Admin UI

- Heap edit panel gains a **"Locked by"** dropdown: "None" + every *other*
  heap (by name). Saved through the existing params-update call; server
  validation above is the backstop.

## 5. Testing

- **Shared/client pure:** `isHeapLocked` unit tests incl. fail-open cases
  (missing prerequisite, null field, already beaten).
- **Server:** validation tests — unknown ID rejected, self-lock rejected,
  A↔B cycle rejected, **A→B→C→A chain rejected on the closing edit**, valid
  chain accepted, null clears the lock; list/read round-trip the field;
  **reset preserves the lock** (regression for the merged-literal gap).
- **SaveData:** old saves load with `beatenHeapIds: []`; merge-union test;
  regression test that `playerSecret` survives `mergeCloudSave`.
- **Visual:** scene-preview screenshots of a locked row (heap-scene-preview
  skill), then a live browser smoke test (smoke-testing-heap skill): beat a
  prerequisite heap, verify the locked heap unlocks.

## Rollout note

Retroactively locking an already-live heap is a UX cliff: `beatenHeapIds`
tracks *wins*, not *has played*, so existing players who have played (but
never beaten) a heap lose access with no credit. Admins should only lock
newly added heaps, or accept that veterans must re-beat the prerequisite.
No code mitigation in this iteration.

## Out of scope

- Server-side per-player completion records / cheat resistance.
- Multiple prerequisites per heap ("beat A and B").
- Ordered progression index; branches are expressed via the per-heap pointer.

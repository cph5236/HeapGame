# Live Zone Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed `HEAP_TOP_ZONE_PX` placement gate with a dynamic boundary derived from the server's liveZone cache, allowing block placement anywhere in the un-frozen portion of the heap.

**Architecture:** Add `HeapClient.getLiveZoneBottomY(heapId)` which reads the existing localStorage cache and returns the max Y of the liveZone vertices. `GameScene` stores the result in `_liveZoneBottomY`, refreshes it after each `load()`, and uses it to replace `inTopZone` with `inLiveZone` in `update()`.

**Tech Stack:** TypeScript, Phaser 3, Vitest

---

## File Map

| File | Change |
|------|--------|
| `src/systems/HeapClient.ts` | Add `static getLiveZoneBottomY(heapId: string): number \| null` |
| `src/scenes/GameScene.ts` | Add `_liveZoneBottomY` field; init in `create()`; refresh in `placeBlock()`; replace `inTopZone` → `inLiveZone` in `update()` |
| `src/systems/__tests__/HeapClient.test.ts` | Add 3 tests for `getLiveZoneBottomY` |

---

## Task 1: `HeapClient.getLiveZoneBottomY` — tests + implementation

**Files:**
- Modify: `src/systems/__tests__/HeapClient.test.ts`
- Modify: `src/systems/HeapClient.ts`

- [ ] **Step 1: Write 3 failing tests**

Append this `describe` block at the end of `src/systems/__tests__/HeapClient.test.ts` (after all existing `describe` blocks):

```ts
// ── getLiveZoneBottomY() ──────────────────────────────────────────────────────

describe('HeapClient.getLiveZoneBottomY', () => {
  it('returns null when no cache exists for the heapId', () => {
    // localStorage is empty (fresh stub from beforeEach)
    expect(HeapClient.getLiveZoneBottomY('no-such-id')).toBeNull();
  });

  it('returns null when cached liveZone is empty', () => {
    localStorageStub.setItem(
      'heap_cache_abc',
      JSON.stringify({ version: 1, baseId: 'b1', liveZone: [] }),
    );
    expect(HeapClient.getLiveZoneBottomY('abc')).toBeNull();
  });

  it('returns the maximum Y value from a populated liveZone', () => {
    localStorageStub.setItem(
      'heap_cache_xyz',
      JSON.stringify({
        version: 3,
        baseId: 'b2',
        liveZone: [
          { x: 100, y: 200 },
          { x: 150, y: 800 },
          { x: 120, y: 500 },
        ],
      }),
    );
    expect(HeapClient.getLiveZoneBottomY('xyz')).toBe(800);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /home/connor/Documents/Repos/HeapGame && npm test -- --reporter=verbose 2>&1 | grep -A 3 "getLiveZoneBottomY"
```

Expected: 3 failures — `HeapClient.getLiveZoneBottomY is not a function` (or similar).

- [ ] **Step 3: Add `getLiveZoneBottomY` to `HeapClient`**

In `src/systems/HeapClient.ts`, add this method after the `append` method (before the closing `}`):

```ts
  /**
   * Returns the maximum Y value (freeze line) of the cached liveZone for a heap.
   * Returns null if the cache is absent or the liveZone is empty.
   */
  static getLiveZoneBottomY(heapId: string): number | null {
    const cache = loadCache(heapId);
    if (!cache || cache.liveZone.length === 0) return null;
    return Math.max(...cache.liveZone.map(v => v.y));
  }
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /home/connor/Documents/Repos/HeapGame && npm test -- --reporter=verbose 2>&1 | grep -A 3 "getLiveZoneBottomY"
```

Expected: 3 tests pass. Full suite should still be green — run without filter to confirm:

```bash
cd /home/connor/Documents/Repos/HeapGame && npm test 2>&1 | tail -5
```

Expected: something like `Tests X passed (X)` with no failures.

- [ ] **Step 5: Commit**

```bash
cd /home/connor/Documents/Repos/HeapGame && git add src/systems/HeapClient.ts src/systems/__tests__/HeapClient.test.ts && git commit -m "feat: add HeapClient.getLiveZoneBottomY for live zone boundary"
```

---

## Task 2: Wire `_liveZoneBottomY` into `GameScene` and replace `inTopZone`

**Files:**
- Modify: `src/scenes/GameScene.ts`

- [ ] **Step 1: Add `_liveZoneBottomY` field**

In `src/scenes/GameScene.ts`, add the field next to the existing `_holdElapsed` field (around line 64):

```ts
  private _holdElapsed = 0;
  private _liveZoneBottomY: number | null = null;
```

- [ ] **Step 2: Initialize `_liveZoneBottomY` in `create()`**

Find this line in `create()` (around line 99):

```ts
    this._heapId = heapId;
```

Add one line immediately after it:

```ts
    this._heapId = heapId;
    this._liveZoneBottomY = HeapClient.getLiveZoneBottomY(heapId);
```

By the time `GameScene.create()` runs, `BootScene` has already called `HeapClient.load()` and populated the localStorage cache, so this read is always current.

- [ ] **Step 3: Refresh `_liveZoneBottomY` after `placeBlock()` completes**

Find the `placeBlock()` method (around line 380). The existing chain is:

```ts
    void HeapClient.append(this._heapId, px, py).then(() =>
      HeapClient.load(this._heapId),
    ).then(freshPolygon => {
      applyPolygonToGenerator(freshPolygon, this.heapGenerator);
      this.heapGenerator.setPolygonTopY(polygonTopY(freshPolygon));
      this.game.registry.set('heapPolygon', freshPolygon);
    });
```

Replace it with:

```ts
    void HeapClient.append(this._heapId, px, py).then(() =>
      HeapClient.load(this._heapId),
    ).then(freshPolygon => {
      applyPolygonToGenerator(freshPolygon, this.heapGenerator);
      this.heapGenerator.setPolygonTopY(polygonTopY(freshPolygon));
      this.game.registry.set('heapPolygon', freshPolygon);
      this._liveZoneBottomY = HeapClient.getLiveZoneBottomY(this._heapId);
    });
```

- [ ] **Step 4: Replace `inTopZone` with `inLiveZone` in `update()`**

Find the `update()` method. The current block (around line 252) is:

```ts
  update(_time: number, delta: number): void {
    const im = this.im;
    const inTopZone = this.player.sprite.y < this.heapGenerator.topY + HEAP_TOP_ZONE_PX;
    im.update(delta, inTopZone);
```

And later (around line 295):

```ts
    const showPlaceUI = inTopZone && !this.blockPlaced;
```

And (around line 309):

```ts
    const canPlace = !this.blockPlaced && inTopZone && inCenterZone && onHeapSurface;
```

Replace all three references. The new `update()` opening:

```ts
  update(_time: number, delta: number): void {
    const im = this.im;
    const inLiveZone = this._liveZoneBottomY !== null
      ? this.player.sprite.y <= this._liveZoneBottomY
      : this.player.sprite.y < this.heapGenerator.topY + HEAP_TOP_ZONE_PX;
    im.update(delta, inLiveZone);
```

The `showPlaceUI` line:

```ts
    const showPlaceUI = inLiveZone && !this.blockPlaced;
```

The `canPlace` line:

```ts
    const canPlace = !this.blockPlaced && inLiveZone && inCenterZone && onHeapSurface;
```

- [ ] **Step 5: Run full test suite**

```bash
cd /home/connor/Documents/Repos/HeapGame && npm test 2>&1 | tail -5
```

Expected: all tests pass (no new failures — `GameScene` is not unit-tested so this just confirms nothing else broke).

- [ ] **Step 6: Commit**

```bash
cd /home/connor/Documents/Repos/HeapGame && git add src/scenes/GameScene.ts && git commit -m "feat: gate block placement on live zone boundary instead of fixed top zone"
```

---

## Smoke test checklist (manual)

After both tasks are merged:

1. Start dev server: `npm run dev`
2. Load a heap from the server (requires local Wrangler running)
3. Climb partway down from the summit — the PLACE BLOCK button / SPACE hint should remain visible
4. Stand on a heap surface well below the old 300px top zone — hold SPACE / PLACE BLOCK and confirm placement fires
5. Climb below the freeze line — confirm the button disappears
6. Offline fallback: disconnect from server, reload — confirm the button still appears near the top (HEAP_TOP_ZONE_PX fallback active)

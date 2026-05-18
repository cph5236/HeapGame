# Ghost Point Jitter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fully-random ghost point placement with vertex-anchored jitter — each ghost point is placed within ±80px of a randomly sampled existing live zone vertex, keeping the heap shape organic rather than spikey.

**Architecture:** Single change to the ghost point loop in `POST /heaps/:id/place`. A new constant `GHOST_JITTER_RADIUS_PX = 80` is added alongside the existing `OFF_PEAK_*` constants. The player's just-placed vertex is already in `liveZone` before the ghost loop runs, so there is always at least one anchor to sample — no fallback needed.

**Tech Stack:** Hono (server route), Cloudflare D1 (via MockHeapDB in tests), Vitest.

---

## File Map

| File | Change |
|---|---|
| `server/src/routes/heap.ts` | Add `GHOST_JITTER_RADIUS_PX` constant; replace random-in-bounds ghost loop with jitter-from-anchor loop |
| `server/tests/routes.test.ts` | Add one new test verifying ghost points land near an existing vertex |

---

### Task 1: Jitter ghost points toward existing live zone vertices

**Files:**
- Modify: `server/src/routes/heap.ts`
- Modify: `server/tests/routes.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the `describe('POST /heaps/:id/place', ...)` block in `server/tests/routes.test.ts`, after the existing ghost point tests:

```typescript
  it('ghost points land within GHOST_JITTER_RADIUS_PX of an existing live zone vertex', async () => {
    // Seed a heap with one existing vertex far from the placement point
    const db = new MockHeapDB();
    db.seedHeap('h1', 1, [{ x: 600, y: 300 }], 'base-1', 0, {
      ...DEFAULT_HEAP_PARAMS,
      ghostPointCount: 1,
    });
    db.seedBase('base-1', 'h1', []);

    const app = createApp(db, new MockScoreDB());
    await app.request('/heaps/h1/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 100, y: 150 }),
    });

    const heapRes = await app.request('/heaps/h1?version=0');
    const heap = await heapRes.json() as Extract<GetHeapResponse, { changed: true }>;
    // 1 existing + 1 player + 1 ghost = 3
    expect(heap.liveZone).toHaveLength(3);

    const RADIUS = 80; // must match GHOST_JITTER_RADIUS_PX in heap.ts
    // Possible anchors at the time ghost was inserted: existing (600,300) and player (100,150)
    const anchors = [{ x: 600, y: 300 }, { x: 100, y: 150 }];
    const ghostPoints = heap.liveZone.filter(
      v => !(v.x === 100 && v.y === 150) && !(v.x === 600 && v.y === 300),
    );
    expect(ghostPoints).toHaveLength(1);
    const ghost = ghostPoints[0];
    const nearAnyAnchor = anchors.some(
      a => Math.abs(ghost.x - a.x) <= RADIUS && Math.abs(ghost.y - a.y) <= RADIUS,
    );
    expect(nearAnyAnchor).toBe(true);
  });
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd server && npm test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|ghost|jitter|✓|✗"
```

Expected: the new test fails (old code places ghost randomly, likely outside any ±80 window).

- [ ] **Step 3: Add GHOST_JITTER_RADIUS_PX constant**

In `server/src/routes/heap.ts`, find:
```typescript
const OFF_PEAK_THRESHOLD_PX = 100; // px below top_y that earns off-peak bonus
const OFF_PEAK_BONUS_COINS  = 10;  // flat coins awarded for off-peak placement
```

Add immediately after:
```typescript
const GHOST_JITTER_RADIUS_PX = 80;  // max px offset from anchor when placing ghost points
```

- [ ] **Step 4: Replace the ghost point loop**

Find:
```typescript
    // Ghost points: spread heap shape without player input
    const ghostCount = Math.max(0, Math.floor(row.ghost_point_count ?? 1));
    for (let i = 0; i < ghostCount; i++) {
      const gx = PLACE_X_MIN + Math.random() * (PLACE_X_MAX - PLACE_X_MIN);
      const gy = row.top_y + Math.random() * (liveZoneBottomY - row.top_y);
      const gv: Vertex = { x: gx, y: gy };
      const gIdx = liveZone.findIndex((v) => v.y > gy);
      if (gIdx === -1) liveZone.push(gv); else liveZone.splice(gIdx, 0, gv);
    }
```

Replace with:
```typescript
    // Ghost points: jitter near a random existing live zone vertex to keep heap shape organic
    const ghostCount = Math.max(0, Math.floor(row.ghost_point_count ?? 1));
    for (let i = 0; i < ghostCount; i++) {
      const anchorIdx = Math.floor(Math.random() * liveZone.length);
      const anchor = liveZone[anchorIdx];
      const dx = (Math.random() * 2 - 1) * GHOST_JITTER_RADIUS_PX;
      const dy = (Math.random() * 2 - 1) * GHOST_JITTER_RADIUS_PX;
      const gx = Math.max(PLACE_X_MIN, Math.min(PLACE_X_MAX, anchor.x + dx));
      const gy = Math.max(row.top_y, Math.min(liveZoneBottomY, anchor.y + dy));
      const gv: Vertex = { x: gx, y: gy };
      const gIdx = liveZone.findIndex((v) => v.y > gy);
      if (gIdx === -1) liveZone.push(gv); else liveZone.splice(gIdx, 0, gv);
    }
```

- [ ] **Step 5: Run all server tests**

```bash
cd server && npm test
```

Expected: all tests pass (159 existing + 1 new = 160 total). The existing ghost count tests (`toHaveLength(3)`) still pass because they only assert count, not position.

- [ ] **Step 6: Run build**

```bash
cd /home/connor/Documents/Repos/HeapGame && npm run build 2>&1 | grep error
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/heap.ts server/tests/routes.test.ts
git commit -m "feat: ghost points jitter near existing live zone vertices instead of random placement"
```

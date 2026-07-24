# Enemy-Params Version Bump Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an Admin-UI enemy-params edit bump the heap's `version` so version-gated base-heap clients re-fetch the fresh params on their next `load()`.

**Architecture:** Server-only change. The `PUT /heaps/:id/enemy-params` handler already writes the `heap_parameters` table via `db.upsertEnemyParams`; we add a version bump by reusing the existing `db.updateHeap` (all other row fields passed through unchanged). `updateHeap` already invalidates the KV heap-row cache, and `GET /:id`'s `changed: true` branch already returns freshly-read `enemyParams` — so no client change is needed.

**Tech Stack:** TypeScript, Hono (Cloudflare Worker), Vitest. D1 with Mock + Cached DB variants.

## Global Constraints

- Branch off `main`; PR before merge, never push direct to main.
- No migration, no client change, no DB-interface change — server route + test only.
- `updateHeap` CAS uses `expectedVersion`; a lost CAS is safe to ignore (see Task 1 rationale).
- Run `npm test` and `npm run build` before claiming done.

---

### Task 1: Bump heap version on enemy-params PUT

**Files:**
- Modify: `server/src/routes/heap.ts` (the `PUT /:id/enemy-params` handler, currently `heap.ts:240-257`)
- Test: `server/tests/routes.test.ts` (the `describe('PUT /heaps/:id/enemy-params', …)` suite at `routes.test.ts:758`)

**Interfaces:**
- Consumes (already present, no new imports):
  - `db.getHeap(id)` → `HeapRow | null` with fields `base_id: string`, `live_zone: string` (JSON), `freeze_y: number`, `version: number`.
  - `db.upsertEnemyParams(id, params)` → `Promise<void>`.
  - `db.updateHeap(id, baseId: string, version: number, liveZone: Vertex[], freezeY: number, expectedVersion?: number)` → `Promise<boolean>` (`true` if the CAS UPDATE applied). In `CachedHeapDB` it invalidates `cache:heap:${id}` + list cache on success.
  - `Vertex` type — already imported in `heap.ts:23`.
- Produces: no new exported symbols. Behaviour change only: after a successful `PUT /:id/enemy-params`, the heap's `version` is `version + 1`.

- [ ] **Step 1: Write the failing tests**

Add these two tests inside the existing `describe('PUT /heaps/:id/enemy-params', …)` block in `server/tests/routes.test.ts` (append after the existing `'subsequent GET returns the PUT value'` test, before the `400` cases). They use the same `makeApp()` / `VERTICES` / `HeapEnemyParams` helpers already imported at the top of the file.

```ts
it('bumps heap version so a version-gated client sees changed:true with fresh params', async () => {
  const app = makeApp();
  const createRes = await app.request('/heaps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vertices: VERTICES }),
  });
  const { id } = await createRes.json() as { id: string };

  // Read the heap once to learn its current version (client's cached version).
  const before = await (await app.request(`/heaps/${id}?version=0`)).json()
    as Extract<GetHeapResponse, { changed: true }>;
  const oldVersion = before.version;

  const params: HeapEnemyParams = {
    ghost: { spawnStartPxAboveFloor: 2222, spawnEndPxAboveFloor: -1, spawnRampPxAboveFloor: 9000, spawnChanceMin: 0.1, spawnChanceMax: 0.4 },
  };
  const putRes = await app.request(`/heaps/${id}/enemy-params`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  expect(putRes.status).toBe(200);

  // A client caught up to oldVersion must now be told the heap changed…
  const after = await (await app.request(`/heaps/${id}?version=${oldVersion}`)).json()
    as GetHeapResponse;
  expect(after.changed).toBe(true);
  expect(after.version).toBeGreaterThan(oldVersion);
  // …and the delta must carry the freshly-written enemy params.
  const changed = after as Extract<GetHeapResponse, { changed: true }>;
  expect(changed.enemyParams.ghost.spawnStartPxAboveFloor).toBe(2222);
});

it('a client caught up to the new version still gets changed:false', async () => {
  const app = makeApp();
  const createRes = await app.request('/heaps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vertices: VERTICES }),
  });
  const { id } = await createRes.json() as { id: string };

  await app.request(`/heaps/${id}/enemy-params`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ghost: { spawnStartPxAboveFloor: 5, spawnEndPxAboveFloor: -1, spawnRampPxAboveFloor: 9000, spawnChanceMin: 0.1, spawnChanceMax: 0.4 } } as HeapEnemyParams),
  });

  const current = await (await app.request(`/heaps/${id}?version=0`)).json()
    as Extract<GetHeapResponse, { changed: true }>;
  const res = await (await app.request(`/heaps/${id}?version=${current.version}`)).json()
    as GetHeapResponse;
  expect(res.changed).toBe(false);
});
```

Confirm `GetHeapResponse` is imported at the top of `routes.test.ts` (it is used elsewhere in the file, e.g. `routes.test.ts:387`). If not, add it to the existing `shared/heapTypes` import.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- routes.test.ts -t "enemy-params"`
Expected: the new `bumps heap version…` test FAILS — `after.changed` is `false` (version never bumped), so `expect(after.changed).toBe(true)` fails. The `still gets changed:false` test may already pass; that is fine (it is a regression guard).

- [ ] **Step 3: Implement the version bump**

In `server/src/routes/heap.ts`, in the `PUT /:id/enemy-params` handler, replace:

```ts
    await db.upsertEnemyParams(id, body);
    return c.json({ ok: true });
```

with:

```ts
    await db.upsertEnemyParams(id, body);
    // Bump the heap version so version-gated clients (base-heap load()) re-fetch
    // the fresh enemy params on their next load instead of keeping stale cache.
    // Reuse updateHeap with every other field unchanged; it also invalidates the
    // KV heap-row cache. CAS on the current version — if a concurrent place wins
    // the race it already bumped the version, so the client still refreshes.
    await db.updateHeap(
      id,
      row.base_id,
      row.version + 1,
      JSON.parse(row.live_zone) as Vertex[],
      row.freeze_y,
      row.version,
    );
    return c.json({ ok: true });
```

(`row` is already in scope — it is fetched at the top of the handler via `const row = await db.getHeap(id);`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- routes.test.ts -t "enemy-params"`
Expected: PASS — all enemy-params tests green, including the two new ones.

- [ ] **Step 5: Run the full server + shared suite and the build**

Run: `npm test`
Expected: PASS — no regressions (existing `'upserts and returns ok:true'` and `'subsequent GET returns the PUT value'` tests still green; the Mock DB's `updateHeap` handles the pass-through update).

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/heap.ts server/tests/routes.test.ts
git commit -m "fix(heap): bump version on enemy-params PUT so clients pick up edits"
```

---

## Self-Review

**Spec coverage:**
- "Bump version inside PUT /heaps/:id/enemy-params handler" → Task 1 Step 3. ✓
- "Next base-heap load sees changed:true and gets fresh enemyParams" → Task 1 Step 1 first test. ✓
- "No migration / no client / no DB-interface change" → confirmed; only `heap.ts` route + `routes.test.ts` touched, reusing existing `updateHeap`. ✓
- "Tests: version increments; GET old-version → changed:true with new params; GET new-version → changed:false" → both new tests in Step 1. ✓
- Concurrency (ignore CAS miss) → documented in the Step 3 code comment; no extra code needed. ✓
- Verification (`npm test`, `npm run build`) → Steps 4–5. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; all test and implementation code is spelled out. ✓

**Type consistency:** `updateHeap(id, baseId, version, liveZone: Vertex[], freezeY, expectedVersion)` matches the signature in `db.ts:68`/`147`; `row.base_id` / `row.live_zone` / `row.freeze_y` / `row.version` match `HeapRow` (`db.ts:5`). `GetHeapResponse` discriminated union (`changed: true`) matches `shared/heapTypes.ts:96-97`. ✓

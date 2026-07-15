# /place Player Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Authenticate `POST /heaps/:id/place` with the existing player write-auth (TOFU secret) when the client sends a `playerGuid`, while keeping guid-less legacy requests working unchanged.

**Architecture:** Reuse `enforcePlayerAuth` / `PlayerAuthDB` (merged PR #94) exactly as the scores/customization/codes routes do. `PlaceRequest` gains an optional `playerGuid`; token rides the `X-Player-Token` header. No new tables, no migration.

**Tech Stack:** Hono (server routes), Vitest, TypeScript strict.

## Global Constraints

- Branch `feature/place-auth` off `main`. PR targets `main`.
- Client identity is ALWAYS `getEffectivePlayerId()` from SaveData — never bare `getPlayerGuid()`.
- Token header name comes from the exported `PLAYER_TOKEN_HEADER` constants (server: `server/src/playerAuth.ts`, client: `src/systems/authToken.ts`) — never a string literal.
- Missing `playerGuid` in a place request = legacy request → identical behavior to today (no auth check, no 403).
- Run `npm test` (root) AND `cd server && npx vitest run` AND `npm run build` (root) before declaring done.
- Commit after each task; message style `feat(place-auth): …` / `test(place-auth): …`.

---

### Task 1: PlaceRequest type + server route enforcement (TDD)

**Files:**
- Modify: `shared/heapTypes.ts` (PlaceRequest, ~line 89)
- Modify: `server/src/routes/heap.ts` (heapRoutes signature ~line 95, /place handler ~line 337)
- Modify: `server/src/app.ts:97` (pass playerAuthDb through)
- Test: `server/tests/placeAuth.test.ts` (new)

**Interfaces:**
- Produces: `heapRoutes(db: HeapDB, getSink: () => Sink | undefined, authDb?: PlayerAuthDB): Hono` — the new optional 3rd param. Task 2 (client) relies on the wire shape `{ x, y, playerGuid? }` + `X-Player-Token` header.

- [ ] **Step 1: Write failing server tests**

Create `server/tests/placeAuth.test.ts`. Study `server/tests/authEnforcement.test.ts` and `server/tests/placeCas.test.ts` first and reuse their existing helpers (mock HeapDB with a seeded heap, mock `PlayerAuthDB`, app construction via `createApp`). Cover, with a valid in-bounds placement body each time:

```ts
// Matrix rows (guid = 'p1', token = 'secret-1'):
// 1. guid + token, unclaimed        → 200 accepted, player_auth row created (claim)
// 2. guid + token, claimed match    → 200 accepted
// 3. guid + token, claimed mismatch → 403 { error: 'forbidden' }
// 4. guid, no token, unclaimed      → 200 accepted (legacy row of matrix)
// 5. guid, no token, claimed        → 403
// 6. no guid at all                 → 200 accepted (legacy passthrough, auth DB untouched)
// 7. playerGuid: ''                 → 400
// 8. playerGuid: 'x'.repeat(65)     → 400
// 9. playerGuid: 123 (non-string)   → 400
// 10. no authDb wired (createApp without playerAuthDb) + guid+token → 200 accepted
```

Use a known valid placement coordinate (see how placeCas.test.ts seeds its heap and picks x/y). For row 3, pre-claim by first placing with token `secret-1`, then attempt with token `secret-2`.

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd server && npx vitest run tests/placeAuth.test.ts`
Expected: FAIL (route ignores playerGuid today; 403/400 rows fail).

- [ ] **Step 3: Implement**

`shared/heapTypes.ts`:

```ts
export interface PlaceRequest {
  x: number;
  y: number;
  /** Optional player identity for attribution; auth token rides X-Player-Token. */
  playerGuid?: string;
}
```

`server/src/routes/heap.ts` — add imports and the optional param:

```ts
import type { PlayerAuthDB } from '../playerAuthDb';
import { enforcePlayerAuth } from '../playerAuth';

const MAX_ID_LEN = 64; // mirrors scores route

export function heapRoutes(
  db: HeapDB,
  getSink: () => Sink | undefined,
  authDb?: PlayerAuthDB,
): Hono {
```

In the `/place` handler, after the existing coord validation (after ~line 360) and BEFORE the CAS loop:

```ts
    const { playerGuid } = body;
    if (playerGuid !== undefined) {
      if (typeof playerGuid !== 'string' || playerGuid.length === 0 || playerGuid.length > MAX_ID_LEN) {
        console.warn(`[place] reject: bad playerGuid heapId=${id}`);
        const sink = getSink();
        if (sink) {
          await captureServer(sink, 'warn', 'place:rejected', { reason: 'bad playerGuid', heapId: id });
        }
        return c.json({ error: 'invalid placement' }, 400);
      }
      const authRes = await enforcePlayerAuth(c, authDb, playerGuid, getSink, 'heaps:place');
      if (authRes) return authRes;
    }
```

`server/src/app.ts:97`:

```ts
  app.route('/heaps',  heapRoutes(heapDb, () => opts.logSink, opts.playerAuthDb));
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd server && npx vitest run` (full suite — existing place tests must stay green)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/heapTypes.ts server/src/routes/heap.ts server/src/app.ts server/tests/placeAuth.test.ts
git commit -m "feat(place-auth): enforce player write-auth on /heaps/:id/place when playerGuid present"
```

---

### Task 2: Client sends identity + token (TDD)

**Files:**
- Modify: `src/systems/HeapClient.ts` (`append`, ~line 160)
- Modify: `src/scenes/GameScene.ts:686` (call site)
- Test: `src/systems/__tests__/HeapClient.test.ts` (extend `describe('HeapClient.append')`)

**Interfaces:**
- Consumes: wire shape from Task 1.
- Produces: `HeapClient.append(heapId: string, x: number, y: number, playerGuid?: string): Promise<PlaceResponse | null>`.

- [ ] **Step 1: Write failing tests**

Extend the existing `HeapClient.append` describe block (study how it mocks fetch). Add:

```ts
// 1. append(heapId, 220, 380, 'player-guid-1') → fetch body includes playerGuid: 'player-guid-1'
//    and headers include X-Player-Token (value from the SaveData playerSecret mock —
//    see how src/systems/__tests__/ScoreClient or authToken tests mock getPlayerSecret).
// 2. append(heapId, 220, 380) → body has NO playerGuid key (legacy shape preserved).
// 3. server 403 → resolves null AND remote logger error 'auth:rejected' fired
//    (mock getLogger like the existing ScoreClient 403 test does).
```

- [ ] **Step 2: Run tests, verify fail**

Run: `npx vitest run src/systems/__tests__/HeapClient.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/systems/HeapClient.ts` — import `{ authHeaders, logIfAuthRejected } from './authToken';` and change `append`:

```ts
  static async append(heapId: string, x: number, y: number, playerGuid?: string): Promise<PlaceResponse | null> {
    try {
      const body: PlaceRequest = playerGuid !== undefined ? { x, y, playerGuid } : { x, y };
      const res = await fetchWithLog(`${SERVER_URL}/heaps/${heapId}/place`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        logIfAuthRejected('heaps:place', res.status);
        return null;
      }
      return await res.json() as PlaceResponse;
    } catch {
      return null;
    }
  }
```

(Import `PlaceRequest` type from `shared/heapTypes` if not already imported.)

`src/scenes/GameScene.ts:686` — pass identity (add `getEffectivePlayerId` to the existing SaveData import list if missing):

```ts
    const appendDone = HeapClient.append(this._heapId, px, py, getEffectivePlayerId()).then(placeResp => {
```

- [ ] **Step 4: Run full verification**

Run: `npm test` → all green. `cd server && npx vitest run` → green. `npm run build` → no TS errors.

- [ ] **Step 5: Commit**

```bash
git add src/systems/HeapClient.ts src/scenes/GameScene.ts src/systems/__tests__/HeapClient.test.ts
git commit -m "feat(place-auth): client sends playerGuid + X-Player-Token on block placement"
```

---

## Self-review checklist (run before opening PR)

- [ ] No-guid requests hit zero new code paths besides one `undefined` check.
- [ ] `npm test`, server vitest, `npm run build` all green — paste outputs into the PR body.
- [ ] Grep: no bare `getPlayerGuid()` introduced.

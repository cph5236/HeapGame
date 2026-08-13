# Daily Status Cache (`stableUntil`) + Min-Gap Countdown Can — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PR #146's `nextEligibleAt`-based daily-status cache gate with a server-computed `stableUntil`, and add a `waiting` can-icon state that counts down the min-gap window instead of rendering a claimable can that 409s.

**Architecture:** The server answers "when can this response change by itself" (`stableUntil`: a unix-ms instant, or `null` when nothing can change it) alongside the existing `nextEligibleAt` ("when may this player claim again"). The client cache gates purely on `stableUntil` plus a 24h hard cap; the menu icon uses `nextEligibleAt` to render a countdown. The two fields stay independent — caching and the countdown compose with zero extra fetches.

**Tech Stack:** TypeScript 5.9, Vitest, Hono (Cloudflare Worker), Phaser 3.90.

**Spec:** `docs/superpowers/specs/2026-08-12-daily-status-cache-design.md`

## Global Constraints

- Branch is `claude/todo-bugs-triage-gee0l2` (PR #146). Do **not** create a new branch; do **not** rebase, reset, force-push, or amend existing commits.
- Do not push to remote. Commit locally only.
- `nextEligibleAt` **stays** on `DailyStatusResponse` and on `DailyClaimSuccess`. Nothing in this plan removes it.
- `stableUntil` has three meaningful values and all three are load-bearing: `number` = changes at that instant; `null` = nothing can change it; **absent/`undefined`** = server predates the field, so the client must not cache.
- The daily can stays hidden once `claimedToday` is true. The "must not linger once it has no job" rule is unchanged.
- Client cache hard cap is **24h** (`86_400_000` ms), measured as `now - entry.fetchedAt`.
- Countdown tick interval is **15_000** ms.
- `DEFAULT_GRACE_HOURS = 36`, `DEFAULT_MIN_GAP_HOURS = 10` — do not change these.
- All instants are unix ms. "Local" means the player's UTC offset in minutes (positive = east of UTC).
- Run `npm run build` before claiming any task done — it catches TS errors the tests miss.

## File Structure

| File | Responsibility |
|---|---|
| `shared/dailyDrop.ts` | Pure day/streak logic. Gains `nextLocalMidnight` (extracted) and `stableUntilFor`. |
| `shared/dailyTypes.ts` | Wire types. Gains `stableUntil` on status + claim-success. |
| `server/src/routes/daily.ts` | Emits `stableUntil` on both endpoints. |
| `src/systems/dailyStatusCache.ts` | localStorage snapshot cache. Guard rewritten around `stableUntil` + 24h cap. |
| `src/systems/DailyDropClient.ts` | Fetch/claim seam. `cacheClaimedSnapshot` reads `stableUntil`. |
| `src/ui/dailyDropLogic.ts` | Pure icon-state logic. Gains `'waiting'` state and `formatCountdown`. |
| `src/scenes/MenuScene.ts` | Waiting-can visual, countdown label, tick timer. |

Existing test files are modified in place; no new test files are created.

---

### Task 1: `nextLocalMidnight` + `stableUntilFor` in shared logic

**Files:**
- Modify: `shared/dailyDrop.ts:82-88` (extract midnight helper), and append `stableUntilFor`
- Test: `shared/__tests__/dailyDrop.test.ts`

**Interfaces:**
- Consumes: existing `ClaimState { lastClaimAt: number; streakDay: number }`, `localDateKey(unixMs, offsetMin)`, module-private `HOUR_MS`/`DAY_MS`.
- Produces:
  - `nextLocalMidnight(unixMs: number, offsetMin: number): number`
  - `stableUntilFor(state: ClaimState | null, nowMs: number, offsetMin: number, graceHours: number): number | null`

- [ ] **Step 1: Write the failing tests**

Append to `shared/__tests__/dailyDrop.test.ts`. Note the fixture: `T0` is 10pm July 15 in New York, so the next local midnight is 2h later.

```ts
describe('stableUntilFor', () => {
  const H = 3_600_000;
  const NY = -240;
  const T0 = Date.parse('2026-07-16T02:00:00Z'); // 10pm Jul 15 in NY
  const GRACE = 36;

  it('never claimed: nothing can change the response', () => {
    expect(stableUntilFor(null, T0, NY, GRACE)).toBeNull();
  });

  it('claimed today: expires at next local midnight', () => {
    const state = { lastClaimAt: T0, streakDay: 1 };
    expect(stableUntilFor(state, T0, NY, GRACE)).toBe(T0 + 2 * H);
  });

  it('unclaimed within grace: expires when grace expires', () => {
    const state = { lastClaimAt: T0, streakDay: 3 };
    // 12h later is a new local day, so claimedToday is false; grace runs to +36h.
    expect(stableUntilFor(state, T0 + 12 * H, NY, GRACE)).toBe(T0 + 36 * H);
  });

  it('unclaimed with grace already expired: already reset, nothing left to change', () => {
    const state = { lastClaimAt: T0, streakDay: 3 };
    expect(stableUntilFor(state, T0 + 40 * H, NY, GRACE)).toBeNull();
  });

  it('takes the earliest transition when grace expires before midnight', () => {
    const state = { lastClaimAt: T0, streakDay: 1 };
    // claimedToday, so midnight (+2h) applies, but a 1h grace expires sooner.
    expect(stableUntilFor(state, T0, NY, 1)).toBe(T0 + 1 * H);
  });

  it('honours a non-default graceHours', () => {
    const state = { lastClaimAt: T0, streakDay: 3 };
    expect(stableUntilFor(state, T0 + 6 * H, NY, 12)).toBe(T0 + 12 * H);
  });
});

describe('nextLocalMidnight', () => {
  const H = 3_600_000;
  const NY = -240;
  const T0 = Date.parse('2026-07-16T02:00:00Z');

  it('returns the next local midnight for the offset', () => {
    expect(nextLocalMidnight(T0, NY)).toBe(T0 + 2 * H);
  });
});
```

Add `stableUntilFor` and `nextLocalMidnight` to the existing import from `../dailyDrop` at the top of the file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run shared/__tests__/dailyDrop.test.ts`
Expected: FAIL — `stableUntilFor is not a function` / `nextLocalMidnight is not a function`.

- [ ] **Step 3: Extract `nextLocalMidnight`**

Replace `shared/dailyDrop.ts:82-88` with:

```ts
/** Next local-midnight instant after `unixMs` at the given UTC offset. */
export function nextLocalMidnight(unixMs: number, offsetMin: number): number {
  const local = unixMs + offsetMin * 60_000;
  return (Math.floor(local / DAY_MS) + 1) * DAY_MS - offsetMin * 60_000;
}

/** Earliest instant the next claim can succeed: the later of the next local
 *  midnight and lastClaim + minGap. */
export function nextEligibleAt(lastClaimAt: number, offsetMin: number, minGapHours: number): number {
  return Math.max(nextLocalMidnight(lastClaimAt, offsetMin), lastClaimAt + minGapHours * HOUR_MS);
}
```

This is a pure refactor — `nextEligibleAt` returns exactly what it did before.

- [ ] **Step 4: Add `stableUntilFor`**

Append to `shared/dailyDrop.ts`:

```ts
/**
 * The next instant a `/daily/status` response can change *by itself*, or null
 * when no such instant exists. This is what the client cache gates on — it is
 * a different question from `nextEligibleAt` ("when may they claim again"),
 * and the difference is the whole unclaimed half of the state space.
 *
 * Only two things change a response without a claim: the local day rolling
 * over (which flips `claimedToday` to false) and grace expiring (which resets
 * `nextClaimDay` to 1). Midnight only matters while `claimedToday` is true —
 * for an unclaimed response it changes nothing, and including it would force a
 * needless daily re-fetch.
 */
export function stableUntilFor(
  state: ClaimState | null,
  nowMs: number,
  offsetMin: number,
  graceHours: number,
): number | null {
  if (!state) return null;  // never claimed — frozen until they claim

  const transitions: number[] = [];

  const claimedToday =
    localDateKey(nowMs, offsetMin) === localDateKey(state.lastClaimAt, offsetMin);
  if (claimedToday) transitions.push(nextLocalMidnight(nowMs, offsetMin));

  const graceExpiry = state.lastClaimAt + graceHours * HOUR_MS;
  if (graceExpiry > nowMs) transitions.push(graceExpiry);

  return transitions.length ? Math.min(...transitions) : null;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run shared/__tests__/dailyDrop.test.ts`
Expected: PASS — new cases plus every pre-existing `nextEligibleAt` case still green (the extraction must not change behaviour).

- [ ] **Step 6: Commit**

```bash
git add shared/dailyDrop.ts shared/__tests__/dailyDrop.test.ts
git commit -m "Add stableUntilFor: when a daily status response self-expires"
```

---

### Task 2: Emit `stableUntil` from both daily endpoints

**Files:**
- Modify: `shared/dailyTypes.ts` (`DailyStatusResponse`, `DailyClaimSuccess`)
- Modify: `shared/dailyDrop.ts` (`statusFromState`, ~line 143-164)
- Modify: `server/src/routes/daily.ts:45-48` (status) and `:100-108` (claim success)
- Test: `server/tests/daily.test.ts`

**Interfaces:**
- Consumes: `stableUntilFor` from Task 1.
- Produces: `DailyStatusResponse.stableUntil?: number | null`; `DailyClaimSuccess.stableUntil: number`.

- [ ] **Step 1: Add the wire types**

In `shared/dailyTypes.ts`, add to `DailyClaimSuccess` (keep `nextEligibleAt`):

```ts
  /** Unix ms this claim's status snapshot self-expires (next local midnight).
   *  Lets the client cache the claim it just made. */
  stableUntil: number;
```

And to `DailyStatusResponse` (keep `nextEligibleAt` and its existing comment):

```ts
  /** Unix ms this response can next change by itself, or `null` when nothing
   *  can change it without a claim (never claimed, or grace already expired).
   *  **Absent** means the server predates this field — the client must not
   *  cache at all in that case. Distinct from `nextEligibleAt`, which answers
   *  when the player may claim rather than when this response goes stale. */
  stableUntil?: number | null;
```

- [ ] **Step 2: Write the failing server tests**

Append inside the existing `/daily/status` `describe` block in `server/tests/daily.test.ts`:

```ts
  it('reports stableUntil null for a player who has never claimed', async () => {
    const app = makeApp();
    const body = await (await app.request(`/daily/status?playerGuid=new1&utcOffsetMin=${NY}`)).json();
    expect(body.stableUntil).toBeNull();
  });

  it('reports stableUntil at next local midnight once claimed today', async () => {
    const app = makeApp();
    await claim(app, 'p1', NY);
    const body = await (await app.request(`/daily/status?playerGuid=p1&utcOffsetMin=${NY}`)).json();
    // Claimed 10pm NY; local midnight is 2h away. Note this differs from
    // nextEligibleAt (+10h), which the min gap pushes past midnight.
    expect(body.stableUntil).toBe(T0 + 2 * H);
  });

  it('reports stableUntil at grace expiry while unclaimed and within grace', async () => {
    const app = makeApp();
    await claim(app, 'p1', NY);
    vi.setSystemTime(T0 + 12 * H);
    const body = await (await app.request(`/daily/status?playerGuid=p1&utcOffsetMin=${NY}`)).json();
    expect(body.claimedToday).toBe(false);
    expect(body.stableUntil).toBe(T0 + 36 * H);
  });

  it('reports stableUntil null once grace has expired — nothing left to change', async () => {
    const app = makeApp();
    await claim(app, 'p1', NY);
    vi.setSystemTime(T0 + 40 * H);
    const body = await (await app.request(`/daily/status?playerGuid=p1&utcOffsetMin=${NY}`)).json();
    expect(body.stableUntil).toBeNull();
  });

  it('reports stableUntil on a successful claim so the client can cache it', async () => {
    const app = makeApp();
    const body = await (await claim(app, 'p1', NY)).json();
    expect(body.kind).toBe('ok');
    expect(body.stableUntil).toBe(T0 + 2 * H);
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd server && npx vitest run tests/daily.test.ts`
Expected: FAIL — `stableUntil` is `undefined` on every assertion.

- [ ] **Step 4: Emit it from `statusFromState`**

In `shared/dailyDrop.ts`, update both return paths of `statusFromState`:

```ts
  if (!state) {
    return {
      streakDay: 0, claimedToday: false, nextClaimDay: 1,
      todayGrants: grantsForDay(table, 1),
      stableUntil: null,
    };
  }
```

and the main return gains one line (keep `nextEligibleAt`):

```ts
  return {
    streakDay: state.streakDay,
    claimedToday,
    nextClaimDay,
    todayGrants: grantsForDay(table, nextClaimDay),
    nextEligibleAt: nextEligibleAt(state.lastClaimAt, offsetMin, minGapHours),
    stableUntil: stableUntilFor(state, nowMs, offsetMin, graceHours),
  };
```

`statusFromState` already receives `graceHours` and `nowMs`, so its signature is unchanged.

This breaks one existing assertion. `shared/__tests__/dailyDrop.test.ts:141-144`
matches the never-claimed response with a strict `toEqual`, and `toEqual` ignores
`undefined` properties but not `null` ones. Add the new field to it:

```ts
    expect(s).toEqual({
      streakDay: 0, claimedToday: false, nextClaimDay: 1,
      todayGrants: grantsForDay(DEFAULT_DAILY_REWARDS, 1),
      stableUntil: null,
    });
```

While there, add a shared-side case alongside the existing `nextEligibleAt` ones:

```ts
  it('reports stableUntil null for a never-claimed player — nothing can change it', () => {
    const s = statusFromState(null, T0, -240, DEFAULT_GRACE_HOURS, DEFAULT_DAILY_REWARDS, 10);
    expect(s.stableUntil).toBeNull();
  });
```

- [ ] **Step 5: Emit it from the claim route**

In `server/src/routes/daily.ts`, add `stableUntilFor` to the existing import from `../../../shared/dailyDrop`, then extend the success response at `:100-108`:

```ts
    return c.json({
      kind: 'ok',
      rewards,
      streakDay: decision.day,
      nextRewardPreview: grantsForDay(table, decision.day + 1),
      // Same formula every 409 uses — drives the menu's countdown can.
      nextEligibleAt: nextEligibleAt(now, offset, minGapHours),
      // When this snapshot self-expires — drives the client cache.
      stableUntil: stableUntilFor({ lastClaimAt: now, streakDay: decision.day }, now, offset, graceHours),
    }, 200);
```

The `GET /daily/status` route needs no edit — it returns `statusFromState(...)` wholesale.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd server && npx vitest run tests/daily.test.ts` — expect 22 (17 + 5).
Run: `npx vitest run shared/__tests__/dailyDrop.test.ts` — the shared suite must be green too, including the `toEqual` fixed above.

- [ ] **Step 7: Commit**

```bash
git add shared/dailyTypes.ts shared/dailyDrop.ts shared/__tests__/dailyDrop.test.ts \
        server/src/routes/daily.ts server/tests/daily.test.ts
git commit -m "Report stableUntil on /daily/status and successful claims"
```

---

### Task 3: Gate the client cache on `stableUntil` + a 24h cap

The guard change and the claim-seeding change land together: rewriting the gate
invalidates four existing `DailyDropClient` fixtures that cache via
`nextEligibleAt`, so splitting them would leave the suite red between tasks.

**Files:**
- Modify: `src/systems/dailyStatusCache.ts` (rewrite `isUsable`, drop the `localDateKey` import)
- Modify: `src/systems/DailyDropClient.ts:102-123` (`cacheClaimedSnapshot`)
- Test: `src/systems/__tests__/dailyStatusCache.test.ts`
- Test: `src/systems/__tests__/DailyDropClient.test.ts`

**Interfaces:**
- Consumes: `DailyStatusResponse.stableUntil` and `DailyClaimSuccess.stableUntil` from Task 2.
- Produces: unchanged public API — `readCachedDailyStatus(playerId, offsetMin, now?)`, `writeCachedDailyStatus(playerId, offsetMin, status, now?)`, `clearCachedDailyStatus()`.

- [ ] **Step 1: Rewrite the cache test file's fixtures and cases**

The existing fixture builds a `claimed()` status gated on `nextEligibleAt`; the
gate is now `stableUntil`. In `src/systems/__tests__/dailyStatusCache.test.ts`,
replace everything from `function claimed(` to the end of the file with:

```ts
function snap(over: Partial<DailyStatusResponse> = {}): DailyStatusResponse {
  return {
    streakDay: 3,
    claimedToday: true,
    nextClaimDay: 4,
    todayGrants: [{ type: 'coins', amount: 100 }],
    nextEligibleAt: T0 + 10 * H,
    stableUntil: NEXT_MIDNIGHT,
    ...over,
  };
}

beforeEach(() => { localStorage.clear(); });

describe('dailyStatusCache', () => {
  it('returns null when nothing is cached', () => {
    expect(readCachedDailyStatus('p1', NY, T0)).toBeNull();
  });

  it('serves a snapshot before its stableUntil', () => {
    writeCachedDailyStatus('p1', NY, snap(), T0);
    expect(readCachedDailyStatus('p1', NY, T0 + 1 * H)).toEqual(snap());
  });

  it('stops serving once stableUntil has passed', () => {
    writeCachedDailyStatus('p1', NY, snap(), T0);
    expect(readCachedDailyStatus('p1', NY, NEXT_MIDNIGHT)).toBeNull();
  });

  it('serves a null stableUntil — nothing can change that response', () => {
    // Never claimed, or grace long expired: frozen until they claim.
    const frozen = snap({ claimedToday: false, streakDay: 0, nextClaimDay: 1, stableUntil: null });
    writeCachedDailyStatus('p1', NY, frozen, T0);
    expect(readCachedDailyStatus('p1', NY, T0 + 12 * H)).toEqual(frozen);
  });

  it('caps even a null stableUntil at 24h', () => {
    const frozen = snap({ stableUntil: null });
    writeCachedDailyStatus('p1', NY, frozen, T0);
    expect(readCachedDailyStatus('p1', NY, T0 + 23 * H)).toEqual(frozen);
    expect(readCachedDailyStatus('p1', NY, T0 + 25 * H)).toBeNull();
  });

  it('never serves a snapshot from a server that omits stableUntil', () => {
    const old = snap({ stableUntil: undefined });
    writeCachedDailyStatus('p1', NY, old, T0);
    expect(readCachedDailyStatus('p1', NY, T0)).toBeNull();
  });

  it('caches unclaimed snapshots too — locked/ready is decided locally', () => {
    const unclaimed = snap({ claimedToday: false, stableUntil: T0 + 36 * H });
    writeCachedDailyStatus('p1', NY, unclaimed, T0);
    expect(readCachedDailyStatus('p1', NY, T0 + 1 * H)).toEqual(unclaimed);
  });

  it('ignores a snapshot belonging to a different player', () => {
    writeCachedDailyStatus('p1', NY, snap(), T0);
    expect(readCachedDailyStatus('p2', NY, T0)).toBeNull();
  });

  it('ignores a snapshot taken at a different UTC offset', () => {
    writeCachedDailyStatus('p1', NY, snap(), T0);
    expect(readCachedDailyStatus('p1', 60, T0)).toBeNull();
  });

  it('re-fetches when the clock has been rewound behind the entry', () => {
    writeCachedDailyStatus('p1', NY, snap(), T0);
    expect(readCachedDailyStatus('p1', NY, T0 - 1 * H)).toBeNull();
  });

  it('clearCachedDailyStatus drops the entry', () => {
    writeCachedDailyStatus('p1', NY, snap(), T0);
    clearCachedDailyStatus();
    expect(readCachedDailyStatus('p1', NY, T0)).toBeNull();
  });

  it('survives a corrupt entry', () => {
    localStorage.setItem('heap_daily_status_cache', '{not json');
    expect(readCachedDailyStatus('p1', NY, T0)).toBeNull();
  });
});
```

- [ ] **Step 2: Update the DailyDropClient fixtures**

Five edits in `src/systems/__tests__/DailyDropClient.test.ts`. Each existing test
below caches via `nextEligibleAt` and must move to `stableUntil`.

**(a)** In `'serves a claimed-today snapshot from cache without hitting the network again'`, add `stableUntil` to the `status` object:

```ts
    const status = {
      streakDay: 2, claimedToday: true, nextClaimDay: 3, todayGrants: [],
      nextEligibleAt: Date.now() + HOUR,
      stableUntil: Date.now() + HOUR,
    };
```

**(b)** Replace the whole test `'still fetches when the cached snapshot says the drop is claimable'` — that rule is gone, unclaimed snapshots are now cacheable — with these two:

```ts
  it('caches an unclaimed snapshot too — locked/ready is decided locally', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, {
      streakDay: 2, claimedToday: false, nextClaimDay: 3, todayGrants: [],
      nextEligibleAt: Date.now() - HOUR,
      stableUntil: Date.now() + 12 * HOUR,
    }));
    await fetchDailyStatus();
    await fetchDailyStatus();
    expect(fetchWithLog).toHaveBeenCalledTimes(1);
  });

  it('keeps fetching against a server that omits stableUntil', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, {
      streakDay: 2, claimedToday: true, nextClaimDay: 3, todayGrants: [],
      nextEligibleAt: Date.now() + HOUR,
    }));
    await fetchDailyStatus();
    await fetchDailyStatus();
    expect(fetchWithLog).toHaveBeenCalledTimes(2);
  });
```

**(c)** In `'seeds the status cache so the next menu load skips /daily/status'`, add `stableUntil` to the claim response body:

```ts
    fetchWithLog.mockResolvedValue(jsonResponse(200, {
      kind: 'ok', streakDay: 3, rewards: [{ rewardType: 'coins', rewardAmount: 100 }],
      nextRewardPreview: [{ type: 'coins', amount: 150 }],
      nextEligibleAt: Date.now() + HOUR,
      stableUntil: Date.now() + HOUR,
    }));
```

**(d)** Rename `'does not cache a claim from a server that omits nextEligibleAt'` to `'does not cache a claim from a server that omits stableUntil'`. Its body already omits both fields, so no other change is needed — but the rename matters, because `stableUntil` is now the field under test.

**(e)** In `'drops a cached snapshot when a claim comes back 409'`, add `stableUntil` to the **first** status mock so the snapshot genuinely caches and the test proves the 409 drops it rather than passing because nothing was cached:

```ts
    fetchWithLog.mockResolvedValue(jsonResponse(200, {
      streakDay: 2, claimedToday: true, nextClaimDay: 3, todayGrants: [],
      nextEligibleAt: Date.now() + HOUR,
      stableUntil: Date.now() + HOUR,
    }));
    await fetchDailyStatus();
```

Leave the two later mocks in that test alone.

- [ ] **Step 3: Run both test files to verify they fail**

Run: `npx vitest run src/systems/__tests__/dailyStatusCache.test.ts src/systems/__tests__/DailyDropClient.test.ts`
Expected: FAIL — the cache still demands `claimedToday` + `nextEligibleAt`, so the `stableUntil`, 24h-cap, unclaimed, and clock-rewind cases all fail.

- [ ] **Step 4: Rewrite the cache guard**

In `src/systems/dailyStatusCache.ts`: remove the now-unused `import { localDateKey } from '../../shared/dailyDrop';`, add the cap constant next to `KEY`, and replace `isUsable` entirely.

```ts
const KEY = 'heap_daily_status_cache';
/** Hard ceiling on any entry, even one the server called permanently stable.
 *  Bounds cross-device staleness: a claim on another device leaves this one
 *  showing a spent can until it is tapped (which 409s and clears the entry). */
const MAX_AGE_MS = 86_400_000;  // 24h
```

```ts
function isUsable(entry: CachedEntry, playerId: string, offsetMin: number, now: number): boolean {
  if (entry.playerId !== playerId) return false;      // signed into GPGS since
  if (entry.offsetMin !== offsetMin) return false;    // device travelled
  const age = now - entry.fetchedAt;
  if (!(age >= 0 && age < MAX_AGE_MS)) return false;  // stale, or clock rewound

  // `stableUntil` answers "when can this response change by itself":
  //   null      → never, so serve it (subject to the cap above)
  //   number    → serve until that instant
  //   undefined → server predates the field; caching would be a guess
  const until = entry.status?.stableUntil;
  if (until === null) return true;
  if (typeof until !== 'number' || !Number.isFinite(until)) return false;
  return now < until;
}
```

Also update the module header comment: the reuse rule is no longer "only when
`claimedToday`", it is "until the server-declared expiry, capped at 24h".

- [ ] **Step 5: Update `cacheClaimedSnapshot`**

Replace the function in `src/systems/DailyDropClient.ts`:

```ts
/** A successful claim tells us everything `/daily/status` would: the drop is
 *  claimed, the next one opens at `nextEligibleAt`, and the snapshot holds
 *  until `stableUntil` (next local midnight). Seeding here saves the status
 *  call on the menu load right after claiming — the most common menu entry.
 *  Older servers omit `stableUntil`; without it the entry could never be
 *  served, so drop the cache instead. */
function cacheClaimedSnapshot(
  playerId: string,
  offsetMin: number,
  data: DailyClaimSuccess,
): void {
  if (typeof data.stableUntil !== 'number' || !Number.isFinite(data.stableUntil)) {
    clearCachedDailyStatus();
    return;
  }
  writeCachedDailyStatus(playerId, offsetMin, {
    streakDay: data.streakDay,
    claimedToday: true,
    nextClaimDay: (data.streakDay % 7) + 1,
    todayGrants: data.nextRewardPreview,
    nextEligibleAt: data.nextEligibleAt,
    stableUntil: data.stableUntil,
  });
}
```

Claim-outcome clearing (409 / `!res.ok` / `streakBroken` / `notEligible`) at
`:78-93` is unchanged.

- [ ] **Step 6: Run both test files to verify they pass**

Run: `npx vitest run src/systems/__tests__/dailyStatusCache.test.ts src/systems/__tests__/DailyDropClient.test.ts`
Expected: PASS — 12 cache tests and 14 client tests.

- [ ] **Step 7: Commit**

```bash
git add src/systems/dailyStatusCache.ts src/systems/DailyDropClient.ts \
        src/systems/__tests__/dailyStatusCache.test.ts \
        src/systems/__tests__/DailyDropClient.test.ts
git commit -m "Gate the daily status cache on stableUntil plus a 24h cap"
```

---

### Task 4: `waiting` icon state + countdown formatting

**Files:**
- Modify: `src/ui/dailyDropLogic.ts:28-39` (`DailyIconState`, `dailyIconState`), append `formatCountdown`
- Test: `src/ui/__tests__/dailyDropLogic.test.ts`

**Interfaces:**
- Consumes: `DailyStatusResponse.nextEligibleAt` (already present).
- Produces:
  - `export type DailyIconState = 'hidden' | 'locked' | 'ready' | 'waiting' | 'offline'`
  - `dailyIconState(status: DailyStatusResponse | null, playedToday: boolean, now?: number): DailyIconState`
  - `formatCountdown(msRemaining: number): string`

- [ ] **Step 1: Write the failing tests**

Add to the existing `dailyIconState` describe block in `src/ui/__tests__/dailyDropLogic.test.ts`, plus a new describe:

```ts
  const H = 3_600_000;
  const NOW = Date.parse('2026-07-16T02:00:00Z');

  it('waiting when played but the min gap has not elapsed', () => {
    const status = { ...base, nextEligibleAt: NOW + 2 * H };
    expect(dailyIconState(status, true, NOW)).toBe('waiting');
  });

  it('locked beats waiting — "play a run" is the actionable gate', () => {
    const status = { ...base, nextEligibleAt: NOW + 2 * H };
    expect(dailyIconState(status, false, NOW)).toBe('locked');
  });

  it('ready once nextEligibleAt has passed', () => {
    const status = { ...base, nextEligibleAt: NOW - 1 * H };
    expect(dailyIconState(status, true, NOW)).toBe('ready');
  });

  it('ready when the server omits nextEligibleAt', () => {
    expect(dailyIconState(base, true, NOW)).toBe('ready');
  });

  it('hidden still wins once claimed, whatever nextEligibleAt says', () => {
    const status = { ...base, claimedToday: true, nextEligibleAt: NOW + 2 * H };
    expect(dailyIconState(status, true, NOW)).toBe('hidden');
  });
});

describe('formatCountdown', () => {
  const H = 3_600_000;
  const M = 60_000;

  it('shows hours and minutes past an hour', () => {
    expect(formatCountdown(2 * H + 14 * M)).toBe('2h 14m');
  });
  it('shows minutes only under an hour', () => {
    expect(formatCountdown(14 * M)).toBe('14m');
  });
  it('shows a floor marker under a minute', () => {
    expect(formatCountdown(30_000)).toBe('<1m');
  });
  it('shows a floor marker at or below zero', () => {
    expect(formatCountdown(0)).toBe('<1m');
    expect(formatCountdown(-5000)).toBe('<1m');
  });
  it('keeps the minute component on a whole hour', () => {
    expect(formatCountdown(1 * H)).toBe('1h 0m');
  });
});
```

Add `formatCountdown` to the existing import from `../dailyDropLogic`. Note the closing `});` above belongs to the existing `dailyIconState` describe — place the new cases inside it and start `formatCountdown` as a sibling describe.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/__tests__/dailyDropLogic.test.ts`
Expected: FAIL — `formatCountdown is not a function`, and the waiting case returns `'ready'`.

- [ ] **Step 3: Implement**

In `src/ui/dailyDropLogic.ts`, replace the type and `dailyIconState`:

```ts
export type DailyIconState = 'hidden' | 'locked' | 'ready' | 'waiting' | 'offline';

/** Icon visibility/state. Hidden after today's claim (spec: the can must not
 *  linger once it has no job). `waiting` covers the min-gap window, where
 *  `claimedToday` is already false but a claim would still 409 — without it the
 *  can renders `ready` and the tap dead-ends. It displaces only `ready`:
 *  when the player has not run yet, `locked` is the gate they can act on, and
 *  tapping `locked` opens a preview with no claim path, so it is not a
 *  dead-end. A server that omits `nextEligibleAt` never yields `waiting`. */
export function dailyIconState(
  status: DailyStatusResponse | null,
  playedToday: boolean,
  now: number = Date.now(),
): DailyIconState {
  if (status === null) return 'offline';
  if (status.claimedToday) return 'hidden';
  if (!playedToday) return 'locked';
  if (typeof status.nextEligibleAt === 'number' && now < status.nextEligibleAt) return 'waiting';
  return 'ready';
}
```

And append:

```ts
/** Coarse "time until the next drop" label for the waiting can. Minute
 *  granularity — the can ticks every 15s, and seconds would just churn. */
export function formatCountdown(msRemaining: number): string {
  const totalMin = Math.floor(msRemaining / 60_000);
  if (totalMin < 1) return '<1m';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/__tests__/dailyDropLogic.test.ts`
Expected: PASS — new cases plus the four pre-existing `dailyIconState` cases (their `base` fixture has no `nextEligibleAt`, so they are unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/ui/dailyDropLogic.ts src/ui/__tests__/dailyDropLogic.test.ts
git commit -m "Add a waiting can state for the min-gap window"
```

---

### Task 5: Render the waiting can in MenuScene

**Files:**
- Modify: `src/scenes/MenuScene.ts` — field at `:61`, `addDailyCanIcon` at `:1399-1443`, `openDaily` at `:1445-1452`, import at `:28`

**Interfaces:**
- Consumes: `dailyIconState` (now 3-arg) and `formatCountdown` from Task 4; existing `openDailyLockedPreview(status)`.
- Produces: no exports. Private members `dailyTick`, `clearDailyCanIcon()`, `refreshDailyDrop()`.

No unit test — this is Phaser scene wiring. Verified by build plus the live smoke test in the Final Verification section.

- [ ] **Step 1: Add the timer field and import**

At `src/scenes/MenuScene.ts:28`, extend the existing import:

```ts
import { dailyIconState, shouldAutoShowPopup, formatCountdown, type DailyIconState } from '../ui/dailyDropLogic';
```

Beside `private dailyCanIcon?: Phaser.GameObjects.Container;` at `:61`:

```ts
  private dailyTick?: Phaser.Time.TimerEvent;
```

- [ ] **Step 2: Add teardown and refresh helpers**

Insert after `setupDailyDrop`:

```ts
  /** Tear down the can and its countdown together — the tick closes over the
   *  label, so orphaning one leaks into the next render. */
  private clearDailyCanIcon(): void {
    this.dailyTick?.remove();
    this.dailyTick = undefined;
    this.dailyCanIcon?.destroy();
    this.dailyCanIcon = undefined;
  }

  /** Re-render the can when the countdown reaches zero. Reads the cached
   *  status — the snapshot has not changed, only `now` has, so this costs no
   *  network call. */
  private refreshDailyDrop(): void {
    this.clearDailyCanIcon();
    void this.setupDailyDrop();
  }
```

At the top of `setupDailyDrop`, before the `await`, add `this.clearDailyCanIcon();` so a refresh never stacks two cans.

- [ ] **Step 3: Render the waiting state**

In `addDailyCanIcon`, the `bodyColor` line already dims anything that is not `ready`, so `waiting` picks up the dim can for free. Add a branch to the state chain — it goes between the `ready` and `locked` branches:

```ts
    } else if (state === 'waiting') {
      const label = this.add.text(0, 26, '', {
        fontSize: '10px', color: '#c8cee0', fontStyle: 'bold',
      }).setOrigin(0.5);
      icon.add(label);
      const until = status?.nextEligibleAt ?? 0;
      const paint = (): void => {
        if (!this.scene.isActive()) return;
        const left = until - Date.now();
        if (left <= 0) { this.refreshDailyDrop(); return; }
        label.setText(formatCountdown(left));
      };
      paint();
      this.dailyTick = this.time.addEvent({ delay: 15_000, loop: true, callback: paint });
    } else if (state === 'locked') {
```

No `!` badge and no wobble tween — the can is not actionable yet. Phaser clears the scene Clock on shutdown, so the timer needs no separate shutdown hook.

- [ ] **Step 4: Route the tap**

In the `zone.on('pointerup', ...)` handler, add a case above the offline fallback:

```ts
      if (state === 'waiting' && status) { this.openDailyLockedPreview(status); return; }
```

The countdown label already answers "when"; the preview answers "what for".

- [ ] **Step 5: Use the shared teardown in `openDaily`**

Replace the two lines in `openDaily`'s callback:

```ts
      this.dailyCanIcon?.destroy();
      this.dailyCanIcon = undefined;
```

with:

```ts
      this.clearDailyCanIcon();
```

- [ ] **Step 6: Verify the build**

Run: `npm run build`
Expected: clean. A `DailyIconState` exhaustiveness error here means a branch was missed.

- [ ] **Step 7: Commit**

```bash
git add src/scenes/MenuScene.ts
git commit -m "Render the waiting can with a live countdown to the next drop"
```

---

## Final Verification

- [ ] **Full test suites**

```bash
npm test                          # client + shared
cd server && npx vitest run       # worker
```
Expected: all green. Baseline before this work was 1786 client / 533 server; this plan adds roughly 5 server and 20 client/shared cases.

- [ ] **Build**

```bash
npm run build
```
Expected: clean. (`cd server && npx tsc --noEmit` reports one pre-existing unrelated error in `shared/__tests__/pickupScores.test.ts` that is also present on `main` — ignore it.)

- [ ] **Live check against a local worker**

Production serves neither field, so this cannot be verified against the deployed worker. Start a local one from this branch:

```bash
npx wrangler dev --local --ip 0.0.0.0 --port 8787
```

Uncomment `VITE_HEAP_SERVER_URL=http://localhost:8787` in `.env.local`. Use the dev server already on port 3000 — do not start or kill one (see CLAUDE.md).

With the network panel open, confirm `/daily/status` request counts across repeated menu loads:

| State | Expected |
|---|---|
| Never claimed | 1 request, then silent on reload |
| Claimed today | 1 request, then silent |
| Unclaimed, within grace | 1 request, then silent |
| Grace expired | 1 request, then silent |
| After a claim | 0 requests on the next menu load (seeded from the claim) |

Then set `daily_min_gap_hours` high enough via the admin config UI to force the min-gap window, claim, cross local midnight (or claim from a device offset that puts you there), and confirm the can shows the dim countdown, that tapping it opens the locked preview rather than 409ing, and that the label ticks down.

Revert `.env.local` to its commented state when finished.

- [ ] **Restore `.env.local` and confirm the branch is clean**

```bash
git status --short
```
Expected: no stray modifications to `.env.local` or `.env`.

## Out of Scope

- A countdown on the claimed-today can — it stays hidden.
- A countdown inside the daily drop overlay.
- Any change to claim eligibility, streak, or grace semantics.
- Pushing to remote, or updating the PR #146 description (the user pushes).

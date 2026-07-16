# Daily Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Daily reward system — after the first completed run of the day a trash can appears on the menu; tapping it grants server-chosen coins/items on a 7-day streak track with 36h grace and rewarded-ad streak repair.

**Architecture:** Pure day/streak/reward logic lives in `shared/dailyDrop.ts`, used by both sides. The server adds a `daily_claims` table (heap_rewards D1), a `DailyClaimDB` repo (D1 + Mock), and `/daily/status` + `/daily/claim` Hono routes that reuse the existing `RewardPayload` shape, player write-auth, and remote-config. The client adds a thin fetch client, a device-local "played today" gate, pure icon/popup state logic, and MenuScene UI (can icon + claim overlay).

**Tech Stack:** TypeScript 5.9, Phaser 3.90, Hono on Cloudflare Workers, D1, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-16-daily-drop-design.md` — read it first.

## Global Constraints

- Work on branch `feature/daily-drop` (already created). Never push to `main`; PR at the end. Do not push after every commit.
- Root tests: `npm test` (from repo root). Server tests: `cd server && npm test`. Run `npm run build` from root before claiming completion.
- Never commit `.wrangler/state/`.
- Per-player server calls key on `getEffectivePlayerId()` — never bare `getPlayerGuid()`.
- Player writes carry `X-Player-Token` via `authHeaders()` (see `src/systems/authToken.ts`).
- Config defaults (from spec): grace = **36 h** (`daily_streak_grace_hours`), min gap = **10 h** (`daily_min_gap_hours`), reward table key = **`daily_rewards`**. UTC offset clamp = **−720 … +840 minutes**.
- Streak track wraps 7 → 1. Day 7 grants coins **and** an item (`revive`) — responses carry a `rewards` **array**.
- Subagents: no destructive git operations (no reset --hard, no force push, no branch deletion). Stick to the task prompt verbatim.

---

### Task 1: Shared types + pure daily logic

**Files:**
- Create: `shared/dailyTypes.ts`
- Create: `shared/dailyDrop.ts`
- Test: `shared/__tests__/dailyDrop.test.ts`

**Interfaces:**
- Consumes: `RewardPayload` from `shared/codeTypes.ts`, `ItemId` strings from `shared/itemIds.ts`.
- Produces (used by Tasks 4, 6, 7, 8, 9):
  - Types: `DailyGrant`, `DailyRewardTable`, `DailyClaimRequest`, `DailyClaimResponse` (`{kind:'ok',rewards,streakDay,nextRewardPreview}` | `{kind:'streakBroken',repairableDay}` | `{kind:'notEligible',nextEligibleAt}`), `DailyStatusResponse { streakDay, claimedToday, nextClaimDay, todayGrants }`
  - Functions: `clampOffsetMin(v: unknown): number`, `localDateKey(unixMs: number, offsetMin: number): string`, `decideClaim(state, nowMs, offsetMin, resolution, graceHours, minGapHours): ClaimDecision`, `nextEligibleAt(lastClaimAt, offsetMin, minGapHours): number`, `grantsForDay(table, day): DailyGrant[]`, `grantsToRewards(grants, isValidItemId, rand?): RewardPayload[]`, `sanitizeRewardTable(value: unknown): DailyRewardTable`, `statusFromState(state, nowMs, offsetMin, graceHours, table): DailyStatusResponse`
  - Constants: `DEFAULT_DAILY_REWARDS`, `DEFAULT_GRACE_HOURS = 36`, `DEFAULT_MIN_GAP_HOURS = 10`, `DAILY_FALLBACK_COINS = 50`

- [ ] **Step 1: Write the failing tests**

Create `shared/__tests__/dailyDrop.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  clampOffsetMin, localDateKey, decideClaim, nextEligibleAt,
  grantsForDay, grantsToRewards, sanitizeRewardTable, statusFromState,
  DEFAULT_DAILY_REWARDS, DEFAULT_GRACE_HOURS, DEFAULT_MIN_GAP_HOURS, DAILY_FALLBACK_COINS,
} from '../dailyDrop';
import { isItemId } from '../itemIds';

const H = 3_600_000;
// 2026-07-16T02:00:00Z — 10pm July 15 in New York (UTC-4, offset -240)
const T0 = Date.parse('2026-07-16T02:00:00Z');

describe('clampOffsetMin', () => {
  it('passes normal offsets through, truncated', () => {
    expect(clampOffsetMin(-240)).toBe(-240);
    expect(clampOffsetMin(330.7)).toBe(330);
  });
  it('clamps to the valid UTC offset range', () => {
    expect(clampOffsetMin(-100000)).toBe(-720);
    expect(clampOffsetMin(100000)).toBe(840);
  });
  it('maps garbage to 0', () => {
    expect(clampOffsetMin('x')).toBe(0);
    expect(clampOffsetMin(NaN)).toBe(0);
    expect(clampOffsetMin(undefined)).toBe(0);
  });
});

describe('localDateKey', () => {
  it('derives the local calendar date from a UTC instant + offset', () => {
    expect(localDateKey(T0, 0)).toBe('2026-07-16');     // UTC
    expect(localDateKey(T0, -240)).toBe('2026-07-15');  // New York evening
    expect(localDateKey(T0, 840)).toBe('2026-07-16');   // UTC+14
  });
});

describe('decideClaim', () => {
  const G = DEFAULT_GRACE_HOURS, M = DEFAULT_MIN_GAP_HOURS;

  it('first-ever claim grants day 1', () => {
    expect(decideClaim(null, T0, -240, undefined, G, M)).toEqual({ kind: 'grant', day: 1 });
  });

  it('east-coast case: 10pm claim then 3pm next local day is eligible (day 2)', () => {
    const state = { lastClaimAt: T0, streakDay: 1 };        // 10pm Jul 15 local
    const next = T0 + 17 * H;                                // 3pm Jul 16 local
    expect(decideClaim(state, next, -240, undefined, G, M)).toEqual({ kind: 'grant', day: 2 });
  });

  it('same local day is not eligible even after the min gap', () => {
    // Morning claim at 8am local; 12h later is 8pm the SAME local day —
    // min gap passed, but the calendar day rule still blocks it.
    const morning = Date.parse('2026-07-16T12:00:00Z');      // 8am Jul 16 in NY
    const state = { lastClaimAt: morning, streakDay: 3 };
    const out = decideClaim(state, morning + 12 * H, -240, undefined, G, M);
    expect(out.kind).toBe('notEligible');
  });

  it('a new local day within the min gap is blocked (11:55pm → 12:05am)', () => {
    const lateNight = Date.parse('2026-07-16T03:55:00Z');    // 11:55pm Jul 15 NY
    const state = { lastClaimAt: lateNight, streakDay: 2 };
    const out = decideClaim(state, lateNight + 10 * 60_000, -240, undefined, G, M);
    expect(out.kind).toBe('notEligible');
  });

  it('within grace continues the streak; wraps 7 → 1', () => {
    const state = { lastClaimAt: T0, streakDay: 7 };
    expect(decideClaim(state, T0 + 24 * H, -240, undefined, G, M)).toEqual({ kind: 'grant', day: 1 });
  });

  it('past grace with no resolution reports streakBroken', () => {
    const state = { lastClaimAt: T0, streakDay: 4 };
    expect(decideClaim(state, T0 + 40 * H, -240, undefined, G, M))
      .toEqual({ kind: 'broken', repairableDay: 5 });
  });

  it('past grace with resolution=repair continues the streak', () => {
    const state = { lastClaimAt: T0, streakDay: 4 };
    expect(decideClaim(state, T0 + 40 * H, -240, 'repair', G, M)).toEqual({ kind: 'grant', day: 5 });
  });

  it('past grace with resolution=reset grants day 1', () => {
    const state = { lastClaimAt: T0, streakDay: 4 };
    expect(decideClaim(state, T0 + 40 * H, -240, 'reset', G, M)).toEqual({ kind: 'grant', day: 1 });
  });

  it('a resolution sent when the streak is intact is ignored', () => {
    const state = { lastClaimAt: T0, streakDay: 4 };
    expect(decideClaim(state, T0 + 24 * H, -240, 'reset', G, M)).toEqual({ kind: 'grant', day: 5 });
  });
});

describe('nextEligibleAt', () => {
  it('is at least the next local midnight', () => {
    const at = nextEligibleAt(T0, -240, DEFAULT_MIN_GAP_HOURS); // claimed 10pm local
    expect(localDateKey(at, -240)).toBe('2026-07-16');           // next local day
    expect(at).toBeGreaterThanOrEqual(T0 + DEFAULT_MIN_GAP_HOURS * H);
  });
  it('is at least minGap after the last claim (morning claim)', () => {
    const morning = Date.parse('2026-07-16T12:00:00Z');          // 8am NY
    const at = nextEligibleAt(morning, -240, DEFAULT_MIN_GAP_HOURS);
    // next local midnight (16h away) dominates the 10h gap here
    expect(localDateKey(at, -240)).toBe('2026-07-17');
  });
});

describe('reward table', () => {
  it('grantsForDay wraps day 8 to day 1', () => {
    expect(grantsForDay(DEFAULT_DAILY_REWARDS, 8)).toEqual(grantsForDay(DEFAULT_DAILY_REWARDS, 1));
  });

  it('day 7 default grants coins AND a revive', () => {
    const rewards = grantsToRewards(grantsForDay(DEFAULT_DAILY_REWARDS, 7), isItemId, () => 0);
    expect(rewards).toEqual([
      { rewardType: 'coins', rewardAmount: 300 },
      { rewardType: 'item', rewardId: 'revive', rewardAmount: 1 },
    ]);
  });

  it('item grants pick from the pool with the provided rand', () => {
    const rewards = grantsToRewards(grantsForDay(DEFAULT_DAILY_REWARDS, 3), isItemId, () => 0.99);
    expect(rewards).toEqual([{ rewardType: 'item', rewardId: 'checkpoint', rewardAmount: 1 }]);
  });

  it('an all-invalid pool falls back to coins, never an invalid item id', () => {
    const rewards = grantsToRewards([{ type: 'item', pool: ['not_real'], amount: 1 }], isItemId);
    expect(rewards).toEqual([{ rewardType: 'coins', rewardAmount: DAILY_FALLBACK_COINS }]);
  });

  it('sanitizeRewardTable returns the value itself when valid, DEFAULT otherwise', () => {
    expect(sanitizeRewardTable(DEFAULT_DAILY_REWARDS)).toBe(DEFAULT_DAILY_REWARDS);
    expect(sanitizeRewardTable([[{ type: 'coins', amount: 5 }]])).toBe(DEFAULT_DAILY_REWARDS); // wrong length
    expect(sanitizeRewardTable('junk')).toBe(DEFAULT_DAILY_REWARDS);
    expect(sanitizeRewardTable([[], [], [], [], [], [], []])).toBe(DEFAULT_DAILY_REWARDS);     // empty days
  });
});

describe('statusFromState', () => {
  it('never-claimed player: day 1 preview, not claimed', () => {
    const s = statusFromState(null, T0, -240, DEFAULT_GRACE_HOURS, DEFAULT_DAILY_REWARDS);
    expect(s).toEqual({
      streakDay: 0, claimedToday: false, nextClaimDay: 1,
      todayGrants: grantsForDay(DEFAULT_DAILY_REWARDS, 1),
    });
  });
  it('claimed earlier today: claimedToday true', () => {
    const state = { lastClaimAt: T0, streakDay: 2 };
    const s = statusFromState(state, T0 + 2 * H, -240, DEFAULT_GRACE_HOURS, DEFAULT_DAILY_REWARDS);
    expect(s.claimedToday).toBe(true);
    expect(s.nextClaimDay).toBe(3);
  });
  it('past grace: preview drops to day 1', () => {
    const state = { lastClaimAt: T0, streakDay: 5 };
    const s = statusFromState(state, T0 + 50 * H, -240, DEFAULT_GRACE_HOURS, DEFAULT_DAILY_REWARDS);
    expect(s.claimedToday).toBe(false);
    expect(s.nextClaimDay).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run shared/__tests__/dailyDrop.test.ts`
Expected: FAIL — cannot resolve `../dailyDrop`.

- [ ] **Step 3: Write the implementation**

Create `shared/dailyTypes.ts`:

```ts
// shared/dailyTypes.ts
//
// Types for the Daily Drop reward system. Reuses RewardPayload — the same
// grant shape reward codes ship — so the client applies both identically.
// Spec: docs/superpowers/specs/2026-07-16-daily-drop-design.md

import type { RewardPayload } from './codeTypes';

/** One grant within a day's reward. Item grants pick randomly from `pool`. */
export type DailyGrant =
  | { type: 'coins'; amount: number }
  | { type: 'item'; pool: string[]; amount: number };

/** 7 entries, index 0 = streak day 1. Each day may grant several things. */
export type DailyRewardTable = DailyGrant[][];

/** POST /daily/claim request body. */
export interface DailyClaimRequest {
  playerGuid: string;
  utcOffsetMin: number;
  /** Sent on the follow-up call after a streakBroken response. */
  resolution?: 'repair' | 'reset';
}

export interface DailyClaimSuccess {
  kind: 'ok';
  rewards: RewardPayload[];      // array: day 7 grants coins AND an item
  streakDay: number;             // day just claimed (1-7)
  nextRewardPreview: DailyGrant[];
}
export interface DailyStreakBroken { kind: 'streakBroken'; repairableDay: number }
export interface DailyNotEligible { kind: 'notEligible'; nextEligibleAt: number } // unix ms
export type DailyClaimResponse = DailyClaimSuccess | DailyStreakBroken | DailyNotEligible;

/** GET /daily/status response. */
export interface DailyStatusResponse {
  streakDay: number;        // last claimed day (1-7), 0 = never claimed
  claimedToday: boolean;    // in the requesting device's local day
  nextClaimDay: number;     // day the next claim grants (1 if streak lapsed)
  todayGrants: DailyGrant[];
}
```

Create `shared/dailyDrop.ts`:

```ts
// shared/dailyDrop.ts
//
// Pure day/streak/reward logic for Daily Drop, shared by worker and client.
// All instants are unix ms; "local" means the player's UTC offset in minutes
// (positive = east of UTC, i.e. -new Date().getTimezoneOffset()).
// Spec: docs/superpowers/specs/2026-07-16-daily-drop-design.md

import type { RewardPayload } from './codeTypes';
import type { DailyGrant, DailyRewardTable, DailyStatusResponse } from './dailyTypes';

export const DEFAULT_GRACE_HOURS = 36;    // streak survives gaps up to this
export const DEFAULT_MIN_GAP_HOURS = 10;  // anti-abuse floor between claims
export const DAILY_FALLBACK_COINS = 50;   // granted when an item pool is misconfigured

const MIN_OFFSET = -720;  // UTC-12
const MAX_OFFSET = 840;   // UTC+14
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export const DEFAULT_DAILY_REWARDS: DailyRewardTable = [
  [{ type: 'coins', amount: 50 }],
  [{ type: 'coins', amount: 75 }],
  [{ type: 'item', pool: ['ladder', 'ibeam', 'checkpoint'], amount: 1 }],
  [{ type: 'coins', amount: 100 }],
  [{ type: 'item', pool: ['shield', 'pogo', 'stall', 'adrenaline'], amount: 1 }],
  [{ type: 'coins', amount: 150 }],
  [{ type: 'coins', amount: 300 }, { type: 'item', pool: ['revive'], amount: 1 }],
];

/** Clamp a client-reported UTC offset to the real-world range; garbage → 0. */
export function clampOffsetMin(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0;
  return Math.max(MIN_OFFSET, Math.min(MAX_OFFSET, n));
}

/** Local calendar date key 'YYYY-MM-DD' for a unix-ms instant at a UTC offset. */
export function localDateKey(unixMs: number, offsetMin: number): string {
  return new Date(unixMs + offsetMin * 60_000).toISOString().slice(0, 10);
}

export interface ClaimState {
  lastClaimAt: number;  // unix ms
  streakDay: number;    // 1-7, day most recently claimed
}

export type ClaimDecision =
  | { kind: 'grant'; day: number }
  | { kind: 'broken'; repairableDay: number }
  | { kind: 'notEligible'; nextEligibleAt: number };

/**
 * Core claim rule. Eligible = different local calendar day AND at least the
 * min gap since the last claim (the gap is what stops timezone-hopping from
 * minting extra days). Within grace the streak continues; past grace the
 * caller must resolve: 'repair' keeps the streak, 'reset' restarts at day 1,
 * no resolution reports the break so the client can prompt.
 */
export function decideClaim(
  state: ClaimState | null,
  nowMs: number,
  offsetMin: number,
  resolution: 'repair' | 'reset' | undefined,
  graceHours: number,
  minGapHours: number,
): ClaimDecision {
  if (!state) return { kind: 'grant', day: 1 };

  const gapMs = nowMs - state.lastClaimAt;
  const sameLocalDay =
    localDateKey(nowMs, offsetMin) === localDateKey(state.lastClaimAt, offsetMin);
  if (sameLocalDay || gapMs < minGapHours * HOUR_MS) {
    return { kind: 'notEligible', nextEligibleAt: nextEligibleAt(state.lastClaimAt, offsetMin, minGapHours) };
  }

  const continuedDay = (state.streakDay % 7) + 1;
  if (gapMs <= graceHours * HOUR_MS) return { kind: 'grant', day: continuedDay };
  if (resolution === 'repair') return { kind: 'grant', day: continuedDay };
  if (resolution === 'reset') return { kind: 'grant', day: 1 };
  return { kind: 'broken', repairableDay: continuedDay };
}

/** Earliest instant the next claim can succeed: the later of the next local
 *  midnight and lastClaim + minGap. */
export function nextEligibleAt(lastClaimAt: number, offsetMin: number, minGapHours: number): number {
  const local = lastClaimAt + offsetMin * 60_000;
  const nextLocalMidnightUtc = (Math.floor(local / DAY_MS) + 1) * DAY_MS - offsetMin * 60_000;
  return Math.max(nextLocalMidnightUtc, lastClaimAt + minGapHours * HOUR_MS);
}

/** Table lookup with 7-day wrap (day 8 == day 1). */
export function grantsForDay(table: DailyRewardTable, day: number): DailyGrant[] {
  const idx = (((day - 1) % 7) + 7) % 7;
  return table[idx] ?? [];
}

/**
 * Resolve grants into concrete RewardPayloads. Item pools are filtered
 * through `isValidItemId`; an emptied pool falls back to coins so the server
 * never returns an invalid rewardId.
 */
export function grantsToRewards(
  grants: DailyGrant[],
  isValidItemId: (id: string) => boolean,
  rand: () => number = Math.random,
): RewardPayload[] {
  return grants.map((g): RewardPayload => {
    if (g.type === 'item') {
      const pool = g.pool.filter(isValidItemId);
      if (pool.length > 0) {
        const id = pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
        return { rewardType: 'item', rewardId: id, rewardAmount: g.amount };
      }
      return { rewardType: 'coins', rewardAmount: DAILY_FALLBACK_COINS };
    }
    return { rewardType: 'coins', rewardAmount: g.amount };
  });
}

function isGrant(v: unknown): v is DailyGrant {
  if (typeof v !== 'object' || v === null) return false;
  const g = v as Record<string, unknown>;
  if (g.type === 'coins') {
    return typeof g.amount === 'number' && Number.isFinite(g.amount) && g.amount > 0;
  }
  if (g.type === 'item') {
    return Array.isArray(g.pool) && g.pool.length > 0
      && g.pool.every((p) => typeof p === 'string')
      && typeof g.amount === 'number' && Number.isFinite(g.amount) && g.amount > 0;
  }
  return false;
}

/** Returns `value` itself when it is a well-formed 7-day table, else DEFAULT.
 *  (Identity return lets callers detect validity: sanitize(v) === v.) */
export function sanitizeRewardTable(value: unknown): DailyRewardTable {
  if (!Array.isArray(value) || value.length !== 7) return DEFAULT_DAILY_REWARDS;
  const ok = value.every((day) => Array.isArray(day) && day.length > 0 && day.every(isGrant));
  return ok ? (value as DailyRewardTable) : DEFAULT_DAILY_REWARDS;
}

/** Snapshot for GET /daily/status and the client's icon states. */
export function statusFromState(
  state: ClaimState | null,
  nowMs: number,
  offsetMin: number,
  graceHours: number,
  table: DailyRewardTable,
): DailyStatusResponse {
  if (!state) {
    return { streakDay: 0, claimedToday: false, nextClaimDay: 1, todayGrants: grantsForDay(table, 1) };
  }
  const claimedToday =
    localDateKey(nowMs, offsetMin) === localDateKey(state.lastClaimAt, offsetMin);
  const withinGrace = nowMs - state.lastClaimAt <= graceHours * HOUR_MS;
  const nextClaimDay = withinGrace ? (state.streakDay % 7) + 1 : 1;
  return { streakDay: state.streakDay, claimedToday, nextClaimDay, todayGrants: grantsForDay(table, nextClaimDay) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run shared/__tests__/dailyDrop.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add shared/dailyTypes.ts shared/dailyDrop.ts shared/__tests__/dailyDrop.test.ts
git commit -m "feat(shared): Daily Drop day/streak/reward pure logic"
```

---

### Task 2: D1 migration — `daily_claims` in heap_rewards

**Files:**
- Create: `server/migrations/heap_rewards/0002_daily_claims.sql`
- Modify: `server/schema/heap_rewards.sql` (append the same table)

**Interfaces:**
- Produces: table `daily_claims(player_id TEXT PK, last_claim_at INTEGER, last_claim_offset_min INTEGER, streak_day INTEGER, total_claims INTEGER)` — consumed by Task 3's D1 repo.

Follow the two-file rule from the `adding-d1-migrations` skill: incremental migration + final-state schema.

- [ ] **Step 1: Write the migration**

Create `server/migrations/heap_rewards/0002_daily_claims.sql`:

```sql
-- heap_rewards / 0002_daily_claims.sql
-- Daily Drop: one row per player tracking the most recent daily claim.
-- last_claim_at is the server-clock instant (unix ms); the client-reported
-- UTC offset used for that claim is kept for debuggability only.

CREATE TABLE IF NOT EXISTS daily_claims (
  player_id             TEXT PRIMARY KEY,   -- effective player id (GPGS id or GUID)
  last_claim_at         INTEGER NOT NULL,   -- unix ms, server clock
  last_claim_offset_min INTEGER NOT NULL,   -- clamped client UTC offset at claim time
  streak_day            INTEGER NOT NULL,   -- 1..7, day most recently claimed
  total_claims          INTEGER NOT NULL DEFAULT 0  -- lifetime counter (v2 can cosmetics)
);
```

- [ ] **Step 2: Append the same DDL to `server/schema/heap_rewards.sql`**

Add the identical `CREATE TABLE IF NOT EXISTS daily_claims (...)` block (with the comments) to the end of `server/schema/heap_rewards.sql`.

- [ ] **Step 3: Apply locally and verify**

```bash
cd server && npx wrangler d1 migrations apply heap_rewards --local
cd server && npx wrangler d1 migrations list heap_rewards --local
```

Expected: `0002_daily_claims.sql` listed as applied. (Remote apply happens automatically on merge via `.github/workflows/migrate-d1.yml`.)

- [ ] **Step 4: Commit** (do NOT add `.wrangler/state/`)

```bash
git add server/migrations/heap_rewards/0002_daily_claims.sql server/schema/heap_rewards.sql
git commit -m "feat(server): daily_claims migration in heap_rewards"
```

---

### Task 3: Server repo — `DailyClaimDB` (D1 + Mock)

**Files:**
- Create: `server/src/dailyDb.ts`
- Create: `server/tests/helpers/mockDailyDb.ts`
- Test: `server/tests/dailyDb.mock.test.ts`

**Interfaces:**
- Consumes: `daily_claims` table (Task 2).
- Produces (used by Task 4):

```ts
interface DailyClaimRow {
  player_id: string; last_claim_at: number; last_claim_offset_min: number;
  streak_day: number; total_claims: number;
}
interface DailyClaimDB {
  get(playerId: string): Promise<DailyClaimRow | null>;
  record(playerId: string, nowMs: number, offsetMin: number, streakDay: number,
         expectedLastClaimAt: number | null): Promise<boolean>;
}
```

`record` is a **conditional** upsert — the double-claim race guard from the spec: it succeeds only when the stored `last_claim_at` still equals `expectedLastClaimAt` (`null` = row must not exist yet). The losing device gets `false` and the route turns that into `notEligible`.

- [ ] **Step 1: Write the failing tests**

Create `server/tests/dailyDb.mock.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MockDailyDb } from './helpers/mockDailyDb';

describe('MockDailyDb', () => {
  it('get returns null for an unknown player', async () => {
    const db = new MockDailyDb();
    expect(await db.get('p1')).toBeNull();
  });

  it('first record inserts (expected null) and get returns the row', async () => {
    const db = new MockDailyDb();
    expect(await db.record('p1', 1000, -240, 1, null)).toBe(true);
    expect(await db.get('p1')).toEqual({
      player_id: 'p1', last_claim_at: 1000, last_claim_offset_min: -240,
      streak_day: 1, total_claims: 1,
    });
  });

  it('insert loses when a row already exists (two devices, first claim race)', async () => {
    const db = new MockDailyDb();
    await db.record('p1', 1000, 0, 1, null);
    expect(await db.record('p1', 1001, 0, 1, null)).toBe(false);
  });

  it('update succeeds when expectedLastClaimAt matches, and bumps total_claims', async () => {
    const db = new MockDailyDb();
    await db.record('p1', 1000, 0, 1, null);
    expect(await db.record('p1', 2000, 60, 2, 1000)).toBe(true);
    expect(await db.get('p1')).toEqual({
      player_id: 'p1', last_claim_at: 2000, last_claim_offset_min: 60,
      streak_day: 2, total_claims: 2,
    });
  });

  it('update loses when another claim landed in between (stale expected)', async () => {
    const db = new MockDailyDb();
    await db.record('p1', 1000, 0, 1, null);
    await db.record('p1', 2000, 0, 2, 1000);       // device A wins
    expect(await db.record('p1', 2001, 0, 2, 1000)).toBe(false); // device B stale
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run tests/dailyDb.mock.test.ts`
Expected: FAIL — cannot resolve `./helpers/mockDailyDb`.

- [ ] **Step 3: Write the implementation**

Create `server/src/dailyDb.ts`:

```ts
// server/src/dailyDb.ts

/** One daily_claims row (heap_rewards D1). */
export interface DailyClaimRow {
  player_id: string;
  last_claim_at: number;         // unix ms, server clock
  last_claim_offset_min: number; // clamped client UTC offset at claim time
  streak_day: number;            // 1..7
  total_claims: number;
}

/** Abstraction over D1 for Daily Drop claims. Allows MockDailyDb in tests. */
export interface DailyClaimDB {
  get(playerId: string): Promise<DailyClaimRow | null>;

  /**
   * Conditional upsert — the double-claim race guard. Succeeds only when the
   * stored last_claim_at still equals `expectedLastClaimAt` (null = row must
   * not exist yet). Returns false when another device's claim landed first.
   */
  record(
    playerId: string,
    nowMs: number,
    offsetMin: number,
    streakDay: number,
    expectedLastClaimAt: number | null,
  ): Promise<boolean>;
}

/** Production implementation backed by Cloudflare D1. */
export class D1DailyClaimDB implements DailyClaimDB {
  constructor(private d1: D1Database) {}

  async get(playerId: string): Promise<DailyClaimRow | null> {
    const row = await this.d1
      .prepare('SELECT * FROM daily_claims WHERE player_id = ?1')
      .bind(playerId)
      .first<DailyClaimRow>();
    return row ?? null;
  }

  async record(
    playerId: string,
    nowMs: number,
    offsetMin: number,
    streakDay: number,
    expectedLastClaimAt: number | null,
  ): Promise<boolean> {
    if (expectedLastClaimAt === null) {
      const res = await this.d1
        .prepare(
          `INSERT INTO daily_claims
             (player_id, last_claim_at, last_claim_offset_min, streak_day, total_claims)
           VALUES (?1, ?2, ?3, ?4, 1)
           ON CONFLICT (player_id) DO NOTHING`,
        )
        .bind(playerId, nowMs, offsetMin, streakDay)
        .run();
      return (res.meta.changes ?? 0) > 0;
    }
    const res = await this.d1
      .prepare(
        `UPDATE daily_claims
            SET last_claim_at = ?2, last_claim_offset_min = ?3,
                streak_day = ?4, total_claims = total_claims + 1
          WHERE player_id = ?1 AND last_claim_at = ?5`,
      )
      .bind(playerId, nowMs, offsetMin, streakDay, expectedLastClaimAt)
      .run();
    return (res.meta.changes ?? 0) > 0;
  }
}
```

Create `server/tests/helpers/mockDailyDb.ts`:

```ts
// server/tests/helpers/mockDailyDb.ts

import type { DailyClaimDB, DailyClaimRow } from '../../src/dailyDb';

/** In-memory DailyClaimDB with the same conditional-write semantics as D1. */
export class MockDailyDb implements DailyClaimDB {
  private rows = new Map<string, DailyClaimRow>();

  async get(playerId: string): Promise<DailyClaimRow | null> {
    const row = this.rows.get(playerId);
    return row ? { ...row } : null;
  }

  async record(
    playerId: string,
    nowMs: number,
    offsetMin: number,
    streakDay: number,
    expectedLastClaimAt: number | null,
  ): Promise<boolean> {
    const existing = this.rows.get(playerId);
    if (expectedLastClaimAt === null) {
      if (existing) return false;
      this.rows.set(playerId, {
        player_id: playerId, last_claim_at: nowMs, last_claim_offset_min: offsetMin,
        streak_day: streakDay, total_claims: 1,
      });
      return true;
    }
    if (!existing || existing.last_claim_at !== expectedLastClaimAt) return false;
    this.rows.set(playerId, {
      player_id: playerId, last_claim_at: nowMs, last_claim_offset_min: offsetMin,
      streak_day: streakDay, total_claims: existing.total_claims + 1,
    });
    return true;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx vitest run tests/dailyDb.mock.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/dailyDb.ts server/tests/helpers/mockDailyDb.ts server/tests/dailyDb.mock.test.ts
git commit -m "feat(server): DailyClaimDB repo with conditional-write race guard"
```

---

### Task 4: Server routes — `/daily/status` + `/daily/claim`, wiring, config shapes

**Files:**
- Create: `server/src/routes/daily.ts`
- Modify: `server/src/app.ts` (AppOptions + mount, mirror the `/codes` block)
- Modify: `server/src/index.ts` (construct `D1DailyClaimDB(env.DB_REWARDS)`)
- Modify: `server/src/routes/config.ts` (`validateKnownKeyShape` cases for the three daily keys)
- Test: `server/tests/daily.test.ts`

**Interfaces:**
- Consumes: `DailyClaimDB`/`MockDailyDb` (Task 3), `decideClaim`/`grantsForDay`/`grantsToRewards`/`sanitizeRewardTable`/`statusFromState`/`clampOffsetMin` + defaults (Task 1), `ConfigDB` (`getAll(): Promise<AppConfig>`), `enforcePlayerAuth(c, authDb, guid, getSink, route)` from `server/src/playerAuth.ts`, `isItemId` from `shared/itemIds.ts`, `captureServer` from `server/src/logging/captureServerEvent.ts`.
- Produces:
  - `GET /daily/status?playerGuid=&utcOffsetMin=` → 200 `DailyStatusResponse` (no auth — read-only, like other GETs)
  - `POST /daily/claim` body `DailyClaimRequest` → 200 `{kind:'ok',...}` or `{kind:'streakBroken',...}`; 409 `{kind:'notEligible', nextEligibleAt}`; 400 invalid; 403 via player auth
  - `dailyRoutes(dailyDb, configDb, getSink, authDb?): Hono`

- [ ] **Step 1: Write the failing tests**

Create `server/tests/daily.test.ts`. Note: routes read `Date.now()` — tests use `vi.useFakeTimers()` + `vi.setSystemTime` to control the clock.

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockDailyDb } from './helpers/mockDailyDb';
import { MockConfigDB } from './helpers/mockConfigDb';

const H = 3_600_000;
// 2026-07-16T02:00:00Z — 10pm July 15 in New York (offset -240)
const T0 = Date.parse('2026-07-16T02:00:00Z');
const NY = -240;

function makeApp(dailyDb = new MockDailyDb(), configDb?: MockConfigDB) {
  return createApp(new MockHeapDB(), new MockScoreDB(), { dailyDb, configDb });
}

function claim(app: ReturnType<typeof createApp>, guid: string, offset: number, resolution?: string) {
  return app.request('/daily/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerGuid: guid, utcOffsetMin: offset, ...(resolution ? { resolution } : {}) }),
  });
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); });
afterEach(() => { vi.useRealTimers(); });

describe('POST /daily/claim', () => {
  it('first claim grants day 1 coins', async () => {
    const app = makeApp();
    const res = await claim(app, 'p1', NY);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe('ok');
    expect(body.streakDay).toBe(1);
    expect(body.rewards).toEqual([{ rewardType: 'coins', rewardAmount: 50 }]);
    expect(body.nextRewardPreview).toEqual([{ type: 'coins', amount: 75 }]);
  });

  it('second claim the same local day is 409 notEligible with nextEligibleAt', async () => {
    const app = makeApp();
    await claim(app, 'p1', NY);
    vi.setSystemTime(T0 + 1 * H);
    const res = await claim(app, 'p1', NY);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.kind).toBe('notEligible');
    expect(typeof body.nextEligibleAt).toBe('number');
  });

  it('east-coast rhythm: 10pm then 3pm next local day grants day 2', async () => {
    const app = makeApp();
    await claim(app, 'p1', NY);
    vi.setSystemTime(T0 + 17 * H);
    const res = await claim(app, 'p1', NY);
    const body = await res.json();
    expect(body.kind).toBe('ok');
    expect(body.streakDay).toBe(2);
  });

  it('past grace: reports streakBroken without granting, then repair continues', async () => {
    const app = makeApp();
    await claim(app, 'p1', NY);
    vi.setSystemTime(T0 + 40 * H);
    const broken = await (await claim(app, 'p1', NY)).json();
    expect(broken).toEqual({ kind: 'streakBroken', repairableDay: 2 });

    const repaired = await (await claim(app, 'p1', NY, 'repair')).json();
    expect(repaired.kind).toBe('ok');
    expect(repaired.streakDay).toBe(2);
  });

  it('past grace with reset restarts at day 1', async () => {
    const app = makeApp();
    await claim(app, 'p1', NY);
    vi.setSystemTime(T0 + 40 * H);
    const body = await (await claim(app, 'p1', NY, 'reset')).json();
    expect(body.kind).toBe('ok');
    expect(body.streakDay).toBe(1);
  });

  it('day 7 grants coins AND the revive item', async () => {
    const db = new MockDailyDb();
    // Seed a player who claimed day 6 yesterday.
    await db.record('p1', T0 - 24 * H, NY, 6, null);
    const app = makeApp(db);
    const body = await (await claim(app, 'p1', NY)).json();
    expect(body.streakDay).toBe(7);
    expect(body.rewards).toHaveLength(2);
    expect(body.rewards[0]).toEqual({ rewardType: 'coins', rewardAmount: 300 });
    expect(body.rewards[1]).toEqual({ rewardType: 'item', rewardId: 'revive', rewardAmount: 1 });
  });

  it('clamps an absurd utcOffsetMin instead of trusting it', async () => {
    const app = makeApp();
    await claim(app, 'p1', NY);
    // A fake offset of 100000 minutes must not create an instant "new day".
    vi.setSystemTime(T0 + 1 * H);
    const res = await claim(app, 'p1', 100000);
    expect(res.status).toBe(409);
  });

  it('rejects a missing guid (400)', async () => {
    const app = makeApp();
    const res = await claim(app, '', NY);
    expect(res.status).toBe(400);
  });

  it('a lost write race returns 409 notEligible', async () => {
    const db = new MockDailyDb();
    // Force the conditional write to fail regardless of inputs.
    db.record = async () => false;
    const app = makeApp(db);
    const res = await claim(app, 'p1', NY);
    expect(res.status).toBe(409);
  });

  it('uses a config-overridden reward table', async () => {
    const cfg = new MockConfigDB();
    await cfg.set('daily_rewards', [
      [{ type: 'coins', amount: 9 }], [{ type: 'coins', amount: 9 }], [{ type: 'coins', amount: 9 }],
      [{ type: 'coins', amount: 9 }], [{ type: 'coins', amount: 9 }], [{ type: 'coins', amount: 9 }],
      [{ type: 'coins', amount: 9 }],
    ], 'now');
    const app = makeApp(new MockDailyDb(), cfg);
    const body = await (await claim(app, 'p1', NY)).json();
    expect(body.rewards).toEqual([{ rewardType: 'coins', rewardAmount: 9 }]);
  });
});

describe('GET /daily/status', () => {
  it('never-claimed player previews day 1', async () => {
    const app = makeApp();
    const res = await app.request(`/daily/status?playerGuid=p1&utcOffsetMin=${NY}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      streakDay: 0, claimedToday: false, nextClaimDay: 1,
      todayGrants: [{ type: 'coins', amount: 50 }],
    });
  });

  it('after claiming, claimedToday is true and the next day previews', async () => {
    const app = makeApp();
    await claim(app, 'p1', NY);
    const body = await (await app.request(`/daily/status?playerGuid=p1&utcOffsetMin=${NY}`)).json();
    expect(body.claimedToday).toBe(true);
    expect(body.streakDay).toBe(1);
    expect(body.nextClaimDay).toBe(2);
  });

  it('rejects a missing guid (400)', async () => {
    const app = makeApp();
    const res = await app.request('/daily/status?utcOffsetMin=0');
    expect(res.status).toBe(400);
  });
});
```

Also add a player-auth enforcement case. **First read `server/tests/placeAuth.test.ts`** for the established MockPlayerAuthDB/TOFU pattern and mirror it — the test must show: claim with token A succeeds (TOFU-registers), a later claim with token B for the same guid returns 403. Add it to `daily.test.ts` under `describe('claim auth')`, using fake timers to move past the eligibility window between the two claims.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run tests/daily.test.ts`
Expected: FAIL — `dailyDb` is not a known AppOptions key / route 404s.

- [ ] **Step 3: Write the route**

Create `server/src/routes/daily.ts`:

```ts
// server/src/routes/daily.ts

import { Hono } from 'hono';
import type { DailyClaimDB } from '../dailyDb';
import type { ConfigDB } from '../configDb';
import type { PlayerAuthDB } from '../playerAuthDb';
import type { Sink } from '../logging/Sink';
import { captureServer } from '../logging/captureServerEvent';
import { enforcePlayerAuth } from '../playerAuth';
import { isItemId } from '../../../shared/itemIds';
import {
  clampOffsetMin, decideClaim, grantsForDay, grantsToRewards,
  sanitizeRewardTable, statusFromState,
  DEFAULT_GRACE_HOURS, DEFAULT_MIN_GAP_HOURS,
} from '../../../shared/dailyDrop';
import type { DailyClaimRequest } from '../../../shared/dailyTypes';

const MAX_GUID_LEN = 64;
const HOUR_MS = 3_600_000;

export function dailyRoutes(
  dailyDb: DailyClaimDB,
  configDb: ConfigDB | undefined,
  getSink: () => Sink | undefined,
  authDb?: PlayerAuthDB,
): Hono {
  const app = new Hono();

  async function loadTuning() {
    const cfg = configDb ? await configDb.getAll() : {};
    const grace = cfg['daily_streak_grace_hours'];
    const gap = cfg['daily_min_gap_hours'];
    return {
      table: sanitizeRewardTable(cfg['daily_rewards']),
      graceHours: typeof grace === 'number' && grace > 0 ? grace : DEFAULT_GRACE_HOURS,
      minGapHours: typeof gap === 'number' && gap > 0 ? gap : DEFAULT_MIN_GAP_HOURS,
    };
  }

  // ── Read-only streak/claim snapshot (drives the menu icon states) ────────
  app.get('/status', async (c) => {
    const guid = (c.req.query('playerGuid') ?? '').trim();
    if (!guid || guid.length > MAX_GUID_LEN) return c.json({ error: 'invalid request' }, 400);
    const offset = clampOffsetMin(Number(c.req.query('utcOffsetMin')));

    const { table, graceHours } = await loadTuning();
    const row = await dailyDb.get(guid);
    const state = row ? { lastClaimAt: row.last_claim_at, streakDay: row.streak_day } : null;
    return c.json(statusFromState(state, Date.now(), offset, graceHours, table), 200);
  });

  // ── Claim today's drop (auth-gated, server-authoritative) ────────────────
  app.post('/claim', async (c) => {
    let body: DailyClaimRequest;
    try {
      body = await c.req.json<DailyClaimRequest>();
    } catch {
      return c.json({ error: 'invalid request' }, 400);
    }
    const guid = typeof body.playerGuid === 'string' ? body.playerGuid.trim() : '';
    if (!guid || guid.length > MAX_GUID_LEN) return c.json({ error: 'invalid request' }, 400);
    const resolution =
      body.resolution === 'repair' || body.resolution === 'reset' ? body.resolution : undefined;
    const offset = clampOffsetMin(body.utcOffsetMin);

    const authRes = await enforcePlayerAuth(c, authDb, guid, getSink, 'daily:claim');
    if (authRes) return authRes;

    const { table, graceHours, minGapHours } = await loadTuning();
    const now = Date.now();
    const row = await dailyDb.get(guid);
    const state = row ? { lastClaimAt: row.last_claim_at, streakDay: row.streak_day } : null;
    const decision = decideClaim(state, now, offset, resolution, graceHours, minGapHours);

    if (decision.kind === 'notEligible') {
      return c.json({ kind: 'notEligible', nextEligibleAt: decision.nextEligibleAt }, 409);
    }
    if (decision.kind === 'broken') {
      // Informational — nothing granted until the client resolves repair/reset.
      return c.json({ kind: 'streakBroken', repairableDay: decision.repairableDay }, 200);
    }

    const stored = await dailyDb.record(guid, now, offset, decision.day, row ? row.last_claim_at : null);
    if (!stored) {
      // Lost a same-instant race — another device's claim landed first.
      return c.json({ kind: 'notEligible', nextEligibleAt: now + minGapHours * HOUR_MS }, 409);
    }

    const rewards = grantsToRewards(grantsForDay(table, decision.day), isItemId);
    const sink = getSink();
    if (sink) {
      await captureServer(sink, 'event', 'daily:claimed',
        { day: decision.day, repaired: resolution === 'repair' });
    }
    return c.json({
      kind: 'ok',
      rewards,
      streakDay: decision.day,
      nextRewardPreview: grantsForDay(table, decision.day + 1),
    }, 200);
  });

  return app;
}
```

- [ ] **Step 4: Wire into app.ts and index.ts**

In `server/src/app.ts`:
- Add imports: `import { dailyRoutes } from './routes/daily';` and `import type { DailyClaimDB } from './dailyDb';`
- Add to `AppOptions`:

```ts
  /** Daily Drop claims (daily_claims in heap_rewards). If unset, /daily is not mounted. */
  dailyDb?: DailyClaimDB;
```

- Mount after the `/codes` block, reusing the codes limiter bucket (both are low-frequency reward grants):

```ts
  if (opts.dailyDb) {
    // Player claim endpoint — rate-limited, no admin gate.
    app.post('/daily/claim', rateLimit(lim.codes, 'daily-claim'));
    app.route('/daily', dailyRoutes(opts.dailyDb, opts.configDb, () => opts.logSink, opts.playerAuthDb));
  }
```

In `server/src/index.ts`:
- Add `import { D1DailyClaimDB } from './dailyDb';`
- Add to the `createApp` options object: `dailyDb: new D1DailyClaimDB(env.DB_REWARDS),`

- [ ] **Step 5: Add config shape checks**

In `server/src/routes/config.ts`, add to `validateKnownKeyShape` (after the `ad_cadence` case), plus the import:

```ts
import { sanitizeRewardTable } from '../../../shared/dailyDrop';
```

```ts
  if (key === 'daily_streak_grace_hours' || key === 'daily_min_gap_hours') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return 'value must be a positive number of hours';
    }
  }
  if (key === 'daily_rewards') {
    // sanitizeRewardTable returns its input by identity iff well-formed.
    if (sanitizeRewardTable(value) !== value) {
      return 'value must be a 7-entry array of non-empty grant arrays';
    }
  }
```

Add two cases to `server/tests/config.test.ts` following its existing style: `PUT /config/daily_min_gap_hours` with `-5` → 400, and with `10` → 200.

- [ ] **Step 6: Run the server suite**

Run: `cd server && npm test`
Expected: PASS — new daily tests plus every pre-existing test (especially `routes.test.ts`, `security.test.ts`, `config.test.ts`).

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/daily.ts server/src/app.ts server/src/index.ts server/src/routes/config.ts server/tests/daily.test.ts server/tests/config.test.ts
git commit -m "feat(server): /daily/status + /daily/claim routes with auth, config tuning"
```

---

### Task 5: Client — extract shared `applyReward`

**Files:**
- Create: `src/systems/applyReward.ts`
- Modify: `src/systems/CodeClient.ts` (delete its private `applyReward`, use the shared one)
- Test: `src/systems/__tests__/applyReward.test.ts`

**Interfaces:**
- Consumes: `addBalance`, `addItem` from `src/systems/SaveData.ts`; `ITEM_DEFS` from `src/data/itemDefs.ts`; `RewardPayload` from `shared/codeTypes.ts`.
- Produces (used by Task 7): `applyReward(reward: RewardPayload): { ok: boolean; message: string }` — message like `+500 coins` / `+1 Shield` (no leading `✓`; callers add their own framing).

- [ ] **Step 1: Write the failing tests**

Create `src/systems/__tests__/applyReward.test.ts` (mock style copied from `CodeClient.test.ts`):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const addBalance = vi.fn();
const addItem = vi.fn();
vi.mock('../SaveData', () => ({
  addBalance: (n: number) => addBalance(n),
  addItem: (id: string, qty: number) => addItem(id, qty),
}));

import { applyReward } from '../applyReward';

describe('applyReward', () => {
  beforeEach(() => { addBalance.mockClear(); addItem.mockClear(); });

  it('applies coins', () => {
    const out = applyReward({ rewardType: 'coins', rewardAmount: 500 });
    expect(out.ok).toBe(true);
    expect(out.message).toBe('+500 coins');
    expect(addBalance).toHaveBeenCalledWith(500);
  });

  it('applies a known item using its display name', () => {
    const out = applyReward({ rewardType: 'item', rewardId: 'shield', rewardAmount: 2 });
    expect(out.ok).toBe(true);
    expect(out.message).toContain('+2');
    expect(addItem).toHaveBeenCalledWith('shield', 2);
  });

  it('rejects an unknown item id without granting', () => {
    const out = applyReward({ rewardType: 'item', rewardId: 'ghost', rewardAmount: 1 });
    expect(out.ok).toBe(false);
    expect(addItem).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/systems/__tests__/applyReward.test.ts`
Expected: FAIL — cannot resolve `../applyReward`.

- [ ] **Step 3: Write the implementation and refactor CodeClient**

Create `src/systems/applyReward.ts`:

```ts
// src/systems/applyReward.ts

import { addBalance, addItem } from './SaveData';
import { ITEM_DEFS } from '../data/itemDefs';
import type { RewardPayload } from '../../shared/codeTypes';

export interface AppliedReward { ok: boolean; message: string }

/** Apply a server-granted reward to local SaveData. Shared by reward-code
 *  redemption and Daily Drop claims — one grant path, one item-id guard. */
export function applyReward(reward: RewardPayload): AppliedReward {
  if (reward.rewardType === 'coins') {
    addBalance(reward.rewardAmount);
    return { ok: true, message: `+${reward.rewardAmount} coins` };
  }
  const def = ITEM_DEFS.find((d) => d.id === reward.rewardId);
  if (!def) return { ok: false, message: 'Unknown reward item' };
  addItem(def.id, reward.rewardAmount);
  return { ok: true, message: `+${reward.rewardAmount} ${def.name}` };
}
```

In `src/systems/CodeClient.ts`:
- Remove the private `applyReward` function and the now-unused `addBalance`, `addItem`, `ITEM_DEFS` imports.
- Add `import { applyReward } from './applyReward';`
- Replace the success branch of `redeemCode` (`return applyReward(reward);`) with:

```ts
  if (res.ok) {
    const reward = (await res.json()) as RewardPayload;
    const applied = applyReward(reward);
    return applied.ok
      ? { status: 'success', message: `✓ ${applied.message}`, reward }
      : { status: 'error', message: applied.message };
  }
```

- [ ] **Step 4: Run tests to verify everything passes**

Run: `npx vitest run src/systems/__tests__/applyReward.test.ts src/systems/__tests__/CodeClient.test.ts`
Expected: PASS — including all pre-existing CodeClient tests (message format `✓ +500 coins` is preserved).

- [ ] **Step 5: Commit**

```bash
git add src/systems/applyReward.ts src/systems/CodeClient.ts src/systems/__tests__/applyReward.test.ts
git commit -m "refactor(client): extract shared applyReward from CodeClient"
```

---

### Task 6: Client — played-today gate + ScoreScene hook

**Files:**
- Create: `src/systems/dailyRunGate.ts`
- Modify: `src/scenes/ScoreScene.ts` (call `markRunEnded()` at the top of `create()`)
- Modify (conditional): `src/scenes/PauseScene.ts` (only if it quits to menu without passing ScoreScene — see Step 3)
- Test: `src/systems/__tests__/dailyRunGate.test.ts`

**Interfaces:**
- Consumes: `localDateKey` from `shared/dailyDrop.ts`.
- Produces (used by Task 9): `markRunEnded(now?: number): void`, `hasPlayedToday(offsetMin: number, now?: number): boolean`, `deviceUtcOffsetMin(d?: Date): number`.

Design note (from spec discussion): this lives in its own localStorage key, **not** inside the `RawSave` blob — it describes *this device's* day and must not round-trip through cloud saves (a stale cloud value would re-lock the can).

- [ ] **Step 1: Write the failing tests**

Create `src/systems/__tests__/dailyRunGate.test.ts` (localStorage stub pattern from `SaveData.test.ts`):

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { markRunEnded, hasPlayedToday, deviceUtcOffsetMin } from '../dailyRunGate';

// Stub localStorage — vitest runs in node environment
beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(global, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
    },
    configurable: true,
  });
});

const NY = -240;
// 10pm July 15 in New York:
const T0 = Date.parse('2026-07-16T02:00:00Z');

beforeEach(() => { localStorage.clear(); });

describe('dailyRunGate', () => {
  it('reports not-played when no run has ended', () => {
    expect(hasPlayedToday(NY, T0)).toBe(false);
  });

  it('reports played after a run ends the same local day', () => {
    markRunEnded(T0);                                        // 10pm local
    expect(hasPlayedToday(NY, T0 + 30 * 60_000)).toBe(true); // 10:30pm local, same day
  });

  it('resets across the local midnight', () => {
    markRunEnded(T0);                                           // 10pm July 15 local
    expect(hasPlayedToday(NY, T0 + 3 * 3_600_000)).toBe(false); // 1am July 16 local
  });

  it('survives garbage in storage', () => {
    localStorage.setItem('heap_last_run_ended_at', 'garbage');
    expect(hasPlayedToday(NY, T0)).toBe(false);
  });

  it('deviceUtcOffsetMin inverts getTimezoneOffset sign', () => {
    const fake = { getTimezoneOffset: () => 240 } as Date;   // NY reports +240
    expect(deviceUtcOffsetMin(fake)).toBe(-240);             // we want east-positive
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/systems/__tests__/dailyRunGate.test.ts`
Expected: FAIL — cannot resolve `../dailyRunGate`.

- [ ] **Step 3: Write the implementation**

Create `src/systems/dailyRunGate.ts`:

```ts
// src/systems/dailyRunGate.ts
//
// Device-local "played today" gate for Daily Drop. Deliberately a standalone
// localStorage key, NOT part of RawSave: it describes this device's calendar
// day and must not sync through cloud saves (a stale cloud value would
// re-lock the menu can).

import { localDateKey } from '../../shared/dailyDrop';

const KEY = 'heap_last_run_ended_at';

/** Record that a run just ended (any run counts, per spec). */
export function markRunEnded(now: number = Date.now()): void {
  try { localStorage.setItem(KEY, String(now)); } catch { /* storage unavailable */ }
}

/** True when a run has ended during the current local calendar day. */
export function hasPlayedToday(offsetMin: number, now: number = Date.now()): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const t = Number(raw);
    if (!Number.isFinite(t)) return false;
    return localDateKey(t, offsetMin) === localDateKey(now, offsetMin);
  } catch {
    return false;
  }
}

/** This device's UTC offset in minutes, matching localDateKey's convention
 *  (positive = east of UTC). JS getTimezoneOffset reports the inverse sign. */
export function deviceUtcOffsetMin(d: Date = new Date()): number {
  return -d.getTimezoneOffset();
}
```

In `src/scenes/ScoreScene.ts`: add `import { markRunEnded } from '../systems/dailyRunGate';` and call `markRunEnded();` as the first line of `create()`. (ScoreScene is launched at the end of every run — death or success, both modes — so this is the main "run ended" point.)

Spec also counts a mid-run quit-to-menu as a played run. Check `grep -n "MenuScene" src/scenes/PauseScene.ts` — if PauseScene has a quit-to-menu handler that bypasses ScoreScene, add the same `markRunEnded();` call there (with the same import) immediately before its `scene.start('MenuScene')`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/systems/__tests__/dailyRunGate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/systems/dailyRunGate.ts src/scenes/ScoreScene.ts src/systems/__tests__/dailyRunGate.test.ts
git commit -m "feat(client): device-local played-today gate, marked on run end"
```

---

### Task 7: Client — `DailyDropClient`

**Files:**
- Create: `src/systems/DailyDropClient.ts`
- Test: `src/systems/__tests__/DailyDropClient.test.ts`

**Interfaces:**
- Consumes: `getEffectivePlayerId` (SaveData), `fetchWithLog`, `authHeaders`/`logIfAuthRejected`, `applyReward` (Task 5), `deviceUtcOffsetMin` (Task 6), types from `shared/dailyTypes.ts`.
- Produces (used by Task 9):

```ts
type DailyStatusResult = { status: 'ok'; data: DailyStatusResponse } | { status: 'offline' };
fetchDailyStatus(): Promise<DailyStatusResult>

type DailyClaimResult =
  | { status: 'claimed'; messages: string[]; streakDay: number }
  | { status: 'streakBroken'; repairableDay: number }
  | { status: 'notEligible' }
  | { status: 'offline' }
  | { status: 'error' };
claimDaily(resolution?: 'repair' | 'reset'): Promise<DailyClaimResult>
```

- [ ] **Step 1: Write the failing tests**

Create `src/systems/__tests__/DailyDropClient.test.ts` (same mocking pattern as `CodeClient.test.ts`):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const addBalance = vi.fn();
const addItem = vi.fn();
vi.mock('../SaveData', () => ({
  getEffectivePlayerId: () => 'gpgs-effective',
  addBalance: (n: number) => addBalance(n),
  addItem: (id: string, qty: number) => addItem(id, qty),
}));
const fetchWithLog = vi.fn();
vi.mock('../../logging/fetchWithLog', () => ({
  fetchWithLog: (...args: unknown[]) => fetchWithLog(...args),
}));
vi.mock('../authToken', () => ({
  authHeaders: () => ({ 'X-Player-Token': 'secret-test' }),
  logIfAuthRejected: vi.fn(),
}));

import { fetchDailyStatus, claimDaily } from '../DailyDropClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => { addBalance.mockClear(); addItem.mockClear(); fetchWithLog.mockReset(); });

describe('fetchDailyStatus', () => {
  it('returns parsed status and sends the effective player id + offset', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, {
      streakDay: 2, claimedToday: false, nextClaimDay: 3, todayGrants: [],
    }));
    const out = await fetchDailyStatus();
    expect(out.status).toBe('ok');
    const url = fetchWithLog.mock.calls[0][0] as string;
    expect(url).toContain('playerGuid=gpgs-effective');
    expect(url).toContain('utcOffsetMin=');
  });

  it('maps fetch failure to offline', async () => {
    fetchWithLog.mockRejectedValue(new Error('net'));
    expect((await fetchDailyStatus()).status).toBe('offline');
  });

  it('maps non-200 to offline', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(500, {}));
    expect((await fetchDailyStatus()).status).toBe('offline');
  });
});

describe('claimDaily', () => {
  it('applies every reward in the array and reports messages', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, {
      kind: 'ok', streakDay: 7,
      rewards: [
        { rewardType: 'coins', rewardAmount: 300 },
        { rewardType: 'item', rewardId: 'revive', rewardAmount: 1 },
      ],
      nextRewardPreview: [],
    }));
    const out = await claimDaily();
    expect(out).toMatchObject({ status: 'claimed', streakDay: 7 });
    expect(addBalance).toHaveBeenCalledWith(300);
    expect(addItem).toHaveBeenCalledWith('revive', 1);
    if (out.status === 'claimed') expect(out.messages).toHaveLength(2);
  });

  it('passes resolution through in the body', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, {
      kind: 'ok', streakDay: 5, rewards: [{ rewardType: 'coins', rewardAmount: 1 }], nextRewardPreview: [],
    }));
    await claimDaily('repair');
    const init = fetchWithLog.mock.calls[0][1] as { body: string };
    expect(JSON.parse(init.body).resolution).toBe('repair');
  });

  it('maps streakBroken through without granting', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, { kind: 'streakBroken', repairableDay: 4 }));
    const out = await claimDaily();
    expect(out).toEqual({ status: 'streakBroken', repairableDay: 4 });
    expect(addBalance).not.toHaveBeenCalled();
  });

  it('maps 409 to notEligible', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(409, { kind: 'notEligible', nextEligibleAt: 1 }));
    expect((await claimDaily()).status).toBe('notEligible');
  });

  it('maps network failure to offline', async () => {
    fetchWithLog.mockRejectedValue(new Error('net'));
    expect((await claimDaily()).status).toBe('offline');
  });

  it('sends the auth token header', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, {
      kind: 'ok', streakDay: 1, rewards: [], nextRewardPreview: [],
    }));
    await claimDaily();
    const init = fetchWithLog.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers['X-Player-Token']).toBe('secret-test');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/systems/__tests__/DailyDropClient.test.ts`
Expected: FAIL — cannot resolve `../DailyDropClient`.

- [ ] **Step 3: Write the implementation**

Create `src/systems/DailyDropClient.ts`:

```ts
// src/systems/DailyDropClient.ts

import { getEffectivePlayerId } from './SaveData';
import { fetchWithLog } from '../logging/fetchWithLog';
import { authHeaders, logIfAuthRejected } from './authToken';
import { applyReward } from './applyReward';
import { deviceUtcOffsetMin } from './dailyRunGate';
import type { DailyClaimResponse, DailyStatusResponse } from '../../shared/dailyTypes';

const SERVER_URL: string =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_HEAP_SERVER_URL ??
  'http://localhost:8787';

export type DailyStatusResult =
  | { status: 'ok'; data: DailyStatusResponse }
  | { status: 'offline' };

export async function fetchDailyStatus(): Promise<DailyStatusResult> {
  const guid = encodeURIComponent(getEffectivePlayerId());
  try {
    const res = await fetchWithLog(
      `${SERVER_URL}/daily/status?playerGuid=${guid}&utcOffsetMin=${deviceUtcOffsetMin()}`,
    );
    if (!res.ok) return { status: 'offline' };
    return { status: 'ok', data: (await res.json()) as DailyStatusResponse };
  } catch {
    return { status: 'offline' };
  }
}

export type DailyClaimResult =
  | { status: 'claimed'; messages: string[]; streakDay: number }
  | { status: 'streakBroken'; repairableDay: number }
  | { status: 'notEligible' }
  | { status: 'offline' }
  | { status: 'error' };

/** Claim today's drop server-side, then apply the granted rewards locally. */
export async function claimDaily(resolution?: 'repair' | 'reset'): Promise<DailyClaimResult> {
  const body = {
    playerGuid: getEffectivePlayerId(),
    utcOffsetMin: deviceUtcOffsetMin(),
    ...(resolution ? { resolution } : {}),
  };
  let res: Response;
  try {
    res = await fetchWithLog(`${SERVER_URL}/daily/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
  } catch {
    return { status: 'offline' };
  }

  if (res.status === 409) return { status: 'notEligible' };
  if (!res.ok) {
    logIfAuthRejected('daily:claim', res.status);
    return { status: 'error' };
  }

  const data = (await res.json()) as DailyClaimResponse;
  if (data.kind === 'streakBroken') return { status: 'streakBroken', repairableDay: data.repairableDay };
  if (data.kind === 'notEligible') return { status: 'notEligible' };
  const messages = data.rewards
    .map((r) => applyReward(r))
    .filter((a) => a.ok)
    .map((a) => a.message);
  return { status: 'claimed', messages, streakDay: data.streakDay };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/systems/__tests__/DailyDropClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/systems/DailyDropClient.ts src/systems/__tests__/DailyDropClient.test.ts
git commit -m "feat(client): DailyDropClient status + claim over auth rails"
```

---

### Task 8: Client — pure icon/popup state logic

**Files:**
- Create: `src/ui/dailyDropLogic.ts`
- Test: `src/ui/__tests__/dailyDropLogic.test.ts`

**Interfaces:**
- Consumes: `DailyStatusResponse` from `shared/dailyTypes.ts`.
- Produces (used by Task 9): `DailyIconState = 'hidden' | 'locked' | 'ready' | 'offline'`, `dailyIconState(status: DailyStatusResponse | null, playedToday: boolean): DailyIconState`, `shouldAutoShowPopup(state: DailyIconState, lastShownDateKey: string | null, todayKey: string): boolean`, `StreakChip = 'done' | 'now' | 'todo'`, `streakChips(nextDay: number): StreakChip[]`.

- [ ] **Step 1: Write the failing tests**

Create `src/ui/__tests__/dailyDropLogic.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { dailyIconState, shouldAutoShowPopup, streakChips } from '../dailyDropLogic';
import type { DailyStatusResponse } from '../../../shared/dailyTypes';

const base: DailyStatusResponse = { streakDay: 2, claimedToday: false, nextClaimDay: 3, todayGrants: [] };

describe('dailyIconState', () => {
  it('offline when status is unavailable', () => {
    expect(dailyIconState(null, true)).toBe('offline');
  });
  it('hidden once claimed today — the can must get out of the way', () => {
    expect(dailyIconState({ ...base, claimedToday: true }, true)).toBe('hidden');
  });
  it('locked before the first run of the day', () => {
    expect(dailyIconState(base, false)).toBe('locked');
  });
  it('ready after a run, unclaimed', () => {
    expect(dailyIconState(base, true)).toBe('ready');
  });
});

describe('shouldAutoShowPopup', () => {
  it('fires when ready and not yet shown today', () => {
    expect(shouldAutoShowPopup('ready', null, '2026-07-16')).toBe(true);
    expect(shouldAutoShowPopup('ready', '2026-07-15', '2026-07-16')).toBe(true);
  });
  it('fires at most once per day', () => {
    expect(shouldAutoShowPopup('ready', '2026-07-16', '2026-07-16')).toBe(false);
  });
  it('never fires for other states', () => {
    expect(shouldAutoShowPopup('locked', null, '2026-07-16')).toBe(false);
    expect(shouldAutoShowPopup('hidden', null, '2026-07-16')).toBe(false);
    expect(shouldAutoShowPopup('offline', null, '2026-07-16')).toBe(false);
  });
});

describe('streakChips', () => {
  it('marks earlier days done, the claiming day now, later days todo', () => {
    expect(streakChips(3)).toEqual(['done', 'done', 'now', 'todo', 'todo', 'todo', 'todo']);
  });
  it('day 1 has nothing done', () => {
    expect(streakChips(1)[0]).toBe('now');
    expect(streakChips(1).filter((c) => c === 'done')).toHaveLength(0);
  });
  it('day 7 is all done but the last', () => {
    expect(streakChips(7)).toEqual(['done', 'done', 'done', 'done', 'done', 'done', 'now']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/__tests__/dailyDropLogic.test.ts`
Expected: FAIL — cannot resolve `../dailyDropLogic`.

- [ ] **Step 3: Write the implementation**

Create `src/ui/dailyDropLogic.ts`:

```ts
// src/ui/dailyDropLogic.ts
//
// Pure state logic for the Daily Drop menu icon + auto-popup (testable
// without Phaser, same pattern as hudLogic.ts).

import type { DailyStatusResponse } from '../../shared/dailyTypes';

export type DailyIconState = 'hidden' | 'locked' | 'ready' | 'offline';

/** Icon visibility/state. Hidden after today's claim (spec: the can must not
 *  linger once it has no job). */
export function dailyIconState(
  status: DailyStatusResponse | null,
  playedToday: boolean,
): DailyIconState {
  if (status === null) return 'offline';
  if (status.claimedToday) return 'hidden';
  return playedToday ? 'ready' : 'locked';
}

/** The claim overlay auto-opens once per local day, only when claimable. */
export function shouldAutoShowPopup(
  state: DailyIconState,
  lastShownDateKey: string | null,
  todayKey: string,
): boolean {
  return state === 'ready' && lastShownDateKey !== todayKey;
}

export type StreakChip = 'done' | 'now' | 'todo';

/** Chip states for the 7-day strip when the player is claiming `nextDay`. */
export function streakChips(nextDay: number): StreakChip[] {
  return Array.from({ length: 7 }, (_, i) =>
    i + 1 < nextDay ? 'done' : i + 1 === nextDay ? 'now' : 'todo');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/__tests__/dailyDropLogic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/dailyDropLogic.ts src/ui/__tests__/dailyDropLogic.test.ts
git commit -m "feat(client): pure Daily Drop icon/popup/streak state logic"
```

---

### Task 9: MenuScene UI — can icon, claim overlay, repair prompt

**Files:**
- Create: `src/ui/DailyDropOverlay.ts`
- Modify: `src/scenes/MenuScene.ts` (setup call at end of `create()`, icon builder, overlay opener)

**Interfaces:**
- Consumes: `fetchDailyStatus`/`claimDaily` (Task 7), `hasPlayedToday`/`deviceUtcOffsetMin` (Task 6), `dailyIconState`/`shouldAutoShowPopup`/`streakChips` (Task 8), `localDateKey` (Task 1), `AdClient.showRewarded(): Promise<boolean>` from `src/systems/ads/AdClient.ts`, `getBalance` (SaveData), `logicalWidth`/`logicalHeight` from `src/systems/displayMetrics.ts`.
- Produces: `openDailyDropOverlay(scene: Phaser.Scene, status: DailyStatusResponse, onClosed: (claimed: boolean) => void): void`

This task has no unit tests (Phaser scene code — the logic underneath was tested in Tasks 7/8). Verification is visual (scene-preview) + build.

- [ ] **Step 1: Create the overlay**

Create `src/ui/DailyDropOverlay.ts`:

```ts
// src/ui/DailyDropOverlay.ts
//
// Daily Drop claim overlay: dimmed backdrop, panel with the 7-day streak
// strip, a procedural trash can that pops open on tap, and the repair prompt
// when the streak broke. All positions are logical-layout coordinates.

import Phaser from 'phaser';
import { logicalWidth, logicalHeight } from '../systems/displayMetrics';
import { claimDaily } from '../systems/DailyDropClient';
import { AdClient } from '../systems/ads/AdClient';
import { streakChips } from './dailyDropLogic';
import type { DailyStatusResponse } from '../../shared/dailyTypes';

const DEPTH = 300;
const ACCENT = 0xff9922;
const ACCENT_DARK = 0xb3650f;
const PANEL = 0x12152e;
const GOLD = 0xffce8a;

export function openDailyDropOverlay(
  scene: Phaser.Scene,
  status: DailyStatusResponse,
  onClosed: (claimed: boolean) => void,
): void {
  const w = logicalWidth(scene);
  const h = logicalHeight(scene);
  const cx = w / 2;
  const root = scene.add.container(0, 0).setDepth(DEPTH);
  let claimed = false;
  let busy = false;

  // Full-screen backdrop; swallows input behind the panel.
  const backdrop = scene.add.rectangle(w / 2, h / 2, w, h, 0x04050c, 0.62)
    .setInteractive();
  root.add(backdrop);

  const close = (): void => { root.destroy(); onClosed(claimed); };
  backdrop.on('pointerup', () => { if (!busy) close(); });

  // Panel.
  const panelTop = h * 0.2;
  const panelH = 340;
  const panel = scene.add.graphics();
  panel.fillStyle(PANEL, 0.97);
  panel.fillRoundedRect(cx - 190, panelTop, 380, panelH, 16);
  panel.lineStyle(2, ACCENT, 0.9);
  panel.strokeRoundedRect(cx - 190, panelTop, 380, panelH, 16);
  root.add(panel);
  // Panel area eats taps so they don't hit the backdrop-dismiss.
  const panelZone = scene.add.zone(cx, panelTop + panelH / 2, 380, panelH).setInteractive();
  root.add(panelZone);

  const day = status.nextClaimDay;
  const title = scene.add.text(cx, panelTop + 30, `DAILY DROP — DAY ${day}`, {
    fontSize: '22px', color: '#ffce8a', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3,
  }).setOrigin(0.5);
  root.add(title);

  // Dismiss ✕.
  const closeBtn = scene.add.text(cx + 165, panelTop + 28, '✕', {
    fontSize: '22px', color: '#9a95a8',
  }).setOrigin(0.5).setInteractive({ useHandCursor: true });
  closeBtn.on('pointerup', () => { if (!busy) close(); });
  root.add(closeBtn);

  // 7-day streak strip.
  const chips = streakChips(day);
  const stripY = panelTop + 70;
  chips.forEach((chip, i) => {
    const x = cx - 132 + i * 44;
    const g = scene.add.graphics();
    const fill = chip === 'done' ? ACCENT_DARK : chip === 'now' ? ACCENT : 0x0e1124;
    g.fillStyle(fill, 1);
    g.fillRoundedRect(x - 16, stripY - 16, 32, 32, 8);
    g.lineStyle(1, 0xffffff, chip === 'now' ? 0.8 : 0.15);
    g.strokeRoundedRect(x - 16, stripY - 16, 32, 32, 8);
    root.add(g);
    const label = chip === 'done' ? '✓' : String(i + 1);
    root.add(scene.add.text(x, stripY, label, {
      fontSize: '14px', color: chip === 'now' ? '#1a0f00' : '#e9e4d8', fontStyle: 'bold',
    }).setOrigin(0.5));
  });

  // Procedural trash can (day 7 goes golden).
  const golden = day === 7;
  const canY = panelTop + 200;
  const can = scene.add.container(cx, canY);
  const body = scene.add.graphics();
  const bodyColor = golden ? GOLD : 0x8d96ad;
  const ridgeColor = golden ? 0xd9a743 : 0x6f7890;
  body.fillStyle(bodyColor, 1);
  body.fillRoundedRect(-34, -30, 68, 62, 6);
  body.fillStyle(ridgeColor, 1);
  for (let i = -22; i <= 22; i += 11) body.fillRect(i - 2, -26, 4, 54);
  const lid = scene.add.graphics();
  lid.fillStyle(golden ? 0xffe1a8 : 0xaab3c9, 1);
  lid.fillRoundedRect(-38, -44, 76, 12, 6);
  lid.fillRoundedRect(-10, -50, 20, 7, 3);
  can.add([body, lid]);
  root.add(can);
  if (golden) {
    const glow = scene.add.graphics();
    glow.fillStyle(ACCENT, 0.18);
    glow.fillCircle(cx, canY, 70);
    root.addAt(glow, root.getIndex(can));
  }

  const hint = scene.add.text(cx, panelTop + 285, 'TAP THE CAN!', {
    fontSize: '15px', color: '#ffce8a', fontStyle: 'bold',
  }).setOrigin(0.5);
  root.add(hint);
  scene.tweens.add({ targets: hint, alpha: 0.4, duration: 700, yoyo: true, repeat: -1 });
  const wiggle = scene.tweens.add({
    targets: can, angle: { from: -2.5, to: 2.5 }, duration: 140,
    yoyo: true, repeat: -1, repeatDelay: 1400,
  });

  const setHint = (msg: string, color = '#e9e4d8'): void => {
    hint.setText(msg).setColor(color);
  };

  const showRewards = (messages: string[], streakDay: number): void => {
    claimed = true;
    wiggle.stop();
    can.setAngle(0);
    // Lid pops off.
    scene.tweens.add({
      targets: lid, angle: -95, x: -46, y: -34, duration: 420, ease: 'Back.easeOut',
    });
    // Coin burst.
    for (let i = 0; i < 8; i++) {
      const coin = scene.add.circle(cx, canY - 34, 6, ACCENT).setStrokeStyle(1, ACCENT_DARK);
      root.add(coin);
      const a = -Math.PI / 2 + (i - 3.5) * 0.32;
      scene.tweens.add({
        targets: coin,
        x: cx + Math.cos(a) * Phaser.Math.Between(50, 90),
        y: canY - 34 + Math.sin(a) * Phaser.Math.Between(60, 100),
        alpha: { from: 1, to: 0.85 },
        duration: 620, ease: 'Cubic.easeOut',
      });
    }
    title.setText(`DAY ${streakDay} CLAIMED!`);
    const lines = messages.join('\n');
    const rewardText = scene.add.text(cx, canY - 96, lines, {
      fontSize: '18px', color: '#ffffff', fontStyle: 'bold', align: 'center',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setAlpha(0);
    root.add(rewardText);
    scene.tweens.add({ targets: rewardText, alpha: 1, y: canY - 108, duration: 350, delay: 250 });
    setHint('TAP ANYWHERE TO CLOSE');
    busy = false;
  };

  const showRepairPrompt = (repairableDay: number): void => {
    setHint(`Streak broken! Keep Day ${repairableDay}?`, '#e08a7a');
    const adBtn = scene.add.text(cx - 80, panelTop + 315, '▶ WATCH AD', {
      fontSize: '15px', color: '#1a0f00', fontStyle: 'bold',
      backgroundColor: '#ff9922', padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    const resetBtn = scene.add.text(cx + 85, panelTop + 315, 'START OVER', {
      fontSize: '15px', color: '#e9e4d8',
      backgroundColor: '#2b2f4a', padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    root.add(adBtn);
    root.add(resetBtn);

    const finish = async (resolution: 'repair' | 'reset'): Promise<void> => {
      busy = true;
      adBtn.destroy(); resetBtn.destroy();
      const out = await claimDaily(resolution);
      if (out.status === 'claimed') showRewards(out.messages, out.streakDay);
      else { setHint('Something went wrong — try again later'); busy = false; }
    };
    adBtn.on('pointerup', async () => {
      if (busy) return;
      busy = true;
      const watched = await AdClient.showRewarded();
      busy = false;
      if (watched) await finish('repair');
      else setHint('Ad unavailable — try again or start over', '#e08a7a');
    });
    resetBtn.on('pointerup', () => { if (!busy) void finish('reset'); });
  };

  // The can is the claim button.
  const canZone = scene.add.zone(cx, canY, 110, 110).setInteractive({ useHandCursor: true });
  root.add(canZone);
  canZone.on('pointerup', async () => {
    if (busy || claimed) return;
    busy = true;
    setHint('…');
    const out = await claimDaily();
    switch (out.status) {
      case 'claimed':      showRewards(out.messages, out.streakDay); break;
      case 'streakBroken': busy = false; showRepairPrompt(out.repairableDay); break;
      case 'notEligible':  busy = false; setHint('Already claimed — come back tomorrow!'); break;
      case 'offline':      busy = false; setHint('Offline — rewards need a connection', '#e08a7a'); break;
      default:             busy = false; setHint('Something went wrong — try again later', '#e08a7a');
    }
  });
}
```

- [ ] **Step 2: Wire into MenuScene**

In `src/scenes/MenuScene.ts`:

Add imports:

```ts
import { fetchDailyStatus } from '../systems/DailyDropClient';
import { hasPlayedToday, deviceUtcOffsetMin } from '../systems/dailyRunGate';
import { dailyIconState, shouldAutoShowPopup, type DailyIconState } from '../ui/dailyDropLogic';
import { openDailyDropOverlay } from '../ui/DailyDropOverlay';
import { localDateKey } from '../../shared/dailyDrop';
import type { DailyStatusResponse } from '../../shared/dailyTypes';
```

Add a field near the other private fields:

```ts
  private dailyCanIcon?: Phaser.GameObjects.Container;
```

Call `void this.setupDailyDrop();` at the end of `create()`.

Add the methods:

```ts
  // ── Daily Drop ─────────────────────────────────────────────────────────────

  private async setupDailyDrop(): Promise<void> {
    const result = await fetchDailyStatus();
    if (!this.scene.isActive()) return; // player already navigated away
    const status = result.status === 'ok' ? result.data : null;
    const played = hasPlayedToday(deviceUtcOffsetMin());
    const state = dailyIconState(status, played);
    if (state === 'hidden') return;

    this.addDailyCanIcon(state, status);

    const POPUP_KEY = 'heap_daily_popup_shown';
    const todayKey = localDateKey(Date.now(), deviceUtcOffsetMin());
    if (status && shouldAutoShowPopup(state, localStorage.getItem(POPUP_KEY), todayKey)) {
      localStorage.setItem(POPUP_KEY, todayKey);
      this.openDaily(status);
    }
  }

  private addDailyCanIcon(state: DailyIconState, status: DailyStatusResponse | null): void {
    const x = 36;
    const y = 96;
    const icon = this.add.container(x, y).setDepth(20);

    const g = this.add.graphics();
    const bodyColor = state === 'ready' ? 0x8d96ad : 0x565d70;
    g.fillStyle(0x0a0c1a, 0.55);
    g.fillRoundedRect(-22, -22, 44, 44, 10);
    g.lineStyle(1, 0xffffff, 0.18);
    g.strokeRoundedRect(-22, -22, 44, 44, 10);
    g.fillStyle(bodyColor, 1);
    g.fillRoundedRect(-9, -6, 18, 18, 3);   // can body
    g.fillRoundedRect(-12, -11, 24, 5, 2);  // lid
    icon.add(g);

    if (state === 'ready') {
      const badge = this.add.circle(16, -16, 8, 0xff9922).setStrokeStyle(1, 0xb3650f);
      const bang = this.add.text(16, -16, '!', {
        fontSize: '12px', color: '#1a0f00', fontStyle: 'bold',
      }).setOrigin(0.5);
      icon.add([badge, bang]);
      this.tweens.add({
        targets: icon, angle: { from: -4, to: 4 }, duration: 130,
        yoyo: true, repeat: -1, repeatDelay: 1600,
      });
    } else if (state === 'locked') {
      const lock = this.add.text(16, -16, '🔒', { fontSize: '12px' }).setOrigin(0.5);
      icon.add(lock);
    } else { // offline
      icon.setAlpha(0.5);
    }

    const zone = this.add.zone(0, 0, 48, 48).setInteractive({ useHandCursor: true });
    icon.add(zone);
    zone.on('pointerup', () => {
      if (state === 'ready' && status) this.openDaily(status);
      else this.showDailyToast(state === 'offline'
        ? 'Offline — rewards need a connection'
        : 'Finish a run to open today\'s drop!');
    });

    this.dailyCanIcon = icon;
  }

  private openDaily(status: DailyStatusResponse): void {
    openDailyDropOverlay(this, status, (claimed) => {
      if (!claimed) return;
      this.dailyCanIcon?.destroy();
      this.dailyCanIcon = undefined;
      if (this.balanceText?.active) this.balanceText.setText(`${getBalance()} coins`);
    });
  }

  private showDailyToast(msg: string): void {
    const t = this.add.text(36, 132, msg, {
      fontSize: '13px', color: '#ffce8a', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0, 0.5).setDepth(21);
    this.tweens.add({ targets: t, alpha: 0, delay: 1800, duration: 400, onComplete: () => t.destroy() });
  }
```

(`getBalance` is already imported by MenuScene.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean TypeScript build, no errors.

- [ ] **Step 4: Visual verification via scene-preview**

Use the `heap-scene-preview` skill (REQUIRED SUB-SKILL for this step) to screenshot `MenuScene` at a phone size and confirm:
- The can icon renders at the top-left without overlapping the title, version text, or any existing button — **nudge `x`/`y` in `addDailyCanIcon` if it collides**.
- Note: the icon only appears when `/daily/status` responds; if the local worker isn't running the icon shows its offline state — that render is still enough to verify placement.

- [ ] **Step 5: Run the full root suite**

Run: `npm test`
Expected: PASS — no regressions (MenuScene isn't unit-tested directly, but imports must not break other suites).

- [ ] **Step 6: Commit**

```bash
git add src/ui/DailyDropOverlay.ts src/scenes/MenuScene.ts
git commit -m "feat(client): Daily Drop menu can icon + claim overlay + repair prompt"
```

---

### Task 10: Full verification + PR

**Files:** none (verification only)

- [ ] **Step 1: Full test suites**

```bash
npm test
cd server && npm test
```

Expected: all green, both suites.

- [ ] **Step 2: Build**

Run: `npm run build` (from root)
Expected: clean.

- [ ] **Step 3: Live smoke test**

Use the `smoke-testing-heap` skill (REQUIRED SUB-SKILL) against the dev server (use the user's server on localhost:3000 if it responds — never kill it) with the local worker running. Verify the loop end-to-end:
1. Fresh menu (no claim row): can icon shows **locked** state; tapping it shows the "finish a run" toast.
2. Play any run to the score screen, return to menu: claim overlay **auto-opens once**; can pops on tap; coins land in the balance text.
3. Re-enter the menu: no icon, no popup (claimed → hidden).
4. `/daily/claim` again via the overlay is impossible; a manual curl returns 409.

- [ ] **Step 4: Update the spec status line**

In `docs/superpowers/specs/2026-07-16-daily-drop-design.md`, change `**Status:** Approved design, pre-implementation` to `**Status:** Implemented (see docs/superpowers/plans/2026-07-16-daily-drop.md)`. Commit:

```bash
git add docs/superpowers/specs/2026-07-16-daily-drop-design.md
git commit -m "docs(spec): mark Daily Drop implemented"
```

- [ ] **Step 5: Open the PR** (only after the user confirms the smoke test looks good — per repo push discipline, don't push mid-verification)

```bash
git push -u origin feature/daily-drop
gh pr create --title "feat: Daily Drop daily reward system" --body "$(cat <<'EOF'
## Summary
- 7-day streak daily reward claimed after the first run of the day (trash-can reveal on the menu)
- Server-authoritative: /daily/status + /daily/claim on player write-auth, daily_claims in heap_rewards (migration 0002)
- Local-calendar-day eligibility with 10h min-gap guardrail; 36h grace; rewarded-ad streak repair
- Reward table + tuning in remote config (daily_rewards, daily_streak_grace_hours, daily_min_gap_hours)

Spec: docs/superpowers/specs/2026-07-16-daily-drop-design.md
Plan: docs/superpowers/plans/2026-07-16-daily-drop.md

## Test plan
- [x] shared dailyDrop unit tests (day derivation, guardrails, streak transitions)
- [x] server route tests (eligibility matrix, repair flow, day-7 dual grant, auth, race)
- [x] client tests (applyReward, run gate, DailyDropClient, icon logic)
- [x] live smoke test of the full first-run → popup → claim loop

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Note: merging to main auto-applies migration 0002 remotely via `migrate-d1.yml`.

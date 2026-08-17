# Admin Shadow Ban Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin hide a player from every other player's leaderboard and silently drop their heap placements, without the player being able to tell.

**Architecture:** A global `player_ban` table in the `heap_scores` D1 database. Every leaderboard read takes an optional `viewerId` and filters with `(ban IS NULL OR s.player_id = ?viewer)`, so a banned player still sees themselves at their true rank while vanishing for everyone else. Placements from a banned player return the `{ accepted: false }` response the client already receives routinely. Admin CRUD lives behind the existing `X-Admin-Secret` gate.

**Tech Stack:** Cloudflare Workers, Hono, D1, Workers KV, TypeScript 5.9, Vitest. Admin UI is standalone static HTML + Tailwind in `admin/index.html`.

**Spec:** `docs/superpowers/specs/2026-08-16-admin-shadow-ban-design.md`

## Global Constraints

- Branch is `feature/admin-shadow-ban`, already created off `main`. Never push directly to `main`; PR before merge.
- **Two-file rule for schema changes:** every migration in `server/migrations/heap_scores/` must be mirrored into `server/schema/heap_scores.sql`. Invoke the `adding-d1-migrations` skill for Task 1.
- Server tests run with `npm test` from `server/` (`cd server && npx vitest run <file>`), client tests with `npm test` from the repo root.
- `npm run build` must pass before the work is called done — it catches TS errors the tests miss.
- Per-player server calls use `getEffectivePlayerId()` from `SaveData`, never bare `getPlayerGuid()`.
- No ban state is ever sent to a game client. The client never learns it is banned.
- Player-id length is validated against `MAX_ID_LEN` from `server/src/constants.ts`, matching every other route.
- Don't commit `.wrangler/state/`.

---

### Task 1: `player_ban` schema and `BanDB`

**Files:**
- Create: `server/migrations/heap_scores/0007_player_ban.sql`
- Modify: `server/schema/heap_scores.sql` (append after the `player_name` block)
- Create: `server/src/banDb.ts`
- Create: `server/tests/helpers/mockBanDb.ts`
- Test: `server/tests/banDb.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `BanRow`, `BanDB`, `D1BanDB` from `server/src/banDb.ts`; `MockBanDB` from `server/tests/helpers/mockBanDb.ts`. Every later task depends on these exact names.

- [ ] **Step 1: Write the failing test**

Create `server/tests/banDb.test.ts`. This tests the in-memory double's contract — the same contract `D1BanDB` implements — so later tasks can trust `MockBanDB` to stand in for D1.

```ts
// server/tests/banDb.test.ts

import { describe, it, expect } from 'vitest';
import { MockBanDB } from './helpers/mockBanDb';

describe('BanDB contract', () => {
  it('isBanned is false for an unknown player', async () => {
    const db = new MockBanDB();
    expect(await db.isBanned('nobody')).toBe(false);
  });

  it('ban then isBanned is true, and get returns the row', async () => {
    const db = new MockBanDB();
    await db.ban('cheater', 'speed hack', '2026-08-16T00:00:00.000Z');
    expect(await db.isBanned('cheater')).toBe(true);
    const row = await db.get('cheater');
    expect(row).toEqual({
      player_id: 'cheater',
      reason:    'speed hack',
      banned_at: '2026-08-16T00:00:00.000Z',
    });
  });

  it('ban is idempotent and overwrites reason and timestamp', async () => {
    const db = new MockBanDB();
    await db.ban('cheater', 'first', '2026-08-16T00:00:00.000Z');
    await db.ban('cheater', 'second', '2026-08-17T00:00:00.000Z');
    expect((await db.list()).length).toBe(1);
    const row = await db.get('cheater');
    expect(row?.reason).toBe('second');
    expect(row?.banned_at).toBe('2026-08-17T00:00:00.000Z');
  });

  it('accepts a null reason', async () => {
    const db = new MockBanDB();
    await db.ban('cheater', null, '2026-08-16T00:00:00.000Z');
    expect((await db.get('cheater'))?.reason).toBeNull();
  });

  it('unban removes the row and is idempotent on an unbanned player', async () => {
    const db = new MockBanDB();
    await db.ban('cheater', null, '2026-08-16T00:00:00.000Z');
    await db.unban('cheater');
    expect(await db.isBanned('cheater')).toBe(false);
    expect(await db.get('cheater')).toBeNull();
    await db.unban('cheater');          // must not throw
    await db.unban('never-banned');     // must not throw
    expect(await db.list()).toEqual([]);
  });

  it('list returns every ban', async () => {
    const db = new MockBanDB();
    await db.ban('a', null, '2026-08-16T00:00:00.000Z');
    await db.ban('b', 'rude', '2026-08-16T00:00:01.000Z');
    expect((await db.list()).map(r => r.player_id).sort()).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/banDb.test.ts`
Expected: FAIL — cannot resolve `./helpers/mockBanDb`.

- [ ] **Step 3: Write the migration**

Create `server/migrations/heap_scores/0007_player_ban.sql`:

```sql
-- Shadow-ban list. A banned player is filtered out of every other player's
-- leaderboard read and has their heap placements silently dropped, while their
-- own client continues to behave exactly as before. Global, not per-heap: the
-- ban outlives score pruning and can pre-date the player's first score.
CREATE TABLE IF NOT EXISTS player_ban (
  player_id TEXT NOT NULL PRIMARY KEY,
  reason    TEXT,
  banned_at TEXT NOT NULL
);
```

- [ ] **Step 4: Mirror the migration into the reference schema**

Append the same `CREATE TABLE` block (comment included) to the end of `server/schema/heap_scores.sql`. The file's own header states it is the final intended state for fresh installs and must be kept in sync with the migrations — this is the two-file rule.

- [ ] **Step 5: Write `BanDB` and `D1BanDB`**

Create `server/src/banDb.ts`:

```ts
// server/src/banDb.ts

export interface BanRow {
  player_id: string;
  reason:    string | null;
  banned_at: string;
}

/**
 * Abstraction over D1 for the player_ban table. Allows MockBanDB in tests.
 *
 * `isBanned` sits on the leaderboard read path — see cache/MemoBanDB.ts, which
 * memoises it per isolate so the hot path does not pay a D1 read per request.
 */
export interface BanDB {
  /** True if this player is shadow-banned. */
  isBanned(playerId: string): Promise<boolean>;
  /** Full ban row, or null if the player is not banned. */
  get(playerId: string): Promise<BanRow | null>;
  /** Every ban, newest first. Admin surface only — never on a player path. */
  list(): Promise<BanRow[]>;
  /** Idempotent upsert; re-banning overwrites reason and banned_at. */
  ban(playerId: string, reason: string | null, now: string): Promise<void>;
  /** Idempotent delete; unbanning an unbanned player is a no-op. */
  unban(playerId: string): Promise<void>;
}

/** Production implementation backed by Cloudflare D1 (heap_scores). */
export class D1BanDB implements BanDB {
  constructor(private d1: D1Database) {}

  async isBanned(playerId: string): Promise<boolean> {
    const row = await this.d1
      .prepare('SELECT 1 AS hit FROM player_ban WHERE player_id=?1')
      .bind(playerId)
      .first<{ hit: number }>();
    return row !== null;
  }

  async get(playerId: string): Promise<BanRow | null> {
    const row = await this.d1
      .prepare('SELECT player_id, reason, banned_at FROM player_ban WHERE player_id=?1')
      .bind(playerId)
      .first<BanRow>();
    return row ?? null;
  }

  async list(): Promise<BanRow[]> {
    const result = await this.d1
      .prepare('SELECT player_id, reason, banned_at FROM player_ban ORDER BY banned_at DESC')
      .all<BanRow>();
    return result.results;
  }

  async ban(playerId: string, reason: string | null, now: string): Promise<void> {
    await this.d1
      .prepare(`
        INSERT INTO player_ban (player_id, reason, banned_at) VALUES (?1, ?2, ?3)
        ON CONFLICT (player_id) DO UPDATE SET reason = ?2, banned_at = ?3
      `)
      .bind(playerId, reason, now)
      .run();
  }

  async unban(playerId: string): Promise<void> {
    await this.d1
      .prepare('DELETE FROM player_ban WHERE player_id=?1')
      .bind(playerId)
      .run();
  }
}
```

- [ ] **Step 6: Write `MockBanDB`**

Create `server/tests/helpers/mockBanDb.ts`:

```ts
import type { BanDB, BanRow } from '../../src/banDb';

/** In-memory BanDB for tests. No D1 or Workers runtime needed. */
export class MockBanDB implements BanDB {
  private rows = new Map<string, BanRow>();

  async isBanned(playerId: string): Promise<boolean> {
    return this.rows.has(playerId);
  }

  async get(playerId: string): Promise<BanRow | null> {
    return this.rows.get(playerId) ?? null;
  }

  async list(): Promise<BanRow[]> {
    return Array.from(this.rows.values())
      .sort((a, b) => b.banned_at.localeCompare(a.banned_at));
  }

  async ban(playerId: string, reason: string | null, now: string): Promise<void> {
    this.rows.set(playerId, { player_id: playerId, reason, banned_at: now });
  }

  async unban(playerId: string): Promise<void> {
    this.rows.delete(playerId);
  }
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd server && npx vitest run tests/banDb.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 8: Apply the migration to the local D1 database**

Run from the repo root:

```bash
npx wrangler d1 execute heap_scores --local --file=server/migrations/heap_scores/0007_player_ban.sql
npx wrangler d1 execute heap_scores --local --command="SELECT name FROM sqlite_master WHERE type='table' AND name='player_ban'"
```

Expected: the second command prints a row containing `player_ban`. If the exact database name or invocation differs, follow the `adding-d1-migrations` skill — it is the authority on how migrations are applied here. Remote apply happens in Task 10, not now.

- [ ] **Step 9: Commit**

```bash
git add server/migrations/heap_scores/0007_player_ban.sql server/schema/heap_scores.sql \
        server/src/banDb.ts server/tests/helpers/mockBanDb.ts server/tests/banDb.test.ts
git commit -m "Add player_ban table and BanDB"
```

---

### Task 2: `MemoBanDB` — per-isolate memo for `isBanned`

**Files:**
- Create: `server/src/cache/MemoBanDB.ts`
- Test: `server/tests/memoBanDb.test.ts`

**Interfaces:**
- Consumes: `BanDB`, `BanRow` from `server/src/banDb.ts`; `MockBanDB` from `server/tests/helpers/mockBanDb.ts`.
- Produces: `MemoBanDB` (class, `implements BanDB`) and `__resetBanMemo(): void` from `server/src/cache/MemoBanDB.ts`. Constructor: `(inner: BanDB, ttlMs?: number, now?: () => number)`.

**Why the memo is module-scope, not instance-scope:** `server/src/index.ts` constructs its DB objects inside `fetch`, i.e. once per request. An instance-level cache would therefore never be reused. Workers reuse *isolates* across requests, so the memo has to live in module scope to buy anything.

- [ ] **Step 1: Write the failing test**

Create `server/tests/memoBanDb.test.ts`:

```ts
// server/tests/memoBanDb.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoBanDB, __resetBanMemo } from '../src/cache/MemoBanDB';
import { MockBanDB } from './helpers/mockBanDb';
import type { BanDB } from '../src/banDb';

/** Wraps a MockBanDB and counts isBanned round-trips. */
class CountingBanDB extends MockBanDB {
  calls = 0;
  async isBanned(playerId: string): Promise<boolean> {
    this.calls++;
    return super.isBanned(playerId);
  }
}

describe('MemoBanDB', () => {
  beforeEach(() => __resetBanMemo());

  it('passes the first lookup through to the inner db', async () => {
    const inner = new CountingBanDB();
    await inner.ban('cheater', null, '2026-08-16T00:00:00.000Z');
    const memo = new MemoBanDB(inner);
    expect(await memo.isBanned('cheater')).toBe(true);
    expect(inner.calls).toBe(1);
  });

  it('serves a repeat lookup from the memo within the TTL', async () => {
    const inner = new CountingBanDB();
    let clock = 1000;
    const memo = new MemoBanDB(inner, 60_000, () => clock);
    await memo.isBanned('someone');
    clock += 59_000;
    await memo.isBanned('someone');
    expect(inner.calls).toBe(1);
  });

  it('memoises a negative result too', async () => {
    const inner = new CountingBanDB();
    const memo = new MemoBanDB(inner);
    expect(await memo.isBanned('clean')).toBe(false);
    expect(await memo.isBanned('clean')).toBe(false);
    expect(inner.calls).toBe(1);
  });

  it('re-reads after the TTL expires', async () => {
    const inner = new CountingBanDB();
    let clock = 1000;
    const memo = new MemoBanDB(inner, 60_000, () => clock);
    await memo.isBanned('someone');
    clock += 60_001;
    await memo.isBanned('someone');
    expect(inner.calls).toBe(2);
  });

  it('ban writes through and drops the stale memo entry', async () => {
    const inner = new CountingBanDB();
    const memo = new MemoBanDB(inner);
    expect(await memo.isBanned('cheater')).toBe(false);   // caches "not banned"
    await memo.ban('cheater', 'aimbot', '2026-08-16T00:00:00.000Z');
    expect(await memo.isBanned('cheater')).toBe(true);    // must not serve the stale false
    expect(await inner.get('cheater')).not.toBeNull();
  });

  it('unban writes through and drops the stale memo entry', async () => {
    const inner = new CountingBanDB();
    await inner.ban('cheater', null, '2026-08-16T00:00:00.000Z');
    const memo = new MemoBanDB(inner);
    expect(await memo.isBanned('cheater')).toBe(true);
    await memo.unban('cheater');
    expect(await memo.isBanned('cheater')).toBe(false);
  });

  it('delegates get and list without memoising them', async () => {
    const inner = new CountingBanDB();
    await inner.ban('cheater', 'aimbot', '2026-08-16T00:00:00.000Z');
    const memo = new MemoBanDB(inner);
    expect((await memo.get('cheater'))?.reason).toBe('aimbot');
    expect((await memo.list()).length).toBe(1);
  });

  it('evicts everything once the memo exceeds its entry cap', async () => {
    const inner = new CountingBanDB();
    const memo = new MemoBanDB(inner);
    for (let i = 0; i < 5001; i++) await memo.isBanned('p' + i);
    const callsBefore = inner.calls;
    await memo.isBanned('p0');            // evicted — must hit the inner db again
    expect(inner.calls).toBe(callsBefore + 1);
  });

  it('shares the memo across instances in the same isolate', async () => {
    const inner = new CountingBanDB();
    await new MemoBanDB(inner).isBanned('someone');
    await new MemoBanDB(inner).isBanned('someone');
    expect(inner.calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/memoBanDb.test.ts`
Expected: FAIL — cannot resolve `../src/cache/MemoBanDB`.

- [ ] **Step 3: Write `MemoBanDB`**

Create `server/src/cache/MemoBanDB.ts`:

```ts
// server/src/cache/MemoBanDB.ts
//
// Per-isolate memo over a BanDB. isBanned() runs on every leaderboard read, so
// without this each read would pay a D1 point lookup. The memo lives in MODULE
// scope, not on the instance: index.ts constructs its DB objects inside fetch()
// (once per request), while Workers reuse isolates across requests — an
// instance-level cache would never be reused.
//
// Staleness: a ban placed on one isolate is invisible to others until their
// entry expires, so a ban takes full effect within TTL_MS. That deliberately
// matches SCORES_TTL in CachedScoreDB, so the two staleness windows are the
// same number and there is one story to tell about how long a ban takes.

import type { BanDB, BanRow } from '../banDb';

const TTL_MS = 60_000;
/** Hard cap so a flood of distinct ids cannot grow the memo without bound. */
const MAX_ENTRIES = 5000;

const memo = new Map<string, { banned: boolean; expiresAt: number }>();

/** Test-only: drop every memoised entry. */
export function __resetBanMemo(): void {
  memo.clear();
}

export class MemoBanDB implements BanDB {
  constructor(
    private inner: BanDB,
    private ttlMs: number = TTL_MS,
    /** Injectable clock — tests advance it instead of sleeping. */
    private now: () => number = () => Date.now(),
  ) {}

  async isBanned(playerId: string): Promise<boolean> {
    const t   = this.now();
    const hit = memo.get(playerId);
    if (hit && hit.expiresAt > t) return hit.banned;

    const banned = await this.inner.isBanned(playerId);
    // Wholesale clear rather than LRU eviction: the working set is tiny in
    // practice, and a periodic cold start costs one D1 read per active player.
    if (memo.size >= MAX_ENTRIES) memo.clear();
    memo.set(playerId, { banned, expiresAt: t + this.ttlMs });
    return banned;
  }

  // Admin-only reads — never memoised, so the admin UI always sees the truth.
  get(playerId: string): Promise<BanRow | null> { return this.inner.get(playerId); }
  list(): Promise<BanRow[]>                     { return this.inner.list(); }

  // Writes go through, then drop the entry so THIS isolate is immediately
  // correct. Other isolates converge within the TTL.
  async ban(playerId: string, reason: string | null, now: string): Promise<void> {
    await this.inner.ban(playerId, reason, now);
    memo.delete(playerId);
  }

  async unban(playerId: string): Promise<void> {
    await this.inner.unban(playerId);
    memo.delete(playerId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/memoBanDb.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/cache/MemoBanDB.ts server/tests/memoBanDb.test.ts
git commit -m "Memoise isBanned per isolate"
```

---

### Task 3: Filter banned players out of `ScoreDB` reads

**Files:**
- Modify: `server/src/scoreDb.ts` (whole file — interface and `D1ScoreDB`)
- Modify: `server/tests/helpers/mockScoreDb.ts`
- Modify: `server/src/cache/CachedScoreDB.ts` (signature pass-through only)
- Modify: `server/tests/cacheDecorators.test.ts` (mechanical — see Step 6)
- Test: `server/tests/scoreBanFilter.test.ts`

**Interfaces:**
- Consumes: `BanDB` from `server/src/banDb.ts`; `MockBanDB` from `server/tests/helpers/mockBanDb.ts`.
- Produces, on `ScoreDB`:
  - `getTopScores(heapId: string, limit: number, viewerId?: string)`
  - `getScoresPaginated(heapId: string, offset: number, limit: number, viewerId?: string)`
  - `countScores(heapId: string, viewerId?: string)`
  - `getRank(heapId: string, score: number, viewerId?: string)`
  - `getPlayerScores(playerId: string)` — signature unchanged; the viewer is always the subject
  - `listScoresForAdmin(heapId: string, offset: number, limit: number): Promise<AdminScoreRow[]>`
  - `countAllScores(heapId: string): Promise<number>`
  - `AdminScoreRow = ScoreRow & { banned: boolean }`
- Also produces on `MockScoreDB`: `attachBanDb(banDb: BanDB): void`.

**The one predicate, used everywhere:**

```sql
LEFT JOIN player_ban b ON b.player_id = s.player_id
WHERE ... AND (b.player_id IS NULL OR s.player_id = ?viewer)
```

`viewerId` defaults to `''`, which matches no player.

- [ ] **Step 1: Write the failing test**

Create `server/tests/scoreBanFilter.test.ts`:

```ts
// server/tests/scoreBanFilter.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockBanDB } from './helpers/mockBanDb';

const HEAP = 'heap-1';

/** Alice 9800, BadGuy 8900 (banned), Carl 8700, Dana 8200. */
async function seeded(): Promise<{ scores: MockScoreDB; bans: MockBanDB }> {
  const scores = new MockScoreDB();
  const bans   = new MockBanDB();
  scores.attachBanDb(bans);
  scores.seed(HEAP, 'alice',  'Alice',  9800);
  scores.seed(HEAP, 'badguy', 'BadGuy', 8900);
  scores.seed(HEAP, 'carl',   'Carl',   8700);
  scores.seed(HEAP, 'dana',   'Dana',   8200);
  await bans.ban('badguy', 'aimbot', '2026-08-16T00:00:00.000Z');
  return { scores, bans };
}

describe('ScoreDB ban filtering', () => {
  it('getTopScores hides a banned player from an ordinary viewer', async () => {
    const { scores } = await seeded();
    const rows = await scores.getTopScores(HEAP, 10, 'carl');
    expect(rows.map(r => r.player_id)).toEqual(['alice', 'carl', 'dana']);
  });

  it('getTopScores hides a banned player when there is no viewer at all', async () => {
    const { scores } = await seeded();
    const rows = await scores.getTopScores(HEAP, 10);
    expect(rows.map(r => r.player_id)).toEqual(['alice', 'carl', 'dana']);
  });

  it('getTopScores keeps the banned player for their own viewer id', async () => {
    const { scores } = await seeded();
    const rows = await scores.getTopScores(HEAP, 10, 'badguy');
    expect(rows.map(r => r.player_id)).toEqual(['alice', 'badguy', 'carl', 'dana']);
  });

  it('getScoresPaginated hides the banned player and does not leave a hole', async () => {
    const { scores } = await seeded();
    const page = await scores.getScoresPaginated(HEAP, 0, 2, 'carl');
    expect(page.map(r => r.player_id)).toEqual(['alice', 'carl']);
  });

  it('getScoresPaginated keeps the banned player for their own viewer id', async () => {
    const { scores } = await seeded();
    const page = await scores.getScoresPaginated(HEAP, 0, 2, 'badguy');
    expect(page.map(r => r.player_id)).toEqual(['alice', 'badguy']);
  });

  it('countScores excludes banned rows, but counts the viewer themselves', async () => {
    const { scores } = await seeded();
    expect(await scores.countScores(HEAP, 'carl')).toBe(3);
    expect(await scores.countScores(HEAP)).toBe(3);
    expect(await scores.countScores(HEAP, 'badguy')).toBe(4);
  });

  it('getRank closes up over a hidden player for everyone else', async () => {
    const { scores } = await seeded();
    // Carl (8700) sits behind Alice and BadGuy, but BadGuy is hidden -> rank 2.
    expect(await scores.getRank(HEAP, 8700, 'carl')).toBe(2);
  });

  it('getRank gives the banned player their original rank', async () => {
    const { scores } = await seeded();
    expect(await scores.getRank(HEAP, 8900, 'badguy')).toBe(2);
  });

  it('getPlayerScores ranks the banned player as if they were visible', async () => {
    const { scores } = await seeded();
    const rows = await scores.getPlayerScores('badguy');
    expect(rows).toEqual([{ heapId: HEAP, name: 'BadGuy', score: 8900, rank: 2 }]);
  });

  it('getPlayerScores hides other banned players from an ordinary player', async () => {
    const { scores } = await seeded();
    const rows = await scores.getPlayerScores('carl');
    expect(rows).toEqual([{ heapId: HEAP, name: 'Carl', score: 8700, rank: 2 }]);
  });

  it('countAllScores and listScoresForAdmin see everything, flagged', async () => {
    const { scores } = await seeded();
    expect(await scores.countAllScores(HEAP)).toBe(4);
    const rows = await scores.listScoresForAdmin(HEAP, 0, 10);
    expect(rows.map(r => r.player_id)).toEqual(['alice', 'badguy', 'carl', 'dana']);
    expect(rows.map(r => r.banned)).toEqual([false, true, false, false]);
  });

  it('unbanning restores the player for everyone', async () => {
    const { scores, bans } = await seeded();
    await bans.unban('badguy');
    const rows = await scores.getTopScores(HEAP, 10, 'carl');
    expect(rows.map(r => r.player_id)).toEqual(['alice', 'badguy', 'carl', 'dana']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/scoreBanFilter.test.ts`
Expected: FAIL — `scores.attachBanDb is not a function`.

- [ ] **Step 3: Update the `ScoreDB` interface**

In `server/src/scoreDb.ts`, add the admin row type below `ScoreRow`:

```ts
/** Admin-surface row: unfiltered, with ban state resolved. */
export type AdminScoreRow = ScoreRow & { banned: boolean };
```

Then change these five members of `interface ScoreDB`, keeping their existing doc comments and appending the note shown:

```ts
  /** Returns top `limit` entries for a heap, ordered by score DESC.
   *  Shadow-banned players are excluded unless they are `viewerId` themselves. */
  getTopScores(heapId: string, limit: number, viewerId?: string): Promise<ScoreRow[]>;

  /**
   * Returns the 1-indexed rank of `score` in `heapId`.
   * Rank = (number of visible rows with score strictly higher) + 1.
   * Shadow-banned players are excluded unless they are `viewerId` themselves,
   * so a hidden player above you does not inflate your rank.
   */
  getRank(heapId: string, score: number, viewerId?: string): Promise<number>;

  /** Returns total number of VISIBLE score rows for a heap — the denominator
   *  the paginated leaderboard shows. See countAllScores for the raw total. */
  countScores(heapId: string, viewerId?: string): Promise<number>;

  /** Returns paginated entries for a heap, ordered by score DESC.
   *  Shadow-banned players are excluded unless they are `viewerId` themselves. */
  getScoresPaginated(heapId: string, offset: number, limit: number, viewerId?: string): Promise<ScoreRow[]>;
```

And add two admin-only members at the end of the interface:

```ts
  /** Admin surface: one page of a heap's scores, unfiltered, ban state resolved. */
  listScoresForAdmin(heapId: string, offset: number, limit: number): Promise<AdminScoreRow[]>;

  /** Admin surface: raw row count for a heap, banned rows included. countScores
   *  is the filtered count and would stop the admin table short of exactly the
   *  rows it exists to show. */
  countAllScores(heapId: string): Promise<number>;
```

`getPlayerScores` keeps its signature; only its doc gains: *"Banned players are excluded from the ranking window, but the subject is always retained even when banned."*

- [ ] **Step 4: Update `D1ScoreDB`**

Replace the bodies of the affected methods in `server/src/scoreDb.ts`. `getScore` and `upsertScore` are unchanged — a banned player still reads and writes their own row.

```ts
  async getTopScores(heapId: string, limit: number, viewerId = ''): Promise<ScoreRow[]> {
    const result = await this.d1
      .prepare(`
        SELECT s.heap_id, s.player_id, s.score, s.created_at, s.updated_at,
               COALESCE(pn.name, 'Anonymous') AS name,
               pc.loadout AS loadout
          FROM score s
          LEFT JOIN player_name pn          ON pn.player_id = s.player_id
          LEFT JOIN player_customization pc ON pc.player_id = s.player_id
          LEFT JOIN player_ban b            ON b.player_id  = s.player_id
         WHERE s.heap_id=?1 AND (b.player_id IS NULL OR s.player_id=?2)
         ORDER BY s.score DESC
         LIMIT ?3
      `)
      .bind(heapId, viewerId, limit)
      .all<ScoreRow>();
    return result.results;
  }

  async getRank(heapId: string, score: number, viewerId = ''): Promise<number> {
    const result = await this.d1
      .prepare(`
        SELECT COUNT(*) as cnt
          FROM score s
          LEFT JOIN player_ban b ON b.player_id = s.player_id
         WHERE s.heap_id=?1 AND s.score>?2 AND (b.player_id IS NULL OR s.player_id=?3)
      `)
      .bind(heapId, score, viewerId)
      .first<{ cnt: number }>();
    return (result?.cnt ?? 0) + 1;
  }

  async countScores(heapId: string, viewerId = ''): Promise<number> {
    const result = await this.d1
      .prepare(`
        SELECT COUNT(*) as cnt
          FROM score s
          LEFT JOIN player_ban b ON b.player_id = s.player_id
         WHERE s.heap_id=?1 AND (b.player_id IS NULL OR s.player_id=?2)
      `)
      .bind(heapId, viewerId)
      .first<{ cnt: number }>();
    return result?.cnt ?? 0;
  }

  async getScoresPaginated(heapId: string, offset: number, limit: number, viewerId = ''): Promise<ScoreRow[]> {
    const result = await this.d1
      .prepare(`
        SELECT s.heap_id, s.player_id, s.score, s.created_at, s.updated_at,
               COALESCE(pn.name, 'Anonymous') AS name,
               pc.loadout AS loadout
          FROM score s
          LEFT JOIN player_name pn          ON pn.player_id = s.player_id
          LEFT JOIN player_customization pc ON pc.player_id = s.player_id
          LEFT JOIN player_ban b            ON b.player_id  = s.player_id
         WHERE s.heap_id=?1 AND (b.player_id IS NULL OR s.player_id=?2)
         ORDER BY s.score DESC
         LIMIT ?3 OFFSET ?4
      `)
      .bind(heapId, viewerId, limit, offset)
      .all<ScoreRow>();
    return result.results;
  }

  async getPlayerScores(playerId: string): Promise<Array<{
    heapId: string; name: string; score: number; rank: number;
  }>> {
    const result = await this.d1
      .prepare(`
        WITH visible AS (
          SELECT s.heap_id, s.player_id, s.score
            FROM score s
            LEFT JOIN player_ban b ON b.player_id = s.player_id
           WHERE b.player_id IS NULL OR s.player_id = ?1
        ),
        ranked AS (
          SELECT heap_id, player_id, score,
                 RANK() OVER (PARTITION BY heap_id ORDER BY score DESC) AS rank
            FROM visible
        )
        SELECT r.heap_id AS heapId, COALESCE(pn.name, 'Anonymous') AS name, r.score, r.rank
          FROM ranked r
          LEFT JOIN player_name pn ON pn.player_id = r.player_id
         WHERE r.player_id = ?1
      `)
      .bind(playerId)
      .all<{ heapId: string; name: string; score: number; rank: number }>();
    return result.results;
  }

  async listScoresForAdmin(heapId: string, offset: number, limit: number): Promise<AdminScoreRow[]> {
    const result = await this.d1
      .prepare(`
        SELECT s.heap_id, s.player_id, s.score, s.created_at, s.updated_at,
               COALESCE(pn.name, 'Anonymous') AS name,
               CASE WHEN b.player_id IS NULL THEN 0 ELSE 1 END AS banned
          FROM score s
          LEFT JOIN player_name pn ON pn.player_id = s.player_id
          LEFT JOIN player_ban b   ON b.player_id  = s.player_id
         WHERE s.heap_id=?1
         ORDER BY s.score DESC
         LIMIT ?2 OFFSET ?3
      `)
      .bind(heapId, limit, offset)
      .all<ScoreRow & { banned: number }>();
    return result.results.map(r => ({ ...r, banned: r.banned === 1 }));
  }

  async countAllScores(heapId: string): Promise<number> {
    const result = await this.d1
      .prepare('SELECT COUNT(*) as cnt FROM score WHERE heap_id=?1')
      .bind(heapId)
      .first<{ cnt: number }>();
    return result?.cnt ?? 0;
  }
```

Add `AdminScoreRow` to the file's existing import/export surface as needed (it is declared in this same file, so only `D1ScoreDB` needs it in scope).

**Do not touch `pruneScores`.** It retains the top 1000 by raw score; a banned player holding one of those slots costs nothing.

- [ ] **Step 5: Update `MockScoreDB`**

In `server/tests/helpers/mockScoreDb.ts`, add the ban source and mirror the filter. Add to the imports:

```ts
import type { BanDB } from '../../src/banDb';
import type { AdminScoreRow } from '../../src/scoreDb';
```

Add the field and attach method next to the existing `nameDb` / `attachNameDb` pair:

```ts
  private banDb: BanDB | null = null;

  /** Wire an external BanDB; mirrors the D1 LEFT JOIN player_ban. */
  attachBanDb(banDb: BanDB): void {
    this.banDb = banDb;
  }

  /** True when this row must be hidden from `viewerId`. Mirrors the SQL
   *  predicate (b.player_id IS NULL OR s.player_id = ?viewer). */
  private async hidden(playerId: string, viewerId: string): Promise<boolean> {
    if (!this.banDb) return false;
    if (playerId === viewerId) return false;
    return this.banDb.isBanned(playerId);
  }

  /** Rows for a heap, banned players filtered out, ordered by score DESC. */
  private async visibleRows(heapId: string, viewerId: string): Promise<ScoreRow[]> {
    const rows = Array.from(this.rows.values()).filter(r => r.heap_id === heapId);
    const keep: ScoreRow[] = [];
    for (const r of rows) {
      if (!(await this.hidden(r.player_id, viewerId))) keep.push(r);
    }
    return keep.sort((a, b) => b.score - a.score);
  }
```

Then replace the read methods:

```ts
  async getTopScores(heapId: string, limit: number, viewerId = ''): Promise<ScoreRow[]> {
    const rows = (await this.visibleRows(heapId, viewerId)).slice(0, limit);
    return Promise.all(rows.map(r => this.withJoins(r)));
  }

  async getRank(heapId: string, score: number, viewerId = ''): Promise<number> {
    const rows = await this.visibleRows(heapId, viewerId);
    return rows.filter(r => r.score > score).length + 1;
  }

  async countScores(heapId: string, viewerId = ''): Promise<number> {
    return (await this.visibleRows(heapId, viewerId)).length;
  }

  async getScoresPaginated(heapId: string, offset: number, limit: number, viewerId = ''): Promise<ScoreRow[]> {
    const rows = (await this.visibleRows(heapId, viewerId)).slice(offset, offset + limit);
    return Promise.all(rows.map(r => this.withJoins(r)));
  }

  async getPlayerScores(playerId: string): Promise<Array<{
    heapId: string; name: string; score: number; rank: number;
  }>> {
    const playerRows = Array.from(this.rows.values()).filter(r => r.player_id === playerId);
    const name = await this.resolveName(playerId);
    const out: Array<{ heapId: string; name: string; score: number; rank: number }> = [];
    for (const r of playerRows) {
      const visible = await this.visibleRows(r.heap_id, playerId);
      const rank = visible.filter(o => o.score > r.score).length + 1;
      out.push({ heapId: r.heap_id, name, score: r.score, rank });
    }
    return out;
  }

  async listScoresForAdmin(heapId: string, offset: number, limit: number): Promise<AdminScoreRow[]> {
    const rows = Array.from(this.rows.values())
      .filter(r => r.heap_id === heapId)
      .sort((a, b) => b.score - a.score)
      .slice(offset, offset + limit);
    return Promise.all(rows.map(async r => ({
      ...(await this.withJoins(r)),
      banned: this.banDb ? await this.banDb.isBanned(r.player_id) : false,
    })));
  }

  async countAllScores(heapId: string): Promise<number> {
    return Array.from(this.rows.values()).filter(r => r.heap_id === heapId).length;
  }
```

`pruneScores` stays exactly as it is.

- [ ] **Step 6: Make `CachedScoreDB` compile and stay correct**

`CachedScoreDB implements ScoreDB`, so it must adopt the new signatures now. This step is a **conservative, correct interim**: any request that names a viewer skips the shared cache. Task 5 narrows that to banned viewers only.

In `server/src/cache/CachedScoreDB.ts`:

```ts
  async getTopScores(heapId: string, limit: number, viewerId = ''): Promise<ScoreRow[]> {
    // Larger-than-cached requests bypass the cache entirely.
    if (limit > CACHE_TOP_N) return this.inner.getTopScores(heapId, limit, viewerId);
    // TEMPORARY (narrowed in the ban-aware cache task): the cached blob is the
    // PUBLIC board, so it cannot serve a viewer who might be banned. Bypassing
    // for every named viewer is correct but pessimistic.
    if (viewerId !== '') return this.inner.getTopScores(heapId, limit, viewerId);

    const key = this.topKey(heapId);
    const hit = await this.safeGet<ScoreRow[]>(key);
    if (hit) return hit.slice(0, limit);

    const top = await this.inner.getTopScores(heapId, CACHE_TOP_N);
    this.waitUntil(this.kv.put(key, JSON.stringify(top), { expirationTtl: SCORES_TTL }));
    return top.slice(0, limit);
  }
```

And forward the viewer on the uncached delegations, plus add the two admin methods:

```ts
  getRank(heapId: string, score: number, viewerId?: string): Promise<number> {
    return this.inner.getRank(heapId, score, viewerId);
  }

  countScores(heapId: string, viewerId?: string): Promise<number> {
    return this.inner.countScores(heapId, viewerId);
  }

  getScoresPaginated(heapId: string, offset: number, limit: number, viewerId?: string): Promise<ScoreRow[]> {
    return this.inner.getScoresPaginated(heapId, offset, limit, viewerId);
  }

  listScoresForAdmin(heapId: string, offset: number, limit: number): Promise<AdminScoreRow[]> {
    return this.inner.listScoresForAdmin(heapId, offset, limit);
  }

  countAllScores(heapId: string): Promise<number> {
    return this.inner.countAllScores(heapId);
  }
```

Update the file's import to `import type { ScoreDB, ScoreRow, AdminScoreRow } from '../scoreDb';`.

`server/tests/cacheDecorators.test.ts` also defines an inline stub implementing `ScoreDB`. If TypeScript now reports it as incomplete, add the two missing methods to that stub returning `[]` and `0`. No behavioural change to those tests.

- [ ] **Step 7: Run the tests**

Run: `cd server && npx vitest run tests/scoreBanFilter.test.ts tests/cacheDecorators.test.ts`
Expected: PASS — 12 new tests, and every existing cache test still green.

- [ ] **Step 8: Verify the real SQL against local D1**

The tests above exercise `MockScoreDB`, not the D1 SQL. Prove the actual query text parses and filters, using the local database:

```bash
npx wrangler d1 execute heap_scores --local --command="
  INSERT OR REPLACE INTO score (heap_id, player_id, score, created_at, updated_at)
    VALUES ('sqlcheck','alice',9800,'t','t'), ('sqlcheck','badguy',8900,'t','t');
  INSERT OR REPLACE INTO player_ban (player_id, reason, banned_at) VALUES ('badguy','test','t');"

# viewer = carl -> alice only
npx wrangler d1 execute heap_scores --local --command="
  SELECT s.player_id FROM score s
    LEFT JOIN player_ban b ON b.player_id = s.player_id
   WHERE s.heap_id='sqlcheck' AND (b.player_id IS NULL OR s.player_id='carl')
   ORDER BY s.score DESC"

# viewer = badguy -> alice AND badguy
npx wrangler d1 execute heap_scores --local --command="
  SELECT s.player_id FROM score s
    LEFT JOIN player_ban b ON b.player_id = s.player_id
   WHERE s.heap_id='sqlcheck' AND (b.player_id IS NULL OR s.player_id='badguy')
   ORDER BY s.score DESC"

# clean up
npx wrangler d1 execute heap_scores --local --command="
  DELETE FROM score WHERE heap_id='sqlcheck';
  DELETE FROM player_ban WHERE player_id='badguy';"
```

Expected: the first select returns `alice` only; the second returns `alice` and `badguy`.

- [ ] **Step 9: Commit**

```bash
git add server/src/scoreDb.ts server/tests/helpers/mockScoreDb.ts \
        server/src/cache/CachedScoreDB.ts server/tests/cacheDecorators.test.ts \
        server/tests/scoreBanFilter.test.ts
git commit -m "Filter banned players out of leaderboard reads"
```

---

### Task 4: Thread the viewer through the score routes, and add the admin scores list

**Files:**
- Modify: `server/src/routes/scores.ts`
- Modify: `server/src/app.ts` (one `adminGate` line)
- Test: `server/tests/scoreBanRoutes.test.ts`

**Interfaces:**
- Consumes: everything from Task 3.
- Produces: `GET /scores/:heapId?playerId=` and `GET /scores/:heapId/context?playerId=` honouring the filter; `GET /scores/admin/:heapId?page&limit` returning `{ entries: Array<{ rank, playerId, name, score, banned }>, total, page }`.

- [ ] **Step 1: Write the failing test**

Create `server/tests/scoreBanRoutes.test.ts`:

```ts
// server/tests/scoreBanRoutes.test.ts

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockBanDB } from './helpers/mockBanDb';
import type {
  PaginatedLeaderboardResponse,
  LeaderboardContext,
  SubmitScoreResponse,
} from '../../shared/scoreTypes';

const HEAP = 'heap-1';

async function makeApp() {
  const scores = new MockScoreDB();
  const bans   = new MockBanDB();
  scores.attachBanDb(bans);
  scores.seed(HEAP, 'alice',  'Alice',  9800);
  scores.seed(HEAP, 'badguy', 'BadGuy', 8900);
  scores.seed(HEAP, 'carl',   'Carl',   8700);
  await bans.ban('badguy', 'aimbot', '2026-08-16T00:00:00.000Z');
  const app = createApp(new MockHeapDB(), scores, { banDb: bans });
  return { app, scores, bans };
}

describe('GET /scores/:heapId with ban filtering', () => {
  it('hides a banned player from an ordinary viewer and fixes the total', async () => {
    const { app } = await makeApp();
    const res = await app.request(`/scores/${HEAP}?playerId=carl`);
    expect(res.status).toBe(200);
    const body = await res.json() as PaginatedLeaderboardResponse;
    expect(body.entries.map(e => e.playerId)).toEqual(['alice', 'carl']);
    expect(body.total).toBe(2);
  });

  it('hides a banned player when no viewer is supplied', async () => {
    const { app } = await makeApp();
    const res = await app.request(`/scores/${HEAP}`);
    const body = await res.json() as PaginatedLeaderboardResponse;
    expect(body.entries.map(e => e.playerId)).toEqual(['alice', 'carl']);
  });

  it('shows the banned player to themselves, at their true rank', async () => {
    const { app } = await makeApp();
    const res = await app.request(`/scores/${HEAP}?playerId=badguy`);
    const body = await res.json() as PaginatedLeaderboardResponse;
    expect(body.entries.map(e => e.playerId)).toEqual(['alice', 'badguy', 'carl']);
    expect(body.entries.map(e => e.rank)).toEqual([1, 2, 3]);
    expect(body.total).toBe(3);
  });

  it('ranks close up for an ordinary viewer', async () => {
    const { app } = await makeApp();
    const res = await app.request(`/scores/${HEAP}?playerId=carl`);
    const body = await res.json() as PaginatedLeaderboardResponse;
    expect(body.entries.find(e => e.playerId === 'carl')?.rank).toBe(2);
  });
});

describe('GET /scores/:heapId/context with ban filtering', () => {
  it('hides the banned player from another player’s top list', async () => {
    const { app } = await makeApp();
    const res = await app.request(`/scores/${HEAP}/context?playerId=carl&limit=10`);
    const body = await res.json() as LeaderboardContext;
    expect(body.top.map(e => e.playerId)).toEqual(['alice', 'carl']);
    expect(body.player?.rank).toBe(2);
  });

  it('keeps the banned player in their own top list with their original rank', async () => {
    const { app } = await makeApp();
    const res = await app.request(`/scores/${HEAP}/context?playerId=badguy&limit=10`);
    const body = await res.json() as LeaderboardContext;
    expect(body.top.map(e => e.playerId)).toEqual(['alice', 'badguy', 'carl']);
    expect(body.player?.rank).toBe(2);
  });
});

describe('GET /scores/admin/:heapId', () => {
  it('401s without the admin secret when one is configured', async () => {
    const { scores, bans } = await makeApp();
    const app = createApp(new MockHeapDB(), scores, { banDb: bans, adminSecret: 's3cret' });
    const res = await app.request(`/scores/admin/${HEAP}`);
    expect(res.status).toBe(401);
  });

  it('returns every row, banned ones flagged, with the raw total', async () => {
    const { scores, bans } = await makeApp();
    const app = createApp(new MockHeapDB(), scores, { banDb: bans, adminSecret: 's3cret' });
    const res = await app.request(`/scores/admin/${HEAP}`, {
      headers: { 'X-Admin-Secret': 's3cret' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      entries: Array<{ rank: number; playerId: string; name: string; score: number; banned: boolean }>;
      total: number; page: number;
    };
    expect(body.entries.map(e => e.playerId)).toEqual(['alice', 'badguy', 'carl']);
    expect(body.entries.map(e => e.banned)).toEqual([false, true, false]);
    expect(body.total).toBe(3);
    expect(body.page).toBe(0);
  });

  it('paginates', async () => {
    const { scores, bans } = await makeApp();
    const app = createApp(new MockHeapDB(), scores, { banDb: bans, adminSecret: 's3cret' });
    const res = await app.request(`/scores/admin/${HEAP}?page=1&limit=2`, {
      headers: { 'X-Admin-Secret': 's3cret' },
    });
    const body = await res.json() as { entries: Array<{ playerId: string; rank: number }> };
    expect(body.entries.map(e => e.playerId)).toEqual(['carl']);
    expect(body.entries[0].rank).toBe(3);
  });
});

// Submission must be completely unaffected — a 4xx or a missing row here is the
// loudest possible tell that a player has been banned. Fixture mirrors
// server/tests/scores.test.ts.
describe('POST /scores from a banned player', () => {
  const SUBMIT_HEAP = 'heap-test-001';

  function submitBody(playerId: string, baseHeightPx: number) {
    return JSON.stringify({
      heapId:     SUBMIT_HEAP,
      playerId,
      playerName: 'Trashbag#00001',
      inputs: {
        baseHeightPx,
        kills:     { percher: 0, ghost: 0 },
        elapsedMs: 60_000,
        isFailure: true,
      },
    });
  }

  async function submitApp() {
    const scores = new MockScoreDB();
    const bans   = new MockBanDB();
    scores.attachBanDb(bans);
    const heapDb = new MockHeapDB();
    heapDb.seedHeap(SUBMIT_HEAP, 1, []);
    await bans.ban('badguy', 'aimbot', '2026-08-16T00:00:00.000Z');
    return { app: createApp(heapDb, scores, { banDb: bans }), scores, bans };
  }

  it('returns 200 and records the score exactly as for a clean player', async () => {
    const { app, scores } = await submitApp();
    const res = await app.request('/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: submitBody('badguy', 1500),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as SubmitScoreResponse;
    expect(body.submitted).toBe(true);
    expect(await scores.getScore(SUBMIT_HEAP, 'badguy')).not.toBeNull();
  });

  it('returns a context in which the banned player can see themselves', async () => {
    const { app, scores } = await submitApp();
    scores.seed(SUBMIT_HEAP, 'alice', 'Alice', 9800);
    const res = await app.request('/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: submitBody('badguy', 1500),
    });
    const body = await res.json() as SubmitScoreResponse;
    expect(body.context.top.map(e => e.playerId)).toContain('badguy');
    expect(body.context.player).not.toBeNull();
  });

  it('hides the banned player from another player’s submit context', async () => {
    const { app, scores } = await submitApp();
    scores.seed(SUBMIT_HEAP, 'badguy', 'BadGuy', 9800);
    const res = await app.request('/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: submitBody('alice', 1500),
    });
    const body = await res.json() as SubmitScoreResponse;
    expect(body.context.top.map(e => e.playerId)).not.toContain('badguy');
  });
});
```

Note: `createApp(..., { banDb })` does not exist yet — it is added in Task 6. For **this** task, add `banDb?: BanDB` to `AppOptions` in `server/src/app.ts` as an unused field so these tests compile; Task 6 wires it to the `/bans` routes.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/scoreBanRoutes.test.ts`
Expected: FAIL — `/scores/admin/:heapId` 404s, and the banned player still appears for other viewers.

- [ ] **Step 3: Thread the viewer through `buildContext`**

In `server/src/routes/scores.ts`, `buildContext` already receives `playerId` — pass it to both reads:

```ts
async function buildContext(
  scoreDb:  ScoreDB,
  heapId:   string,
  playerId: string,
  limit:    number,
): Promise<LeaderboardContext> {
  // playerId doubles as the viewer: a shadow-banned player still sees
  // themselves on their own board, at the rank they would have had.
  const [topRows, playerRow] = await Promise.all([
    scoreDb.getTopScores(heapId, limit, playerId),
    scoreDb.getScore(heapId, playerId),
  ]);
  const top: LeaderboardEntry[] = topRows.map((row, i) => ({
    rank:     i + 1,
    playerId: row.player_id,
    name:     row.name,
    score:    row.score,
    loadout:  parseLoadout(row.loadout),
  }));
  if (!playerRow) return { top, player: null };

  const rank: number = await scoreDb.getRank(heapId, playerRow.score, playerId);
  const player: LeaderboardEntry = {
    rank,
    playerId: playerRow.player_id,
    name:     playerRow.name,
    score:    playerRow.score,
  };
  return { top, player };
}
```

- [ ] **Step 4: Add the viewer to the paginated route**

Replace the `GET /:heapId` handler body's read pair:

```ts
  // GET /scores/:heapId — paginated full leaderboard
  app.get('/:heapId', async (c) => {
    const heapId   = c.req.param('heapId');
    // Optional viewer. Shadow-banned players are filtered out for everyone
    // except themselves, so their own board looks untouched.
    const viewerId = c.req.query('playerId') ?? '';
    const page     = parseInt(c.req.query('page') ?? '0') || 0;
    const limit    = Math.min(
      parseInt(c.req.query('limit') ?? String(MAX_LIMIT)) || MAX_LIMIT,
      MAX_LIMIT,
    );
    const offset = page * limit;

    const [rows, total] = await Promise.all([
      scoreDb.getScoresPaginated(heapId, offset, limit, viewerId),
      scoreDb.countScores(heapId, viewerId),
    ]);
```

The rest of the handler (the `entries` map and the response) is unchanged.

- [ ] **Step 5: Add the admin scores route**

Add this handler to `server/src/routes/scores.ts` **immediately before** the `GET /player/:playerId` handler, so it is registered ahead of `/:heapId` and `/:heapId/context` — the same ordering hazard already flagged in this file:

```ts
  // GET /scores/admin/:heapId — unfiltered page for the admin UI, ban state
  // resolved per row. Registered before /:heapId so "admin" is never parsed as
  // a heapId. Admin-gated in app.ts.
  app.get('/admin/:heapId', async (c) => {
    const heapId = c.req.param('heapId');
    const page   = parseInt(c.req.query('page') ?? '0') || 0;
    const limit  = Math.min(
      parseInt(c.req.query('limit') ?? String(MAX_LIMIT)) || MAX_LIMIT,
      MAX_LIMIT,
    );
    const offset = page * limit;

    const [rows, total] = await Promise.all([
      scoreDb.listScoresForAdmin(heapId, offset, limit),
      scoreDb.countAllScores(heapId),
    ]);

    const entries = rows.map((row, i) => ({
      rank:     offset + i + 1,
      playerId: row.player_id,
      name:     row.name,
      score:    row.score,
      banned:   row.banned,
    }));

    return c.json({ entries, total, page });
  });
```

- [ ] **Step 6: Gate it in `app.ts`**

Add one line to the `adminGate` block in `server/src/app.ts`, below `app.delete('/heaps/:id', adminGate);`:

```ts
  app.get   ('/scores/admin/:heapId',   adminGate);
```

Also add the unused option to `AppOptions` (wired in Task 6), with its import:

```ts
import type { BanDB } from './banDb';
```

```ts
  /** Shadow-ban list (player_ban in heap_scores). If unset, /bans is not mounted
   *  and placements are never silently dropped. */
  banDb?: BanDB;
```

- [ ] **Step 7: Run the tests**

Run: `cd server && npx vitest run tests/scoreBanRoutes.test.ts tests/routes.test.ts tests/scores.test.ts`
Expected: PASS — 12 new tests, existing route and score tests still green.

- [ ] **Step 8: Commit**

```bash
git add server/src/routes/scores.ts server/src/app.ts server/tests/scoreBanRoutes.test.ts
git commit -m "Thread viewer id through score routes and add admin scores list"
```

---

### Task 5: Make the KV cache ban-aware

**Files:**
- Modify: `server/src/cache/CachedScoreDB.ts`
- Modify: `server/src/index.ts`
- Modify: `server/tests/cacheDecorators.test.ts` (11 construction sites)
- Test: `server/tests/cachedScoreBan.test.ts`

**Interfaces:**
- Consumes: `MemoBanDB`, `__resetBanMemo` (Task 2); `MockBanDB` (Task 1).
- Produces: `CachedScoreDB` constructor becomes `(inner: ScoreDB, kv: KVNamespace, waitUntil: (p: Promise<unknown>) => void, banDb: BanDB, sink?: Sink)` — `banDb` is **required**, inserted before the optional `sink`.

This replaces Task 3's pessimistic "bypass for any viewer" with "bypass only for a viewer who is actually banned", restoring the cache for ordinary players.

- [ ] **Step 1: Write the failing test**

Create `server/tests/cachedScoreBan.test.ts`. Reuse the KV fake already present in `server/tests/cacheDecorators.test.ts` — read that file first and import or mirror its helper (`kv.asKV()`, `noWait`) rather than inventing a second one.

```ts
// server/tests/cachedScoreBan.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { CachedScoreDB } from '../src/cache/CachedScoreDB';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockBanDB } from './helpers/mockBanDb';
import { __resetBanMemo } from '../src/cache/MemoBanDB';

// Mirror the KV fake used in cacheDecorators.test.ts.
function fakeKv() {
  const store = new Map<string, string>();
  let gets = 0;
  return {
    store,
    get gets() { return gets; },
    asKV(): KVNamespace {
      return {
        get: async (key: string) => { gets++; const v = store.get(key); return v ? JSON.parse(v) : null; },
        put: async (key: string, val: string) => { store.set(key, val); },
        delete: async (key: string) => { store.delete(key); },
      } as unknown as KVNamespace;
    },
  };
}
const noWait = (p: Promise<unknown>) => { void p; };

const HEAP = 'heap-1';

function seeded() {
  const scores = new MockScoreDB();
  const bans   = new MockBanDB();
  scores.attachBanDb(bans);
  scores.seed(HEAP, 'alice',  'Alice',  9800);
  scores.seed(HEAP, 'badguy', 'BadGuy', 8900);
  scores.seed(HEAP, 'carl',   'Carl',   8700);
  return { scores, bans };
}

describe('CachedScoreDB ban awareness', () => {
  beforeEach(() => __resetBanMemo());

  it('serves an ordinary viewer from the shared cache', async () => {
    const { scores, bans } = seeded();
    const kv = fakeKv();
    const cached = new CachedScoreDB(scores, kv.asKV(), noWait, bans);
    await cached.getTopScores(HEAP, 10, 'carl');       // populates
    const rows = await cached.getTopScores(HEAP, 10, 'carl');
    expect(rows.map(r => r.player_id)).toEqual(['alice', 'badguy', 'carl']);
    expect(kv.store.size).toBe(1);                     // the public blob exists
  });

  it('a banned viewer bypasses the cache and sees themselves', async () => {
    const { scores, bans } = seeded();
    await bans.ban('badguy', 'aimbot', '2026-08-16T00:00:00.000Z');
    const kv = fakeKv();
    const cached = new CachedScoreDB(scores, kv.asKV(), noWait, bans);
    // Warm the public blob from an ordinary viewer first.
    await cached.getTopScores(HEAP, 10, 'carl');
    const rows = await cached.getTopScores(HEAP, 10, 'badguy');
    expect(rows.map(r => r.player_id)).toEqual(['alice', 'badguy', 'carl']);
  });

  it('the cached public blob never contains a banned player', async () => {
    const { scores, bans } = seeded();
    await bans.ban('badguy', 'aimbot', '2026-08-16T00:00:00.000Z');
    const kv = fakeKv();
    const cached = new CachedScoreDB(scores, kv.asKV(), noWait, bans);
    const rows = await cached.getTopScores(HEAP, 10, 'carl');
    expect(rows.map(r => r.player_id)).toEqual(['alice', 'carl']);
  });

  it('an anonymous read still uses the cache', async () => {
    const { scores, bans } = seeded();
    const kv = fakeKv();
    const cached = new CachedScoreDB(scores, kv.asKV(), noWait, bans);
    await cached.getTopScores(HEAP, 10);
    expect(kv.store.size).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/cachedScoreBan.test.ts`
Expected: FAIL — `CachedScoreDB` takes 4 args with `sink` in position 4, and a banned viewer currently bypasses via the Task 3 interim rule (the third test may pass by accident; the first and second will not).

- [ ] **Step 3: Add the `banDb` dependency and narrow the bypass**

In `server/src/cache/CachedScoreDB.ts`, change the constructor and `getTopScores`:

```ts
  constructor(
    private inner: ScoreDB,
    private kv: KVNamespace,
    private waitUntil: (p: Promise<unknown>) => void,
    /** Required, not optional: the cached blob is the PUBLIC board, so without a
     *  ban source this decorator would serve it to a banned viewer and silently
     *  break the illusion their client depends on. */
    private banDb: BanDB,
    /** Optional telemetry sink — see CachedHeapDB for rationale. Optional so
     *  tests can construct this class directly. */
    private sink?: Sink,
  ) {}
```

```ts
  async getTopScores(heapId: string, limit: number, viewerId = ''): Promise<ScoreRow[]> {
    // Larger-than-cached requests bypass the cache entirely.
    if (limit > CACHE_TOP_N) return this.inner.getTopScores(heapId, limit, viewerId);

    // The cached blob is the PUBLIC board — every shadow-banned player is
    // already filtered out of it. Only a viewer who is themselves banned needs
    // a different result set, so only they pay for a D1 read. isBanned is
    // memoised per isolate (MemoBanDB), so this costs no round trip in the
    // common case.
    if (viewerId !== '' && await this.banDb.isBanned(viewerId)) {
      return this.inner.getTopScores(heapId, limit, viewerId);
    }

    const key = this.topKey(heapId);
    const hit = await this.safeGet<ScoreRow[]>(key);
    if (hit) return hit.slice(0, limit);

    const top = await this.inner.getTopScores(heapId, CACHE_TOP_N);
    this.waitUntil(this.kv.put(key, JSON.stringify(top), { expirationTtl: SCORES_TTL }));
    return top.slice(0, limit);
  }
```

Add `import type { BanDB } from '../banDb';`.

Add a note above the class documenting that ban and unban need no cache invalidation:

```ts
// Ban/unban deliberately does NOT bust this cache. The blob carries a 60s
// expirationTtl (SCORES_TTL), so a newly banned player disappears from every
// public board within a minute on its own. Fanning a KV delete out across every
// heap on each ban would spend the tightest Cloudflare quota (deletes) to buy
// less than a minute.
```

- [ ] **Step 4: Update the 11 construction sites in the cache tests**

In `server/tests/cacheDecorators.test.ts`, add near the top:

```ts
import { MockBanDB } from './helpers/mockBanDb';
```

Then update every `new CachedScoreDB(...)` call to pass a fresh `MockBanDB` in the new fourth position:

- `new CachedScoreDB(inner, kv.asKV(), noWait)` → `new CachedScoreDB(inner, kv.asKV(), noWait, new MockBanDB())`
- `new CachedScoreDB(inner, kv.asKV(), noWait, sink)` → `new CachedScoreDB(inner, kv.asKV(), noWait, new MockBanDB(), sink)`

There are 11 sites (lines ~160, 321, 405, 506, 519, 534, 548, 561, 574, 585, 599). No assertions change.

- [ ] **Step 5: Wire the real thing in `index.ts`**

In `server/src/index.ts`, add the imports and construct the ban DB before `scoreDb`, then pass it in:

```ts
import { D1BanDB } from './banDb';
import { MemoBanDB } from './cache/MemoBanDB';
```

```ts
    // Ban lookups ride the leaderboard read path, so they get a per-isolate memo
    // rather than a KV decorator — see cache/MemoBanDB.ts.
    const banDb    = new MemoBanDB(new D1BanDB(env.DB_SCORES));
    const heapDb   = new CachedHeapDB(new D1HeapDB(env.DB_HEAP), env.CACHE, w, logSink);
    const scoreDb  = new CachedScoreDB(new D1ScoreDB(env.DB_SCORES), env.CACHE, w, banDb, logSink);
```

and add `banDb,` to the `createApp` options object (alongside `playerNameDb`).

- [ ] **Step 6: Run the tests**

Run: `cd server && npx vitest run tests/cachedScoreBan.test.ts tests/cacheDecorators.test.ts`
Expected: PASS — 4 new tests, all existing cache tests green.

- [ ] **Step 7: Commit**

```bash
git add server/src/cache/CachedScoreDB.ts server/src/index.ts \
        server/tests/cacheDecorators.test.ts server/tests/cachedScoreBan.test.ts
git commit -m "Bypass the leaderboard cache only for banned viewers"
```

---

### Task 6: Admin ban routes

**Files:**
- Create: `server/src/routes/bans.ts`
- Modify: `server/src/app.ts`
- Test: `server/tests/bansRoutes.test.ts`

**Interfaces:**
- Consumes: `BanDB` (Task 1), `ScoreDB` (Task 3), `PlayerNameDB`, `MAX_ID_LEN` from `server/src/constants.ts`.
- Produces: `banRoutes(banDb: BanDB, scoreDb: ScoreDB, nameDb?: PlayerNameDB): Hono`, mounted at `/bans`.

- [ ] **Step 1: Write the failing test**

Create `server/tests/bansRoutes.test.ts`:

```ts
// server/tests/bansRoutes.test.ts

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockBanDB } from './helpers/mockBanDb';

const SECRET = 's3cret';
const HEAP = 'heap-1';
const AUTH = { 'X-Admin-Secret': SECRET, 'Content-Type': 'application/json' };

function makeApp() {
  const scores = new MockScoreDB();
  const bans   = new MockBanDB();
  scores.attachBanDb(bans);
  scores.seed(HEAP, 'alice',  'Alice',  9800);
  scores.seed(HEAP, 'badguy', 'BadGuy', 8900);
  const app = createApp(new MockHeapDB(), scores, { banDb: bans, adminSecret: SECRET });
  return { app, scores, bans };
}

describe('ban admin routes', () => {
  it('401s every route without the admin secret', async () => {
    const { app } = makeApp();
    expect((await app.request('/bans')).status).toBe(401);
    expect((await app.request('/bans/badguy')).status).toBe(401);
    expect((await app.request('/bans/badguy', { method: 'PUT', body: '{}' })).status).toBe(401);
    expect((await app.request('/bans/badguy', { method: 'DELETE' })).status).toBe(401);
  });

  it('PUT bans a player with a reason', async () => {
    const { app, bans } = makeApp();
    const res = await app.request('/bans/badguy', {
      method: 'PUT', headers: AUTH, body: JSON.stringify({ reason: 'aimbot' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, banned: true });
    expect(await bans.isBanned('badguy')).toBe(true);
    expect((await bans.get('badguy'))?.reason).toBe('aimbot');
  });

  it('PUT with no body bans with a null reason', async () => {
    const { app, bans } = makeApp();
    const res = await app.request('/bans/badguy', { method: 'PUT', headers: AUTH });
    expect(res.status).toBe(200);
    expect((await bans.get('badguy'))?.reason).toBeNull();
  });

  it('PUT is idempotent', async () => {
    const { app, bans } = makeApp();
    await app.request('/bans/badguy', { method: 'PUT', headers: AUTH, body: JSON.stringify({ reason: 'a' }) });
    await app.request('/bans/badguy', { method: 'PUT', headers: AUTH, body: JSON.stringify({ reason: 'b' }) });
    expect((await bans.list()).length).toBe(1);
    expect((await bans.get('badguy'))?.reason).toBe('b');
  });

  it('DELETE unbans, and is idempotent on an unbanned player', async () => {
    const { app, bans } = makeApp();
    await bans.ban('badguy', null, '2026-08-16T00:00:00.000Z');
    const res = await app.request('/bans/badguy', { method: 'DELETE', headers: AUTH });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, banned: false });
    expect(await bans.isBanned('badguy')).toBe(false);
    expect((await app.request('/bans/badguy', { method: 'DELETE', headers: AUTH })).status).toBe(200);
  });

  it('GET /bans lists every ban', async () => {
    const { app, bans } = makeApp();
    await bans.ban('badguy', 'aimbot', '2026-08-16T00:00:00.000Z');
    const res = await app.request('/bans', { headers: AUTH });
    const body = await res.json() as { bans: Array<{ player_id: string; reason: string | null }> };
    expect(body.bans.map(b => b.player_id)).toEqual(['badguy']);
    expect(body.bans[0].reason).toBe('aimbot');
  });

  it('GET /bans/:playerId reports a banned player with name and scores', async () => {
    const { app, bans } = makeApp();
    await bans.ban('badguy', 'aimbot', '2026-08-16T00:00:00.000Z');
    const res = await app.request('/bans/badguy', { headers: AUTH });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      playerId: string; name: string; banned: boolean;
      bannedAt: string | null; reason: string | null;
      scores: Array<{ heapId: string; score: number; rank: number }>;
    };
    expect(body.playerId).toBe('badguy');
    expect(body.name).toBe('BadGuy');
    expect(body.banned).toBe(true);
    expect(body.reason).toBe('aimbot');
    expect(body.bannedAt).toBe('2026-08-16T00:00:00.000Z');
    expect(body.scores).toEqual([{ heapId: HEAP, score: 8900, rank: 2 }]);
  });

  it('GET /bans/:playerId reports an unbanned player', async () => {
    const { app } = makeApp();
    const res = await app.request('/bans/alice', { headers: AUTH });
    const body = await res.json() as { banned: boolean; reason: string | null; bannedAt: string | null };
    expect(body.banned).toBe(false);
    expect(body.reason).toBeNull();
    expect(body.bannedAt).toBeNull();
  });

  it('GET /bans/:playerId works for a player with no scores at all', async () => {
    const { app } = makeApp();
    const res = await app.request('/bans/ghost-id', { headers: AUTH });
    expect(res.status).toBe(200);
    const body = await res.json() as { name: string; scores: unknown[] };
    expect(body.scores).toEqual([]);
    expect(body.name).toBe('Anonymous');
  });

  it('rejects an over-long player id', async () => {
    const { app } = makeApp();
    const long = 'x'.repeat(300);
    const res = await app.request(`/bans/${long}`, { method: 'PUT', headers: AUTH });
    expect(res.status).toBe(400);
  });

  it('is not mounted when banDb is absent', async () => {
    const app = createApp(new MockHeapDB(), new MockScoreDB(), { adminSecret: SECRET });
    expect((await app.request('/bans', { headers: AUTH })).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/bansRoutes.test.ts`
Expected: FAIL — every `/bans` request 404s.

- [ ] **Step 3: Write the routes**

Create `server/src/routes/bans.ts`:

```ts
// server/src/routes/bans.ts

import { Hono } from 'hono';
import type { BanDB } from '../banDb';
import type { ScoreDB } from '../scoreDb';
import type { PlayerNameDB } from '../playerNameDb';
import { MAX_ID_LEN } from '../constants';

/**
 * Admin-only shadow-ban surface (adminGate applied in app.ts).
 *
 * Nothing here is ever reachable by a game client, and no player-facing
 * response anywhere in the API reveals ban state — that is the whole point of a
 * shadow ban.
 */
export function banRoutes(banDb: BanDB, scoreDb: ScoreDB, nameDb?: PlayerNameDB): Hono {
  const app = new Hono();

  /** Shared id guard — same bound every other route applies. */
  function badId(playerId: string): boolean {
    return playerId.length === 0 || playerId.length > MAX_ID_LEN;
  }

  // GET /bans — every ban, newest first.
  app.get('/', async (c) => {
    return c.json({ bans: await banDb.list() });
  });

  // GET /bans/:playerId — status plus enough context to judge: who they are and
  // what they have scored. One request answers the whole question.
  app.get('/:playerId', async (c) => {
    const playerId = c.req.param('playerId');
    if (badId(playerId)) return c.json({ error: 'invalid player id' }, 400);

    const [row, scores, name] = await Promise.all([
      banDb.get(playerId),
      scoreDb.getPlayerScores(playerId),
      nameDb ? nameDb.getName(playerId) : Promise.resolve(null),
    ]);

    return c.json({
      playerId,
      name:     name ?? scores[0]?.name ?? 'Anonymous',
      banned:   row !== null,
      bannedAt: row?.banned_at ?? null,
      reason:   row?.reason ?? null,
      scores:   scores.map(s => ({ heapId: s.heapId, score: s.score, rank: s.rank })),
    });
  });

  // PUT /bans/:playerId — ban. Idempotent; re-banning overwrites the reason.
  app.put('/:playerId', async (c) => {
    const playerId = c.req.param('playerId');
    if (badId(playerId)) return c.json({ error: 'invalid player id' }, 400);

    // Body is optional — a ban with no stated reason is still a ban.
    let reason: string | null = null;
    try {
      const body = await c.req.json<{ reason?: unknown }>();
      if (typeof body?.reason === 'string' && body.reason.trim() !== '') {
        reason = body.reason.trim().slice(0, 500);
      }
    } catch {
      // no body / not JSON — leave reason null
    }

    await banDb.ban(playerId, reason, new Date().toISOString());
    // No cache invalidation: the leaderboard blob expires on its own within
    // SCORES_TTL (60s). See the note in cache/CachedScoreDB.ts.
    return c.json({ ok: true, banned: true });
  });

  // DELETE /bans/:playerId — unban. Idempotent. The player's score row was never
  // touched, so they reappear at their real rank as soon as the cache turns over.
  app.delete('/:playerId', async (c) => {
    const playerId = c.req.param('playerId');
    if (badId(playerId)) return c.json({ error: 'invalid player id' }, 400);

    await banDb.unban(playerId);
    return c.json({ ok: true, banned: false });
  });

  return app;
}
```

- [ ] **Step 4: Mount and gate in `app.ts`**

Add the import:

```ts
import { banRoutes } from './routes/bans';
```

And mount below the `playerNameDb` block:

```ts
  if (opts.banDb) {
    // Admin shadow-ban surface — entirely behind the admin gate.
    app.get   ('/bans',           adminGate);
    app.get   ('/bans/:playerId', adminGate);
    app.put   ('/bans/:playerId', adminGate);
    app.delete('/bans/:playerId', adminGate);
    app.route('/bans', banRoutes(opts.banDb, scoreDb, opts.playerNameDb));
  }
```

- [ ] **Step 5: Run the tests**

Run: `cd server && npx vitest run tests/bansRoutes.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/bans.ts server/src/app.ts server/tests/bansRoutes.test.ts
git commit -m "Add admin ban routes"
```

---

### Task 7: Silently drop a banned player's placements

**Files:**
- Modify: `server/src/routes/heap.ts` (the `POST /:id/place` handler, and `heapRoutes`'s signature)
- Modify: `server/src/app.ts` (one argument)
- Test: `server/tests/placeBan.test.ts`

**Interfaces:**
- Consumes: `BanDB` (Task 1).
- Produces: `heapRoutes(heapDb, getSink, authDb?, contributionDb?, banDb?)` — `banDb` appended last, optional so existing call sites and tests keep working.

- [ ] **Step 1: Write the failing test**

Create `server/tests/placeBan.test.ts`. The heap fixture mirrors the "accepts a point when live zone is empty and base is empty" case in `server/tests/routes.test.ts` — a directly seeded empty heap at version 1, with `{ x: 200, y: 200 }` as the known-accepted placement.

```ts
// server/tests/placeBan.test.ts

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockBanDB } from './helpers/mockBanDb';
import type { PlaceResponse } from '../../shared/heapTypes';

/** Empty heap at version 1 — the fixture routes.test.ts uses for an accepted place. */
function appWithHeap(bans: MockBanDB) {
  const db = new MockHeapDB();
  db.seedHeap('h1', 1, [], 'base-1');
  db.seedBase('base-1', 'h1', []);
  const app = createApp(db, new MockScoreDB(), { banDb: bans });
  return { app, db, heapId: 'h1' };
}

async function place(
  app: ReturnType<typeof createApp>,
  heapId: string,
  playerGuid?: string,
) {
  const body: Record<string, unknown> = { x: 200, y: 200 };
  if (playerGuid !== undefined) body.playerGuid = playerGuid;
  const res = await app.request(`/heaps/${heapId}/place`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as PlaceResponse };
}

describe('POST /heaps/:id/place with a shadow-banned player', () => {
  it('accepts the placement for a clean player (control)', async () => {
    const { app, heapId } = appWithHeap(new MockBanDB());
    const { status, body } = await place(app, heapId, 'clean-player');
    expect(status).toBe(200);
    expect(body.accepted).toBe(true);
    expect(body.version).toBe(2);
  });

  it('returns accepted:false for a banned player, with 200 and the unchanged version', async () => {
    const bans = new MockBanDB();
    await bans.ban('badguy', 'griefing', '2026-08-16T00:00:00.000Z');
    const { app, heapId } = appWithHeap(bans);
    const { status, body } = await place(app, heapId, 'badguy');
    expect(status).toBe(200);
    expect(body.accepted).toBe(false);
    expect(body.version).toBe(1);          // still the seeded version — nothing was written
    expect(body.bonusCoins).toBeUndefined();
  });

  it('leaves the heap version untouched across repeated banned placements', async () => {
    const bans = new MockBanDB();
    await bans.ban('badguy', null, '2026-08-16T00:00:00.000Z');
    const { app, heapId } = appWithHeap(bans);
    await place(app, heapId, 'badguy');
    await place(app, heapId, 'badguy');
    const res = await app.request(`/heaps/${heapId}`);
    const heap = await res.json() as { version: number };
    expect(heap.version).toBe(1);
  });

  it('accepts again once the player is unbanned', async () => {
    const bans = new MockBanDB();
    await bans.ban('badguy', null, '2026-08-16T00:00:00.000Z');
    const { app, heapId } = appWithHeap(bans);
    expect((await place(app, heapId, 'badguy')).body.accepted).toBe(false);
    await bans.unban('badguy');
    expect((await place(app, heapId, 'badguy')).body.accepted).toBe(true);
  });

  it('leaves anonymous placements (no playerGuid) untouched', async () => {
    const bans = new MockBanDB();
    await bans.ban('badguy', null, '2026-08-16T00:00:00.000Z');
    const { app, heapId } = appWithHeap(bans);
    expect((await place(app, heapId)).body.accepted).toBe(true);
  });
});
```

The banned response asserts the *same shape* the containment no-op returns — that equivalence is the feature, so if a later change adds a field to one path it must add it to both.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/placeBan.test.ts`
Expected: the control test passes; the banned-player tests FAIL with `accepted: true`.

- [ ] **Step 3: Add `banDb` to `heapRoutes`**

In `server/src/routes/heap.ts`, add the import and extend the factory signature (keep every existing parameter in place):

```ts
import type { BanDB } from '../banDb';
```

```ts
export function heapRoutes(
  db: HeapDB,
  getSink: () => Sink | undefined,
  authDb?: PlayerAuthDB,
  contributionDb?: ContributionDB,
  banDb?: BanDB,
): Hono {
```

Match the existing parameter names in the file — if the first parameter is named something other than `db`, leave it alone and only append `banDb`.

- [ ] **Step 4: Add the silent drop**

In the `POST /:id/place` handler, immediately **after** the `enforcePlayerAuth` block and **before** the `const band = bandOf(y);` window read, insert:

```ts
    // Shadow ban: a banned player's placement is dropped without a trace. The
    // response is byte-identical to the containment no-op below — a response
    // this client already receives routinely whenever a placement fails to
    // widen the silhouette — so there is nothing here to notice. A 4xx would
    // be the tell. Placed after auth so the ordering with claim-on-first-write
    // is unchanged, and before the band read so a banned player costs us
    // nothing beyond one memoised ban lookup.
    if (banDb && playerGuid !== undefined && await banDb.isBanned(playerGuid)) {
      return c.json({ accepted: false, version: row.version } satisfies PlaceResponse);
    }
```

If the heap row variable is not named `row` at that point in the handler, use whatever name the surrounding code uses for the current heap row — the same one the containment no-op reads `version` from.

- [ ] **Step 5: Pass it in from `app.ts`**

```ts
  app.route('/heaps',  heapRoutes(heapDb, () => opts.logSink, opts.playerAuthDb, opts.contributionDb, opts.banDb));
```

- [ ] **Step 6: Run the tests**

Run: `cd server && npx vitest run tests/placeBan.test.ts tests/routes.test.ts`
Expected: PASS — 5 new tests, existing heap route tests green.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/heap.ts server/src/app.ts server/tests/placeBan.test.ts
git commit -m "Silently drop placements from banned players"
```

---

### Task 8: Send the viewer id from the client

**Files:**
- Modify: `src/systems/ScoreClient.ts`
- Modify: `src/scenes/LeaderboardScene.ts`
- Test: `src/systems/__tests__/ScoreClient.test.ts`

**Interfaces:**
- Consumes: `GET /scores/:heapId?playerId=` (Task 4).
- Produces: `ScoreClient.getLeaderboardPage(heapId: string, page: number, limit: number, playerId?: string)`.

This is what makes a banned player's own leaderboard *browser* look normal. Without it they would still be missing from the full list.

- [ ] **Step 1: Write the failing test**

Add to `src/systems/__tests__/ScoreClient.test.ts`, following that file's existing mocking style:

```ts
describe('getLeaderboardPage viewer id', () => {
  it('sends playerId when one is supplied', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, { entries: [], total: 0, page: 0 }));
    await ScoreClient.getLeaderboardPage('heap-1', 2, 25, 'player-abc');
    const url = fetchWithLog.mock.calls[0][0] as string;
    expect(url).toContain('page=2');
    expect(url).toContain('limit=25');
    expect(url).toContain('playerId=player-abc');
  });

  it('omits playerId entirely when none is supplied', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, { entries: [], total: 0, page: 0 }));
    await ScoreClient.getLeaderboardPage('heap-1', 0, 25);
    expect(fetchWithLog.mock.calls[0][0] as string).not.toContain('playerId');
  });

  it('url-encodes the player id', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, { entries: [], total: 0, page: 0 }));
    await ScoreClient.getLeaderboardPage('heap-1', 0, 25, 'a b&c');
    expect(fetchWithLog.mock.calls[0][0] as string).toContain('playerId=a%20b%26c');
  });
});
```

Reuse the file's existing `fetchWithLog` mock and `jsonResponse` helper if it has them; if the names differ, mirror the local conventions instead of introducing new ones.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/systems/__tests__/ScoreClient.test.ts`
Expected: FAIL — the URL contains no `playerId`.

- [ ] **Step 3: Add the parameter**

In `src/systems/ScoreClient.ts`:

```ts
  /**
   * Fetch one page of the per-heap leaderboard. Returns null on failure.
   *
   * `playerId` identifies the viewer to the server. It must be the effective
   * player id (see getEffectivePlayerId), and it is what keeps a player's own
   * board complete regardless of any server-side moderation.
   */
  static async getLeaderboardPage(heapId: string, page: number, limit: number, playerId?: string)
    : Promise<PaginatedLeaderboardResponse | null>
  {
    try {
      const viewer = playerId ? `&playerId=${encodeURIComponent(playerId)}` : '';
      const url = `${SERVER_URL}/scores/${encodeURIComponent(heapId)}?page=${page}&limit=${limit}${viewer}`;
      const res = await fetchWithLog(url);
      if (!res.ok) return null;
      return (await res.json()) as PaginatedLeaderboardResponse;
    } catch {
      return null;
    }
  }
```

- [ ] **Step 4: Pass it from `LeaderboardScene`**

`LeaderboardScene` already holds `this.playerId` (it feeds `getContext`). Update both call sites:

```ts
      ScoreClient.getLeaderboardPage(this.heapId, 0, PAGE_LIMIT, this.playerId),
```

```ts
    const data = await ScoreClient.getLeaderboardPage(this.heapId, page, PAGE_LIMIT, this.playerId);
```

Confirm `this.playerId` is sourced from `getEffectivePlayerId()`; if it is a bare GUID, fix it at the source — that is a repo-wide convention, not a local choice.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/systems/__tests__/ScoreClient.test.ts`
Expected: PASS, 3 new tests.

- [ ] **Step 6: Commit**

```bash
git add src/systems/ScoreClient.ts src/scenes/LeaderboardScene.ts src/systems/__tests__/ScoreClient.test.ts
git commit -m "Send the viewer id with leaderboard page requests"
```

---

### Task 9: Players card in the admin UI

**Files:**
- Modify: `admin/index.html` (markup after the Reward Codes card; JS before the Boot section)

**Interfaces:**
- Consumes: `GET /scores/admin/:heapId` (Task 4); `GET|PUT|DELETE /bans/:playerId` and `GET /bans` (Task 6).
- Produces: no exports — this is a standalone static page.

This page has no test harness; Step 5 is a manual verification against a local worker, and it is not optional.

- [ ] **Step 1: Add the markup**

Insert into `admin/index.html` immediately after the Reward Codes card's closing `</div>` and before the Remote Config card:

```html
  <div class="card border-l-term-violet">
    <h2 class="card-head">Players</h2>
    <div class="flex flex-wrap items-end gap-2">
      <div class="grow">
        <label class="lbl">Heap</label>
        <select id="pl-heap" class="field"></select>
      </div>
      <button id="pl-refresh" class="btn btn-sm">Refresh</button>
    </div>
    <div class="overflow-x-auto">
      <table class="tbl mt-4">
        <thead><tr><th>#</th><th>Player ID</th><th>Name</th><th>Score</th><th>Status</th><th></th></tr></thead>
        <tbody id="pl-tbody"><tr><td colspan="6" class="muted">not loaded</td></tr></tbody>
      </table>
    </div>
    <div class="mt-2 flex items-center gap-2">
      <button id="pl-prev" class="btn btn-sm">‹ prev</button>
      <span id="pl-pageLabel" class="muted">—</span>
      <button id="pl-next" class="btn btn-sm">next ›</button>
    </div>

    <h3 class="card-sub">Look up / ban by ID</h3>
    <div class="flex flex-wrap items-end gap-2">
      <div class="grow">
        <label class="lbl">Player ID</label>
        <input type="text" id="pl-lookupId" class="field" placeholder="paste a player id" />
      </div>
      <button id="pl-lookup" class="btn btn-sm">Look up</button>
    </div>
    <div id="pl-lookupResult" class="mt-3 muted">nothing looked up yet</div>
  </div>
```

Check that `card-sub` and `tbl` are the class names this file actually uses (the Remote Config card uses `card-sub`, Reward Codes uses `tbl`) — reuse, don't invent.

- [ ] **Step 2: Add the JavaScript**

Insert before the `// ────── Boot ──────` comment in `admin/index.html`:

```js
    // ────── Players / Shadow Bans ────────────────────────────────────────────

    const PL_PAGE_LIMIT = 25;
    let plPage = 0;
    let plTotal = 0;

    /** Fill the heap picker from the heap list the page already loaded. */
    function refreshPlayerHeapPicker() {
      const sel = $('pl-heap');
      const prev = sel.value;
      sel.innerHTML = cachedHeaps
        .map(h => `<option value="${h.id}">${escapeHtml(h.params.name)}</option>`)
        .join('');
      if (prev && cachedHeaps.some(h => h.id === prev)) sel.value = prev;
    }

    async function loadPlayers() {
      const heapId = $('pl-heap').value;
      if (!heapId) {
        $('pl-tbody').innerHTML = '<tr><td colspan="6" class="muted">pick a heap</td></tr>';
        return;
      }
      const gen = envGeneration;
      try {
        const res = await adminFetch(
          `/scores/admin/${encodeURIComponent(heapId)}?page=${plPage}&limit=${PL_PAGE_LIMIT}`);
        if (!res.ok) throw new Error('list failed: ' + res.status);
        const data = await res.json();
        if (gen !== envGeneration) return; // operator switched environments mid-flight
        plTotal = data.total || 0;
        renderPlayersTable(data.entries || []);
      } catch (e) {
        if (gen !== envGeneration) return;
        setStatus(String(e), 'err');
      }
    }

    function renderPlayersTable(entries) {
      const tbody = $('pl-tbody');
      const pages = Math.max(1, Math.ceil(plTotal / PL_PAGE_LIMIT));
      $('pl-pageLabel').textContent = `page ${plPage + 1} / ${pages} — ${plTotal} players`;
      if (!entries.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="muted">no scores on this heap</td></tr>';
        return;
      }
      tbody.innerHTML = entries.map(e => {
        const status = e.banned
          ? '<span class="text-term-red">BANNED</span>'
          : '<span class="text-term-green">ok</span>';
        const action = e.banned
          ? `<button class="btn btn-sm" onclick="onUnbanPlayer('${e.playerId}')">Unban</button>`
          : `<button class="btn btn-sm btn-danger" onclick="onBanPlayer('${e.playerId}')">Ban</button>`;
        return '<tr>'
          + '<td>' + e.rank + '</td>'
          + '<td class="font-mono text-xs">' + escapeHtml(e.playerId) + '</td>'
          + '<td>' + escapeHtml(e.name) + '</td>'
          + '<td>' + e.score + '</td>'
          + '<td>' + status + '</td>'
          + '<td>' + action + '</td>'
          + '</tr>';
      }).join('');
    }

    async function onBanPlayer(playerId) {
      const reason = prompt(`Shadow-ban ${playerId} on ${envLabel()}?\n\nReason (optional):`);
      if (reason === null) return;  // cancelled
      try {
        const res = await adminFetch('/bans/' + encodeURIComponent(playerId), {
          method: 'PUT',
          body: JSON.stringify({ reason }),
        });
        if (!res.ok) throw new Error('ban failed: ' + res.status);
        setStatus('banned ' + playerId + ' (takes up to 60s to clear caches)', 'ok');
        loadPlayers();
      } catch (e) {
        setStatus(String(e), 'err');
      }
    }

    async function onUnbanPlayer(playerId) {
      if (!confirm(`Unban ${playerId} on ${envLabel()}?`)) return;
      try {
        const res = await adminFetch('/bans/' + encodeURIComponent(playerId), { method: 'DELETE' });
        if (!res.ok) throw new Error('unban failed: ' + res.status);
        setStatus('unbanned ' + playerId, 'ok');
        loadPlayers();
      } catch (e) {
        setStatus(String(e), 'err');
      }
    }

    async function onLookupPlayer() {
      const playerId = $('pl-lookupId').value.trim();
      if (!playerId) { setStatus('player id required', 'err'); return; }
      try {
        const res = await adminFetch('/bans/' + encodeURIComponent(playerId));
        if (!res.ok) throw new Error('lookup failed: ' + res.status);
        renderLookup(await res.json());
      } catch (e) {
        setStatus(String(e), 'err');
      }
    }

    function renderLookup(p) {
      const status = p.banned
        ? `<span class="text-term-red">BANNED</span> since ${escapeHtml(p.bannedAt || '?')}`
          + (p.reason ? ' — ' + escapeHtml(p.reason) : '')
        : '<span class="text-term-green">not banned</span>';
      const scores = p.scores.length
        ? p.scores.map(s =>
            `<li>${escapeHtml(s.heapId)} — ${s.score} (rank ${s.rank})</li>`).join('')
        : '<li class="muted">no scores</li>';
      const action = p.banned
        ? `<button class="btn btn-sm" onclick="onUnbanPlayer('${p.playerId}')">Unban</button>`
        : `<button class="btn btn-sm btn-danger" onclick="onBanPlayer('${p.playerId}')">Ban</button>`;
      $('pl-lookupResult').innerHTML =
          '<div class="text-term-text">' + escapeHtml(p.name) + '</div>'
        + '<div class="font-mono text-xs">' + escapeHtml(p.playerId) + '</div>'
        + '<div class="mt-1">' + status + '</div>'
        + '<ul class="mt-2">' + scores + '</ul>'
        + '<div class="mt-2">' + action + '</div>';
    }

    function bootPlayers() {
      $('pl-refresh').onclick = () => { plPage = 0; loadPlayers(); };
      $('pl-heap').onchange   = () => { plPage = 0; loadPlayers(); };
      $('pl-lookup').onclick  = onLookupPlayer;
      $('pl-prev').onclick = () => {
        if (plPage === 0) return;
        plPage--; loadPlayers();
      };
      $('pl-next').onclick = () => {
        if ((plPage + 1) * PL_PAGE_LIMIT >= plTotal) return;
        plPage++; loadPlayers();
      };
    }
```

- [ ] **Step 3: Wire it into boot and env switching**

Add `bootPlayers();` to the `DOMContentLoaded` handler, after `bootConfig();`.

The heap picker depends on `cachedHeaps`, which `loadHeaps()` fills asynchronously — so populate the picker where the heap table is rendered. In `renderHeapsTable()`, add as the last line of the function body (**outside** the early-return branch, so an empty heap list still clears the picker):

```js
      refreshPlayerHeapPicker();
```

Place it so it runs on both paths — restructure the early return if needed:

```js
    function renderHeapsTable() {
      const tbody = $('heapsTbody');
      if (!cachedHeaps.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="muted">no heaps</td></tr>';
        refreshPlayerHeapPicker();
        return;
      }
      // …existing map/join…
      refreshPlayerHeapPicker();
    }
```

In `applyEnv()`, reset the players table so a stale environment's rows never linger — add after `loadConfig();`:

```js
      plPage = 0;
      $('pl-tbody').innerHTML = '<tr><td colspan="6" class="muted">not loaded</td></tr>';
      $('pl-lookupResult').textContent = 'nothing looked up yet';
```

The table itself is not auto-loaded on env switch: it needs a heap selection, and it is an admin-secret request. The operator presses Refresh.

- [ ] **Step 4: Confirm the inline handlers resolve**

`onBanPlayer` / `onUnbanPlayer` are called from `onclick` attributes, so they must be global. The existing `onEditHeap` / `onDeleteHeap` are declared the same way in the same script scope — confirm the new functions sit in that same top-level scope, not nested inside another function.

- [ ] **Step 5: Verify manually against a local worker**

Start the worker (`cd server && npx wrangler dev`), open `admin/index.html` through the admin Vite config (`npx vite --config admin/vite.config.ts`), select Local, and:

1. Pick a heap → Refresh → rows appear with player IDs.
2. Ban a row → status flips to BANNED after the auto-refresh.
3. Paste that same id into the lookup box → Look up → shows BANNED, the reason, and their scores.
4. Unban from the lookup panel → Refresh the table → status is back to ok.
5. Switch environment and back → the table clears rather than showing stale rows.
6. Clear the admin secret and press Refresh → the page reports the 401 rather than silently blanking.

- [ ] **Step 6: Commit**

```bash
git add admin/index.html
git commit -m "Add Players card with shadow-ban controls to the admin UI"
```

---

### Task 10: Full verification and rollout

**Files:**
- Modify: `Todo/Todo.md` (strike the "admin player ban abilities" line)

**Interfaces:**
- Consumes: every prior task.
- Produces: a branch ready for PR.

- [ ] **Step 1: Run the whole server suite**

Run: `cd server && npm test`
Expected: PASS. Report the exact count. Any failure here is a real regression — fix it before continuing, do not proceed with a red suite.

- [ ] **Step 2: Run the whole client suite**

Run: `npm test` (from the repo root)
Expected: PASS, with the count reported.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean. This is the step that catches TS errors the tests miss — the `ScoreDB` signature change touches several implementers.

- [ ] **Step 4: End-to-end check against local D1**

With `wrangler dev` running and the local migration applied:

```bash
# ban a throwaway id
curl -s -X PUT localhost:8787/bans/e2e-test-player \
  -H 'Content-Type: application/json' -H "X-Admin-Secret: $ADMIN_SECRET" \
  -d '{"reason":"e2e"}'

# it appears in the ban list
curl -s localhost:8787/bans -H "X-Admin-Secret: $ADMIN_SECRET"

# and in a lookup
curl -s localhost:8787/bans/e2e-test-player -H "X-Admin-Secret: $ADMIN_SECRET"

# clean up
curl -s -X DELETE localhost:8787/bans/e2e-test-player -H "X-Admin-Secret: $ADMIN_SECRET"
```

If a seeded local heap with real scores is available (`npm run seed`), also ban a player who holds a score and confirm they vanish from `GET /scores/<heapId>` while `GET /scores/<heapId>?playerId=<that id>` still lists them. That is the single most important behaviour in this feature — verify it, don't assume it.

- [ ] **Step 5: Update the Todo**

In `Todo/Todo.md`, remove the `- admin player ban abilities` line from the FEATURES section. Leave every other edit in that file alone — it has unrelated uncommitted changes.

- [ ] **Step 6: Commit and open the PR**

```bash
git add Todo/Todo.md
git commit -m "Tick off admin player ban"
git push -u origin feature/admin-shadow-ban
```

Then open a PR against `main` describing: the new `player_ban` table and that migration 0007 must be applied remotely, the viewer-id filter, the placement drop, and the admin card. Do not merge without the user's say-so.

- [ ] **Step 7: Remote migration**

Migration 0007 must be applied to the remote `heap_scores` database. Follow the `adding-d1-migrations` skill for whether this happens automatically on merge or needs a manual `--remote` apply — that skill is the authority, and past migrations in this repo have gone both ways. Flag it explicitly in the PR description either way.

- [ ] **Step 8: Post-merge smoke test**

Follow the `smoke-testing-heap` skill: ban a throwaway player in the production admin UI, confirm they disappear from another client's leaderboard within 60 seconds while their own board is unchanged, then unban.

---

## Notes for the implementer

- **The illusion is the feature.** Any change that makes a banned player's client behave differently — an error code, a missing row on their own board, a rejected placement — is a bug, even if the ban itself works.
- **`viewerId` is never trusted.** It is an unauthenticated query parameter, exactly like leaderboard reads today. The only thing guessing a banned id buys an attacker is sight of that one player, which a shadow ban tolerates by design. Do not add auth to these reads as a "fix".
- **Don't add cache invalidation on ban.** It looks like an oversight and isn't: `SCORES_TTL` is 60s, and a fan-out delete across every heap would spend the tightest Cloudflare quota to save under a minute.

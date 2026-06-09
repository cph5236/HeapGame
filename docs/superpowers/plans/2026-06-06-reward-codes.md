# Reward Codes System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add redeemable reward codes (coins or items) — admin-minted, server-validated, applied to the player's client-held balance/inventory, with replay and cap protection.

**Architecture:** A new D1-backed `/codes` surface on the Hono worker (`POST /codes/redeem` for players, `POST /codes` + `GET /codes` behind the admin gate for minting/listing). Cap and replay safety live in the write path: a `CHECK` constraint on `redeemed_count` plus an atomic two-statement D1 `batch()`. The client (`CodeClient`) validates via the server then applies coins/items to `SaveData`. Players redeem from a renamed **Player** settings tab via a DOM dialog; admins mint from a new section in `admin/index.html`.

**Tech Stack:** Hono + Cloudflare D1 (server), TypeScript, Vitest, Phaser 3.90 (client UI), plain HTML/JS (admin).

**Spec:** [docs/superpowers/specs/2026-06-06-reward-codes-design.md](../specs/2026-06-06-reward-codes-design.md)

---

## File Structure

**New files:**
- `shared/itemIds.ts` — canonical rewardable item-id list (server-visible source of truth).
- `shared/__tests__/itemIds.test.ts` — drift guard: `ITEM_DEFS` ids === `ITEM_IDS`.
- `shared/codeTypes.ts` — request/response/row/outcome types shared by server + client + tests.
- `server/migrations/0008_reward_codes.sql` — incremental schema.
- `server/src/codeDb.ts` — `RewardCodeDB` interface + `D1RewardCodeDB` implementation.
- `server/tests/helpers/mockCodeDb.ts` — `MockCodeDB` (in-memory, same semantics).
- `server/tests/codes.test.ts` — route + redeem-logic tests (run against `MockCodeDB`).
- `server/src/routes/codes.ts` — Hono sub-app for `/codes`.
- `src/systems/CodeClient.ts` — client redeem + reward application.
- `src/systems/__tests__/CodeClient.test.ts` — status-mapping + reward-application tests.

**Modified files:**
- `server/schema.sql` — add the two tables (fresh-install parity).
- `server/src/app.ts` — `AppOptions.codeDb` + `limiters.codes`; mount `/codes` when `codeDb` set.
- `server/src/index.ts` — `Env.RL_CODES`, construct `D1RewardCodeDB`, pass `codeDb` + `limiters.codes`.
- `server/wrangler.toml` — `RL_CODES` rate-limit binding.
- `src/data/itemDefs.ts` — import `ItemId` to type the `id` field (single source).
- `src/scenes/MenuScene.ts` — rename "Dev" tab → "Player", remove `+ 500 Coins`, reorder, add Redeem dialog.
- `admin/index.html` — Reward Codes mint form + listing.

**Design note (deviation from spec wording):** the spec said "add the `codeDb` param" to `createApp`. There are ~70 existing `createApp(heapDb, scoreDb, opts)` call sites; adding a 3rd positional param breaks all of them. Instead `codeDb` goes into `AppOptions` and `/codes` mounts only when present — exactly the existing pattern for `logSink`/`/log`. Functionally identical, far less churn.

---

## Task 1: Shared item-id list + drift guard

**Files:**
- Create: `shared/itemIds.ts`
- Create: `shared/__tests__/itemIds.test.ts`
- Modify: `src/data/itemDefs.ts:6-13` (type the `id` field with `ItemId`)

- [ ] **Step 1: Write the failing test**

`shared/__tests__/itemIds.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ITEM_IDS } from '../itemIds';
import { ITEM_DEFS } from '../../src/data/itemDefs';

describe('ITEM_IDS', () => {
  it('exactly matches the ids declared in ITEM_DEFS (no drift)', () => {
    const defIds = ITEM_DEFS.map(d => d.id).sort();
    const sharedIds = [...ITEM_IDS].sort();
    expect(sharedIds).toEqual(defIds);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/__tests__/itemIds.test.ts`
Expected: FAIL — cannot resolve `../itemIds`.

- [ ] **Step 3: Create `shared/itemIds.ts`**

```typescript
// shared/itemIds.ts
//
// Canonical list of rewardable / valid item ids. This is the single source the
// SERVER can import (it cannot see the client-only src/data/itemDefs.ts) for
// mint-time reward_id validation. A unit test asserts this stays in sync with
// ITEM_DEFS.

export const ITEM_IDS = [
  'ladder',
  'ibeam',
  'checkpoint',
  'shield',
  'revive',
  'adrenaline',
  'pogo',
  'stall',
] as const;

export type ItemId = (typeof ITEM_IDS)[number];

export function isItemId(s: string): s is ItemId {
  return (ITEM_IDS as readonly string[]).includes(s);
}
```

- [ ] **Step 4: Type the `id` field in `itemDefs.ts`**

In `src/data/itemDefs.ts`, add the import at the top (after the comment block) and change the `id` field type:

```typescript
import type { ItemId } from '../../shared/itemIds';
```

Change line 8 from `  id:             string;` to:

```typescript
  id:             ItemId;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run shared/__tests__/itemIds.test.ts`
Expected: PASS. (If it fails, the two lists disagree — fix `ITEM_IDS` to match `ITEM_DEFS`.)

- [ ] **Step 6: Commit**

```bash
git add shared/itemIds.ts shared/__tests__/itemIds.test.ts src/data/itemDefs.ts
git commit -m "$(printf 'feat(codes): shared item-id list + drift guard\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: Shared code types

**Files:**
- Create: `shared/codeTypes.ts`

No standalone test (types only — exercised by Tasks 5/6/8). This is a pure type module; TDD does not apply.

- [ ] **Step 1: Create `shared/codeTypes.ts`**

```typescript
// shared/codeTypes.ts
//
// Contract shared by the worker (server/src/routes/codes.ts, codeDb.ts), the
// client (src/systems/CodeClient.ts), and tests.

export type RewardType = 'coins' | 'item';

/** What a redeemed code grants. rewardId is set only when rewardType === 'item'. */
export interface RewardPayload {
  rewardType:   RewardType;
  rewardId?:    string;
  rewardAmount: number;
}

/** POST /codes/redeem request body. */
export interface RedeemCodeRequest {
  code:       string;
  playerGuid: string;
}

/** POST /codes/redeem 200 body. */
export type RedeemCodeResponse = RewardPayload;

/** POST /codes (admin) request body. */
export interface CreateCodeRequest {
  code:            string;
  rewardType:      RewardType;
  rewardId?:       string;       // required when rewardType === 'item'
  rewardAmount:    number;
  maxRedemptions?: number;       // 0/undefined = unlimited
  expiresAt?:      string | null; // ISO8601 or null = never
}

/** Persisted row shape (also the GET /codes listing entry). */
export interface RewardCodeRow {
  code:            string;
  reward_type:     RewardType;
  reward_id:       string | null;
  reward_amount:   number;
  max_redemptions: number;
  redeemed_count:  number;
  expires_at:      string | null;
  created_at:      string;
}

/** Discriminated result of a redeem attempt (server-internal). */
export type RedeemOutcome =
  | { kind: 'ok'; reward: RewardPayload }
  | { kind: 'notFound' }
  | { kind: 'expired' }
  | { kind: 'exhausted' }
  | { kind: 'alreadyRedeemed' };
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors from `shared/codeTypes.ts`.

- [ ] **Step 3: Commit**

```bash
git add shared/codeTypes.ts
git commit -m "$(printf 'feat(codes): shared code request/response/row types\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: D1 migration + schema

**Files:**
- Create: `server/migrations/0008_reward_codes.sql`
- Modify: `server/schema.sql` (append the two tables)

No automated test — verified by applying the migration locally (Step 3). Per CLAUDE.md: write the incremental migration **and** update `schema.sql`; never edit an applied migration.

- [ ] **Step 1: Create the migration**

`server/migrations/0008_reward_codes.sql`:

```sql
-- 0008_reward_codes.sql — redeemable reward codes (coins or items)

CREATE TABLE IF NOT EXISTS reward_codes (
  code            TEXT PRIMARY KEY,          -- normalized UPPERCASE
  reward_type     TEXT NOT NULL,             -- 'coins' | 'item'
  reward_id       TEXT,                       -- item id when type='item', NULL for coins
  reward_amount   INTEGER NOT NULL,           -- coin count, or item quantity
  max_redemptions INTEGER NOT NULL DEFAULT 0, -- 0 = unlimited; 1 = one-time; N = capped
  redeemed_count  INTEGER NOT NULL DEFAULT 0,
  expires_at      TEXT,                        -- nullable ISO8601; NULL = never
  created_at      TEXT NOT NULL,
  -- Enforces the cap in the write path: an increment past the cap aborts the
  -- transaction, so two players racing for the last slot cannot oversubscribe.
  CHECK (max_redemptions = 0 OR redeemed_count <= max_redemptions)
);

CREATE TABLE IF NOT EXISTS code_redemptions (
  code        TEXT NOT NULL,
  player_guid TEXT NOT NULL,
  redeemed_at TEXT NOT NULL,
  PRIMARY KEY (code, player_guid)   -- one redemption per player
);
```

- [ ] **Step 2: Append the same tables to `server/schema.sql`**

Add the identical two `CREATE TABLE IF NOT EXISTS` statements (the block above, without the leading migration comment) to the end of `server/schema.sql`.

- [ ] **Step 3: Apply locally and verify**

Run:
```bash
cd server && npx wrangler d1 migrations apply heap-db --local
```
Expected: reports `0008_reward_codes.sql` applied (0 → 1 migration run). Then verify the tables exist:
```bash
cd server && npx wrangler d1 execute heap-db --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('reward_codes','code_redemptions');"
```
Expected: both `reward_codes` and `code_redemptions` listed.

- [ ] **Step 4: Commit**

```bash
git add server/migrations/0008_reward_codes.sql server/schema.sql
git commit -m "$(printf 'feat(codes): D1 migration for reward_codes + code_redemptions\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: RewardCodeDB interface + D1 implementation

**Files:**
- Create: `server/src/codeDb.ts`

Mirrors `server/src/scoreDb.ts` (interface + `D1*` impl in one file). The D1 impl is exercised end-to-end against real D1 only in manual smoke (Task 11); logic is unit-tested via the mock in Task 5 (this matches how `D1ScoreDB` is handled in the repo).

- [ ] **Step 1: Create `server/src/codeDb.ts`**

```typescript
// server/src/codeDb.ts

import type {
  CreateCodeRequest,
  RewardCodeRow,
  RedeemOutcome,
  RewardType,
} from '../../shared/codeTypes';

/** Normalized, validated mint input (route does the validation). */
export interface NormalizedCreateCode {
  code:            string;        // already UPPERCASE-normalized
  rewardType:      RewardType;
  rewardId:        string | null;
  rewardAmount:    number;
  maxRedemptions:  number;        // 0 = unlimited
  expiresAt:       string | null;
}

/**
 * Abstraction over D1 for reward-code operations. Allows MockCodeDB in tests.
 */
export interface RewardCodeDB {
  /** Insert a new code. Returns false if the code already exists. */
  createCode(req: NormalizedCreateCode, now: string): Promise<boolean>;

  /** Fetch one code row, or null. */
  getCode(code: string): Promise<RewardCodeRow | null>;

  /** All code rows (admin listing), newest first. */
  listCodes(): Promise<RewardCodeRow[]>;

  /**
   * Atomically redeem `code` for `playerGuid`. Returns a discriminated outcome.
   * Replay (same player) and cap (across players) are both enforced in the
   * write path — see the batch + CHECK constraint below.
   */
  redeem(code: string, playerGuid: string, now: string): Promise<RedeemOutcome>;
}

/** Production implementation backed by Cloudflare D1. */
export class D1RewardCodeDB implements RewardCodeDB {
  constructor(private d1: D1Database) {}

  async createCode(req: NormalizedCreateCode, now: string): Promise<boolean> {
    try {
      await this.d1
        .prepare(
          `INSERT INTO reward_codes
             (code, reward_type, reward_id, reward_amount, max_redemptions, redeemed_count, expires_at, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)`,
        )
        .bind(req.code, req.rewardType, req.rewardId, req.rewardAmount, req.maxRedemptions, req.expiresAt, now)
        .run();
      return true;
    } catch (e) {
      // PRIMARY KEY conflict ⇒ duplicate code.
      if (/UNIQUE|PRIMARY KEY/i.test(String((e as Error)?.message ?? e))) return false;
      throw e;
    }
  }

  async getCode(code: string): Promise<RewardCodeRow | null> {
    const row = await this.d1
      .prepare('SELECT * FROM reward_codes WHERE code = ?1')
      .bind(code)
      .first<RewardCodeRow>();
    return row ?? null;
  }

  async listCodes(): Promise<RewardCodeRow[]> {
    const res = await this.d1
      .prepare('SELECT * FROM reward_codes ORDER BY created_at DESC')
      .all<RewardCodeRow>();
    return res.results;
  }

  async redeem(code: string, playerGuid: string, now: string): Promise<RedeemOutcome> {
    const row = await this.getCode(code);
    if (!row) return { kind: 'notFound' };
    if (row.expires_at && row.expires_at <= now) return { kind: 'expired' };

    try {
      // Atomic transaction. INSERT trips the PK on same-player replay; the
      // UPDATE trips the CHECK constraint if it would exceed the cap. Either
      // failure rolls the whole batch back.
      await this.d1.batch([
        this.d1
          .prepare('INSERT INTO code_redemptions (code, player_guid, redeemed_at) VALUES (?1, ?2, ?3)')
          .bind(code, playerGuid, now),
        this.d1
          .prepare('UPDATE reward_codes SET redeemed_count = redeemed_count + 1 WHERE code = ?1')
          .bind(code),
      ]);
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (/UNIQUE|PRIMARY KEY/i.test(msg)) return { kind: 'alreadyRedeemed' };
      if (/CHECK/i.test(msg))              return { kind: 'exhausted' };
      throw e;
    }

    return {
      kind: 'ok',
      reward: {
        rewardType:   row.reward_type,
        rewardId:     row.reward_id ?? undefined,
        rewardAmount: row.reward_amount,
      },
    };
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd server && npx tsc --noEmit -p tsconfig.json`
Expected: no errors. (`D1Database` is provided by `@cloudflare/workers-types`, already used by `scoreDb.ts`.)

- [ ] **Step 3: Commit**

```bash
git add server/src/codeDb.ts
git commit -m "$(printf 'feat(codes): RewardCodeDB interface + D1 implementation\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: MockCodeDB + redeem-logic tests

**Files:**
- Create: `server/tests/helpers/mockCodeDb.ts`
- Create: `server/tests/codes.test.ts` (logic half; route half added in Task 6)

The mock enforces the same outcome semantics as `D1RewardCodeDB` (replay, cap, expiry) sequentially. This is where the cap and replay logic is verified, including the cap-race scenario.

- [ ] **Step 1: Write the failing test**

`server/tests/codes.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { MockCodeDB } from './helpers/mockCodeDb';

const COINS = {
  code: 'WELCOME', rewardType: 'coins' as const, rewardId: null,
  rewardAmount: 500, maxRedemptions: 0, expiresAt: null,
};

describe('MockCodeDB.redeem', () => {
  it('grants the reward on first redemption', async () => {
    const db = new MockCodeDB();
    await db.createCode(COINS, '2026-06-06T00:00:00.000Z');
    const out = await db.redeem('WELCOME', 'guid-a', '2026-06-06T00:00:01.000Z');
    expect(out).toEqual({ kind: 'ok', reward: { rewardType: 'coins', rewardId: undefined, rewardAmount: 500 } });
  });

  it('returns notFound for an unknown code', async () => {
    const db = new MockCodeDB();
    expect(await db.redeem('NOPE', 'guid-a', '2026-06-06T00:00:00.000Z')).toEqual({ kind: 'notFound' });
  });

  it('returns alreadyRedeemed when the same player redeems twice', async () => {
    const db = new MockCodeDB();
    await db.createCode(COINS, 'now');
    await db.redeem('WELCOME', 'guid-a', 'now');
    expect(await db.redeem('WELCOME', 'guid-a', 'now')).toEqual({ kind: 'alreadyRedeemed' });
  });

  it('returns expired for a past expires_at', async () => {
    const db = new MockCodeDB();
    await db.createCode({ ...COINS, code: 'OLD', expiresAt: '2026-06-01T00:00:00.000Z' }, 'now');
    expect(await db.redeem('OLD', 'guid-a', '2026-06-06T00:00:00.000Z')).toEqual({ kind: 'expired' });
  });

  it('enforces the cap across distinct players (no oversubscription)', async () => {
    const db = new MockCodeDB();
    await db.createCode({ ...COINS, code: 'CAP3', maxRedemptions: 3 }, 'now');
    const outcomes = [];
    for (const g of ['g1', 'g2', 'g3', 'g4']) {
      outcomes.push((await db.redeem('CAP3', g, 'now')).kind);
    }
    expect(outcomes).toEqual(['ok', 'ok', 'ok', 'exhausted']);
    const row = await db.getCode('CAP3');
    expect(row?.redeemed_count).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/codes.test.ts`
Expected: FAIL — cannot resolve `./helpers/mockCodeDb`.

- [ ] **Step 3: Create `server/tests/helpers/mockCodeDb.ts`**

```typescript
// server/tests/helpers/mockCodeDb.ts

import type { RewardCodeDB, NormalizedCreateCode } from '../../src/codeDb';
import type { RewardCodeRow, RedeemOutcome } from '../../../shared/codeTypes';

/** In-memory RewardCodeDB for tests. Same outcome semantics as D1RewardCodeDB. */
export class MockCodeDB implements RewardCodeDB {
  private codes = new Map<string, RewardCodeRow>();
  private redemptions = new Set<string>(); // `${code}::${guid}`

  async createCode(req: NormalizedCreateCode, now: string): Promise<boolean> {
    if (this.codes.has(req.code)) return false;
    this.codes.set(req.code, {
      code:            req.code,
      reward_type:     req.rewardType,
      reward_id:       req.rewardId,
      reward_amount:   req.rewardAmount,
      max_redemptions: req.maxRedemptions,
      redeemed_count:  0,
      expires_at:      req.expiresAt,
      created_at:      now,
    });
    return true;
  }

  async getCode(code: string): Promise<RewardCodeRow | null> {
    return this.codes.get(code) ?? null;
  }

  async listCodes(): Promise<RewardCodeRow[]> {
    return [...this.codes.values()].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }

  async redeem(code: string, playerGuid: string, now: string): Promise<RedeemOutcome> {
    const row = this.codes.get(code);
    if (!row) return { kind: 'notFound' };
    if (row.expires_at && row.expires_at <= now) return { kind: 'expired' };

    const rkey = `${code}::${playerGuid}`;
    if (this.redemptions.has(rkey)) return { kind: 'alreadyRedeemed' };
    if (row.max_redemptions !== 0 && row.redeemed_count >= row.max_redemptions) {
      return { kind: 'exhausted' };
    }

    this.redemptions.add(rkey);
    row.redeemed_count += 1;
    return {
      kind: 'ok',
      reward: {
        rewardType:   row.reward_type,
        rewardId:     row.reward_id ?? undefined,
        rewardAmount: row.reward_amount,
      },
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/codes.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/tests/helpers/mockCodeDb.ts server/tests/codes.test.ts
git commit -m "$(printf 'test(codes): MockCodeDB + redeem-logic tests (cap, replay, expiry)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 6: Codes routes + app wiring

**Files:**
- Create: `server/src/routes/codes.ts`
- Modify: `server/src/app.ts`
- Modify: `server/tests/codes.test.ts` (add route tests)

- [ ] **Step 1: Write the failing route tests (append to `server/tests/codes.test.ts`)**

Add these imports at the top of the file (alongside the existing import):

```typescript
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
```

Append this describe block:

```typescript
function makeApp(codeDb = new MockCodeDB(), adminSecret?: string) {
  return createApp(new MockHeapDB(), new MockScoreDB(), { codeDb, adminSecret });
}

describe('POST /codes (admin mint)', () => {
  it('mints a coins code', async () => {
    const app = makeApp();
    const res = await app.request('/codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'welcome', rewardType: 'coins', rewardAmount: 500 }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.code).toBe('WELCOME'); // normalized uppercase
  });

  it('rejects an item code with an unknown reward_id (400)', async () => {
    const app = makeApp();
    const res = await app.request('/codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'BADITEM', rewardType: 'item', rewardId: 'not_a_real_item', rewardAmount: 1 }),
    });
    expect(res.status).toBe(400);
  });

  it('accepts an item code with a valid reward_id', async () => {
    const app = makeApp();
    const res = await app.request('/codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'FREESHIELD', rewardType: 'item', rewardId: 'shield', rewardAmount: 2 }),
    });
    expect(res.status).toBe(201);
  });

  it('rejects a duplicate code (409)', async () => {
    const app = makeApp();
    const mk = () => app.request('/codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'DUP', rewardType: 'coins', rewardAmount: 100 }),
    });
    expect((await mk()).status).toBe(201);
    expect((await mk()).status).toBe(409);
  });

  it('requires the admin secret when one is configured (401)', async () => {
    const app = makeApp(new MockCodeDB(), 's3cret');
    const res = await app.request('/codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'GATED', rewardType: 'coins', rewardAmount: 100 }),
    });
    expect(res.status).toBe(401);
  });
});

describe('POST /codes/redeem', () => {
  async function seed(app: ReturnType<typeof makeApp>, body: object) {
    await app.request('/codes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  }

  it('redeems a coins code and returns the reward', async () => {
    const codeDb = new MockCodeDB();
    const app = createApp(new MockHeapDB(), new MockScoreDB(), { codeDb });
    await seed(app, { code: 'WELCOME', rewardType: 'coins', rewardAmount: 500 });
    const res = await app.request('/codes/redeem', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'welcome', playerGuid: 'guid-a' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rewardType: 'coins', rewardAmount: 500 });
  });

  it('redeems an item code', async () => {
    const codeDb = new MockCodeDB();
    const app = createApp(new MockHeapDB(), new MockScoreDB(), { codeDb });
    await seed(app, { code: 'SHIELD2', rewardType: 'item', rewardId: 'shield', rewardAmount: 2 });
    const res = await app.request('/codes/redeem', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'SHIELD2', playerGuid: 'guid-a' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rewardType: 'item', rewardId: 'shield', rewardAmount: 2 });
  });

  it('returns 404 for an unknown code', async () => {
    const app = createApp(new MockHeapDB(), new MockScoreDB(), { codeDb: new MockCodeDB() });
    const res = await app.request('/codes/redeem', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'NOPE', playerGuid: 'guid-a' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 409 when the same player redeems twice', async () => {
    const codeDb = new MockCodeDB();
    const app = createApp(new MockHeapDB(), new MockScoreDB(), { codeDb });
    await seed(app, { code: 'ONCE', rewardType: 'coins', rewardAmount: 50 });
    const redeem = () => app.request('/codes/redeem', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ONCE', playerGuid: 'guid-a' }),
    });
    expect((await redeem()).status).toBe(200);
    expect((await redeem()).status).toBe(409);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run tests/codes.test.ts`
Expected: FAIL — `createApp` does not accept `codeDb`; `/codes` returns 404.

- [ ] **Step 3: Create `server/src/routes/codes.ts`**

```typescript
// server/src/routes/codes.ts

import { Hono } from 'hono';
import type { RewardCodeDB } from '../codeDb';
import type { Sink } from '../logging/Sink';
import { captureServer } from '../logging/captureServerEvent';
import { isItemId } from '../../../shared/itemIds';
import type { CreateCodeRequest, RedeemCodeRequest } from '../../../shared/codeTypes';

const MAX_CODE_LEN = 32;
const MAX_GUID_LEN = 64;

function normalizeCode(s: string): string {
  return s.trim().toUpperCase();
}

export function codeRoutes(codeDb: RewardCodeDB, getSink: () => Sink | undefined): Hono {
  const app = new Hono();

  // ── Player: redeem a code ────────────────────────────────────────────────
  app.post('/redeem', async (c) => {
    let body: RedeemCodeRequest;
    try {
      body = await c.req.json<RedeemCodeRequest>();
    } catch {
      return c.json({ error: 'invalid request' }, 400);
    }
    const code = typeof body.code === 'string' ? normalizeCode(body.code) : '';
    const guid = typeof body.playerGuid === 'string' ? body.playerGuid.trim() : '';
    if (!code || code.length > MAX_CODE_LEN || !guid || guid.length > MAX_GUID_LEN) {
      return c.json({ error: 'invalid request' }, 400);
    }

    const now = new Date().toISOString();
    const outcome = await codeDb.redeem(code, guid, now);

    if (outcome.kind === 'ok') {
      const sink = getSink();
      if (sink) await captureServer(sink, 'event', 'code:redeemed', { code, type: outcome.reward.rewardType });
      return c.json(outcome.reward, 200);
    }
    switch (outcome.kind) {
      case 'notFound':        return c.json({ error: 'code not found' }, 404);
      case 'expired':         return c.json({ error: 'code expired' }, 410);
      case 'exhausted':       return c.json({ error: 'code fully redeemed' }, 409);
      case 'alreadyRedeemed': return c.json({ error: 'already redeemed' }, 409);
    }
  });

  // ── Admin: mint a code (adminGate applied in app.ts) ─────────────────────
  app.post('/', async (c) => {
    let body: CreateCodeRequest;
    try {
      body = await c.req.json<CreateCodeRequest>();
    } catch {
      return c.json({ error: 'invalid request' }, 400);
    }

    const code = typeof body.code === 'string' ? normalizeCode(body.code) : '';
    const rewardType = body.rewardType;
    const rewardAmount = body.rewardAmount;
    const maxRedemptions = body.maxRedemptions ?? 0;
    const expiresAt = body.expiresAt ?? null;

    if (!code || code.length > MAX_CODE_LEN) return c.json({ error: 'invalid code' }, 400);
    if (rewardType !== 'coins' && rewardType !== 'item') return c.json({ error: 'invalid rewardType' }, 400);
    if (!Number.isInteger(rewardAmount) || rewardAmount <= 0) return c.json({ error: 'invalid rewardAmount' }, 400);
    if (!Number.isInteger(maxRedemptions) || maxRedemptions < 0) return c.json({ error: 'invalid maxRedemptions' }, 400);

    let rewardId: string | null = null;
    if (rewardType === 'item') {
      rewardId = typeof body.rewardId === 'string' ? body.rewardId : '';
      if (!isItemId(rewardId)) return c.json({ error: 'invalid rewardId' }, 400);
    }
    if (expiresAt !== null && (typeof expiresAt !== 'string' || Number.isNaN(Date.parse(expiresAt)))) {
      return c.json({ error: 'invalid expiresAt' }, 400);
    }

    const now = new Date().toISOString();
    const created = await codeDb.createCode(
      { code, rewardType, rewardId, rewardAmount, maxRedemptions, expiresAt },
      now,
    );
    if (!created) return c.json({ error: 'code already exists' }, 409);
    return c.json({ ok: true, code }, 201);
  });

  // ── Admin: list codes (adminGate applied in app.ts) ──────────────────────
  app.get('/', async (c) => {
    const rows = await codeDb.listCodes();
    return c.json({ codes: rows });
  });

  return app;
}
```

- [ ] **Step 4: Wire `/codes` into `server/src/app.ts`**

Add the import near the other route imports:

```typescript
import { codeRoutes } from './routes/codes';
import type { RewardCodeDB } from './codeDb';
```

In `AppOptions`, add a `codeDb` field and a `codes` limiter. Change the `limiters` block to include `codes`:

```typescript
  /** Reward-code D1 access. If unset, /codes is not mounted. */
  codeDb?: RewardCodeDB;
  limiters?: {
    scores?: RateLimiter;
    place?:  RateLimiter;
    global?: RateLimiter;
    log?:    RateLimiter;
    codes?:  RateLimiter;
  };
```

Mount the routes. Add this block **after** the existing `app.route('/scores', ...)` line and before the `if (opts.logSink)` block:

```typescript
  if (opts.codeDb) {
    // Player redeem endpoint — rate-limited, no admin gate.
    app.post('/codes/redeem', rateLimit(lim.codes, 'codes-redeem'));
    // Admin mint + list — behind the admin gate.
    app.post('/codes', adminGate);
    app.get ('/codes', adminGate);
    app.route('/codes', codeRoutes(opts.codeDb, () => opts.logSink));
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && npx vitest run tests/codes.test.ts`
Expected: PASS (all route + logic tests).

- [ ] **Step 6: Run the full server suite (no regressions)**

Run: `cd server && npx vitest run`
Expected: all existing suites still PASS (the new `opts.codeDb` is optional, so untouched call sites are unaffected).

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/codes.ts server/src/app.ts server/tests/codes.test.ts
git commit -m "$(printf 'feat(codes): /codes redeem + admin mint/list routes, app wiring\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 7: Worker entry + wrangler binding

**Files:**
- Modify: `server/src/index.ts`
- Modify: `server/wrangler.toml`

No automated test (deployment wiring). Verified by typecheck + the existing build. **This is the step that makes the rate limiter and code DB actually reach `createApp` — without it the feature is dead in production.**

- [ ] **Step 1: Wire `server/src/index.ts`**

Add the import alongside the other DB imports:

```typescript
import { D1RewardCodeDB } from './codeDb';
```

Add `RL_CODES` to the `Env` interface (after `RL_GLOBAL`):

```typescript
  RL_CODES?: RateLimiter;
```

Update the `createApp(...)` call to pass `codeDb` and the `codes` limiter:

```typescript
    const app = createApp(new D1HeapDB(env.DB), new D1ScoreDB(env.DB), {
      allowedOrigins: env.ALLOWED_ORIGINS,
      adminSecret:    env.ADMIN_SECRET,
      codeDb:         new D1RewardCodeDB(env.DB),
      limiters: {
        scores: env.RL_SCORES,
        place:  env.RL_PLACE,
        global: env.RL_GLOBAL,
        log:    env.RL_LOG,
        codes:  env.RL_CODES,
      },
      logSink,
    });
```

- [ ] **Step 2: Add the rate-limit binding to `server/wrangler.toml`**

Find the existing `[[unsafe.bindings]]` rate-limit entries (e.g. `RL_SCORES`, `RL_PLACE`). Add an analogous one for `RL_CODES`. Match the existing format exactly; example shape (adjust `namespace_id` to the next free integer not already used by the other limiters):

```toml
[[unsafe.bindings]]
name = "RL_CODES"
type = "ratelimit"
namespace_id = "1004"           # use the next unused namespace_id
simple = { limit = 10, period = 60 }
```

If `wrangler.toml` does not use the `[[unsafe.bindings]]` form for rate limits, mirror whatever form the existing `RL_*` limiters use. (Read the file first; do not invent a format.)

- [ ] **Step 3: Typecheck**

Run: `cd server && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts server/wrangler.toml
git commit -m "$(printf 'feat(codes): wire codeDb + RL_CODES through worker entry\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 8: Client CodeClient

**Files:**
- Create: `src/systems/CodeClient.ts`
- Create: `src/systems/__tests__/CodeClient.test.ts`

- [ ] **Step 1: Write the failing test**

`src/systems/__tests__/CodeClient.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock SaveData and fetchWithLog before importing the module under test.
const addBalance = vi.fn();
const addItem = vi.fn();
vi.mock('../SaveData', () => ({
  getPlayerGuid: () => 'guid-test',
  addBalance: (n: number) => addBalance(n),
  addItem: (id: string, qty: number) => addItem(id, qty),
}));
const fetchWithLog = vi.fn();
vi.mock('../../logging/fetchWithLog', () => ({
  fetchWithLog: (...args: unknown[]) => fetchWithLog(...args),
}));

import { redeemCode } from '../CodeClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('redeemCode', () => {
  beforeEach(() => { addBalance.mockClear(); addItem.mockClear(); fetchWithLog.mockReset(); });

  it('applies coins and reports success', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, { rewardType: 'coins', rewardAmount: 500 }));
    const result = await redeemCode('welcome');
    expect(result.status).toBe('success');
    expect(addBalance).toHaveBeenCalledWith(500);
    expect(result.message).toContain('500');
  });

  it('applies a known item and reports success', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, { rewardType: 'item', rewardId: 'shield', rewardAmount: 2 }));
    const result = await redeemCode('SHIELD2');
    expect(result.status).toBe('success');
    expect(addItem).toHaveBeenCalledWith('shield', 2);
  });

  it('does not grant an unknown item id', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, { rewardType: 'item', rewardId: 'ghost_item', rewardAmount: 1 }));
    const result = await redeemCode('BAD');
    expect(result.status).toBe('error');
    expect(addItem).not.toHaveBeenCalled();
  });

  it('maps 404 → notFound', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(404, { error: 'code not found' }));
    expect((await redeemCode('X')).status).toBe('notFound');
  });

  it('maps 410 → expired', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(410, { error: 'code expired' }));
    expect((await redeemCode('X')).status).toBe('expired');
  });

  it('maps 409 already-redeemed → already', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(409, { error: 'already redeemed' }));
    expect((await redeemCode('X')).status).toBe('already');
  });

  it('maps 409 exhausted → exhausted', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(409, { error: 'code fully redeemed' }));
    expect((await redeemCode('X')).status).toBe('exhausted');
  });

  it('maps a network throw → offline', async () => {
    fetchWithLog.mockRejectedValue(new Error('network down'));
    expect((await redeemCode('X')).status).toBe('offline');
  });

  it('rejects an empty code without calling the network', async () => {
    expect((await redeemCode('   ')).status).toBe('error');
    expect(fetchWithLog).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/systems/__tests__/CodeClient.test.ts`
Expected: FAIL — cannot resolve `../CodeClient`.

- [ ] **Step 3: Create `src/systems/CodeClient.ts`**

```typescript
// src/systems/CodeClient.ts

import { getPlayerGuid, addBalance, addItem } from './SaveData';
import { fetchWithLog } from '../logging/fetchWithLog';
import { ITEM_DEFS } from '../data/itemDefs';
import type { RewardPayload, RedeemCodeRequest } from '../../shared/codeTypes';

const SERVER_URL: string =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_HEAP_SERVER_URL ??
  'http://localhost:8787';

export type RedeemStatus =
  | 'success' | 'already' | 'expired' | 'exhausted' | 'notFound' | 'offline' | 'error';

export interface RedeemResult {
  status:  RedeemStatus;
  message: string;
  reward?: RewardPayload;
}

/** Validates + redeems a code server-side, then applies the reward to SaveData. */
export async function redeemCode(rawCode: string): Promise<RedeemResult> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { status: 'error', message: 'Enter a code' };

  const req: RedeemCodeRequest = { code, playerGuid: getPlayerGuid() };
  let res: Response;
  try {
    res = await fetchWithLog(`${SERVER_URL}/codes/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
  } catch {
    return { status: 'offline', message: 'Offline — try again' };
  }

  if (res.ok) {
    const reward = (await res.json()) as RewardPayload;
    return applyReward(reward);
  }

  switch (res.status) {
    case 404: return { status: 'notFound', message: 'Code not found' };
    case 410: return { status: 'expired',  message: 'Code expired' };
    case 409: {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return body.error === 'already redeemed'
        ? { status: 'already',   message: 'Already redeemed' }
        : { status: 'exhausted', message: 'Code fully redeemed' };
    }
    default:  return { status: 'error', message: 'Could not redeem' };
  }
}

function applyReward(reward: RewardPayload): RedeemResult {
  if (reward.rewardType === 'coins') {
    addBalance(reward.rewardAmount);
    return { status: 'success', message: `✓ +${reward.rewardAmount} coins`, reward };
  }
  const def = ITEM_DEFS.find(d => d.id === reward.rewardId);
  if (!def) {
    return { status: 'error', message: 'Unknown reward item' };
  }
  addItem(def.id, reward.rewardAmount);
  return { status: 'success', message: `✓ +${reward.rewardAmount} ${def.name}`, reward };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/systems/__tests__/CodeClient.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/systems/CodeClient.ts src/systems/__tests__/CodeClient.test.ts
git commit -m "$(printf 'feat(codes): client CodeClient — redeem + reward application\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 9: MenuScene — rename "Dev" tab → "Player", reorganize, add Redeem dialog

**Files:**
- Modify: `src/scenes/MenuScene.ts`

UI work — verified by `npm run build` + scene preview + manual. Mirrors the existing `openNameDialog` DOM-overlay pattern for text entry. Make the edits in order.

- [ ] **Step 1: Update imports**

In the `SaveData` import on line 6, **remove** `addBalance` (its only use is the coin button being deleted) and **add** nothing new from SaveData (`getBalance` stays — still used by `balanceText`). Add a new import for the client:

```typescript
import { redeemCode } from '../systems/CodeClient';
```

- [ ] **Step 2: Relabel the tab (line 756)**

Change:
```typescript
    const devTabText    = this.add.text(tabXs[2], TAB_Y, 'Dev', { fontSize: '13px', color: '#888888' }).setOrigin(0.5).setDepth(33).setVisible(false);
```
to:
```typescript
    const devTabText    = this.add.text(tabXs[2], TAB_Y, 'Player', { fontSize: '13px', color: '#888888' }).setOrigin(0.5).setDepth(33).setVisible(false);
```
(Keep the variable names `devTabBg`/`devTabText`/`showDevTab`/`devItems` — renaming them touches many lines for no behavior change; only the displayed label changes.)

- [ ] **Step 3: Replace the Player-tab content block (lines 761-788)**

Replace the entire block from the `// Dev tab content (existing items, repositioned relative to CONTENT_TOP)` comment through the `analyticsHint` definition with this reordered version (Codes → Analytics → Reset, top to bottom):

```typescript
    // Player tab content — order: Redeem Code, Analytics, Reset (top → bottom)

    // 1. Redeem code (top) — button opens a DOM dialog; result shown below.
    const codeBtnBg = this.add.rectangle(cx, CONTENT_TOP + 24, 260, 48, 0x1a3a5c)
      .setDepth(32).setVisible(false).setStrokeStyle(2, 0x4488ff).setInteractive({ useHandCursor: true });
    const codeBtnLabel = this.add.text(cx, CONTENT_TOP + 24, 'REDEEM CODE', {
      fontSize: '18px', color: '#aaccff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(33).setVisible(false);
    const codeResult = this.add.text(cx, CONTENT_TOP + 58, '', {
      fontSize: '13px', color: '#88ccff', align: 'center',
    }).setOrigin(0.5).setDepth(33).setVisible(false);

    // 2. Analytics checkbox (middle).
    let analyticsEnabled = getVerboseLogging();
    const analyticsBg = this.add.rectangle(cx, CONTENT_TOP + 110, 260, 48, 0x1a3a1a)
      .setDepth(32).setVisible(false).setStrokeStyle(2, 0x44aa44).setInteractive({ useHandCursor: true });
    const analyticsCheckbox = this.add.text(cx - 110, CONTENT_TOP + 110, analyticsEnabled ? '☑' : '☐', {
      fontSize: '20px', color: '#44ff44', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(33).setVisible(false);
    const analyticsLabel = this.add.text(cx - 35, CONTENT_TOP + 102, 'Send anonymous\ngameplay analytics', {
      fontSize: '13px', color: '#aaffaa',
    }).setOrigin(0, 0.5).setDepth(33).setVisible(false);
    const analyticsHint = this.add.text(cx - 35, CONTENT_TOP + 119, 'Errors are always reported.', {
      fontSize: '11px', color: '#88aa88',
    }).setOrigin(0, 0.5).setDepth(33).setVisible(false);

    // 3. Reset all data (bottom).
    const resetBg = this.add.rectangle(cx, CONTENT_TOP + 190, 260, 52, 0x881111)
      .setDepth(32).setVisible(false).setStrokeStyle(2, 0xff4444).setInteractive({ useHandCursor: true });
    const resetLabel = this.add.text(cx, CONTENT_TOP + 190, 'Reset All Data', {
      fontSize: '20px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(33).setVisible(false);
    const resetWarning = this.add.text(cx, CONTENT_TOP + 232, 'Clears all coins, upgrades\nand placed blocks.', {
      fontSize: '14px', color: '#aa8888', align: 'center',
    }).setOrigin(0.5).setDepth(32).setVisible(false);
```

- [ ] **Step 4: Update the `devItems` array (line 868)**

Change:
```typescript
    const devItems    = [coinBg, coinLabel, resetBg, resetLabel, resetWarning, analyticsBg, analyticsCheckbox, analyticsLabel, analyticsHint];
```
to:
```typescript
    const devItems    = [codeBtnBg, codeBtnLabel, codeResult, analyticsBg, analyticsCheckbox, analyticsLabel, analyticsHint, resetBg, resetLabel, resetWarning];
```

- [ ] **Step 5: Replace the coin-button handler (lines 904-907) with the redeem handler**

Change:
```typescript
    // ── Wire existing Dev tab buttons ─────────────────────────────────────────
    coinBg.on('pointerup', () => {
      addBalance(500);
      this.balanceText.setText(`${getBalance()} coins`);
    });
```
to:
```typescript
    // ── Wire Player tab buttons ───────────────────────────────────────────────
    codeBtnBg.on('pointerup', () => {
      this.openRedeemDialog((result) => {
        codeResult.setText(result.message)
          .setColor(result.status === 'success' ? '#88ff88' : '#ff9988')
          .setVisible(true);
        if (result.status === 'success' && result.reward?.rewardType === 'coins') {
          this.balanceText.setText(`${getBalance()} coins`);
        }
      });
    });
```

- [ ] **Step 6: Add the `openRedeemDialog` method**

Immediately after the `openNameDialog` method (after line 429's closing brace), add a new method mirroring it:

```typescript
  private openRedeemDialog(onResult: (result: import('../systems/CodeClient').RedeemResult) => void): void {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.75)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'z-index:9999', 'font-family:monospace',
    ].join(';');

    const panel = document.createElement('div');
    panel.style.cssText = [
      'background:#0d0d20', 'border:2px solid #4488ff', 'border-radius:12px',
      'padding:28px 22px 22px', 'text-align:center', 'width:300px',
      'box-shadow:0 0 32px rgba(68,136,255,0.18)', 'box-sizing:border-box',
    ].join(';');

    const heap = document.createElement('div');
    heap.style.cssText = 'color:#4488ff;font-size:13px;font-weight:bold;letter-spacing:3px;margin-bottom:6px';
    heap.textContent = 'REDEEM CODE';

    const subtitle = document.createElement('div');
    subtitle.style.cssText = 'color:#6699cc;font-size:14px;font-style:italic;margin-bottom:22px';
    subtitle.textContent = 'Enter a reward code';

    const input = document.createElement('input');
    input.maxLength = 32;
    input.autocapitalize = 'characters';
    input.style.cssText = [
      'width:100%', 'box-sizing:border-box', 'background:transparent', 'border:none',
      'border-bottom:2px solid #4488ff', 'color:#ffffff', 'font-size:20px',
      'text-align:center', 'padding:6px 0 8px', 'font-family:monospace',
      'outline:none', 'margin-bottom:18px', 'text-transform:uppercase',
    ].join(';');

    const msg = document.createElement('div');
    msg.style.cssText = 'min-height:16px;font-size:12px;margin-bottom:14px;color:#88aacc';

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'REDEEM';
    confirmBtn.style.cssText = [
      'width:100%', 'padding:13px', 'background:#4488ff', 'border:none',
      'border-radius:8px', 'color:#0a0818', 'font-size:15px', 'font-weight:bold',
      'font-family:monospace', 'letter-spacing:1px', 'cursor:pointer', 'margin-bottom:10px',
    ].join(';');

    const cancelEl = document.createElement('div');
    cancelEl.textContent = 'close';
    cancelEl.style.cssText = 'color:#556677;font-size:12px;cursor:pointer;letter-spacing:1px';

    panel.append(heap, subtitle, input, msg, confirmBtn, cancelEl);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    this.input.enabled = false;

    const close = (): void => {
      this.input.enabled = true;
      if (overlay.parentNode) document.body.removeChild(overlay);
    };

    let busy = false;
    const submit = async (): Promise<void> => {
      if (busy) return;
      busy = true;
      confirmBtn.disabled = true;
      msg.style.color = '#88aacc';
      msg.textContent = 'Redeeming…';
      const result = await redeemCode(input.value);
      onResult(result);
      if (result.status === 'success') {
        msg.style.color = '#88ff88';
        msg.textContent = result.message;
        setTimeout(close, 900);
      } else {
        msg.style.color = '#ff9988';
        msg.textContent = result.message;
        busy = false;
        confirmBtn.disabled = false;
      }
    };

    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter')  void submit();
      if (e.key === 'Escape') close();
    });
    confirmBtn.addEventListener('click', () => void submit());
    cancelEl.addEventListener('click', close);
    overlay.addEventListener('click', (e: MouseEvent) => {
      if (e.target === overlay) close();
    });

    requestAnimationFrame(() => input.focus());
  }
```

- [ ] **Step 7: Build to verify no type/compile errors**

Run: `npm run build`
Expected: build succeeds with no errors. (Catches removed-import misuse, type mismatches, the deleted `coinBg`/`coinLabel` references.)

- [ ] **Step 8: Visual check (scene preview)**

Run:
```bash
npm run scene-preview -- MenuScene '{"_forceSettingsOpen":true}' pixel7
```
If the scene-preview flag for opening settings differs, open the menu manually via `npm run dev` instead. Confirm the Player tab shows, top → bottom: **REDEEM CODE** button, Analytics checkbox, Reset All Data — and that `+ 500 Coins` is gone.

- [ ] **Step 9: Commit**

```bash
git add src/scenes/MenuScene.ts
git commit -m "$(printf 'feat(codes): Player settings tab (renamed) + redeem code dialog\n\nRemoves the +500 Coins dev button; reorders to Codes/Analytics/Reset.\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 10: Admin UI — Reward Codes section

**Files:**
- Modify: `admin/index.html`

No automated test (static admin tool). Verified by loading the page against a local worker.

- [ ] **Step 1: Add the markup**

Insert this `<div class="section">` block immediately **before** `<div id="status"></div>` (line 167):

```html
  <div class="section section-codes">
    <h2>Reward Codes</h2>
    <div class="row">
      <div><label>Code</label><input type="text" id="rc-code" placeholder="LAUNCH2026" /></div>
      <div><label>Reward Type</label>
        <select id="rc-type">
          <option value="coins">coins</option>
          <option value="item">item</option>
        </select>
      </div>
    </div>
    <div class="row">
      <div id="rc-item-wrap" style="display:none"><label>Item</label>
        <select id="rc-item"></select>
      </div>
      <div><label>Amount</label><input type="number" step="1" min="1" id="rc-amount" value="500" /></div>
    </div>
    <div class="row">
      <div><label>Max Redemptions <span class="muted">(0 = unlimited)</span></label><input type="number" step="1" min="0" id="rc-max" value="0" /></div>
      <div><label>Expires At <span class="muted">(blank = never)</span></label><input type="datetime-local" id="rc-expires" /></div>
    </div>
    <button id="rc-create">Mint Code</button>
    <table style="margin-top:14px">
      <thead><tr><th>Code</th><th>Reward</th><th>Redeemed</th><th>Expires</th><th>Created</th></tr></thead>
      <tbody id="rc-tbody"><tr><td colspan="5" class="muted">not loaded</td></tr></tbody>
    </table>
  </div>
```

- [ ] **Step 2: Add the script logic**

Add these constants near the other top-level constants (after `FIELDS` on line 174):

```javascript
    const ITEM_IDS = ['ladder', 'ibeam', 'checkpoint', 'shield', 'revive', 'adrenaline', 'pogo', 'stall'];
```

Add these functions before the `// ────── Boot ──────` comment (after `bootCreateHeap`, ~line 435):

```javascript
    // ────── Reward Codes ─────────────────────────────────────────────────────

    async function loadCodes() {
      try {
        const res = await adminFetch('/codes');
        if (!res.ok) throw new Error('list failed: ' + res.status);
        const data = await res.json();
        renderCodesTable(data.codes || []);
      } catch (e) {
        setStatus(String(e), 'err');
      }
    }

    function renderCodesTable(codes) {
      const tbody = $('rc-tbody');
      if (!codes.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="muted">no codes</td></tr>';
        return;
      }
      tbody.innerHTML = codes.map(c => {
        const reward = c.reward_type === 'coins'
          ? (c.reward_amount + ' coins')
          : (c.reward_amount + '× ' + escapeHtml(c.reward_id || '?'));
        const cap = c.max_redemptions === 0 ? '∞' : c.max_redemptions;
        return '<tr>'
          + '<td>' + escapeHtml(c.code) + '</td>'
          + '<td>' + reward + '</td>'
          + '<td>' + c.redeemed_count + ' / ' + cap + '</td>'
          + '<td>' + escapeHtml(c.expires_at || '—') + '</td>'
          + '<td>' + escapeHtml(c.created_at) + '</td>'
          + '</tr>';
      }).join('');
    }

    async function onCreateCode() {
      const code = $('rc-code').value.trim().toUpperCase();
      const rewardType = $('rc-type').value;
      const rewardAmount = parseInt($('rc-amount').value, 10);
      const maxRedemptions = parseInt($('rc-max').value, 10) || 0;
      const expiresRaw = $('rc-expires').value;
      const expiresAt = expiresRaw ? new Date(expiresRaw).toISOString() : null;
      if (!code) { setStatus('code required', 'err'); return; }
      const body = { code, rewardType, rewardAmount, maxRedemptions, expiresAt };
      if (rewardType === 'item') body.rewardId = $('rc-item').value;
      try {
        const res = await adminFetch('/codes', { method: 'POST', body: JSON.stringify(body) });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error('mint failed: ' + res.status + ' ' + (err.error || ''));
        }
        setStatus('minted ' + code, 'ok');
        loadCodes();
      } catch (e) {
        setStatus(String(e), 'err');
      }
    }

    function bootRewardCodes() {
      $('rc-item').innerHTML = ITEM_IDS.map(id => '<option value="' + id + '">' + id + '</option>').join('');
      $('rc-type').onchange = () => {
        $('rc-item-wrap').style.display = $('rc-type').value === 'item' ? '' : 'none';
      };
      $('rc-create').onclick = onCreateCode;
      loadCodes();
    }
```

- [ ] **Step 3: Call the boot function**

In the `DOMContentLoaded` handler (line 439-444), add:

```javascript
      bootRewardCodes();
```

- [ ] **Step 4: Manual verification**

Run the local worker (`cd server && npx wrangler dev`) and open `admin/index.html` in a browser (or however the admin page is normally served). Set the admin secret if configured. Confirm:
- Mint a coins code → it appears in the table with `0 / ∞`.
- Switch Reward Type to `item` → the Item dropdown appears with the 8 ids.
- Mint an item code → appears with `N× <id>`.

- [ ] **Step 5: Commit**

```bash
git add admin/index.html
git commit -m "$(printf 'feat(codes): admin UI section to mint + list reward codes\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 11: Full verification + end-to-end smoke

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all suites PASS (client + shared). Then:
Run: `cd server && npx vitest run`
Expected: all server suites PASS.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors. (Per CLAUDE.md, this is the gate for "done".)

- [ ] **Step 3: Local end-to-end smoke**

With the local D1 migrated (Task 3) and the worker running (`cd server && npx wrangler dev`):
1. Mint a coins code in `admin/index.html` (e.g. `SMOKE`, 250 coins, max 0).
2. In the game (`npm run dev`), open Settings → **Player** tab → **REDEEM CODE**, enter `smoke`.
3. Confirm: dialog shows `✓ +250 coins`, the menu coin balance increases by 250, and the dialog auto-closes.
4. Re-redeem `smoke` → dialog shows `Already redeemed`, balance unchanged.
5. Enter a bogus code → `Code not found`.

- [ ] **Step 4: Remote migration reminder (do NOT auto-run)**

The production D1 needs migration 0008 before the live worker is deployed:
```bash
cd server && npx wrangler d1 migrations apply heap-db --remote
```
Leave this for the human to run at deploy time (matches the repo's migration discipline — remote migrations are applied deliberately, not as part of feature work). Note it in the PR description.

- [ ] **Step 5: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "$(printf 'chore(codes): verification fixups\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

(Skip if nothing changed.)

---

## Self-Review notes (author)

- **Spec coverage:** §1 data model → Task 3; §2 shared types → Tasks 1+2; §3 codeDb → Tasks 4+5; §4 routes → Task 6; §5 app/worker wiring → Tasks 6+7 (codeDb-in-opts deviation documented); §6 CodeClient → Task 8; §7 Player tab → Task 9; §8 admin UI → Task 10; testing → woven through + Task 11. Known limitation (client-held balances) needs no code.
- **Cap race (High finding):** `CHECK` constraint in Task 3 + atomic `batch()` in Task 4; cap-race behavior tested in Task 5.
- **RL_CODES wiring (Medium finding):** Task 7 covers `index.ts` `Env` + `limiters` + `wrangler.toml` explicitly.
- **Mint-time item validation (Medium finding):** Task 6 route validates `reward_id` against `shared/itemIds.ts` (Task 1); tested in Task 6.
- **Type consistency:** `RewardCodeRow`, `RedeemOutcome`, `RewardPayload`, `NormalizedCreateCode`, `RedeemResult` are defined once (Tasks 2/4/8) and reused; `redeemCode`, `createCode`, `redeem`, `listCodes`, `getCode` names are consistent across tasks.

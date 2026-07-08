# Player Write-Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Authenticate player-keyed write endpoints with a private per-player secret (trust-on-first-use), so a harvested public GUID can no longer be used to impersonate another player.

**Architecture:** Client stores a never-displayed `playerSecret` in SaveData and sends it as an `X-Player-Token` header on writes. Server stores SHA-256 hashes in a new `player_auth` table in the `heap_scores` D1 database and enforces a verify-or-claim matrix on `POST /scores`, `PUT /customization/:playerId`, and `POST /codes/redeem`. An `ADMIN_SECRET`-gated unclaim endpoint rescues hijacked GUIDs. Spec: `docs/superpowers/specs/2026-07-07-player-write-auth-design.md`.

**Tech Stack:** Cloudflare Worker (Hono), D1 (SQLite), `crypto.subtle` (SHA-256), Vitest, TypeScript client (Phaser game).

## Global Constraints

- Header name is exactly `X-Player-Token` (server constant `PLAYER_TOKEN_HEADER`).
- Server stores **only** SHA-256 hex hashes of secrets — never raw secrets. No API response ever contains a secret or hash.
- All auth-rejection responses are `{ error: 'forbidden' }` with status 403 — never reveal whether a GUID is claimed.
- Verify-or-claim matrix (from spec): token+unclaimed→claim+allow · token+match→allow · token+mismatch→403 · tokenless+unclaimed→allow (legacy) · tokenless+claimed→403.
- New route-factory parameters must be **optional** so existing tests and call sites keep working; when `authDb` is absent, behavior is legacy (allow all).
- Every 403 logs `auth:rejected` via `captureServer` (level `warn`) with `{ playerId, route, reason }`; every first claim logs `auth:claimed` (level `event`).
- Never edit an applied migration; `heap_scores` is currently at `0002`, this feature adds `0003`.
- Run all commands from repo root unless a step says otherwise. Tests: `npx vitest run <path>`. Full gate before completion: `npm test` **and** `npm run build`.
- Git: work on branch `feature/player-write-auth` (created in Task 1). Never push to main. Do not run destructive git commands (reset --hard, force push, checkout -- .).
- End commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Branch, migration, and PlayerAuthDB

**Files:**
- Create: `server/migrations/heap_scores/0003_player_auth.sql`
- Modify: `server/schema/heap_scores.sql`
- Create: `server/src/playerAuthDb.ts`
- Create: `server/tests/helpers/mockPlayerAuthDb.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `PlayerAuthDB` interface `{ getSecretHash(playerId: string): Promise<string | null>; insert(playerId: string, secretHash: string, now: string): Promise<void>; delete(playerId: string): Promise<void> }`, `D1PlayerAuthDB` class, `MockPlayerAuthDB` test helper with public `rows: Map<string, string>`.

- [ ] **Step 1: Create the feature branch and commit the approved spec**

```bash
git checkout main
git checkout -b feature/player-write-auth
git add docs/superpowers/specs/2026-07-07-player-write-auth-design.md
git commit -m "docs: add player write-auth design spec

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Note: `Todo/Todo.md` has unrelated user edits — do NOT stage it.

- [ ] **Step 2: Write the migration**

Create `server/migrations/heap_scores/0003_player_auth.sql`:

```sql
-- Player write-auth: per-player secret hashes, trust-on-first-use.
-- See docs/superpowers/specs/2026-07-07-player-write-auth-design.md
CREATE TABLE IF NOT EXISTS player_auth (
  player_id   TEXT NOT NULL PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
```

- [ ] **Step 3: Update the reference schema**

In `server/schema/heap_scores.sql`, append after the `player_customization` table:

```sql

CREATE TABLE IF NOT EXISTS player_auth (
  player_id   TEXT NOT NULL PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
```

- [ ] **Step 4: Apply the migration locally**

```bash
cd server && npx wrangler d1 migrations apply heap_scores --local && cd ..
```

Expected: `0003_player_auth.sql` listed as applied.

- [ ] **Step 5: Write `PlayerAuthDB` + D1 implementation**

Create `server/src/playerAuthDb.ts`:

```typescript
/** Abstraction over D1 for the player_auth table (write-auth secret hashes). */
export interface PlayerAuthDB {
  /** Returns the stored secret hash, or null if the player is unclaimed. */
  getSecretHash(playerId: string): Promise<string | null>;
  /** Claim a player id by storing its secret hash. */
  insert(playerId: string, secretHash: string, now: string): Promise<void>;
  /** Admin unclaim — removes the row so the next tokened write re-claims. */
  delete(playerId: string): Promise<void>;
}

export class D1PlayerAuthDB implements PlayerAuthDB {
  constructor(private d1: D1Database) {}

  async getSecretHash(playerId: string): Promise<string | null> {
    const row = await this.d1
      .prepare('SELECT secret_hash FROM player_auth WHERE player_id=?1')
      .bind(playerId)
      .first<{ secret_hash: string }>();
    return row?.secret_hash ?? null;
  }

  async insert(playerId: string, secretHash: string, now: string): Promise<void> {
    await this.d1
      .prepare('INSERT OR IGNORE INTO player_auth (player_id, secret_hash, created_at) VALUES (?1, ?2, ?3)')
      .bind(playerId, secretHash, now)
      .run();
  }

  async delete(playerId: string): Promise<void> {
    await this.d1
      .prepare('DELETE FROM player_auth WHERE player_id=?1')
      .bind(playerId)
      .run();
  }
}
```

- [ ] **Step 6: Write the mock**

Create `server/tests/helpers/mockPlayerAuthDb.ts`:

```typescript
import type { PlayerAuthDB } from '../../src/playerAuthDb';

/** In-memory PlayerAuthDB for tests. Same semantics as D1PlayerAuthDB. */
export class MockPlayerAuthDB implements PlayerAuthDB {
  rows = new Map<string, string>();

  async getSecretHash(playerId: string): Promise<string | null> {
    return this.rows.get(playerId) ?? null;
  }

  async insert(playerId: string, secretHash: string, _now: string): Promise<void> {
    if (!this.rows.has(playerId)) this.rows.set(playerId, secretHash);
  }

  async delete(playerId: string): Promise<void> {
    this.rows.delete(playerId);
  }
}
```

- [ ] **Step 7: Verify it compiles and commit**

```bash
npm run build
git add server/migrations/heap_scores/0003_player_auth.sql server/schema/heap_scores.sql server/src/playerAuthDb.ts server/tests/helpers/mockPlayerAuthDb.ts
git commit -m "feat(server): player_auth table + PlayerAuthDB repo

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Expected: build passes (do not stage `.wrangler/state/`).

---

### Task 2: hashSecret + verifyOrClaim + enforcePlayerAuth

**Files:**
- Create: `server/src/playerAuth.ts`
- Test: `server/tests/playerAuth.test.ts`

**Interfaces:**
- Consumes: `PlayerAuthDB` from Task 1.
- Produces (used by Tasks 3–6):
  - `PLAYER_TOKEN_HEADER = 'X-Player-Token'`
  - `type AuthOutcome = 'claimed' | 'verified' | 'legacy' | 'rejected-mismatch' | 'rejected-tokenless-claimed'`
  - `hashSecret(secret: string): Promise<string>` — SHA-256 hex
  - `verifyOrClaim(db: PlayerAuthDB, playerId: string, token: string | undefined, now: string): Promise<AuthOutcome>`
  - `enforcePlayerAuth(c: Context, db: PlayerAuthDB | undefined, playerId: string, getSink: () => Sink | undefined, route: string): Promise<Response | null>` — returns a 403 `Response` on rejection, `null` when the write may proceed.

- [ ] **Step 1: Write the failing tests**

Create `server/tests/playerAuth.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { hashSecret, verifyOrClaim } from '../src/playerAuth';
import { MockPlayerAuthDB } from './helpers/mockPlayerAuthDb';

const NOW = '2026-07-07T00:00:00.000Z';

describe('hashSecret', () => {
  it('produces the known SHA-256 hex of "hello"', async () => {
    expect(await hashSecret('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('is deterministic and distinct per input', async () => {
    expect(await hashSecret('a')).toBe(await hashSecret('a'));
    expect(await hashSecret('a')).not.toBe(await hashSecret('b'));
  });
});

describe('verifyOrClaim', () => {
  it('token + unclaimed → claimed, and stores the hash', async () => {
    const db = new MockPlayerAuthDB();
    expect(await verifyOrClaim(db, 'p1', 'secret-1', NOW)).toBe('claimed');
    expect(db.rows.get('p1')).toBe(await hashSecret('secret-1'));
  });

  it('token + matching claim → verified', async () => {
    const db = new MockPlayerAuthDB();
    await verifyOrClaim(db, 'p1', 'secret-1', NOW);
    expect(await verifyOrClaim(db, 'p1', 'secret-1', NOW)).toBe('verified');
  });

  it('token + mismatched claim → rejected-mismatch, hash unchanged', async () => {
    const db = new MockPlayerAuthDB();
    await verifyOrClaim(db, 'p1', 'secret-1', NOW);
    expect(await verifyOrClaim(db, 'p1', 'wrong', NOW)).toBe('rejected-mismatch');
    expect(db.rows.get('p1')).toBe(await hashSecret('secret-1'));
  });

  it('no token + unclaimed → legacy', async () => {
    const db = new MockPlayerAuthDB();
    expect(await verifyOrClaim(db, 'p1', undefined, NOW)).toBe('legacy');
    expect(db.rows.has('p1')).toBe(false);
  });

  it('no token + claimed → rejected-tokenless-claimed', async () => {
    const db = new MockPlayerAuthDB();
    await verifyOrClaim(db, 'p1', 'secret-1', NOW);
    expect(await verifyOrClaim(db, 'p1', undefined, NOW)).toBe('rejected-tokenless-claimed');
  });

  it('empty-string token is treated as no token', async () => {
    const db = new MockPlayerAuthDB();
    expect(await verifyOrClaim(db, 'p1', '', NOW)).toBe('legacy');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/tests/playerAuth.test.ts`
Expected: FAIL — cannot resolve `../src/playerAuth`.

- [ ] **Step 3: Implement**

Create `server/src/playerAuth.ts`:

```typescript
// Player write-auth: trust-on-first-use secret verification.
// See docs/superpowers/specs/2026-07-07-player-write-auth-design.md

import type { Context } from 'hono';
import type { PlayerAuthDB } from './playerAuthDb';
import type { Sink } from './logging/Sink';
import { captureServer } from './logging/captureServerEvent';

export const PLAYER_TOKEN_HEADER = 'X-Player-Token';

export type AuthOutcome =
  | 'claimed'
  | 'verified'
  | 'legacy'
  | 'rejected-mismatch'
  | 'rejected-tokenless-claimed';

/** SHA-256 hex digest. Raw secrets are never stored — only this hash. */
export async function hashSecret(secret: string): Promise<string> {
  const data = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyOrClaim(
  db: PlayerAuthDB,
  playerId: string,
  token: string | undefined,
  now: string,
): Promise<AuthOutcome> {
  const stored = await db.getSecretHash(playerId);
  if (!token) return stored === null ? 'legacy' : 'rejected-tokenless-claimed';

  const hash = await hashSecret(token);
  if (stored === null) {
    await db.insert(playerId, hash, now);
    return 'claimed';
  }
  return stored === hash ? 'verified' : 'rejected-mismatch';
}

/**
 * Route-level gate. Returns a generic 403 Response when the write must be
 * rejected, or null when it may proceed. When `db` is undefined (tests, or
 * feature not wired) behavior is legacy: always allow.
 */
export async function enforcePlayerAuth(
  c: Context,
  db: PlayerAuthDB | undefined,
  playerId: string,
  getSink: () => Sink | undefined,
  route: string,
): Promise<Response | null> {
  if (!db) return null;

  const token = c.req.header(PLAYER_TOKEN_HEADER) || undefined;
  const outcome = await verifyOrClaim(db, playerId, token, new Date().toISOString());

  const sink = getSink();
  if (outcome === 'claimed' && sink) {
    await captureServer(sink, 'event', 'auth:claimed', { playerId, route });
  }
  if (outcome === 'rejected-mismatch' || outcome === 'rejected-tokenless-claimed') {
    const reason = outcome === 'rejected-mismatch' ? 'mismatch' : 'tokenless-claimed';
    console.warn(`[auth] reject: ${reason} playerId=${playerId} route=${route}`);
    if (sink) {
      await captureServer(sink, 'warn', 'auth:rejected', { playerId, route, reason });
    }
    return c.json({ error: 'forbidden' }, 403);
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/tests/playerAuth.test.ts`
Expected: 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/playerAuth.ts server/tests/playerAuth.test.ts
git commit -m "feat(server): hashSecret + verifyOrClaim TOFU core

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Enforce on POST /scores

**Files:**
- Modify: `server/src/routes/scores.ts` (signature + one gate before upsert)
- Modify: `server/src/app.ts` (AppOptions + pass-through)
- Test: `server/tests/authEnforcement.test.ts` (new file, scores section)

**Interfaces:**
- Consumes: `enforcePlayerAuth`, `PLAYER_TOKEN_HEADER` from Task 2; `PlayerAuthDB`/`MockPlayerAuthDB` from Task 1.
- Produces: `scoreRoutes(scoreDb, heapDb, getSink, authDb?)` — 4th param optional. `AppOptions.playerAuthDb?: PlayerAuthDB`.

- [ ] **Step 1: Write the failing tests**

Create `server/tests/authEnforcement.test.ts`:

```typescript
// Route-level tests for the player write-auth TOFU matrix.
import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockPlayerAuthDB } from './helpers/mockPlayerAuthDb';
import { MockSink } from './helpers/mockSink';
import { hashSecret } from '../src/playerAuth';

const HEAP_ID = 'heap-test-001';
const PLAYER = 'player-aaa';
const SECRET = 'secret-aaa';

function makeApp(authDb = new MockPlayerAuthDB(), sink = new MockSink()) {
  const heapDb = new MockHeapDB();
  heapDb.seedHeap(HEAP_ID, 1, []);
  const app = createApp(heapDb, new MockScoreDB(), {
    playerAuthDb: authDb,
    logSink: sink,
  });
  return { app, authDb, sink };
}

function scoreBody(playerId = PLAYER) {
  return {
    heapId: HEAP_ID,
    playerId,
    playerName: 'Trashbag#00001',
    inputs: { baseHeightPx: 1000, kills: { percher: 0, ghost: 0 }, elapsedMs: 60_000, isFailure: true },
  };
}

async function submit(app: ReturnType<typeof makeApp>['app'], token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== undefined) headers['X-Player-Token'] = token;
  return app.request('/scores', { method: 'POST', headers, body: JSON.stringify(scoreBody()) });
}

describe('POST /scores auth', () => {
  it('token + unclaimed: claims and accepts, logs auth:claimed', async () => {
    const { app, authDb, sink } = makeApp();
    const res = await submit(app, SECRET);
    expect(res.status).toBe(200);
    expect(authDb.rows.get(PLAYER)).toBe(await hashSecret(SECRET));
    expect(sink.written.some((e) => e.eventType === 'auth:claimed')).toBe(true);
  });

  it('token + matching claim: accepts without re-claim log', async () => {
    const { app, sink } = makeApp();
    await submit(app, SECRET);
    const before = sink.written.filter((e) => e.eventType === 'auth:claimed').length;
    const res = await submit(app, SECRET);
    expect(res.status).toBe(200);
    expect(sink.written.filter((e) => e.eventType === 'auth:claimed').length).toBe(before);
  });

  it('token mismatch: 403 generic body, logs auth:rejected reason=mismatch', async () => {
    const { app, sink } = makeApp();
    await submit(app, SECRET);
    const res = await submit(app, 'wrong-secret');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    const rej = sink.written.find((e) => e.eventType === 'auth:rejected');
    expect(rej?.payload).toMatchObject({ playerId: PLAYER, reason: 'mismatch' });
  });

  it('no token + unclaimed: accepts (legacy client)', async () => {
    const { app } = makeApp();
    expect((await submit(app)).status).toBe(200);
  });

  it('no token + claimed: 403, logs reason=tokenless-claimed', async () => {
    const { app, sink } = makeApp();
    await submit(app, SECRET);
    const res = await submit(app);
    expect(res.status).toBe(403);
    const rej = sink.written.find((e) => e.eventType === 'auth:rejected');
    expect(rej?.payload).toMatchObject({ reason: 'tokenless-claimed' });
  });

  it('rejected submit does not change the leaderboard', async () => {
    const { app } = makeApp();
    await submit(app, SECRET);
    await submit(app, 'wrong-secret');
    const res = await app.request(`/scores/${HEAP_ID}`);
    const data = (await res.json()) as { entries: { name: string }[] };
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].name).toBe('Trashbag#00001');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/tests/authEnforcement.test.ts`
Expected: FAIL — `playerAuthDb` not in `AppOptions` (TS error) / 403s never returned.

- [ ] **Step 3: Wire authDb through app.ts**

In `server/src/app.ts`:

Add import:

```typescript
import type { PlayerAuthDB } from './playerAuthDb';
```

Add to `AppOptions` (after `customizationDb`):

```typescript
  /** Player write-auth (player_auth table in heap_scores). If unset, writes are not enforced. */
  playerAuthDb?: PlayerAuthDB;
```

Change the scores mount:

```typescript
  app.route('/scores', scoreRoutes(scoreDb, heapDb, () => opts.logSink, opts.playerAuthDb));
```

- [ ] **Step 4: Gate the scores route**

In `server/src/routes/scores.ts`:

Add imports:

```typescript
import type { PlayerAuthDB } from '../playerAuthDb';
import { enforcePlayerAuth } from '../playerAuth';
```

Change the factory signature:

```typescript
export function scoreRoutes(
  scoreDb: ScoreDB,
  heapDb: HeapDB,
  getSink: () => Sink | undefined,
  authDb?: PlayerAuthDB,
): Hono {
```

Insert the gate **after** the `finalScore <= 0` rejection block and **before** the `const limit = ...` line, so claims only happen on otherwise-valid submissions:

```typescript
    // Write-auth: verify-or-claim before any state change.
    const authRes = await enforcePlayerAuth(c, authDb, playerId, getSink, 'scores:submit');
    if (authRes) return authRes;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run server/tests/authEnforcement.test.ts server/tests/scores.test.ts`
Expected: all PASS (existing scores tests unaffected — they pass no `playerAuthDb`).

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/scores.ts server/src/app.ts server/tests/authEnforcement.test.ts
git commit -m "feat(server): enforce player write-auth on POST /scores

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Enforce on PUT /customization/:playerId

**Files:**
- Modify: `server/src/routes/customization.ts`
- Modify: `server/src/app.ts` (pass sink + authDb)
- Test: `server/tests/authEnforcement.test.ts` (append section)

**Interfaces:**
- Consumes: `enforcePlayerAuth` (Task 2), `AppOptions.playerAuthDb` (Task 3).
- Produces: `customizationRoutes(db, getSink?, authDb?)` — new optional params, default `getSink = () => undefined`.

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/authEnforcement.test.ts`:

```typescript
import { MockCustomizationDB } from './helpers/mockCustomizationDb';

function makeCustomizationApp(authDb = new MockPlayerAuthDB(), sink = new MockSink()) {
  const heapDb = new MockHeapDB();
  const app = createApp(heapDb, new MockScoreDB(), {
    customizationDb: new MockCustomizationDB(),
    playerAuthDb: authDb,
    logSink: sink,
  });
  return { app, authDb, sink };
}

async function putLoadout(app: ReturnType<typeof makeCustomizationApp>['app'], token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== undefined) headers['X-Player-Token'] = token;
  return app.request(`/customization/${PLAYER}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ loadout: { hat: 'hat_cone' } }),
  });
}

describe('PUT /customization/:playerId auth', () => {
  it('token + unclaimed: claims and accepts', async () => {
    const { app, authDb } = makeCustomizationApp();
    expect((await putLoadout(app, SECRET)).status).toBe(200);
    expect(authDb.rows.has(PLAYER)).toBe(true);
  });

  it('token mismatch: 403 and loadout unchanged', async () => {
    const { app } = makeCustomizationApp();
    await putLoadout(app, SECRET);
    const res = await putLoadout(app, 'wrong-secret');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('no token + claimed: 403, logs auth:rejected', async () => {
    const { app, sink } = makeCustomizationApp();
    await putLoadout(app, SECRET);
    expect((await putLoadout(app)).status).toBe(403);
    expect(sink.written.some((e) => e.eventType === 'auth:rejected')).toBe(true);
  });

  it('no token + unclaimed: accepts (legacy client)', async () => {
    const { app } = makeCustomizationApp();
    expect((await putLoadout(app)).status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/tests/authEnforcement.test.ts`
Expected: new `customization` tests FAIL (403s never returned).

- [ ] **Step 3: Gate the route**

Replace `server/src/routes/customization.ts` header and signature:

```typescript
import { Hono } from 'hono';
import type { CustomizationDB } from '../customizationDb';
import type { PlayerAuthDB } from '../playerAuthDb';
import type { Sink } from '../logging/Sink';
import { enforcePlayerAuth } from '../playerAuth';
import { validateLoadout, MAX_LOADOUT_JSON_LEN } from '../../../shared/cosmeticCatalog';

const MAX_ID_LEN = 64;

export function customizationRoutes(
  db: CustomizationDB,
  getSink: () => Sink | undefined = () => undefined,
  authDb?: PlayerAuthDB,
): Hono {
```

Insert the gate after the `json.length > MAX_LOADOUT_JSON_LEN` check, before `db.upsertLoadout`:

```typescript
    const authRes = await enforcePlayerAuth(c, authDb, playerId, getSink, 'customization:put');
    if (authRes) return authRes;
```

- [ ] **Step 4: Update the app.ts mount**

In `server/src/app.ts` change:

```typescript
    app.route('/customization', customizationRoutes(opts.customizationDb));
```

to:

```typescript
    app.route('/customization', customizationRoutes(opts.customizationDb, () => opts.logSink, opts.playerAuthDb));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run server/tests/authEnforcement.test.ts server/tests/customization.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/customization.ts server/src/app.ts server/tests/authEnforcement.test.ts
git commit -m "feat(server): enforce player write-auth on PUT /customization

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Enforce on POST /codes/redeem

**Files:**
- Modify: `server/src/routes/codes.ts`
- Modify: `server/src/app.ts`
- Test: `server/tests/authEnforcement.test.ts` (append section)

**Interfaces:**
- Consumes: `enforcePlayerAuth` (Task 2), `AppOptions.playerAuthDb` (Task 3), `MockCodeDB` (existing helper).
- Produces: `codeRoutes(codeDb, getSink, authDb?)` — 3rd param optional. Admin mint/list routes are NOT gated by player auth (admin gate already covers them).

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/authEnforcement.test.ts`:

```typescript
import { MockCodeDB } from './helpers/mockCodeDb';

async function makeCodesApp(authDb = new MockPlayerAuthDB(), sink = new MockSink()) {
  const codeDb = new MockCodeDB();
  await codeDb.createCode(
    { code: 'WELCOME', rewardType: 'coins', rewardId: null, rewardAmount: 100, maxRedemptions: 0, expiresAt: null },
    '2026-07-07T00:00:00.000Z',
  );
  const app = createApp(new MockHeapDB(), new MockScoreDB(), {
    codeDb,
    playerAuthDb: authDb,
    logSink: sink,
  });
  return { app, authDb, sink };
}

async function redeem(app: Awaited<ReturnType<typeof makeCodesApp>>['app'], token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== undefined) headers['X-Player-Token'] = token;
  return app.request('/codes/redeem', {
    method: 'POST',
    headers,
    body: JSON.stringify({ code: 'WELCOME', playerGuid: PLAYER }),
  });
}

describe('POST /codes/redeem auth', () => {
  it('token + unclaimed: claims and redeems', async () => {
    const { app, authDb } = await makeCodesApp();
    expect((await redeem(app, SECRET)).status).toBe(200);
    expect(authDb.rows.has(PLAYER)).toBe(true);
  });

  it('token mismatch: 403 and the code is not consumed', async () => {
    const { app } = await makeCodesApp();
    await redeem(app, SECRET); // claims + consumes for PLAYER
    const res = await redeem(app, 'wrong-secret');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('no token + claimed: 403', async () => {
    const { app } = await makeCodesApp();
    await redeem(app, SECRET);
    expect((await redeem(app)).status).toBe(403);
  });

  it('no token + unclaimed: redeems (legacy client)', async () => {
    const { app } = await makeCodesApp();
    expect((await redeem(app)).status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/tests/authEnforcement.test.ts`
Expected: new `codes` tests FAIL.

- [ ] **Step 3: Gate the redeem route**

In `server/src/routes/codes.ts`:

Add imports:

```typescript
import type { PlayerAuthDB } from '../playerAuthDb';
import { enforcePlayerAuth } from '../playerAuth';
```

Change the signature:

```typescript
export function codeRoutes(
  codeDb: RewardCodeDB,
  getSink: () => Sink | undefined,
  authDb?: PlayerAuthDB,
): Hono {
```

Insert the gate after the `!code || ... || !guid || ...` 400 rejection, before `const now = ...`:

```typescript
    const authRes = await enforcePlayerAuth(c, authDb, guid, getSink, 'codes:redeem');
    if (authRes) return authRes;
```

- [ ] **Step 4: Update the app.ts mount**

In `server/src/app.ts` change:

```typescript
    app.route('/codes', codeRoutes(opts.codeDb, () => opts.logSink));
```

to:

```typescript
    app.route('/codes', codeRoutes(opts.codeDb, () => opts.logSink, opts.playerAuthDb));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run server/tests/authEnforcement.test.ts server/tests/codes.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/codes.ts server/src/app.ts server/tests/authEnforcement.test.ts
git commit -m "feat(server): enforce player write-auth on POST /codes/redeem

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: CORS header, admin unclaim, worker wiring

**Files:**
- Create: `server/src/routes/auth.ts`
- Modify: `server/src/app.ts` (CORS `allowHeaders`, mount `/auth`)
- Modify: `server/src/index.ts` (bind `D1PlayerAuthDB`)
- Test: `server/tests/authEnforcement.test.ts` (append section)

**Interfaces:**
- Consumes: `PlayerAuthDB` (Task 1), `AppOptions.playerAuthDb` (Task 3), existing `requireAdminSecret` gate.
- Produces: `authAdminRoutes(authDb: PlayerAuthDB): Hono` exposing `DELETE /:playerId`; worker env wires `playerAuthDb: new D1PlayerAuthDB(env.DB_SCORES)`.

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/authEnforcement.test.ts`:

```typescript
describe('admin unclaim + CORS', () => {
  it('preflight allows the X-Player-Token header', async () => {
    const { app } = makeApp();
    const res = await app.request('/scores', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://example.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, X-Player-Token',
      },
    });
    expect(res.headers.get('Access-Control-Allow-Headers') ?? '').toContain('X-Player-Token');
  });

  it('DELETE /auth/:playerId requires the admin secret', async () => {
    const authDb = new MockPlayerAuthDB();
    const app = createApp(new MockHeapDB(), new MockScoreDB(), {
      playerAuthDb: authDb,
      adminSecret: 's3cret',
    });
    expect((await app.request(`/auth/${PLAYER}`, { method: 'DELETE' })).status).toBe(401);
  });

  it('admin unclaim deletes the row and the player can re-claim', async () => {
    const { app: scoreApp, authDb } = makeApp();
    await submit(scoreApp, SECRET);
    expect(authDb.rows.has(PLAYER)).toBe(true);

    const adminApp = createApp(new MockHeapDB(), new MockScoreDB(), {
      playerAuthDb: authDb,
      adminSecret: 's3cret',
    });
    const res = await adminApp.request(`/auth/${PLAYER}`, {
      method: 'DELETE',
      headers: { 'X-Admin-Secret': 's3cret' },
    });
    expect(res.status).toBe(200);
    expect(authDb.rows.has(PLAYER)).toBe(false);

    // Player re-claims with a NEW secret after rescue.
    expect((await submit(scoreApp, 'new-secret')).status).toBe(200);
    expect(authDb.rows.has(PLAYER)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/tests/authEnforcement.test.ts`
Expected: FAIL — allow-headers missing token header; `/auth` 404s.

- [ ] **Step 3: Implement the admin route**

Create `server/src/routes/auth.ts`:

```typescript
import { Hono } from 'hono';
import type { PlayerAuthDB } from '../playerAuthDb';

/** Admin-only rescue surface (adminGate applied in app.ts). */
export function authAdminRoutes(authDb: PlayerAuthDB): Hono {
  const app = new Hono();

  // DELETE /auth/:playerId — unclaim a hijacked GUID; next tokened write re-claims.
  app.delete('/:playerId', async (c) => {
    await authDb.delete(c.req.param('playerId'));
    return c.json({ ok: true });
  });

  return app;
}
```

- [ ] **Step 4: Wire CORS + mount in app.ts**

In `server/src/app.ts`:

Add import:

```typescript
import { authAdminRoutes } from './routes/auth';
```

Change the CORS `allowHeaders` line to:

```typescript
    allowHeaders: ['Content-Type', 'X-Admin-Secret', 'X-Player-Token'],
```

After the `customizationDb` mount block, add:

```typescript
  if (opts.playerAuthDb) {
    // Admin rescue: unclaim a player_auth row.
    app.delete('/auth/:playerId', adminGate);
    app.route('/auth', authAdminRoutes(opts.playerAuthDb));
  }
```

- [ ] **Step 5: Wire the worker entry**

In `server/src/index.ts`:

Add import:

```typescript
import { D1PlayerAuthDB } from './playerAuthDb';
```

Add to the `createApp` options (after `customizationDb`):

```typescript
      playerAuthDb:    new D1PlayerAuthDB(env.DB_SCORES),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run server/tests/ && npm run build`
Expected: all server tests PASS, build clean.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/auth.ts server/src/app.ts server/src/index.ts server/tests/authEnforcement.test.ts
git commit -m "feat(server): X-Player-Token CORS + admin unclaim + worker wiring

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Client secret — SaveData + authToken helper

**Files:**
- Modify: `src/systems/SaveData.ts` (`playerSecret` field + getter)
- Create: `src/systems/authToken.ts`
- Test: `src/systems/__tests__/SaveData.test.ts` (append), `src/systems/__tests__/authToken.test.ts` (new)

**Interfaces:**
- Consumes: existing `generateGuid()`, `load()`, `persist()` internals of SaveData; `getLogger`/`setLogger` from `src/logging/index.ts`.
- Produces (used by Task 8):
  - `getPlayerSecret(): string` exported from `src/systems/SaveData.ts`
  - `authHeaders(): Record<string, string>` and `logIfAuthRejected(route: string, status: number): void` exported from `src/systems/authToken.ts`

- [ ] **Step 1: Write the failing SaveData tests**

Append to `src/systems/__tests__/SaveData.test.ts` (add `getPlayerSecret` to the existing import list from `../SaveData`; the file already stubs `localStorage` and calls `resetAllData()`/`resetCacheForTests()` in its setup — follow its existing `beforeEach` conventions):

```typescript
describe('getPlayerSecret', () => {
  it('generates once, persists, and survives a cache reset', () => {
    const first = getPlayerSecret();
    expect(first.length).toBeGreaterThanOrEqual(16);
    expect(getPlayerSecret()).toBe(first);
    resetCacheForTests();
    expect(getPlayerSecret()).toBe(first); // reloaded from storage, not regenerated
  });

  it('is distinct from the public playerGuid', () => {
    expect(getPlayerSecret()).not.toBe(getPlayerGuid());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/systems/__tests__/SaveData.test.ts`
Expected: FAIL — `getPlayerSecret` is not exported.

- [ ] **Step 3: Implement in SaveData**

In `src/systems/SaveData.ts`:

Add to the `RawSave` interface after `playerGuid: string;`:

```typescript
  playerSecret?:  string;   // private write-auth token — never displayed, never logged
```

Add after `getEffectivePlayerId` (~line 421):

```typescript
/** Private write-auth secret, sent as X-Player-Token on server writes.
 *  Lazily backfilled for saves that predate it; rides in cloud saves. */
export function getPlayerSecret(): string {
  const s = load();
  if (!s.playerSecret) {
    s.playerSecret = generateGuid();
    persist(s);
  }
  return s.playerSecret;
}
```

(Lazy backfill covers every schema version without touching `migrate()`, including cloud-save restores of older blobs.)

- [ ] **Step 4: Run SaveData tests to verify they pass**

Run: `npx vitest run src/systems/__tests__/SaveData.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing authToken tests**

Create `src/systems/__tests__/authToken.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Logger } from '../../../shared/logging/Logger';

vi.mock('../SaveData', () => ({
  getPlayerSecret: () => 'secret-123',
}));

import { authHeaders, logIfAuthRejected } from '../authToken';
import { setLogger, _resetLoggerForTests } from '../../logging';

afterEach(() => _resetLoggerForTests());

function spyLogger() {
  const error = vi.fn();
  const logger: Logger = { error, warn: vi.fn(), event: vi.fn(), setVerbose: vi.fn() };
  setLogger(logger);
  return { error };
}

describe('authHeaders', () => {
  it('returns the X-Player-Token header with the player secret', () => {
    expect(authHeaders()).toEqual({ 'X-Player-Token': 'secret-123' });
  });
});

describe('logIfAuthRejected', () => {
  it('logs an error-level auth:rejected event on 403', () => {
    const { error } = spyLogger();
    logIfAuthRejected('scores:submit', 403);
    expect(error).toHaveBeenCalledWith('auth:rejected', { route: 'scores:submit', status: 403 });
  });

  it('does nothing for other statuses', () => {
    const { error } = spyLogger();
    logIfAuthRejected('scores:submit', 500);
    logIfAuthRejected('scores:submit', 200);
    expect(error).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx vitest run src/systems/__tests__/authToken.test.ts`
Expected: FAIL — cannot resolve `../authToken`.

- [ ] **Step 7: Implement authToken**

Create `src/systems/authToken.ts`:

```typescript
// Client side of player write-auth: attach the private secret to server
// writes and surface rejections in remote telemetry.
// See docs/superpowers/specs/2026-07-07-player-write-auth-design.md

import { getPlayerSecret } from './SaveData';
import { getLogger } from '../logging';

export const PLAYER_TOKEN_HEADER = 'X-Player-Token';

/** Header object to spread into fetch init headers on write requests. */
export function authHeaders(): Record<string, string> {
  return { [PLAYER_TOKEN_HEADER]: getPlayerSecret() };
}

/** Error-level remote log on 403 so lockouts show up in heap_logs triage. */
export function logIfAuthRejected(route: string, status: number): void {
  if (status === 403) {
    getLogger().error('auth:rejected', { route, status });
  }
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/systems/__tests__/authToken.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/systems/SaveData.ts src/systems/authToken.ts src/systems/__tests__/SaveData.test.ts src/systems/__tests__/authToken.test.ts
git commit -m "feat(client): playerSecret in SaveData + authToken helper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Attach the token in ScoreClient, CustomizationClient, CodeClient

**Files:**
- Modify: `src/systems/ScoreClient.ts` (`submitScore` only)
- Modify: `src/systems/CustomizationClient.ts` (`putLoadout`)
- Modify: `src/systems/CodeClient.ts` (`redeemCode`)
- Test: `src/systems/__tests__/ScoreClient.test.ts` (append), `src/systems/__tests__/CodeClient.test.ts` (append), `src/systems/__tests__/CustomizationClient.test.ts` (new)

**Interfaces:**
- Consumes: `authHeaders`, `logIfAuthRejected` from Task 7.
- Produces: no new exports — behavior change only. GET/read calls are NOT touched.

- [ ] **Step 1: Write the failing tests**

In `src/systems/__tests__/ScoreClient.test.ts`, add near the other mocks (before the `await import`):

```typescript
vi.mock('../authToken', () => ({
  authHeaders: () => ({ 'X-Player-Token': 'secret-test' }),
  logIfAuthRejected: vi.fn(),
}));
import { logIfAuthRejected } from '../authToken';
```

Append inside `describe('ScoreClient.submitScore', ...)`:

```typescript
  it('sends the X-Player-Token header', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ submitted: true, context: MOCK_CONTEXT }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await ScoreClient.submitScore({
      heapId: 'heap-1', playerId: 'p1', playerName: 'Alpha', inputs: MOCK_INPUTS,
    });
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers['X-Player-Token']).toBe('secret-test');
  });

  it('reports a 403 rejection to the remote logger', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false, status: 403,
      clone: () => ({ text: async () => '' }),
    }));
    const result = await ScoreClient.submitScore({
      heapId: 'heap-1', playerId: 'p1', playerName: 'Alpha', inputs: MOCK_INPUTS,
    });
    expect(result).toBeNull();
    expect(vi.mocked(logIfAuthRejected)).toHaveBeenCalledWith('scores:submit', 403);
  });
```

In `src/systems/__tests__/CodeClient.test.ts`, add alongside the existing `vi.mock` calls:

```typescript
vi.mock('../authToken', () => ({
  authHeaders: () => ({ 'X-Player-Token': 'secret-test' }),
  logIfAuthRejected: vi.fn(),
}));
```

Append inside `describe('redeemCode', ...)`:

```typescript
  it('sends the X-Player-Token header', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, { rewardType: 'coins', rewardAmount: 100 }));
    await redeemCode('welcome');
    const init = fetchWithLog.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers['X-Player-Token']).toBe('secret-test');
  });

  it('returns error status on 403 (claimed by another secret)', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(403, { error: 'forbidden' }));
    const result = await redeemCode('welcome');
    expect(result.status).toBe('error');
  });
```

Create `src/systems/__tests__/CustomizationClient.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../authToken', () => ({
  authHeaders: () => ({ 'X-Player-Token': 'secret-test' }),
  logIfAuthRejected: vi.fn(),
}));
const fetchWithLog = vi.fn();
vi.mock('../../logging/fetchWithLog', () => ({
  fetchWithLog: (...args: unknown[]) => fetchWithLog(...args),
}));

import { CustomizationClient } from '../CustomizationClient';
import { logIfAuthRejected } from '../authToken';

describe('CustomizationClient.putLoadout', () => {
  beforeEach(() => { fetchWithLog.mockReset(); vi.mocked(logIfAuthRejected).mockClear(); });

  it('sends the X-Player-Token header and returns true on 200', async () => {
    fetchWithLog.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    const ok = await CustomizationClient.putLoadout('p1', { hat: 'hat_cone' });
    expect(ok).toBe(true);
    const init = fetchWithLog.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers['X-Player-Token']).toBe('secret-test');
  });

  it('returns false and reports the rejection on 403', async () => {
    fetchWithLog.mockResolvedValue(new Response('{"error":"forbidden"}', { status: 403 }));
    const ok = await CustomizationClient.putLoadout('p1', { hat: 'hat_cone' });
    expect(ok).toBe(false);
    expect(vi.mocked(logIfAuthRejected)).toHaveBeenCalledWith('customization:put', 403);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/systems/__tests__/ScoreClient.test.ts src/systems/__tests__/CodeClient.test.ts src/systems/__tests__/CustomizationClient.test.ts`
Expected: new tests FAIL (header missing / logIfAuthRejected never called).

- [ ] **Step 3: Wire the three clients**

`src/systems/ScoreClient.ts` — add import:

```typescript
import { authHeaders, logIfAuthRejected } from './authToken';
```

In `submitScore`, change the fetch headers line to:

```typescript
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
```

and change `if (!res.ok) return null;` to:

```typescript
      if (!res.ok) {
        logIfAuthRejected('scores:submit', res.status);
        return null;
      }
```

`src/systems/CustomizationClient.ts` — add the same import; change the fetch headers line the same way, and change `return res.ok;` to:

```typescript
      if (!res.ok) logIfAuthRejected('customization:put', res.status);
      return res.ok;
```

`src/systems/CodeClient.ts` — add the same import; change the fetch headers line to `headers: { 'Content-Type': 'application/json', ...authHeaders() },` and add immediately after the `if (res.ok) { ... }` block (before the `switch`):

```typescript
  logIfAuthRejected('codes:redeem', res.status);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/systems/__tests__/ScoreClient.test.ts src/systems/__tests__/CodeClient.test.ts src/systems/__tests__/CustomizationClient.test.ts`
Expected: all PASS (including pre-existing tests in those files).

- [ ] **Step 5: Commit**

```bash
git add src/systems/ScoreClient.ts src/systems/CustomizationClient.ts src/systems/CodeClient.ts src/systems/__tests__/ScoreClient.test.ts src/systems/__tests__/CodeClient.test.ts src/systems/__tests__/CustomizationClient.test.ts
git commit -m "feat(client): send X-Player-Token on score/loadout/code writes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Full verification

**Files:** none new.

**Interfaces:**
- Consumes: everything above.
- Produces: a green branch ready for smoke test + PR.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all suites PASS, zero failures. If anything fails, fix before proceeding — do not skip.

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: clean TypeScript build (catches TS errors tests miss — required before claiming done).

- [ ] **Step 3: Manual matrix spot-check against local worker (optional but recommended)**

With the local worker running (`cd server && npx wrangler dev` — check whether the user's is already running first):

```bash
# tokened claim
curl -si -X PUT http://localhost:8787/customization/smoke-p1 -H 'Content-Type: application/json' -H 'X-Player-Token: s1' -d '{"loadout":{}}'
# expected: HTTP 200, {"ok":true}
# mismatched token → forbidden
curl -si -X PUT http://localhost:8787/customization/smoke-p1 -H 'Content-Type: application/json' -H 'X-Player-Token: s2' -d '{"loadout":{}}'
# expected: HTTP 403, {"error":"forbidden"}
# tokenless on a claimed id → forbidden
curl -si -X PUT http://localhost:8787/customization/smoke-p1 -H 'Content-Type: application/json' -d '{"loadout":{}}'
# expected: HTTP 403, {"error":"forbidden"}
```

- [ ] **Step 4: Commit any stragglers and stop**

```bash
git status
```

Expected: clean tree (besides the user's own `Todo/Todo.md` edits — leave those unstaged). Do NOT push or open a PR; report back for the finishing-a-development-branch decision. Remote note: the `0003_player_auth.sql` migration is applied to production by `.github/workflows/migrate-d1.yml` on merge — no manual remote apply needed, but confirm the workflow run when the PR merges.

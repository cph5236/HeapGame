# Feedback Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players send categorized free-text feedback from the main menu, stored in D1 and readable by Claude through an admin-gated endpoint driven by a GitHub Action.

**Architecture:** A new `feedback` D1 table fronted by a `FeedbackDB` abstraction (D1 + Mock impls), a Hono route module exposing a public rate-limited `POST /feedback` and an admin-gated `GET /feedback?since_id=<int>`, a thin client (`FeedbackClient`) that builds the payload from the logging envelope, a DOM modal (`FeedbackOverlay`) opened from a top-right menu button, and a `workflow_dispatch` GitHub Action that curls the admin endpoint and uploads the JSON as an artifact.

**Tech Stack:** Phaser 3.90, TypeScript 5.9, Vite 6, Cloudflare Workers (Hono + D1), Vitest, GitHub Actions.

## Global Constraints

- **Branch:** all work on `feature/feedback-button` (already checked out). PR before merge; never push direct to `main`.
- **Build gate:** run `npm run build` before claiming any task done — catches TS errors tests miss.
- **D1 migrations:** add `server/migrations/NNNN_*.sql` (incremental SQL only) AND update `server/schema.sql` to the final state. Never edit an applied migration. Apply with `cd server && npx wrangler d1 migrations apply heap-db --local`.
- **Never commit** `.wrangler/state/`.
- **Categories:** exactly `'bug' | 'suggestion'` — nothing else.
- **Message cap:** 3,000 characters, enforced client-side (input hard-limit) AND server-side (`400` if longer).
- **Cursor:** monotonic `id` via `?since_id=<int>` — never `created_at`.
- **Rate limit:** `RL_FEEDBACK`, `namespace_id = "1006"`, `limit = 5`, `period = 60`.
- **Artifact name:** `feedback` (must match `gh run download -n feedback`).
- **Server URL secret:** reuse existing `VITE_HEAP_SERVER_URL` repo secret. New secret required: `ADMIN_SECRET`.

---

### Task 1: Data contract — shared types, migration, schema

**Files:**
- Create: `shared/feedbackTypes.ts`
- Create: `server/migrations/0009_feedback_table.sql`
- Modify: `server/schema.sql` (append the final `feedback` table definition)

**Interfaces:**
- Produces: `FeedbackCategory = 'bug' | 'suggestion'`; `FeedbackSubmitRequest` (client→server POST body); `FeedbackRow` (DB row shape). All consumed by Tasks 2, 3, 6.

- [ ] **Step 1: Create the shared types**

`shared/feedbackTypes.ts`:
```ts
export type FeedbackCategory = 'bug' | 'suggestion';

/** Client → server POST body for /feedback. */
export interface FeedbackSubmitRequest {
  category:   FeedbackCategory;
  message:    string;       // trimmed, ≤ 3000 chars
  playerGuid: string;
  sessionId:  string;
  appVersion: string;
  platform:   string;
  userAgent:  string;
  heapId:     string | null;
}

/** Full DB row, as returned by GET /feedback. */
export interface FeedbackRow {
  id:          number;
  category:    FeedbackCategory;
  player_guid: string;
  session_id:  string;
  message:     string;
  app_version: string;
  platform:    string;
  heap_id:     string | null;
  user_agent:  string;
  created_at:  string;      // ISO8601
}
```

- [ ] **Step 2: Create the migration**

`server/migrations/0009_feedback_table.sql`:
```sql
CREATE TABLE feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT    NOT NULL,
  player_guid TEXT    NOT NULL,
  session_id  TEXT    NOT NULL DEFAULT '',
  message     TEXT    NOT NULL,
  app_version TEXT    NOT NULL DEFAULT '',
  platform    TEXT    NOT NULL DEFAULT '',
  heap_id     TEXT,
  user_agent  TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL
);
```

- [ ] **Step 3: Mirror the table into `server/schema.sql`**

Append the identical `CREATE TABLE feedback (...)` block from Step 2 to `server/schema.sql` (the file holds the full intended schema for fresh installs). Match the existing file's formatting.

- [ ] **Step 4: Apply the migration locally and verify the table exists**

Run:
```bash
cd server && npx wrangler d1 migrations apply heap-db --local
npx wrangler d1 execute heap-db --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name='feedback';"
```
Expected: the apply reports `0009_feedback_table.sql` applied; the SELECT returns a row with `name = feedback`.

- [ ] **Step 5: Commit**

```bash
git add shared/feedbackTypes.ts server/migrations/0009_feedback_table.sql server/schema.sql
git commit -m "feat(feedback): add feedback table migration + shared types"
```

---

### Task 2: FeedbackDB abstraction (interface + D1 + Mock)

**Files:**
- Create: `server/src/feedbackDb.ts`
- Create: `server/tests/helpers/mockFeedbackDb.ts`
- Create: `server/tests/feedbackDb.test.ts`

**Interfaces:**
- Consumes: `FeedbackCategory`, `FeedbackRow` from `shared/feedbackTypes` (Task 1).
- Produces: `NormalizedFeedback` (validated insert input); `FeedbackDB` interface with `insert(f, now): Promise<void>` and `listSince(sinceId: number | null): Promise<FeedbackRow[]>`; `D1FeedbackDB` class; `MockFeedbackDB` test helper. Consumed by Tasks 3, 4, 5.

- [ ] **Step 1: Write the failing test**

`server/tests/feedbackDb.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { MockFeedbackDB } from './helpers/mockFeedbackDb';
import type { NormalizedFeedback } from '../src/feedbackDb';

const base: NormalizedFeedback = {
  category: 'bug', playerGuid: 'g1', sessionId: 's1', message: 'it broke',
  appVersion: '1.0.0', platform: 'web', heapId: null, userAgent: 'UA',
};

describe('MockFeedbackDB', () => {
  it('assigns ascending ids and returns all rows for null cursor', async () => {
    const db = new MockFeedbackDB();
    await db.insert({ ...base, message: 'one' }, '2026-06-18T00:00:00.000Z');
    await db.insert({ ...base, message: 'two' }, '2026-06-18T00:00:00.000Z'); // same timestamp
    const rows = await db.listSince(null);
    expect(rows.map(r => r.id)).toEqual([1, 2]);
    expect(rows.map(r => r.message)).toEqual(['one', 'two']);
  });

  it('listSince filters strictly by id (tie-proof on equal timestamps)', async () => {
    const db = new MockFeedbackDB();
    await db.insert({ ...base, message: 'one' }, 'T');
    await db.insert({ ...base, message: 'two' }, 'T');
    await db.insert({ ...base, message: 'three' }, 'T');
    const rows = await db.listSince(1);
    expect(rows.map(r => r.id)).toEqual([2, 3]);
  });

  it('persists category and heapId', async () => {
    const db = new MockFeedbackDB();
    await db.insert({ ...base, category: 'suggestion', heapId: 'heap-7' }, 'T');
    const [row] = await db.listSince(null);
    expect(row.category).toBe('suggestion');
    expect(row.heap_id).toBe('heap-7');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/tests/feedbackDb.test.ts`
Expected: FAIL — cannot resolve `./helpers/mockFeedbackDb` / `../src/feedbackDb`.

- [ ] **Step 3: Create the interface + D1 impl**

`server/src/feedbackDb.ts`:
```ts
import type { FeedbackCategory, FeedbackRow } from '../../shared/feedbackTypes';

/** Validated, normalized insert input (route does the validation). */
export interface NormalizedFeedback {
  category:   FeedbackCategory;
  playerGuid: string;
  sessionId:  string;
  message:    string;
  appVersion: string;
  platform:   string;
  heapId:     string | null;
  userAgent:  string;
}

/** Abstraction over D1 for feedback. Allows MockFeedbackDB in tests. */
export interface FeedbackDB {
  /** Insert one row. created_at is server-stamped; id is DB-assigned. */
  insert(f: NormalizedFeedback, now: string): Promise<void>;
  /** Rows with id > sinceId (or all if null), ascending by id. */
  listSince(sinceId: number | null): Promise<FeedbackRow[]>;
}

/** Production implementation backed by Cloudflare D1. */
export class D1FeedbackDB implements FeedbackDB {
  constructor(private d1: D1Database) {}

  async insert(f: NormalizedFeedback, now: string): Promise<void> {
    await this.d1
      .prepare(
        `INSERT INTO feedback
           (category, player_guid, session_id, message, app_version, platform, heap_id, user_agent, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .bind(f.category, f.playerGuid, f.sessionId, f.message, f.appVersion, f.platform, f.heapId, f.userAgent, now)
      .run();
  }

  async listSince(sinceId: number | null): Promise<FeedbackRow[]> {
    const stmt = sinceId == null
      ? this.d1.prepare('SELECT * FROM feedback ORDER BY id ASC')
      : this.d1.prepare('SELECT * FROM feedback WHERE id > ?1 ORDER BY id ASC').bind(sinceId);
    const res = await stmt.all<FeedbackRow>();
    return res.results;
  }
}
```

- [ ] **Step 4: Create the mock impl**

`server/tests/helpers/mockFeedbackDb.ts`:
```ts
import type { FeedbackDB, NormalizedFeedback } from '../../src/feedbackDb';
import type { FeedbackRow } from '../../../shared/feedbackTypes';

export class MockFeedbackDB implements FeedbackDB {
  private rows: FeedbackRow[] = [];
  private nextId = 1;

  async insert(f: NormalizedFeedback, now: string): Promise<void> {
    this.rows.push({
      id: this.nextId++,
      category: f.category,
      player_guid: f.playerGuid,
      session_id: f.sessionId,
      message: f.message,
      app_version: f.appVersion,
      platform: f.platform,
      heap_id: f.heapId,
      user_agent: f.userAgent,
      created_at: now,
    });
  }

  async listSince(sinceId: number | null): Promise<FeedbackRow[]> {
    const out = sinceId == null ? this.rows : this.rows.filter(r => r.id > sinceId);
    return [...out].sort((a, b) => a.id - b.id);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run server/tests/feedbackDb.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add server/src/feedbackDb.ts server/tests/helpers/mockFeedbackDb.ts server/tests/feedbackDb.test.ts
git commit -m "feat(feedback): add FeedbackDB abstraction with D1 + mock impls"
```

---

### Task 3: POST /feedback route + app wiring (rate-limited)

**Files:**
- Create: `server/src/routes/feedback.ts`
- Modify: `server/src/app.ts` (add `feedbackDb` + `limiters.feedback` to `AppOptions`; mount routes)
- Create: `server/tests/feedback.test.ts`

**Interfaces:**
- Consumes: `FeedbackDB`, `NormalizedFeedback` (Task 2); `MockFeedbackDB` (Task 2); `createApp` from `../src/app`.
- Produces: `feedbackRoutes(feedbackDb: FeedbackDB): Hono`; extends `AppOptions` with `feedbackDb?: FeedbackDB` and `limiters.feedback?: RateLimiter`. The `GET` handler is added here but admin-gated in Task 4.

- [ ] **Step 1: Write the failing POST tests**

`server/tests/feedback.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockFeedbackDB } from './helpers/mockFeedbackDb';

function makeApp(feedbackDb = new MockFeedbackDB(), adminSecret?: string) {
  return { app: createApp(new MockHeapDB(), new MockScoreDB(), { feedbackDb, adminSecret }), feedbackDb };
}

function postReq(body: unknown): Request {
  return new Request('http://x/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const valid = {
  category: 'bug', message: 'it broke', playerGuid: 'g1', sessionId: 's1',
  appVersion: '1.0.0', platform: 'web', userAgent: 'UA', heapId: 'heap-1',
};

describe('POST /feedback', () => {
  it('accepts a valid bug submission and stores it', async () => {
    const { app, feedbackDb } = makeApp();
    const res = await app.fetch(postReq(valid));
    expect(res.status).toBe(204);
    const rows = await feedbackDb.listSince(null);
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('bug');
    expect(rows[0].message).toBe('it broke');
    expect(rows[0].heap_id).toBe('heap-1');
    expect(rows[0].session_id).toBe('s1');
  });

  it('accepts a suggestion', async () => {
    const { app, feedbackDb } = makeApp();
    const res = await app.fetch(postReq({ ...valid, category: 'suggestion' }));
    expect(res.status).toBe(204);
    expect((await feedbackDb.listSince(null))[0].category).toBe('suggestion');
  });

  it('rejects an invalid category', async () => {
    const { app, feedbackDb } = makeApp();
    const res = await app.fetch(postReq({ ...valid, category: 'spam' }));
    expect(res.status).toBe(400);
    expect(await feedbackDb.listSince(null)).toHaveLength(0);
  });

  it('rejects an empty / whitespace message', async () => {
    const { app } = makeApp();
    expect((await app.fetch(postReq({ ...valid, message: '   ' }))).status).toBe(400);
  });

  it('rejects a message over 3000 chars', async () => {
    const { app } = makeApp();
    const res = await app.fetch(postReq({ ...valid, message: 'a'.repeat(3001) }));
    expect(res.status).toBe(400);
  });

  it('trims the message and stores null heapId when absent', async () => {
    const { app, feedbackDb } = makeApp();
    await app.fetch(postReq({ ...valid, message: '  hi  ', heapId: undefined }));
    const [row] = await feedbackDb.listSince(null);
    expect(row.message).toBe('hi');
    expect(row.heap_id).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/tests/feedback.test.ts`
Expected: FAIL — `feedbackDb` not accepted by `AppOptions` / route not mounted (404 instead of 204).

- [ ] **Step 3: Create the route**

`server/src/routes/feedback.ts`:
```ts
import { Hono } from 'hono';
import type { FeedbackDB, NormalizedFeedback } from '../feedbackDb';
import type { FeedbackCategory } from '../../../shared/feedbackTypes';

const MAX_MESSAGE_LEN = 3000;
const MAX_BODY_BYTES = 8 * 1024;
const VALID_CATEGORIES: ReadonlySet<string> = new Set(['bug', 'suggestion']);

function coerceStr(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v.length > max ? v.slice(0, max) : v;
}

export function feedbackRoutes(feedbackDb: FeedbackDB): Hono {
  const app = new Hono();

  // Public submit — abuse-resistant, server stamps created_at + id.
  app.post('/', async (c) => {
    const lenHeader = c.req.header('content-length');
    if (lenHeader && Number(lenHeader) > MAX_BODY_BYTES) return c.body(null, 400);

    let body: unknown;
    try { body = await c.req.json(); } catch { return c.body(null, 400); }
    if (!body || typeof body !== 'object') return c.body(null, 400);
    const r = body as Record<string, unknown>;

    const category = r.category;
    if (typeof category !== 'string' || !VALID_CATEGORIES.has(category)) return c.body(null, 400);

    const message = typeof r.message === 'string' ? r.message.trim() : '';
    if (!message || message.length > MAX_MESSAGE_LEN) return c.body(null, 400);

    const heapIdRaw = r.heapId;
    const norm: NormalizedFeedback = {
      category:   category as FeedbackCategory,
      playerGuid: coerceStr(r.playerGuid, 64),
      sessionId:  coerceStr(r.sessionId, 64),
      message,
      appVersion: coerceStr(r.appVersion, 32),
      platform:   coerceStr(r.platform, 16),
      heapId:     typeof heapIdRaw === 'string' ? coerceStr(heapIdRaw, 64) : null,
      userAgent:  coerceStr(r.userAgent, 200),
    };

    try {
      await feedbackDb.insert(norm, new Date().toISOString());
    } catch {
      // swallow — abuse / outages must not surface to clients (mirrors /log)
    }
    return c.body(null, 204);
  });

  // Admin read — gate applied in app.ts. Monotonic id cursor.
  app.get('/', async (c) => {
    const sinceRaw = c.req.query('since_id');
    const sinceId = sinceRaw != null && /^\d+$/.test(sinceRaw) ? Number(sinceRaw) : null;
    const rows = await feedbackDb.listSince(sinceId);
    return c.json(rows, 200);
  });

  return app;
}
```

- [ ] **Step 4: Wire into `app.ts`**

In `server/src/app.ts`:

1. Add the import near the other route imports:
```ts
import { feedbackRoutes } from './routes/feedback';
import type { FeedbackDB } from './feedbackDb';
```

2. In the `limiters` block of `AppOptions`, add a `feedback` slot:
```ts
    feedback?: RateLimiter;
```

3. Add to `AppOptions` (near `codeDb`):
```ts
  /** Feedback D1 access. If unset, /feedback is not mounted. */
  feedbackDb?: FeedbackDB;
```

4. After the `if (opts.codeDb) { ... }` block, add:
```ts
  if (opts.feedbackDb) {
    // Public submit — rate-limited, no admin gate.
    app.post('/feedback', rateLimit(lim.feedback, 'feedback'));
    // Admin read — behind the admin gate.
    app.get('/feedback', adminGate);
    app.route('/feedback', feedbackRoutes(opts.feedbackDb));
  }
```
(`rateLimit(undefined, ...)` is a no-op, matching the existing `/scores` mount, so tests without a limiter pass.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run server/tests/feedback.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/feedback.ts server/src/app.ts server/tests/feedback.test.ts
git commit -m "feat(feedback): add POST /feedback route + app wiring"
```

---

### Task 4: GET /feedback admin gate + cursor tests

**Files:**
- Modify: `server/tests/feedback.test.ts` (add GET describe block)

**Interfaces:**
- Consumes: `makeApp` helper (Task 3), `MockFeedbackDB`. No new production code — the `GET` handler exists (Task 3) and the admin gate is mounted (Task 3 Step 4). This task proves the gate + cursor behavior.

- [ ] **Step 1: Write the failing GET tests**

Append to `server/tests/feedback.test.ts`:
```ts
function getReq(query = '', secret?: string): Request {
  const headers: Record<string, string> = {};
  if (secret) headers['X-Admin-Secret'] = secret;
  return new Request(`http://x/feedback${query}`, { method: 'GET', headers });
}

async function seed(db: MockFeedbackDB, n: number) {
  for (let i = 0; i < n; i++) {
    await db.insert(
      { category: 'bug', playerGuid: 'g', sessionId: 's', message: `m${i}`,
        appVersion: '1', platform: 'web', heapId: null, userAgent: 'UA' },
      'T',
    );
  }
}

describe('GET /feedback (admin)', () => {
  it('401s without the admin secret when one is configured', async () => {
    const { app } = makeApp(new MockFeedbackDB(), 's3cret');
    expect((await app.fetch(getReq('', undefined))).status).toBe(401);
  });

  it('returns all rows ascending with the correct secret', async () => {
    const db = new MockFeedbackDB();
    await seed(db, 3);
    const { app } = makeApp(db, 's3cret');
    const res = await app.fetch(getReq('', 's3cret'));
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows.map((r: { id: number }) => r.id)).toEqual([1, 2, 3]);
  });

  it('filters by since_id', async () => {
    const db = new MockFeedbackDB();
    await seed(db, 3);
    const { app } = makeApp(db, 's3cret');
    const res = await app.fetch(getReq('?since_id=1', 's3cret'));
    const rows = await res.json();
    expect(rows.map((r: { id: number }) => r.id)).toEqual([2, 3]);
  });
});
```
Note: `makeApp` already takes `(feedbackDb, adminSecret)` and returns `{ app, feedbackDb }` — reuse it.

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run server/tests/feedback.test.ts`
Expected: PASS (9 tests total). The GET handler + admin gate from Task 3 satisfy these; if the 401 test fails, confirm `app.get('/feedback', adminGate)` is mounted *before* `app.route('/feedback', ...)` in `app.ts`.

- [ ] **Step 3: Commit**

```bash
git add server/tests/feedback.test.ts
git commit -m "test(feedback): cover GET admin gate + since_id cursor"
```

---

### Task 5: Production wiring — rate-limit bucket + index.ts

**Files:**
- Modify: `server/wrangler.toml` (add `RL_FEEDBACK` bucket)
- Modify: `server/src/index.ts` (add `RL_FEEDBACK` to `Env`, construct `D1FeedbackDB`, pass limiter)

**Interfaces:**
- Consumes: `D1FeedbackDB` (Task 2); `feedbackDb` + `limiters.feedback` on `AppOptions` (Task 3).
- Produces: production deployment wiring. Verified by `npm run build` (no runtime test — bindings only exist in the Workers runtime).

- [ ] **Step 1: Add the rate-limit bucket**

Append after the `RL_CODES` block in `server/wrangler.toml`:
```toml
[[ratelimits]]
name = "RL_FEEDBACK"
namespace_id = "1006"
  [ratelimits.simple]
  limit = 5
  period = 60
```

- [ ] **Step 2: Wire `index.ts`**

In `server/src/index.ts`:

1. Add the import:
```ts
import { D1FeedbackDB } from './feedbackDb';
```

2. Add to the `Env` interface:
```ts
  RL_FEEDBACK?: RateLimiter;
```

3. In the `createApp(...)` options object, add `feedbackDb` and the limiter:
```ts
      feedbackDb:     new D1FeedbackDB(env.DB),
```
and inside `limiters: { ... }`:
```ts
        feedback: env.RL_FEEDBACK,
```

- [ ] **Step 3: Verify build + full server test suite**

Run:
```bash
npm run build
npx vitest run server/tests
```
Expected: build succeeds with no TS errors; all server tests pass (including the new feedback suites).

- [ ] **Step 4: Commit**

```bash
git add server/wrangler.toml server/src/index.ts
git commit -m "feat(feedback): wire RL_FEEDBACK bucket + D1FeedbackDB in worker entry"
```

---

### Task 6: FeedbackClient + public log-envelope accessor

**Files:**
- Modify: `src/logging/index.ts` (export `getLogEnvelope`)
- Create: `src/systems/FeedbackClient.ts`
- Create: `src/systems/__tests__/FeedbackClient.test.ts`

**Interfaces:**
- Consumes: `getLogEnvelope(): LogEnvelope` (newly exported); `fetchWithLog`; `FeedbackCategory`, `FeedbackSubmitRequest` (Task 1).
- Produces: `submitFeedback(category: FeedbackCategory, rawMessage: string, heapId: string | null): Promise<FeedbackResult>` where `FeedbackResult = { status: 'success' | 'offline' | 'error'; message: string }`. Consumed by Task 7.

- [ ] **Step 1: Export the envelope accessor**

In `src/logging/index.ts`, add an exported accessor next to the existing private `getEnvelope` function:
```ts
/** Public accessor for the logging envelope, reused by non-logging callers (feedback). */
export function getLogEnvelope(): LogEnvelope { return getEnvelope(); }
```

- [ ] **Step 2: Write the failing test**

`src/systems/__tests__/FeedbackClient.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../logging', () => ({
  getLogEnvelope: () => ({
    userGuid: 'guid-test', sessionId: 'sess-1', appVersion: '1.2.3',
    platform: 'web', userAgent: 'UA',
  }),
}));
const fetchWithLog = vi.fn();
vi.mock('../../logging/fetchWithLog', () => ({
  fetchWithLog: (...args: unknown[]) => fetchWithLog(...args),
}));

import { submitFeedback } from '../FeedbackClient';

function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as { body: string }).body);
}

describe('submitFeedback', () => {
  beforeEach(() => { fetchWithLog.mockReset(); });

  it('builds the full payload for a bug and reports success', async () => {
    fetchWithLog.mockResolvedValue(new Response(null, { status: 204 }));
    const result = await submitFeedback('bug', '  it broke  ', 'heap-1');
    expect(result.status).toBe('success');
    const body = bodyOf(fetchWithLog.mock.calls[0]);
    expect(body).toEqual({
      category: 'bug', message: 'it broke', playerGuid: 'guid-test',
      sessionId: 'sess-1', appVersion: '1.2.3', platform: 'web',
      userAgent: 'UA', heapId: 'heap-1',
    });
  });

  it('passes the suggestion category and null heapId through', async () => {
    fetchWithLog.mockResolvedValue(new Response(null, { status: 204 }));
    await submitFeedback('suggestion', 'idea', null);
    const body = bodyOf(fetchWithLog.mock.calls[0]);
    expect(body.category).toBe('suggestion');
    expect(body.heapId).toBeNull();
  });

  it('rejects an empty message without calling the server', async () => {
    const result = await submitFeedback('bug', '   ', null);
    expect(result.status).toBe('error');
    expect(fetchWithLog).not.toHaveBeenCalled();
  });

  it('reports offline when the request throws', async () => {
    fetchWithLog.mockRejectedValue(new Error('network'));
    expect((await submitFeedback('bug', 'x', null)).status).toBe('offline');
  });

  it('reports error on a non-ok response', async () => {
    fetchWithLog.mockResolvedValue(new Response(null, { status: 400 }));
    expect((await submitFeedback('bug', 'x', null)).status).toBe('error');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/systems/__tests__/FeedbackClient.test.ts`
Expected: FAIL — cannot resolve `../FeedbackClient`.

- [ ] **Step 4: Implement the client**

`src/systems/FeedbackClient.ts`:
```ts
// src/systems/FeedbackClient.ts

import { getLogEnvelope } from '../logging';
import { fetchWithLog } from '../logging/fetchWithLog';
import type { FeedbackCategory, FeedbackSubmitRequest } from '../../shared/feedbackTypes';

const SERVER_URL: string =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_HEAP_SERVER_URL ??
  'http://localhost:8787';

export type FeedbackStatus = 'success' | 'offline' | 'error';

export interface FeedbackResult {
  status:  FeedbackStatus;
  message: string;
}

/** Sends one feedback message to the server, built from the logging envelope. */
export async function submitFeedback(
  category: FeedbackCategory,
  rawMessage: string,
  heapId: string | null,
): Promise<FeedbackResult> {
  const message = rawMessage.trim();
  if (!message) return { status: 'error', message: 'Enter a message' };

  const env = getLogEnvelope();
  const req: FeedbackSubmitRequest = {
    category,
    message,
    playerGuid: env.userGuid,
    sessionId:  env.sessionId,
    appVersion: env.appVersion,
    platform:   env.platform,
    userAgent:  env.userAgent,
    heapId,
  };

  let res: Response;
  try {
    res = await fetchWithLog(`${SERVER_URL}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
  } catch {
    return { status: 'offline', message: 'Offline — try again' };
  }

  return res.ok
    ? { status: 'success', message: 'Thanks!' }
    : { status: 'error', message: "Couldn't send — try again" };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/systems/__tests__/FeedbackClient.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/logging/index.ts src/systems/FeedbackClient.ts src/systems/__tests__/FeedbackClient.test.ts
git commit -m "feat(feedback): add FeedbackClient + public getLogEnvelope accessor"
```

---

### Task 7: FeedbackOverlay modal + main-menu Bug button

**Files:**
- Create: `src/scenes/FeedbackOverlay.ts`
- Modify: `src/scenes/MenuScene.ts` (add the top-right Bug button + open handler)

**Interfaces:**
- Consumes: `submitFeedback`, `FeedbackResult` (Task 6); `FeedbackCategory` (Task 1).
- Produces: `openFeedbackOverlay(opts: { heapId: string | null; onClose: () => void }): void` — builds the DOM modal, owns its own submit/close lifecycle.

**Testing note:** the Vitest environment is `node` (`vite.config.ts:68`), so this DOM/Phaser-bound modal is **not** unit-tested — matching the existing un-tested `openRedeemDialog` modal. Its logic-bearing core (payload build, validation, error mapping) is already covered by `FeedbackClient` tests (Task 6). This task is verified via `scene-preview` + `npm run build`.

- [ ] **Step 1: Create the overlay module**

`src/scenes/FeedbackOverlay.ts` (DOM modal mirroring the structure of `MenuScene.openRedeemDialog`, with a category toggle + textarea):
```ts
import { submitFeedback } from '../systems/FeedbackClient';
import type { FeedbackCategory } from '../../shared/feedbackTypes';

export interface FeedbackOverlayOpts {
  heapId: string | null;
  /** Called after the overlay is removed (re-enable menu input). */
  onClose: () => void;
}

const MAX_LEN = 3000;

/** Opens a DOM feedback modal over the game canvas. Self-contained lifecycle. */
export function openFeedbackOverlay(opts: FeedbackOverlayOpts): void {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 600;
  let category: FeedbackCategory = 'bug';

  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.75)',
    'display:flex', `align-items:${isMobile ? 'flex-start' : 'center'}`, 'justify-content:center',
    'z-index:9999', 'font-family:monospace', isMobile ? 'padding-top:6vh' : '',
  ].join(';');

  const panel = document.createElement('div');
  panel.style.cssText = [
    'background:#0d0d20', 'border:2px solid #4488ff', 'border-radius:12px',
    'padding:24px 22px 20px', 'text-align:center', 'width:320px',
    'box-shadow:0 0 32px rgba(68,136,255,0.18)', 'box-sizing:border-box',
  ].join(';');

  const heading = document.createElement('div');
  heading.style.cssText = 'color:#4488ff;font-size:13px;font-weight:bold;letter-spacing:3px;margin-bottom:14px';
  heading.textContent = 'SEND FEEDBACK';

  // ── Category toggle ──────────────────────────────────────────────────────
  const toggleRow = document.createElement('div');
  toggleRow.style.cssText = 'display:flex;gap:8px;margin-bottom:14px';
  const mkTab = (label: string, value: FeedbackCategory) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = [
      'flex:1', 'padding:9px 0', 'border-radius:8px', 'border:2px solid #4488ff',
      'font-family:monospace', 'font-size:13px', 'font-weight:bold', 'cursor:pointer',
    ].join(';');
    b.addEventListener('click', () => { category = value; paintTabs(); });
    return b;
  };
  const bugTab = mkTab('🐛 Bug', 'bug');
  const ideaTab = mkTab('💡 Suggestion', 'suggestion');
  const paintTabs = () => {
    for (const [b, v] of [[bugTab, 'bug'], [ideaTab, 'suggestion']] as const) {
      const active = category === v;
      b.style.background = active ? '#4488ff' : 'transparent';
      b.style.color = active ? '#0a0818' : '#6699cc';
    }
  };
  paintTabs();
  toggleRow.append(bugTab, ideaTab);

  // ── Message textarea ─────────────────────────────────────────────────────
  const textarea = document.createElement('textarea');
  textarea.maxLength = MAX_LEN;
  textarea.rows = 5;
  textarea.placeholder = 'What happened? What would you change?';
  textarea.style.cssText = [
    'width:100%', 'box-sizing:border-box', 'background:#060612',
    'border:1px solid #335', 'border-radius:8px', 'color:#fff', 'font-size:14px',
    'font-family:monospace', 'padding:10px', 'outline:none', 'resize:vertical',
    'margin-bottom:6px',
  ].join(';');

  const counter = document.createElement('div');
  counter.style.cssText = 'color:#556677;font-size:11px;text-align:right;margin-bottom:10px';
  const paintCounter = () => { counter.textContent = `${textarea.value.trim().length} / ${MAX_LEN}`; };
  paintCounter();

  const msg = document.createElement('div');
  msg.style.cssText = 'min-height:16px;font-size:12px;margin-bottom:12px;color:#88aacc';

  const sendBtn = document.createElement('button');
  sendBtn.textContent = 'SEND';
  sendBtn.style.cssText = [
    'width:100%', 'padding:13px', 'background:#4488ff', 'border:none',
    'border-radius:8px', 'color:#0a0818', 'font-size:15px', 'font-weight:bold',
    'font-family:monospace', 'letter-spacing:1px', 'cursor:pointer', 'margin-bottom:10px',
  ].join(';');

  const cancelEl = document.createElement('div');
  cancelEl.textContent = 'close';
  cancelEl.style.cssText = 'color:#556677;font-size:12px;cursor:pointer;letter-spacing:1px';

  panel.append(heading, toggleRow, textarea, counter, msg, sendBtn, cancelEl);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  const close = (): void => {
    if (overlay.parentNode) document.body.removeChild(overlay);
    opts.onClose();
  };

  // Submit is disabled while the trimmed message is empty.
  const refreshEnabled = (): void => {
    const empty = textarea.value.trim().length === 0;
    sendBtn.disabled = empty;
    sendBtn.style.opacity = empty ? '0.5' : '1';
    sendBtn.style.cursor = empty ? 'default' : 'pointer';
  };
  refreshEnabled();

  let busy = false;
  const submit = async (): Promise<void> => {
    if (busy || textarea.value.trim().length === 0) return;
    busy = true;
    sendBtn.disabled = true;
    msg.style.color = '#88aacc';
    msg.textContent = 'Sending…';
    const result = await submitFeedback(category, textarea.value, opts.heapId);
    if (result.status === 'success') {
      msg.style.color = '#88ff88';
      msg.textContent = result.message;
      setTimeout(close, 900);
    } else {
      msg.style.color = '#ff9988';
      msg.textContent = result.message;
      busy = false;
      refreshEnabled();
    }
  };

  textarea.addEventListener('input', () => { paintCounter(); refreshEnabled(); });
  sendBtn.addEventListener('click', () => void submit());
  cancelEl.addEventListener('click', close);
  overlay.addEventListener('click', (e: MouseEvent) => { if (e.target === overlay) close(); });

  requestAnimationFrame(() => textarea.focus());
}
```

- [ ] **Step 2: Add the Bug button to the main menu**

In `src/scenes/MenuScene.ts`:

1. Add the import at the top (with the other imports):
```ts
import { openFeedbackOverlay } from './FeedbackOverlay';
```

2. The settings ☰ button is created in `createSettingsButton()` at `(logicalWidth - 22, 22)` (see `MenuScene.ts:808`). The `create()` method already calls `createSettingsButton()`. Add a sibling call in `create()` (right after that call) to a new private method, so the Bug button sits just left of the gear:
```ts
    this.createFeedbackButton();
```

3. Add the method (place it directly after `createSettingsButton`). It reuses `this.setMenuInputEnabled` (defined at `MenuScene.ts:351`) to gate Phaser input while the modal is open, and reads the active heap id the same way the menu already tracks it — pass `null` if no heap getter exists in scope (the menu is heap-agnostic; feedback heapId is best-effort):
```ts
  private createFeedbackButton(): void {
    const bx = logicalWidth(this) - 58;   // left of the ☰ gear at width-22
    const by = 22;

    const gfx = this.add.graphics().setDepth(20);
    gfx.fillStyle(0x000000, 0.65);
    gfx.fillCircle(bx, by, 14);
    gfx.lineStyle(2, 0x8899bb, 1);
    gfx.strokeCircle(bx, by, 14);
    this.add.text(bx, by, '🐛', { fontSize: '15px' }).setOrigin(0.5).setDepth(20);

    this.add.zone(bx, by, 36, 36).setDepth(20)
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => {
        this.setMenuInputEnabled(false);
        openFeedbackOverlay({
          heapId: null,
          onClose: () => this.setMenuInputEnabled(true),
        });
      });
  }
```
(If `logicalWidth` is not already imported in `MenuScene.ts`, it is — it's used throughout, e.g. `MenuScene.ts:809`.)

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: succeeds, no TS errors.

- [ ] **Step 4: Visually verify the button + modal**

Run: `npm run scene-preview -- MenuScene '{}' pixel7`
Expected: a screenshot showing the 🐛 button in the top-right, just left of the ☰ gear. (The DOM modal opens on tap at runtime; the preview confirms the button placement and that the scene builds without error.)

- [ ] **Step 5: Commit**

```bash
git add src/scenes/FeedbackOverlay.ts src/scenes/MenuScene.ts
git commit -m "feat(feedback): add FeedbackOverlay modal + main-menu Bug button"
```

---

### Task 8: GitHub Action — fetch feedback as an artifact

**Files:**
- Create: `.github/workflows/fetch-feedback.yml`

**Interfaces:**
- Consumes: the deployed `GET /feedback` endpoint (Tasks 3–5); repo secrets `VITE_HEAP_SERVER_URL` (existing) and `ADMIN_SECRET` (new).
- Produces: a `workflow_dispatch` workflow that writes `feedback.json` and uploads it as an artifact named `feedback`.

- [ ] **Step 1: Create the workflow**

`.github/workflows/fetch-feedback.yml`:
```yaml
name: Fetch Feedback

on:
  workflow_dispatch:
    inputs:
      since_id:
        description: 'Only return feedback with id greater than this (blank = all)'
        required: false
        default: ''

jobs:
  fetch:
    runs-on: ubuntu-latest
    steps:
      - name: Fetch feedback from the worker
        env:
          BASE_URL: ${{ secrets.VITE_HEAP_SERVER_URL }}
          ADMIN_SECRET: ${{ secrets.ADMIN_SECRET }}
          SINCE_ID: ${{ inputs.since_id }}
        run: |
          set -euo pipefail
          URL="${BASE_URL}/feedback"
          if [ -n "${SINCE_ID}" ]; then URL="${URL}?since_id=${SINCE_ID}"; fi
          curl -sS -f -H "X-Admin-Secret: ${ADMIN_SECRET}" "${URL}" -o feedback.json
          echo "Fetched $(jq 'length' feedback.json) feedback row(s)."

      - name: Upload feedback artifact
        uses: actions/upload-artifact@v4
        with:
          name: feedback
          path: feedback.json
```

- [ ] **Step 2: Validate the workflow YAML**

Run (uses Python's YAML parser, always available on the runner/local):
```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/fetch-feedback.yml')); print('YAML OK')"
```
Expected: `YAML OK`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/fetch-feedback.yml
git commit -m "ci(feedback): add fetch-feedback workflow to read feedback as an artifact"
```

- [ ] **Step 4: Document the one-time secret setup (manual — do not script)**

The workflow needs a new repo secret. This is a **manual step for the human partner**, surfaced in the PR description — do NOT attempt to set it automatically:
- Add repo secret **`ADMIN_SECRET`** = the worker's configured admin secret (the same value behind `requireAdminSecret`).
- `VITE_HEAP_SERVER_URL` already exists (reused).

After merge + deploy, Claude reads feedback with:
```bash
gh workflow run fetch-feedback.yml -f since_id=<int>   # since_id optional
# then, once the run completes:
gh run download <run-id> -n feedback                    # writes feedback.json
```

---

## Final verification (after all tasks)

- [ ] Run the full suite: `npm test` — all green.
- [ ] Run the build: `npm run build` — no TS errors.
- [ ] Confirm `.wrangler/state/` is not staged: `git status --porcelain | grep -i wrangler/state` returns nothing.
- [ ] Apply the migration to remote before/with deploy: `cd server && npx wrangler d1 migrations apply heap-db --remote`.
- [ ] Open a PR; in the description, call out the **`ADMIN_SECRET` repo secret** setup and the **remote D1 migration** as required manual steps.

## Self-review notes (coverage map)

- Spec §1 (data layer) → Task 1 (migration/schema/types) + Task 2 (DB abstraction).
- Spec §2 POST validation (category, non-empty, ≤3000, coercion, ignore client id/ts) → Task 3 tests + route.
- Spec §2 GET admin gate + `since_id` ascending cursor → Task 4 (+ Task 3 handler).
- Spec §2 wiring (`app.ts`, `index.ts`) → Tasks 3 & 5.
- Spec §3 client (modal, category toggle, 3000 cap, disabled-when-empty, payload incl. sessionId + heapId, success/failure UX) → Task 6 (logic, unit-tested) + Task 7 (modal, preview-verified).
- Spec §4 GitHub Action (since_id, artifact name `feedback`, secret in store) → Task 8.
- Spec §5 rate limit (RL_FEEDBACK 5/60, ns 1006) → Task 5.
- Spec §6 tests → server suites (Tasks 2–4), client suite (Task 6); overlay deviates to preview-verification per the node test env (documented in Task 7).

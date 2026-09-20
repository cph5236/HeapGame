# Player Analytics (Plan 1 of 3) — New-User Counts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an admin-only "how many new players did we get?" report — a D1-backed metrics endpoint over `player_auth.created_at`, plus a line chart in the admin UI.

**Architecture:** A new `MetricsDB` repo over the `heap_scores` D1 binding exposes two reads: new-player counts bucketed by hour/day/week, and a paged list of cohort member ids (consumed by Plan 3). Both are served by a new `metrics` Hono route mounted behind the existing `adminGate`. The admin UI gains an Analytics card rendering the counts as a hand-rolled inline-SVG line chart.

**Tech Stack:** TypeScript 5.9, Hono, Cloudflare D1, Vitest, vanilla JS + Tailwind browser CDN (admin UI).

**Spec:** `docs/superpowers/specs/2026-09-19-player-analytics-design.md` (Phase 1 and Phase 6 View A)

## Global Constraints

- Branch is `feature/player-analytics`, already created off `main`. Never push direct to `main`.
- New server code follows the existing repo pattern: an interface, a `D1*` implementation, and a `Mock*` test helper in `server/tests/helpers/`.
- `MetricsDB` gets **no cache decorator**. A stale admin count is worse than a slow one.
- The metrics routes are **platform**, not game: they live under `server/src/platform/` and must not import anything from `server/src/game/`.
- Every admin route is registered with `adminGate` in `server/src/app.ts` before its handler is mounted, matching `/bans` and `/codes`.
- `bucket` is validated against exactly `hour` | `day` | `week`. The `strftime` format is passed as a **bind parameter**, never interpolated into SQL.
- `npm test` and `npm run build` must both pass before any task is considered done.
- Do not commit `.wrangler/state/`.

---

### Task 1: Let the SQLite test harness load any schema

`createTestD1()` hardcodes `schema/heap_core.sql`. `player_auth` lives in `heap_scores`, so the bucketing SQL cannot be tested for real until the harness can load that schema too.

**Files:**
- Modify: `server/tests/helpers/d1Sqlite.ts:33`
- Test: `server/tests/d1Sqlite.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `createTestD1(schema?: 'heap_core' | 'heap_scores' | 'heap_rewards' | 'heap_telemetry'): D1Database` — defaults to `'heap_core'` so all existing call sites keep working unchanged.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/d1Sqlite.test.ts`:

```ts
it('applies the heap_scores schema on request', async () => {
  const d1 = createTestD1('heap_scores');
  await d1.prepare(
    "INSERT INTO player_auth (player_id, secret_hash, created_at) VALUES ('p1','h','2026-09-19T12:00:00.000Z')",
  ).run();
  const row = await d1.prepare('SELECT player_id FROM player_auth WHERE player_id = ?1')
    .bind('p1').first<{ player_id: string }>();
  expect(row?.player_id).toBe('p1');
});

it('still defaults to heap_core when no schema is named', async () => {
  const d1 = createTestD1();
  await d1.prepare(
    "INSERT INTO heap_base (id, heap_id, vertices, vertex_hash, created_at) VALUES ('b1','h1','[]','hash','now')",
  ).run();
  const row = await d1.prepare('SELECT id FROM heap_base WHERE id = ?1').bind('b1').first<{ id: string }>();
  expect(row?.id).toBe('b1');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx vitest run tests/d1Sqlite.test.ts -t 'heap_scores schema'`
Expected: FAIL — `no such table: player_auth` (the harness loaded heap_core).

- [ ] **Step 3: Make the schema selectable**

In `server/tests/helpers/d1Sqlite.ts`, replace the hardcoded constant at line 33:

```ts
const SCHEMA_DIR = join(__dirname, '../../schema');

export type TestSchema = 'heap_core' | 'heap_scores' | 'heap_rewards' | 'heap_telemetry';
```

Then change the `createTestD1` signature and the line that reads the schema file:

```ts
export function createTestD1(schema: TestSchema = 'heap_core'): D1Database {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(join(SCHEMA_DIR, `${schema}.sql`), 'utf8'));
  // ...rest of the existing body unchanged
```

Keep every other line of the function as it is. The default argument is what preserves the existing call sites.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx vitest run tests/d1Sqlite.test.ts`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add server/tests/helpers/d1Sqlite.ts server/tests/d1Sqlite.test.ts
git commit -m "test: let createTestD1 load any domain schema"
```

---

### Task 2: MetricsDB — new-player counts

**Files:**
- Create: `server/src/platform/metricsDb.ts`
- Test: `server/tests/metricsDb.test.ts`

**Interfaces:**
- Consumes: `createTestD1('heap_scores')` from Task 1.
- Produces:
  - `type MetricsBucket = 'hour' | 'day' | 'week'`
  - `const BUCKET_FORMATS: Record<MetricsBucket, string>`
  - `interface NewPlayerBucket { bucket: string; count: number }`
  - `interface MetricsDB { newPlayersByBucket(bucket: MetricsBucket, since: string, until: string): Promise<NewPlayerBucket[]> }`
  - `class D1MetricsDB implements MetricsDB`

- [ ] **Step 1: Write the failing test**

Create `server/tests/metricsDb.test.ts`:

```ts
// server/tests/metricsDb.test.ts
//
// Bucketing correctness lives entirely in a strftime expression, so this is
// tested against real SQLite rather than a mock — a mock would only prove that
// the mock buckets the way the mock buckets.

import { describe, it, expect } from 'vitest';
import { createTestD1 } from './helpers/d1Sqlite';
import { D1MetricsDB } from '../src/platform/metricsDb';

async function seed(d1: D1Database, timestamps: string[]): Promise<void> {
  let n = 0;
  for (const ts of timestamps) {
    await d1.prepare(
      'INSERT INTO player_auth (player_id, secret_hash, created_at) VALUES (?1, ?2, ?3)',
    ).bind(`p${n++}`, 'hash', ts).run();
  }
}

describe('D1MetricsDB.newPlayersByBucket', () => {
  it('groups by day across the ISO T separator and Z suffix', async () => {
    const d1 = createTestD1('heap_scores');
    await seed(d1, [
      '2026-09-19T12:34:56.789Z',
      '2026-09-19T23:59:59.999Z',
      '2026-09-20T00:00:00.000Z',
    ]);
    const rows = await new D1MetricsDB(d1).newPlayersByBucket(
      'day', '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z',
    );
    expect(rows).toEqual([
      { bucket: '2026-09-19', count: 2 },
      { bucket: '2026-09-20', count: 1 },
    ]);
  });

  it('groups by hour', async () => {
    const d1 = createTestD1('heap_scores');
    await seed(d1, [
      '2026-09-19T12:00:01.000Z',
      '2026-09-19T12:59:59.000Z',
      '2026-09-19T13:00:00.000Z',
    ]);
    const rows = await new D1MetricsDB(d1).newPlayersByBucket(
      'hour', '2026-09-19T00:00:00.000Z', '2026-09-20T00:00:00.000Z',
    );
    expect(rows).toEqual([
      { bucket: '2026-09-19T12:00:00Z', count: 2 },
      { bucket: '2026-09-19T13:00:00Z', count: 1 },
    ]);
  });

  it('groups by week', async () => {
    const d1 = createTestD1('heap_scores');
    await seed(d1, ['2026-09-19T12:00:00.000Z', '2026-09-23T12:00:00.000Z']);
    const rows = await new D1MetricsDB(d1).newPlayersByBucket(
      'week', '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z',
    );
    expect(rows.map((r) => r.count)).toEqual([1, 1]);
    expect(rows[0].bucket).not.toEqual(rows[1].bucket);
  });

  it('excludes rows outside the window, half-open on until', async () => {
    const d1 = createTestD1('heap_scores');
    await seed(d1, [
      '2026-09-18T23:59:59.999Z', // before since — excluded
      '2026-09-19T00:00:00.000Z', // == since — included
      '2026-09-20T00:00:00.000Z', // == until — excluded
    ]);
    const rows = await new D1MetricsDB(d1).newPlayersByBucket(
      'day', '2026-09-19T00:00:00.000Z', '2026-09-20T00:00:00.000Z',
    );
    expect(rows).toEqual([{ bucket: '2026-09-19', count: 1 }]);
  });

  it('returns an empty array when nothing matches', async () => {
    const d1 = createTestD1('heap_scores');
    const rows = await new D1MetricsDB(d1).newPlayersByBucket(
      'day', '2026-09-19T00:00:00.000Z', '2026-09-20T00:00:00.000Z',
    );
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx vitest run tests/metricsDb.test.ts`
Expected: FAIL — cannot resolve `../src/platform/metricsDb`.

- [ ] **Step 3: Write the implementation**

Create `server/src/platform/metricsDb.ts`:

```ts
// server/src/platform/metricsDb.ts
//
// Read-only admin metrics over heap_scores. Platform, not game: player_auth
// knows nothing about heaps.
//
// There is deliberately no cache decorator here. These are low-frequency admin
// reads where a stale number is worse than a slow one.

/** Bucket granularities the metrics endpoints accept. */
export type MetricsBucket = 'hour' | 'day' | 'week';

/**
 * strftime format per bucket. `created_at` is written as
 * `new Date().toISOString()` (see platform/playerAuth.ts), and SQLite's date
 * functions accept both the `T` separator and the trailing `Z`.
 *
 * These strings are passed to SQLite as BIND PARAMETERS, never interpolated
 * into the SQL text — strftime accepts a bound format argument, so the
 * allowlist below is a validation aid rather than the only thing standing
 * between user input and the query.
 */
export const BUCKET_FORMATS: Record<MetricsBucket, string> = {
  hour: '%Y-%m-%dT%H:00:00Z',
  day:  '%Y-%m-%d',
  week: '%Y-W%W',
};

/** True when `v` is one of the three accepted bucket names. */
export function isMetricsBucket(v: unknown): v is MetricsBucket {
  return v === 'hour' || v === 'day' || v === 'week';
}

export interface NewPlayerBucket {
  /** The bucket label, already formatted (e.g. '2026-09-19'). */
  bucket: string;
  count: number;
}

export interface MetricsDB {
  /**
   * New players per bucket over `[since, until)` — half-open, so adjacent
   * windows never double-count a row on the boundary.
   *
   * "New player" is the first row in player_auth, which is written once per
   * player on their first AUTHENTICATED WRITE — not on first launch. A player
   * who installs and never submits a score never appears here.
   */
  newPlayersByBucket(
    bucket: MetricsBucket, since: string, until: string,
  ): Promise<NewPlayerBucket[]>;
}

export class D1MetricsDB implements MetricsDB {
  constructor(private d1: D1Database) {}

  async newPlayersByBucket(
    bucket: MetricsBucket, since: string, until: string,
  ): Promise<NewPlayerBucket[]> {
    const res = await this.d1
      .prepare(
        `SELECT strftime(?1, created_at) AS bucket, COUNT(*) AS count
           FROM player_auth
          WHERE created_at >= ?2 AND created_at < ?3
          GROUP BY bucket
          ORDER BY bucket`,
      )
      .bind(BUCKET_FORMATS[bucket], since, until)
      .all<{ bucket: string; count: number }>();
    return res.results.map((r) => ({ bucket: r.bucket, count: r.count }));
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && npx vitest run tests/metricsDb.test.ts`
Expected: PASS — all five tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/platform/metricsDb.ts server/tests/metricsDb.test.ts
git commit -m "feat(server): add MetricsDB with bucketed new-player counts"
```

---

### Task 3: GET /metrics/new-players

**Files:**
- Create: `server/src/platform/routes/metrics.ts`
- Create: `server/tests/helpers/mockMetricsDb.ts`
- Create: `server/tests/metrics.test.ts`
- Modify: `server/src/platform/app.ts` (options type + mount)
- Modify: `server/src/app.ts` (adminGate registration)

**Interfaces:**
- Consumes: `MetricsDB`, `MetricsBucket`, `isMetricsBucket` from Task 2.
- Produces:
  - `function metricsRoutes(metricsDb: MetricsDB): Hono`
  - `AppOptions.metricsDb?: MetricsDB` — when unset, `/metrics` is not mounted (same convention as `configDb`, `banDb`).
  - Response shape: `{ bucket: MetricsBucket, since: string, until: string, rows: NewPlayerBucket[] }`

- [ ] **Step 1: Write the mock helper**

Create `server/tests/helpers/mockMetricsDb.ts`:

```ts
// server/tests/helpers/mockMetricsDb.ts
//
// Route-logic double. SQL correctness is proven against real SQLite in
// metricsDb.test.ts; this only needs to record what it was asked for.

import type {
  MetricsDB, MetricsBucket, NewPlayerBucket,
} from '../../src/platform/metricsDb';

export class MockMetricsDB implements MetricsDB {
  /** Rows the next newPlayersByBucket call returns. */
  rows: NewPlayerBucket[] = [];
  /** Arguments of the last newPlayersByBucket call, for assertions. */
  lastCall: { bucket: MetricsBucket; since: string; until: string } | null = null;

  async newPlayersByBucket(
    bucket: MetricsBucket, since: string, until: string,
  ): Promise<NewPlayerBucket[]> {
    this.lastCall = { bucket, since, until };
    return this.rows;
  }
}
```

- [ ] **Step 2: Write the failing route test**

Create `server/tests/metrics.test.ts`:

```ts
// server/tests/metrics.test.ts

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockMetricsDB } from './helpers/mockMetricsDb';

function makeApp(metricsDb = new MockMetricsDB(), adminSecret?: string) {
  return createApp(new MockHeapDB(), new MockScoreDB(), { metricsDb, adminSecret });
}

const ADMIN = { 'X-Admin-Secret': 's3cret' };

describe('GET /metrics/new-players', () => {
  it('requires the admin secret when one is configured (401)', async () => {
    const app = makeApp(new MockMetricsDB(), 's3cret');
    const res = await app.request('/metrics/new-players?bucket=day');
    expect(res.status).toBe(401);
  });

  it('returns bucketed rows', async () => {
    const db = new MockMetricsDB();
    db.rows = [{ bucket: '2026-09-19', count: 7 }];
    const app = makeApp(db, 's3cret');

    const res = await app.request(
      '/metrics/new-players?bucket=day&since=2026-09-01T00:00:00.000Z&until=2026-09-20T00:00:00.000Z',
      { headers: ADMIN },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      bucket: 'day',
      since: '2026-09-01T00:00:00.000Z',
      until: '2026-09-20T00:00:00.000Z',
      rows: [{ bucket: '2026-09-19', count: 7 }],
    });
    expect(db.lastCall).toEqual({
      bucket: 'day',
      since: '2026-09-01T00:00:00.000Z',
      until: '2026-09-20T00:00:00.000Z',
    });
  });

  it('defaults to day bucket over the last 30 days', async () => {
    const db = new MockMetricsDB();
    const app = makeApp(db, 's3cret');

    const res = await app.request('/metrics/new-players', { headers: ADMIN });
    expect(res.status).toBe(200);
    expect(db.lastCall?.bucket).toBe('day');

    const since = Date.parse(db.lastCall!.since);
    const until = Date.parse(db.lastCall!.until);
    const days = (until - since) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it('rejects an unknown bucket (400) without touching the db', async () => {
    const db = new MockMetricsDB();
    const app = makeApp(db, 's3cret');
    const res = await app.request('/metrics/new-players?bucket=month', { headers: ADMIN });
    expect(res.status).toBe(400);
    expect(db.lastCall).toBeNull();
  });

  it('rejects a malformed since (400)', async () => {
    const app = makeApp(new MockMetricsDB(), 's3cret');
    const res = await app.request('/metrics/new-players?since=not-a-date', { headers: ADMIN });
    expect(res.status).toBe(400);
  });

  it('rejects since >= until (400)', async () => {
    const app = makeApp(new MockMetricsDB(), 's3cret');
    const res = await app.request(
      '/metrics/new-players?since=2026-09-20T00:00:00.000Z&until=2026-09-19T00:00:00.000Z',
      { headers: ADMIN },
    );
    expect(res.status).toBe(400);
  });

  it('404s when no metricsDb is configured', async () => {
    const app = createApp(new MockHeapDB(), new MockScoreDB(), { adminSecret: 's3cret' });
    const res = await app.request('/metrics/new-players', { headers: ADMIN });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd server && npx vitest run tests/metrics.test.ts`
Expected: FAIL — `metricsDb` is not a known `AppOptions` key, and `/metrics/new-players` 404s.

- [ ] **Step 4: Write the route**

Create `server/src/platform/routes/metrics.ts`:

```ts
// server/src/platform/routes/metrics.ts
//
// Admin-only metrics reads (adminGate applied in app.ts). Nothing here is ever
// reachable by a game client.

import { Hono } from 'hono';
import { type MetricsDB, isMetricsBucket } from '../metricsDb';

const DAY_MS = 86_400_000;
const DEFAULT_WINDOW_DAYS = 30;

/** Parses an ISO timestamp, returning null for anything unparseable. */
function parseIso(v: string | undefined): string | null {
  if (v === undefined) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function metricsRoutes(metricsDb: MetricsDB): Hono {
  const app = new Hono();

  // GET /metrics/new-players?bucket=hour|day|week&since=&until=
  app.get('/new-players', async (c) => {
    const rawBucket = c.req.query('bucket') ?? 'day';
    if (!isMetricsBucket(rawBucket)) {
      return c.json({ error: 'bucket must be one of: hour, day, week' }, 400);
    }

    const now = Date.now();
    const rawUntil = c.req.query('until');
    const rawSince = c.req.query('since');

    const until = rawUntil === undefined
      ? new Date(now).toISOString()
      : parseIso(rawUntil);
    if (until === null) return c.json({ error: 'until is not a valid ISO timestamp' }, 400);

    const since = rawSince === undefined
      ? new Date(Date.parse(until) - DEFAULT_WINDOW_DAYS * DAY_MS).toISOString()
      : parseIso(rawSince);
    if (since === null) return c.json({ error: 'since is not a valid ISO timestamp' }, 400);

    if (Date.parse(since) >= Date.parse(until)) {
      return c.json({ error: 'since must be before until' }, 400);
    }

    const rows = await metricsDb.newPlayersByBucket(rawBucket, since, until);
    return c.json({ bucket: rawBucket, since, until, rows });
  });

  return app;
}
```

- [ ] **Step 5: Add the option and mount the route**

In `server/src/platform/app.ts`, add the import and the option. Put the option alongside the other optional DBs in the options interface:

```ts
import type { MetricsDB } from './metricsDb';
```

```ts
  /** Admin metrics reads (player_auth in heap_scores). If unset, /metrics is not mounted. */
  metricsDb?: MetricsDB;
```

In `server/src/app.ts`, register the admin gate and mount, following the `/bans` block:

```ts
import { metricsRoutes } from './platform/routes/metrics';
```

```ts
  // Admin metrics surface — entirely behind the admin gate.
  if (opts.metricsDb) {
    app.get('/metrics/new-players', adminGate);
    app.route('/metrics', metricsRoutes(opts.metricsDb));
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd server && npx vitest run tests/metrics.test.ts`
Expected: PASS — all seven tests.

- [ ] **Step 7: Commit**

```bash
git add server/src/platform/routes/metrics.ts server/src/platform/app.ts server/src/app.ts \
        server/tests/helpers/mockMetricsDb.ts server/tests/metrics.test.ts
git commit -m "feat(server): add admin GET /metrics/new-players"
```

---

### Task 4: GET /metrics/cohort

Plan 3 joins a cohort of new players against their Analytics Engine events. That join needs the cohort's member ids, paged — a day of ids will not fit in one response or one `IN (…)` clause.

**Files:**
- Modify: `server/src/platform/metricsDb.ts`
- Modify: `server/src/platform/routes/metrics.ts`
- Modify: `server/src/app.ts` (adminGate for the new path)
- Modify: `server/tests/helpers/mockMetricsDb.ts`
- Test: `server/tests/metricsDb.test.ts`, `server/tests/metrics.test.ts`

**Interfaces:**
- Consumes: `MetricsDB` from Task 2, `metricsRoutes` from Task 3.
- Produces:
  - `interface CohortPage { playerIds: string[]; nextCursor: string | null }`
  - `MetricsDB.cohortMembers(since: string, until: string, limit: number, cursor: string | null): Promise<CohortPage>`
  - Route `GET /metrics/cohort?since=&until=&limit=&cursor=` returning `{ since, until, playerIds, nextCursor }`

The cursor is the last `created_at` of the previous page. Paging is keyset, not `OFFSET`: `created_at` is indexed by nothing, but keyset paging is stable under concurrent inserts whereas `OFFSET` silently skips rows.

- [ ] **Step 1: Write the failing DB test**

Append to `server/tests/metricsDb.test.ts`:

```ts
describe('D1MetricsDB.cohortMembers', () => {
  it('pages through members in created_at order', async () => {
    const d1 = createTestD1('heap_scores');
    await seed(d1, [
      '2026-09-19T01:00:00.000Z',
      '2026-09-19T02:00:00.000Z',
      '2026-09-19T03:00:00.000Z',
    ]);
    const db = new D1MetricsDB(d1);

    const first = await db.cohortMembers(
      '2026-09-19T00:00:00.000Z', '2026-09-20T00:00:00.000Z', 2, null,
    );
    expect(first.playerIds).toEqual(['p0', 'p1']);
    expect(first.nextCursor).toBe('2026-09-19T02:00:00.000Z');

    const second = await db.cohortMembers(
      '2026-09-19T00:00:00.000Z', '2026-09-20T00:00:00.000Z', 2, first.nextCursor,
    );
    expect(second.playerIds).toEqual(['p2']);
    expect(second.nextCursor).toBeNull();
  });

  it('returns a null cursor when the window is empty', async () => {
    const d1 = createTestD1('heap_scores');
    const page = await new D1MetricsDB(d1).cohortMembers(
      '2026-09-19T00:00:00.000Z', '2026-09-20T00:00:00.000Z', 10, null,
    );
    expect(page).toEqual({ playerIds: [], nextCursor: null });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npx vitest run tests/metricsDb.test.ts -t cohortMembers`
Expected: FAIL — `cohortMembers is not a function`.

- [ ] **Step 3: Implement cohortMembers**

Add to `server/src/platform/metricsDb.ts` — the interface member, the type, and the implementation:

```ts
export interface CohortPage {
  playerIds: string[];
  /** `created_at` of the last row returned; pass back as `cursor`. Null at the end. */
  nextCursor: string | null;
}
```

Add to the `MetricsDB` interface:

```ts
  /**
   * The player ids first seen in `[since, until)`, oldest first, paged.
   *
   * Keyset paging on `created_at` rather than OFFSET: OFFSET silently skips
   * rows when a concurrent insert lands between pages, which would drop
   * players out of a cohort at random.
   */
  cohortMembers(
    since: string, until: string, limit: number, cursor: string | null,
  ): Promise<CohortPage>;
```

Add to `D1MetricsDB`:

```ts
  async cohortMembers(
    since: string, until: string, limit: number, cursor: string | null,
  ): Promise<CohortPage> {
    const lo = cursor === null ? since : cursor;
    // `>` on a resumed page, `>=` on the first, so the cursor row is not
    // returned twice and the first row is not skipped.
    const cmp = cursor === null ? '>=' : '>';
    const res = await this.d1
      .prepare(
        `SELECT player_id, created_at
           FROM player_auth
          WHERE created_at ${cmp} ?1 AND created_at < ?2
          ORDER BY created_at
          LIMIT ?3`,
      )
      .bind(lo, until, limit)
      .all<{ player_id: string; created_at: string }>();

    const rows = res.results;
    return {
      playerIds: rows.map((r) => r.player_id),
      nextCursor: rows.length === limit ? rows[rows.length - 1].created_at : null,
    };
  }
```

The `${cmp}` interpolation is one of two hardcoded literals chosen by a boolean — no caller input reaches it.

- [ ] **Step 4: Run the DB tests**

Run: `cd server && npx vitest run tests/metricsDb.test.ts`
Expected: PASS — all seven tests.

- [ ] **Step 5: Extend the mock**

In `server/tests/helpers/mockMetricsDb.ts`, add the import of `CohortPage` and this member:

```ts
  /** Page the next cohortMembers call returns. */
  cohortPage: CohortPage = { playerIds: [], nextCursor: null };
  lastCohortCall: { since: string; until: string; limit: number; cursor: string | null } | null = null;

  async cohortMembers(
    since: string, until: string, limit: number, cursor: string | null,
  ): Promise<CohortPage> {
    this.lastCohortCall = { since, until, limit, cursor };
    return this.cohortPage;
  }
```

- [ ] **Step 6: Write the failing route test**

Append to `server/tests/metrics.test.ts`:

```ts
describe('GET /metrics/cohort', () => {
  it('requires the admin secret (401)', async () => {
    const app = makeApp(new MockMetricsDB(), 's3cret');
    const res = await app.request('/metrics/cohort');
    expect(res.status).toBe(401);
  });

  it('returns a page of player ids and the next cursor', async () => {
    const db = new MockMetricsDB();
    db.cohortPage = { playerIds: ['a', 'b'], nextCursor: '2026-09-19T02:00:00.000Z' };
    const app = makeApp(db, 's3cret');

    const res = await app.request(
      '/metrics/cohort?since=2026-09-19T00:00:00.000Z&until=2026-09-20T00:00:00.000Z&limit=2',
      { headers: ADMIN },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      since: '2026-09-19T00:00:00.000Z',
      until: '2026-09-20T00:00:00.000Z',
      playerIds: ['a', 'b'],
      nextCursor: '2026-09-19T02:00:00.000Z',
    });
    expect(db.lastCohortCall?.limit).toBe(2);
    expect(db.lastCohortCall?.cursor).toBeNull();
  });

  it('passes the cursor through', async () => {
    const db = new MockMetricsDB();
    const app = makeApp(db, 's3cret');
    await app.request('/metrics/cohort?cursor=2026-09-19T02:00:00.000Z', { headers: ADMIN });
    expect(db.lastCohortCall?.cursor).toBe('2026-09-19T02:00:00.000Z');
  });

  it('clamps limit to 1000 and defaults to 500', async () => {
    const db = new MockMetricsDB();
    const app = makeApp(db, 's3cret');

    await app.request('/metrics/cohort', { headers: ADMIN });
    expect(db.lastCohortCall?.limit).toBe(500);

    await app.request('/metrics/cohort?limit=99999', { headers: ADMIN });
    expect(db.lastCohortCall?.limit).toBe(1000);

    await app.request('/metrics/cohort?limit=0', { headers: ADMIN });
    expect(db.lastCohortCall?.limit).toBe(1);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `cd server && npx vitest run tests/metrics.test.ts -t cohort`
Expected: FAIL — 404, the route does not exist.

- [ ] **Step 8: Add the route**

In `server/src/platform/routes/metrics.ts`, add these constants near the top:

```ts
const DEFAULT_COHORT_LIMIT = 500;
const MAX_COHORT_LIMIT = 1000;
```

and this handler inside `metricsRoutes`, before `return app;`:

```ts
  // GET /metrics/cohort?since=&until=&limit=&cursor=
  // The cohort's member ids, paged. Consumed by the funnel joins, which cannot
  // happen in SQL: player_auth is in heap_scores and the events are in
  // Analytics Engine, and there is no join across those.
  app.get('/cohort', async (c) => {
    const now = Date.now();
    const until = c.req.query('until') === undefined
      ? new Date(now).toISOString()
      : parseIso(c.req.query('until'));
    if (until === null) return c.json({ error: 'until is not a valid ISO timestamp' }, 400);

    const since = c.req.query('since') === undefined
      ? new Date(Date.parse(until) - DEFAULT_WINDOW_DAYS * DAY_MS).toISOString()
      : parseIso(c.req.query('since'));
    if (since === null) return c.json({ error: 'since is not a valid ISO timestamp' }, 400);

    if (Date.parse(since) >= Date.parse(until)) {
      return c.json({ error: 'since must be before until' }, 400);
    }

    const rawLimit = Number(c.req.query('limit') ?? DEFAULT_COHORT_LIMIT);
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(MAX_COHORT_LIMIT, Math.floor(rawLimit)))
      : DEFAULT_COHORT_LIMIT;

    const cursor = parseIso(c.req.query('cursor'));

    const page = await metricsDb.cohortMembers(since, until, limit, cursor);
    return c.json({ since, until, playerIds: page.playerIds, nextCursor: page.nextCursor });
  });
```

In `server/src/app.ts`, add the gate alongside the one from Task 3:

```ts
    app.get('/metrics/cohort', adminGate);
```

- [ ] **Step 9: Run the tests**

Run: `cd server && npx vitest run tests/metrics.test.ts tests/metricsDb.test.ts`
Expected: PASS — all tests in both files.

- [ ] **Step 10: Commit**

```bash
git add server/src/platform/metricsDb.ts server/src/platform/routes/metrics.ts server/src/app.ts \
        server/tests/helpers/mockMetricsDb.ts server/tests/metrics.test.ts server/tests/metricsDb.test.ts
git commit -m "feat(server): add paged GET /metrics/cohort"
```

---

### Task 5: Wire MetricsDB into the worker

The routes are mounted only when `opts.metricsDb` is set, and nothing sets it yet. Until this task, the endpoints 404 in production.

**Files:**
- Modify: `server/src/index.ts:70-80` (the options object passed to `createApp`)

**Interfaces:**
- Consumes: `D1MetricsDB` from Task 2, `AppOptions.metricsDb` from Task 3.
- Produces: nothing new — this is the composition root.

- [ ] **Step 1: Add the import**

In `server/src/index.ts`, alongside the other platform DB imports:

```ts
import { D1MetricsDB } from './platform/metricsDb';
```

- [ ] **Step 2: Construct it**

In the options object passed to `createApp` — next to `playerNameDb`, which uses the same binding:

```ts
      metricsDb: new D1MetricsDB(env.DB_SCORES),
```

- [ ] **Step 3: Verify the whole server suite and a type check**

Run: `cd server && npx vitest run && npx tsc --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Step 4: Verify the endpoint against local D1**

Start the worker and seed a row, then query it:

```bash
cd server && npx wrangler dev &
# In another shell:
curl -s -H "X-Admin-Secret: $ADMIN_SECRET" \
  'http://localhost:8787/metrics/new-players?bucket=day' | head
```

Expected: HTTP 200 and a JSON body of the shape `{"bucket":"day","since":…,"until":…,"rows":[…]}`. An empty `rows` array is a correct result on a database with no `player_auth` rows — confirm the *shape*, not the contents. Stop the worker when done.

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(server): wire MetricsDB into the worker"
```

---

### Task 6: Admin UI — Acquisition chart

**Files:**
- Modify: `admin/index.html` — new card after the Remote Config card (currently ends at line 326), new render/boot functions before the Boot block, one new call in the `DOMContentLoaded` handler.

**Interfaces:**
- Consumes: `GET /metrics/new-players` from Task 3, and the existing `adminFetch`, `$`, and status helpers already in the file.
- Produces: `renderNewPlayersChart(rows)`, `loadNewPlayers()`, `bootAnalytics()`.

This file is vanilla JS with a Tailwind browser CDN — no build step, no framework, no charting library. The chart is hand-rolled inline SVG to match; do not add a CDN dependency.

- [ ] **Step 1: Add the card markup**

Insert after the Remote Config card's closing `</div>` (before the `<div id="status" …>` line):

```html
  <div class="card border-l-term-cyan">
    <h2 class="card-head">Analytics — Acquisition</h2>
    <div class="grid2">
      <div>
        <label class="lbl">Bucket</label>
        <select id="an-bucket" class="field">
          <option value="day" selected>Day</option>
          <option value="week">Week</option>
          <option value="hour">Hour</option>
        </select>
      </div>
      <div>
        <label class="lbl">Days back</label>
        <input type="number" id="an-days" class="field" value="30" min="1" max="365" />
      </div>
    </div>
    <button id="an-refresh" class="btn mt-3">Load</button>
    <div id="an-summary" class="muted mt-3">Not loaded.</div>
    <div id="an-chart" class="mt-3 overflow-x-auto"></div>
  </div>
```

- [ ] **Step 2: Add the render and load functions**

Insert before the `// ────── Boot ──────` comment block:

```js
    // ────── Analytics ──────────────────────────────────────────────────────

    // Hand-rolled inline SVG. This file has no build step and no charting
    // library; a line chart is ~40 lines and not worth a CDN dependency.
    function renderNewPlayersChart(rows) {
      const host = $('an-chart');
      if (!rows.length) { host.innerHTML = '<div class="muted">No players in this window.</div>'; return; }

      const W = 720, H = 220, PAD_L = 40, PAD_B = 28, PAD_T = 12, PAD_R = 12;
      const max = Math.max(...rows.map((r) => r.count), 1);
      const plotW = W - PAD_L - PAD_R;
      const plotH = H - PAD_T - PAD_B;
      // A single point has no span to divide by; pin it to the left edge.
      const dx = rows.length > 1 ? plotW / (rows.length - 1) : 0;
      const x = (i) => PAD_L + i * dx;
      const y = (v) => PAD_T + plotH - (v / max) * plotH;

      // Bucket labels are server-generated strftime output, but this file
      // builds SVG via innerHTML and has had an XSS finding before — every
      // interpolated string goes through escapeHtml, no exceptions.
      const line = rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r.count).toFixed(1)}`).join(' ');
      const dots = rows.map((r, i) =>
        `<circle cx="${x(i).toFixed(1)}" cy="${y(r.count).toFixed(1)}" r="3" fill="currentColor">`
        + `<title>${escapeHtml(r.bucket)}: ${r.count}</title></circle>`).join('');

      // At most ~8 labels, so a long window stays readable.
      const every = Math.ceil(rows.length / 8);
      const labels = rows.map((r, i) => i % every === 0
        ? `<text x="${x(i).toFixed(1)}" y="${H - 8}" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.6">${escapeHtml(r.bucket)}</text>`
        : '').join('');

      host.innerHTML = `
        <svg viewBox="0 0 ${W} ${H}" width="100%" class="text-term-cyan" role="img" aria-label="New players per bucket">
          <line x1="${PAD_L}" y1="${PAD_T}" x2="${PAD_L}" y2="${PAD_T + plotH}" stroke="currentColor" opacity="0.3" />
          <line x1="${PAD_L}" y1="${PAD_T + plotH}" x2="${W - PAD_R}" y2="${PAD_T + plotH}" stroke="currentColor" opacity="0.3" />
          <text x="4" y="${PAD_T + 8}" font-size="10" fill="currentColor" opacity="0.6">${max}</text>
          <text x="4" y="${PAD_T + plotH}" font-size="10" fill="currentColor" opacity="0.6">0</text>
          <path d="${line}" fill="none" stroke="currentColor" stroke-width="2" />
          ${dots}${labels}
        </svg>`;
    }

    async function loadNewPlayers() {
      const bucket = $('an-bucket').value;
      const days = Math.max(1, Math.min(365, Number($('an-days').value) || 30));
      const until = new Date();
      const since = new Date(until.getTime() - days * 86400000);
      const qs = `?bucket=${bucket}`
        + `&since=${encodeURIComponent(since.toISOString())}`
        + `&until=${encodeURIComponent(until.toISOString())}`;
      try {
        const res = await adminFetch('/metrics/new-players' + qs);
        if (!res.ok) { setStatus('metrics failed: ' + res.status, 'err'); return; }
        const data = await res.json();
        const total = data.rows.reduce((s, r) => s + r.count, 0);
        $('an-summary').textContent =
          `${total} new players across ${data.rows.length} ${bucket} buckets.`;
        renderNewPlayersChart(data.rows);
        setStatus('metrics loaded', 'ok');
      } catch (err) {
        setStatus(String(err && err.message ? err.message : err), 'err');
      }
    }

    function bootAnalytics() {
      $('an-refresh').addEventListener('click', loadNewPlayers);
    }
```

The helpers used above already exist in this file: `$(id)` at line 363, `setStatus(msg, kind)` at line 401 (kinds are `'ok'`, `'err'`, or omitted for neutral), `escapeHtml(s)` at line 412, and `adminFetch(path, opts)` at line 378. Use them; do not introduce parallel versions.

- [ ] **Step 3: Call it at boot**

In the `DOMContentLoaded` handler, after `bootPlayers();`:

```js
      bootAnalytics();
```

- [ ] **Step 4: Verify in the browser**

Run the admin UI against a worker with data:

```bash
cd server && npx wrangler dev &
cd .. && npm run admin
```

Open `http://localhost:3001`, set the server URL to `http://localhost:8787` and enter the admin secret, then press **Load** in the Analytics — Acquisition card.

Expected: the summary line reports a total and a bucket count, and the chart area shows either a line with hoverable points or "No players in this window." Confirm the page does not scroll horizontally at a narrow window width. Stop both servers when done.

- [ ] **Step 5: Commit**

```bash
git add admin/index.html
git commit -m "feat(admin): add acquisition chart to the admin UI"
```

---

### Task 7: Full verification

**Files:** none modified — this task only runs checks.

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: PASS. Note the total count; it should be the pre-existing total plus the ~16 tests added by this plan.

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: completes with no TypeScript errors. CLAUDE.md requires this before claiming work is done — it catches type errors the tests miss.

- [ ] **Step 3: Confirm no stray local D1 state is staged**

Run: `git status --short`
Expected: clean, with nothing under `.wrangler/state/`.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin feature/player-analytics
gh pr create --title "Player analytics 1/3: new-user counts" \
  --body "Implements Phase 1 and View A of docs/superpowers/specs/2026-09-19-player-analytics-design.md.

Adds an admin-only MetricsDB over player_auth.created_at, GET /metrics/new-players (bucketed hour/day/week) and a paged GET /metrics/cohort, plus an acquisition line chart in the admin UI.

No client changes and no schema changes — this reads history that already exists. Plans 2 and 3 (instrumentation, then the AE-backed funnel) follow."
```

---

## Notes for the executor

- **This plan adds no migration.** `player_auth` already exists and is populated. If you find yourself writing SQL DDL, stop — you have misread the plan.
- **No client (`src/`) files change in this plan.** Client instrumentation is Plan 2.
- The `/metrics/cohort` endpoint has no consumer until Plan 3. That is intentional: it belongs with the other `MetricsDB` reads, and shipping it here keeps Plan 3 purely about Analytics Engine.
- Counts from this endpoint undercount installs by design — `created_at` is the first authenticated *write*, not first launch. Do not "fix" this; the spec records it as an accepted limitation.

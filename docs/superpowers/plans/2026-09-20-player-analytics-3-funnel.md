# Player Analytics (Plan 3 of 3) — Funnel and Churn Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer "do new players come back, and what predicts whether they do?" — an admin-gated Analytics Engine query proxy plus three admin views built on it.

**Architecture:** A Worker route exposing a **fixed, enumerated** set of parameterized AE SQL queries (never caller-supplied SQL), joined in Worker code against the D1 cohorts Plan 1 already exposes — AE cannot join to D1, and AE SQL cannot join at all. Three views in the existing single-file admin UI: a first-session funnel, a churn cross-tab, and a per-player event trace.

**Tech Stack:** TypeScript 5.9, Hono, Cloudflare Analytics Engine SQL API, Vitest, vanilla JS + Tailwind browser CDN.

**Spec:** `docs/superpowers/specs/2026-09-19-player-analytics-design.md` (Phase 5 and Phase 6 Views B/C/D)

## Prerequisites

**Plan 2 must be deployed and collecting data before this plan is useful**, and before its tests can be validated against anything real. Specifically this plan depends on:

- Events actually flowing (Plan 2 Task 3 flipped analytics to default-on).
- `index1` carrying `getEffectivePlayerId()`, matching `player_auth.player_id` (Plan 2 Tasks 1–2). Without this the cohort join silently drops every signed-in player.
- `run:end` facts promoted to real columns (Plan 2 Task 6). **AE SQL has no JSON functions**, so without this the cross-tab has nothing to split on.
- `GET /metrics/cohort` from Plan 1, for cohort membership.

This plan can be *built* before Plan 2 ships — every query is unit-testable against a stubbed AE client — but its numbers are meaningless until Plan 2 has been live long enough to accumulate a cohort.

## Global Constraints

- Branch off `main`: `feature/analytics-funnel`. Never push direct to `main`.
- **No caller-supplied SQL, ever.** The proxy exposes a fixed set of query ids with allowlisted parameters. This is the entire security argument for putting a Cloudflare API token in the Worker.
- Everything is admin-gated. `/analytics/*` gets a wildcard `app.use('/analytics/*', adminGate)` registered **before** the route mount — the same structural pattern Plan 1 settled on for `/metrics/*`, not a per-path list.
- Add the new routes to `server/tests/routeInventory.test.ts`'s app and snapshot, so the gate-ordering regression guard actually covers them.
- **AE SQL constraints** (verified against Cloudflare's reference and this repo's `.github/workflows/fetch-logs.yml`):
  - No `JOIN`, no `UNION`. Single table. Subqueries in `FROM` **are** supported.
  - `double1` is SELECTable but **cannot** appear in `WHERE` or `ORDER BY`. The automatic `timestamp` column is the reverse — filterable, not SELECTable. Filter on `timestamp`; output and order on `double1`.
  - No JSON functions. String functions are only `length`/`empty`/`lower`/`upper`/`startsWith`/`endsWith`/`position`/`substring`/`format`/`extract`.
  - Available aggregates include `argMin`/`argMax`, `count(DISTINCT …)`, `countIf`/`sumIf`/`avgIf`, `quantileExactWeighted`.
- **AE column layout** (fixed by `AnalyticsEngineSink.ts` after Plan 2): `index1`=player id; `blob1`=level, `blob2`=eventType, `blob3`=platform, `blob4`=appVersion, `blob5`=sessionId, `blob6`=payload JSON, `blob7`=userAgent, `blob8`=run cause; `double1`=client timestamp, `double2`=score, `double3`=height, `double4`=kills, `double5`=durationMs, `double6`=pickupBonus.
- **Sampling:** AE downsamples at volume. Every count of *events* uses `SUM(_sample_interval)`, never bare `COUNT()`. Every response surfaces `MAX(_sample_interval)` so the UI can warn when the numbers stop being exact.
- Secrets via `wrangler secret put`, never `[vars]`: `CF_ACCOUNT_ID`, `CF_ANALYTICS_TOKEN` (Account Analytics Read).
- `npm test` and `npm run build` must both pass before any task is considered done.
- A pre-existing, unrelated `tsc` error in `shared/__tests__/pickupScores.test.ts` predates this work. Ignore it.

---

### Task 1: AE client — the SQL transport

An injectable client that POSTs SQL to the AE SQL API and returns parsed rows. Separated from the queries so every later task can be tested against a stub without network access.

**Files:**
- Create: `server/src/platform/analytics/aeClient.ts`
- Test: `server/tests/aeClient.test.ts`
- Create: `server/tests/helpers/mockAeClient.ts`

**Interfaces:**
- Produces:

```ts
export interface AeQueryResult<R> { rows: R[]; sampleIntervalMax: number }
export interface AeClient {
  query<R>(sql: string, params: (string | number)[]): Promise<AeQueryResult<R>>;
}
export class HttpAeClient implements AeClient {
  constructor(accountId: string, token: string, fetchImpl?: typeof fetch);
}
```

Parameters are positional and substituted by Cloudflare's own API, not string-interpolated locally.

- [ ] **Step 1: Write the failing test**

Create `server/tests/aeClient.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { HttpAeClient } from '../src/platform/analytics/aeClient';

function fakeFetch(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  })) as unknown as typeof fetch;
}

describe('HttpAeClient', () => {
  it('posts to the account SQL endpoint with a bearer token', async () => {
    const f = fakeFetch({ data: [], meta: [] });
    await new HttpAeClient('acct123', 'tok456', f).query('SELECT 1', []);
    const [url, init] = (f as any).mock.calls[0];
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acct123/analytics_engine/sql');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok456');
  });

  it('returns the data rows', async () => {
    const f = fakeFetch({ data: [{ n: 3 }, { n: 4 }] });
    const res = await new HttpAeClient('a', 't', f).query<{ n: number }>('SELECT 1', []);
    expect(res.rows).toEqual([{ n: 3 }, { n: 4 }]);
  });

  it('reports the largest _sample_interval seen, defaulting to 1', async () => {
    const f = fakeFetch({ data: [{ _sample_interval: 1 }, { _sample_interval: 8 }] });
    const res = await new HttpAeClient('a', 't', f).query('SELECT 1', []);
    expect(res.sampleIntervalMax).toBe(8);

    const f2 = fakeFetch({ data: [{ n: 1 }] });
    const res2 = await new HttpAeClient('a', 't', f2).query('SELECT 1', []);
    expect(res2.sampleIntervalMax).toBe(1);
  });

  it('throws with the response body on a non-2xx, without leaking the token', async () => {
    const f = fakeFetch({ errors: ['bad sql'] }, 400);
    await expect(new HttpAeClient('a', 'sekrit', f).query('SELECT bogus', []))
      .rejects.toThrow(/bad sql/);
    await expect(new HttpAeClient('a', 'sekrit', f).query('SELECT bogus', []))
      .rejects.not.toThrow(/sekrit/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npx vitest run tests/aeClient.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the client**

Create `server/src/platform/analytics/aeClient.ts`:

```ts
// server/src/platform/analytics/aeClient.ts
//
// Transport for the Analytics Engine SQL API. Deliberately knows nothing about
// which queries exist — that lives in queries.ts — so the query SQL can be unit
// tested against a stub client with no network.

export interface AeQueryResult<R> {
  rows: R[];
  /**
   * Largest `_sample_interval` in the result, or 1 when absent. Anything above
   * 1 means AE downsampled and the numbers are estimates — the UI surfaces this
   * rather than quietly presenting sampled counts as exact.
   */
  sampleIntervalMax: number;
}

export interface AeClient {
  query<R>(sql: string, params: (string | number)[]): Promise<AeQueryResult<R>>;
}

export class HttpAeClient implements AeClient {
  constructor(
    private accountId: string,
    private token: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async query<R>(sql: string, params: (string | number)[]): Promise<AeQueryResult<R>> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/analytics_engine/sql`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      // Cloudflare substitutes positional params server-side; never interpolate
      // them into the SQL text here.
      body: JSON.stringify({ query: sql, parameters: params }),
    });

    const text = await res.text();
    if (!res.ok) {
      // Include the body (it carries the SQL error) but never the token.
      throw new Error(`AE query failed (${res.status}): ${text.slice(0, 500)}`);
    }

    const parsed = JSON.parse(text) as { data?: R[] };
    const rows = parsed.data ?? [];
    let sampleIntervalMax = 1;
    for (const r of rows as unknown as Record<string, unknown>[]) {
      const si = Number(r?._sample_interval);
      if (Number.isFinite(si) && si > sampleIntervalMax) sampleIntervalMax = si;
    }
    return { rows, sampleIntervalMax };
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd server && npx vitest run tests/aeClient.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Add the mock**

Create `server/tests/helpers/mockAeClient.ts`:

```ts
import type { AeClient, AeQueryResult } from '../../src/platform/analytics/aeClient';

export class MockAeClient implements AeClient {
  /** Rows the next query returns. */
  rows: unknown[] = [];
  sampleIntervalMax = 1;
  /** Every (sql, params) pair seen, for assertions. */
  calls: { sql: string; params: (string | number)[] }[] = [];

  async query<R>(sql: string, params: (string | number)[]): Promise<AeQueryResult<R>> {
    this.calls.push({ sql, params });
    return { rows: this.rows as R[], sampleIntervalMax: this.sampleIntervalMax };
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add server/src/platform/analytics/aeClient.ts server/tests/aeClient.test.ts \
        server/tests/helpers/mockAeClient.ts
git commit -m "feat(analytics): add Analytics Engine SQL transport client"
```

---

### Task 2: The query set

The fixed, enumerated SQL. Kept in its own module so the SQL is reviewable in one place and testable without a route or a network.

**Files:**
- Create: `server/src/platform/analytics/queries.ts`
- Test: `server/tests/analyticsQueries.test.ts`

**Interfaces:**
- Consumes: `AeClient` from Task 1.
- Produces:

```ts
export const CROSSTAB_DIMENSIONS = ['duration', 'cause', 'height', 'score', 'platform', 'appVersion', 'placed', 'submitted'] as const;
export type CrosstabDimension = typeof CROSSTAB_DIMENSIONS[number];
export function isCrosstabDimension(v: unknown): v is CrosstabDimension;

export interface FunnelStages { cohort: number; startedRun1: number; finishedRun1: number; startedRun2: number; startedRun3: number; returnedLater: number }
export interface CrosstabRow { bucket: string; cohort: number; returned: number }
export interface TraceRow { ts: number; level: string; eventType: string; platform: string; appVersion: string; sessionId: string; payload: string }

export function funnelQuery(dataset: string, playerIds: string[], since: string, until: string): { sql: string; params: (string|number)[] };
export function crosstabQuery(dataset: string, dimension: CrosstabDimension, playerIds: string[], since: string, until: string): { sql: string; params: (string|number)[] };
export function traceQuery(dataset: string, playerId: string, since: string, until: string, limit: number): { sql: string; params: (string|number)[] };
```

Each returns SQL plus positional params; nothing executes here. The dataset name is passed in (production `heap_logs`, staging `heap_logs_staging`) and must come from a server-side constant, never a request.

- [ ] **Step 1: Write the failing test**

Create `server/tests/analyticsQueries.test.ts`. These assert the *shape* of generated SQL — the properties that are easy to get wrong and expensive to discover in production:

```ts
import { describe, it, expect } from 'vitest';
import {
  funnelQuery, crosstabQuery, traceQuery, isCrosstabDimension,
} from '../src/platform/analytics/queries';

const IDS = ['p1', 'p2'];
const SINCE = '2026-09-01T00:00:00.000Z';
const UNTIL = '2026-10-01T00:00:00.000Z';

describe('query construction', () => {
  it('never interpolates player ids into the SQL text', () => {
    const { sql, params } = funnelQuery('heap_logs', IDS, SINCE, UNTIL);
    expect(sql).not.toContain('p1');
    expect(params).toContain('p1');
  });

  it('filters on timestamp and never puts double1 in WHERE or ORDER BY', () => {
    // AE quirk: double1 is SELECTable but not usable in WHERE/ORDER BY, and the
    // auto `timestamp` column is filterable but not SELECTable.
    for (const { sql } of [
      funnelQuery('heap_logs', IDS, SINCE, UNTIL),
      crosstabQuery('heap_logs', 'duration', IDS, SINCE, UNTIL),
      traceQuery('heap_logs', 'p1', SINCE, UNTIL, 100),
    ]) {
      const where = sql.slice(sql.indexOf('WHERE'));
      const orderBy = sql.includes('ORDER BY') ? sql.slice(sql.indexOf('ORDER BY')) : '';
      expect(where.split('GROUP BY')[0]).not.toContain('double1');
      expect(orderBy).not.toMatch(/ORDER BY[^)]*\btimestamp\b/);
    }
  });

  it('uses no JOIN or UNION — AE supports neither', () => {
    for (const { sql } of [
      funnelQuery('heap_logs', IDS, SINCE, UNTIL),
      crosstabQuery('heap_logs', 'cause', IDS, SINCE, UNTIL),
    ]) {
      expect(sql).not.toMatch(/\bJOIN\b/i);
      expect(sql).not.toMatch(/\bUNION\b/i);
    }
  });

  it('counts events with SUM(_sample_interval), never bare COUNT of events', () => {
    const { sql } = funnelQuery('heap_logs', IDS, SINCE, UNTIL);
    expect(sql).toContain('_sample_interval');
  });

  it('targets the dataset it is given', () => {
    expect(funnelQuery('heap_logs_staging', IDS, SINCE, UNTIL).sql).toContain('heap_logs_staging');
  });

  it('rejects an unknown crosstab dimension', () => {
    expect(isCrosstabDimension('duration')).toBe(true);
    expect(isCrosstabDimension('; DROP TABLE')).toBe(false);
    expect(isCrosstabDimension('payload')).toBe(false);
  });

  it('builds a different bucket expression per dimension', () => {
    const a = crosstabQuery('heap_logs', 'duration', IDS, SINCE, UNTIL).sql;
    const b = crosstabQuery('heap_logs', 'cause', IDS, SINCE, UNTIL).sql;
    expect(a).not.toBe(b);
    expect(a).toContain('double5');  // durationMs
    expect(b).toContain('blob8');    // cause
  });

  it('scopes a trace to exactly one player', () => {
    const { sql, params } = traceQuery('heap_logs', 'p9', SINCE, UNTIL, 50);
    expect(sql).toContain('index1 = ?');
    expect(params).toContain('p9');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npx vitest run tests/analyticsQueries.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the query module**

Create `server/src/platform/analytics/queries.ts`. The structure is the same for the two cohort queries: an **inner subquery** aggregates per player (AE has no JOIN, but subqueries in `FROM` work), and an outer query aggregates across players.

```ts
// server/src/platform/analytics/queries.ts
//
// The fixed set of Analytics Engine queries. This is the security boundary:
// the Worker holds a Cloudflare API token that can read all account analytics,
// and the only thing standing between a caller and arbitrary use of it is that
// every query is built here from allowlisted inputs.
//
// AE SQL constraints these queries are written around (see the plan's Global
// Constraints, and .github/workflows/fetch-logs.yml which learned two of them
// the hard way):
//   * No JOIN, no UNION. Single table. Subqueries in FROM are supported, which
//     is how the per-player aggregations below work.
//   * `double1` is SELECTable but cannot appear in WHERE or ORDER BY. The auto
//     `timestamp` column is the reverse. So: filter on timestamp, output/order
//     on double1.
//   * No JSON functions — which is why Plan 2 promoted the run facts into
//     double2..double6 and blob8 instead of leaving them in the payload blob.
//
// Column map (fixed by AnalyticsEngineSink.ts):
//   index1  = player id            blob5 = sessionId
//   blob1   = level                blob6 = payload JSON
//   blob2   = eventType            blob7 = userAgent
//   blob3   = platform             blob8 = run cause
//   blob4   = appVersion
//   double1 = client timestamp     double4 = kills
//   double2 = score                double5 = durationMs
//   double3 = height               double6 = pickupBonus

export const CROSSTAB_DIMENSIONS = [
  'duration', 'cause', 'height', 'score', 'platform', 'appVersion', 'placed', 'submitted',
] as const;
export type CrosstabDimension = typeof CROSSTAB_DIMENSIONS[number];

export function isCrosstabDimension(v: unknown): v is CrosstabDimension {
  return typeof v === 'string' && (CROSSTAB_DIMENSIONS as readonly string[]).includes(v);
}

export interface FunnelStages {
  cohort: number; startedRun1: number; finishedRun1: number;
  startedRun2: number; startedRun3: number; returnedLater: number;
}
export interface CrosstabRow { bucket: string; cohort: number; returned: number }
export interface TraceRow {
  ts: number; level: string; eventType: string;
  platform: string; appVersion: string; sessionId: string; payload: string;
}

/** `?` placeholders for a list of ids, as positional params. */
function idPlaceholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ');
}

/**
 * Per-player stage counts for a cohort.
 *
 * Inner query: one row per player, with their run counts and first/last activity.
 * Outer query: how many players cleared each stage.
 *
 * Event counts use SUM(_sample_interval) so they stay correct under sampling.
 * The outer counts are counts of OBSERVED players — exact while
 * _sample_interval is 1, which is why the result carries it.
 */
export function funnelQuery(
  dataset: string, playerIds: string[], since: string, until: string,
): { sql: string; params: (string | number)[] } {
  const sql = `
    SELECT
      count() AS cohort,
      countIf(starts >= 1) AS startedRun1,
      countIf(ends   >= 1) AS finishedRun1,
      countIf(starts >= 2) AS startedRun2,
      countIf(starts >= 3) AS startedRun3,
      countIf(lastDay > firstDay) AS returnedLater,
      max(si) AS _sample_interval
    FROM (
      SELECT
        index1 AS player,
        SUM(_sample_interval * (blob2 = 'run:start')) AS starts,
        SUM(_sample_interval * (blob2 = 'run:end'))   AS ends,
        toDate(min(double1) / 1000) AS firstDay,
        toDate(max(double1) / 1000) AS lastDay,
        max(_sample_interval) AS si
      FROM ${dataset}
      WHERE timestamp >= toDateTime(?) AND timestamp < toDateTime(?)
        AND index1 IN (${idPlaceholders(playerIds.length)})
      GROUP BY player
    )`;
  return { sql, params: [since, until, ...playerIds] };
}

/** The per-dimension bucket expression, evaluated on each player's FIRST run. */
function bucketExpr(dimension: CrosstabDimension): string {
  switch (dimension) {
    case 'duration':
      // double5 = durationMs on the first run:end
      return `multiIf(firstDuration < 15000, '0-15s',
                      firstDuration < 45000, '15-45s',
                      firstDuration < 120000, '45-120s', '120s+')`;
    case 'height':
      return `multiIf(firstHeight < 100, '0-100', firstHeight < 500, '100-500',
                      firstHeight < 2000, '500-2000', '2000+')`;
    case 'score':
      return `multiIf(firstScore < 100, '0-100', firstScore < 1000, '100-1000',
                      firstScore < 5000, '1000-5000', '5000+')`;
    case 'cause':       return 'firstCause';
    case 'platform':    return 'platform';
    case 'appVersion':  return 'appVersion';
    case 'placed':      return `if(placements > 0, 'placed', 'never placed')`;
    case 'submitted':   return `if(submissions > 0, 'submitted', 'never submitted')`;
  }
}

/**
 * Run-2 rate split by a characteristic of the player's FIRST run.
 *
 * Three levels, because AE has no JOIN and an alias cannot be referenced in the
 * SELECT that defines it: innermost derives each player's facts, the middle
 * layer turns those into a bucket label, the outer layer aggregates by bucket.
 */
export function crosstabQuery(
  dataset: string, dimension: CrosstabDimension,
  playerIds: string[], since: string, until: string,
): { sql: string; params: (string | number)[] } {
  const sql = `
    SELECT bucket, count() AS cohort, countIf(starts >= 2) AS returned, max(si) AS _sample_interval
    FROM (
      SELECT ${bucketExpr(dimension)} AS bucket, starts, si
      FROM (
        SELECT
          index1 AS player,
          SUM(_sample_interval * (blob2 = 'run:start')) AS starts,
          SUM(_sample_interval * (blob2 = 'placement:made')) AS placements,
          SUM(_sample_interval * (blob2 = 'score:submitted')) AS submissions,
          argMinIf(double5, double1, blob2 = 'run:end') AS firstDuration,
          argMinIf(double3, double1, blob2 = 'run:end') AS firstHeight,
          argMinIf(double2, double1, blob2 = 'run:end') AS firstScore,
          argMinIf(blob8,  double1, blob2 = 'run:end') AS firstCause,
          argMin(blob3, double1) AS platform,
          argMin(blob4, double1) AS appVersion,
          max(_sample_interval) AS si
        FROM ${dataset}
        WHERE timestamp >= toDateTime(?) AND timestamp < toDateTime(?)
          AND index1 IN (${idPlaceholders(playerIds.length)})
        GROUP BY player
      )
    )
    GROUP BY bucket
    ORDER BY bucket`;
  return { sql, params: [since, until, ...playerIds] };
}

/** Every event for one player, newest first. */
export function traceQuery(
  dataset: string, playerId: string, since: string, until: string, limit: number,
): { sql: string; params: (string | number)[] } {
  // Ordering is on double1 (the client timestamp) because the auto `timestamp`
  // column cannot be SELECTed and double1 cannot be used in ORDER BY... so the
  // SELECT aliases it first and orders by the alias. fetch-logs.yml does the
  // same thing for the same reason.
  const sql = `
    SELECT
      double1 AS ts,
      blob1 AS level, blob2 AS eventType, blob3 AS platform,
      blob4 AS appVersion, blob5 AS sessionId, blob6 AS payload,
      _sample_interval
    FROM ${dataset}
    WHERE timestamp >= toDateTime(?) AND timestamp < toDateTime(?)
      AND index1 = ?
    ORDER BY ts DESC
    LIMIT ?`;
  return { sql, params: [since, until, playerId, limit] };
}
```

If `argMinIf` or `multiIf` turns out not to be supported when first run against the real API, fall back to `argMin` over a filtered subquery and nested `if(...)` respectively, and record the substitution in the module's header comment. Do not switch to JSON parsing or string slicing — that is the thing this design exists to avoid.

- [ ] **Step 4: Run the tests**

Run: `cd server && npx vitest run tests/analyticsQueries.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/platform/analytics/queries.ts server/tests/analyticsQueries.test.ts
git commit -m "feat(analytics): add the fixed Analytics Engine query set"
```

---

### Task 3: The analytics proxy route

**Files:**
- Create: `server/src/platform/routes/analytics.ts`
- Modify: `server/src/platform/app.ts` (options), `server/src/app.ts` (gate + mount), `server/src/index.ts` (wiring), `server/src/constants.ts` (dataset name)
- Test: `server/tests/analytics.test.ts`
- Modify: `server/tests/routeInventory.test.ts` + its snapshot

**Interfaces:**
- Consumes: `AeClient` (Task 1), the query set (Task 2), `MetricsDB.cohortMembers` (Plan 1).
- Produces:
  - `AppOptions.aeClient?: AeClient` — when unset, `/analytics` is not mounted (404), matching `metricsDb` / `banDb`.
  - `GET /analytics/funnel?since=&until=`
  - `GET /analytics/crosstab?dimension=&since=&until=`
  - `GET /analytics/trace?playerId=&since=&until=&limit=`
  - Every response includes `{ sampled: boolean, sampleIntervalMax: number }`.

- [ ] **Step 1: Write the failing route tests**

Create `server/tests/analytics.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockMetricsDB } from './helpers/mockMetricsDb';
import { MockAeClient } from './helpers/mockAeClient';

const ADMIN = { 'X-Admin-Secret': 's3cret' };

function makeApp(ae = new MockAeClient(), metricsDb = new MockMetricsDB()) {
  return { app: createApp(new MockHeapDB(), new MockScoreDB(), {
    aeClient: ae, metricsDb, adminSecret: 's3cret',
  }), ae, metricsDb };
}

describe('GET /analytics/funnel', () => {
  it('requires the admin secret (401)', async () => {
    const { app } = makeApp();
    expect((await app.request('/analytics/funnel')).status).toBe(401);
  });

  it('pulls the cohort from D1 and passes its ids to the AE query', async () => {
    const { app, ae, metricsDb } = makeApp();
    metricsDb.cohortPage = { playerIds: ['p1', 'p2'], nextCursor: null };
    ae.rows = [{ cohort: 2, startedRun1: 2, finishedRun1: 1, startedRun2: 1, startedRun3: 0, returnedLater: 0 }];

    const res = await app.request('/analytics/funnel?since=2026-09-01T00:00:00.000Z&until=2026-10-01T00:00:00.000Z', { headers: ADMIN });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stages.cohort).toBe(2);
    expect(ae.calls[0].params).toEqual(expect.arrayContaining(['p1', 'p2']));
  });

  it('returns an empty funnel without querying AE when the cohort is empty', async () => {
    const { app, ae, metricsDb } = makeApp();
    metricsDb.cohortPage = { playerIds: [], nextCursor: null };
    const res = await app.request('/analytics/funnel', { headers: ADMIN });
    expect(res.status).toBe(200);
    expect((await res.json()).stages.cohort).toBe(0);
    expect(ae.calls).toHaveLength(0);
  });

  it('flags sampled results', async () => {
    const { app, ae, metricsDb } = makeApp();
    metricsDb.cohortPage = { playerIds: ['p1'], nextCursor: null };
    ae.rows = [{ cohort: 1 }];
    ae.sampleIntervalMax = 8;
    const body = await (await app.request('/analytics/funnel', { headers: ADMIN })).json();
    expect(body.sampled).toBe(true);
    expect(body.sampleIntervalMax).toBe(8);
  });

  it('404s when no aeClient is configured', async () => {
    const app = createApp(new MockHeapDB(), new MockScoreDB(), { adminSecret: 's3cret' });
    expect((await app.request('/analytics/funnel', { headers: ADMIN })).status).toBe(404);
  });
});

describe('GET /analytics/crosstab', () => {
  it('rejects an unknown dimension (400) without querying AE', async () => {
    const { app, ae } = makeApp();
    const res = await app.request('/analytics/crosstab?dimension=payload', { headers: ADMIN });
    expect(res.status).toBe(400);
    expect(ae.calls).toHaveLength(0);
  });

  it('accepts an allowlisted dimension', async () => {
    const { app, ae, metricsDb } = makeApp();
    metricsDb.cohortPage = { playerIds: ['p1'], nextCursor: null };
    ae.rows = [{ bucket: '0-15s', cohort: 10, returned: 1 }];
    const res = await app.request('/analytics/crosstab?dimension=duration', { headers: ADMIN });
    expect(res.status).toBe(200);
    expect((await res.json()).rows[0].bucket).toBe('0-15s');
  });
});

describe('GET /analytics/trace', () => {
  it('requires a playerId (400)', async () => {
    const { app } = makeApp();
    expect((await app.request('/analytics/trace', { headers: ADMIN })).status).toBe(400);
  });

  it('rejects an over-long playerId (400)', async () => {
    const { app } = makeApp();
    const res = await app.request('/analytics/trace?playerId=' + 'x'.repeat(200), { headers: ADMIN });
    expect(res.status).toBe(400);
  });

  it('returns the player events', async () => {
    const { app, ae } = makeApp();
    ae.rows = [{ ts: 123, level: 'event', eventType: 'run:start', payload: '{}' }];
    const body = await (await app.request('/analytics/trace?playerId=p1', { headers: ADMIN })).json();
    expect(body.rows).toHaveLength(1);
    expect(ae.calls[0].params).toContain('p1');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run tests/analytics.test.ts`
Expected: FAIL — `aeClient` is not a known option, routes 404.

- [ ] **Step 3: Extract the shared window parser**

Plan 1's final review already flagged that `routes/metrics.ts` duplicates its
`since`/`until` block between two handlers. This plan would make it five copies.
Extract it first, as its own commit:

Create `server/src/platform/routes/timeWindow.ts`:

```ts
// server/src/platform/routes/timeWindow.ts
//
// Shared `since`/`until` parsing for the admin read routes. Extracted when the
// third and fourth handlers needed it — metrics.ts had already duplicated it
// once, which a review caught.

import type { Context } from 'hono';

export const DAY_MS = 86_400_000;
export const DEFAULT_WINDOW_DAYS = 30;

export function parseIso(v: string | undefined): string | null {
  if (v === undefined) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export type Window = { since: string; until: string };

/** Half-open `[since, until)`. Returns an error string instead of a window
 *  when the request is malformed, so callers can 400 with it. */
export function parseWindow(c: Context): Window | { error: string } {
  const until = c.req.query('until') === undefined
    ? new Date().toISOString()
    : parseIso(c.req.query('until'));
  if (until === null) return { error: 'until is not a valid ISO timestamp' };

  const since = c.req.query('since') === undefined
    ? new Date(Date.parse(until) - DEFAULT_WINDOW_DAYS * DAY_MS).toISOString()
    : parseIso(c.req.query('since'));
  if (since === null) return { error: 'since is not a valid ISO timestamp' };

  if (Date.parse(since) >= Date.parse(until)) {
    return { error: 'since must be before until' };
  }
  return { since, until };
}
```

Refactor both existing handlers in `routes/metrics.ts` to use it, delete the
local `parseIso`/`DAY_MS`/`DEFAULT_WINDOW_DAYS`, and confirm
`tests/metrics.test.ts` still passes **unchanged** — its existing 400 cases are
what prove the extraction is behavior-preserving.

Commit this separately:

```bash
git add server/src/platform/routes/timeWindow.ts server/src/platform/routes/metrics.ts
git commit -m "refactor(server): extract shared since/until window parsing"
```

- [ ] **Step 4: Write the route**

Create `server/src/platform/routes/analytics.ts`:

```ts
// server/src/platform/routes/analytics.ts
//
// Admin-only Analytics Engine proxy (adminGate applied in app.ts).
//
// SECURITY: this Worker holds a Cloudflare API token that can read ALL account
// analytics. The only thing keeping a caller from using it that way is that
// every query is built from the fixed set in analytics/queries.ts, from
// allowlisted parameters. NEVER add an endpoint that accepts SQL, a dataset
// name, or a column name from the request.

import { Hono } from 'hono';
import type { AeClient } from '../analytics/aeClient';
import type { MetricsDB } from '../metricsDb';
import { AE_DATASET, MAX_ID_LEN } from '../../constants';
import { parseWindow } from './timeWindow';
import {
  funnelQuery, crosstabQuery, traceQuery, isCrosstabDimension,
  type FunnelStages, type CrosstabRow, type TraceRow, CROSSTAB_DIMENSIONS,
} from '../analytics/queries';

/** Ceiling on cohort size pulled from D1 for one request. */
const MAX_COHORT_PLAYERS = 2000;
/** Ids per AE query — a day of ids will not fit in one IN (...) clause. */
const MAX_IDS_PER_QUERY = 500;
const COHORT_PAGE = 500;

const DEFAULT_TRACE_LIMIT = 200;
const MAX_TRACE_LIMIT = 1000;

/** Pages cohortMembers until exhausted or the ceiling is hit. */
async function loadCohort(
  metricsDb: MetricsDB, since: string, until: string,
): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  while (ids.length < MAX_COHORT_PLAYERS) {
    const page = await metricsDb.cohortMembers(since, until, COHORT_PAGE, cursor);
    ids.push(...page.playerIds);
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  return ids.slice(0, MAX_COHORT_PLAYERS);
}

function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

export function analyticsRoutes(ae: AeClient, metricsDb: MetricsDB): Hono {
  const app = new Hono();

  // GET /analytics/funnel?since=&until=
  app.get('/funnel', async (c) => {
    const w = parseWindow(c);
    if ('error' in w) return c.json({ error: w.error }, 400);

    const ids = await loadCohort(metricsDb, w.since, w.until);
    const empty: FunnelStages = {
      cohort: 0, startedRun1: 0, finishedRun1: 0,
      startedRun2: 0, startedRun3: 0, returnedLater: 0,
    };
    // An empty IN () is a syntax error — and there is nothing to ask anyway.
    if (ids.length === 0) {
      return c.json({ stages: empty, sampled: false, sampleIntervalMax: 1, truncated: false });
    }

    const totals = { ...empty };
    let siMax = 1;
    for (const batch of chunk(ids, MAX_IDS_PER_QUERY)) {
      const { sql, params } = funnelQuery(AE_DATASET, batch, w.since, w.until);
      const res = await ae.query<Partial<FunnelStages>>(sql, params);
      const row = res.rows[0] ?? {};
      for (const k of Object.keys(totals) as (keyof FunnelStages)[]) {
        totals[k] += Number(row[k] ?? 0);
      }
      if (res.sampleIntervalMax > siMax) siMax = res.sampleIntervalMax;
    }

    return c.json({
      stages: totals,
      since: w.since, until: w.until,
      sampled: siMax > 1, sampleIntervalMax: siMax,
      truncated: ids.length >= MAX_COHORT_PLAYERS,
    });
  });

  // GET /analytics/crosstab?dimension=&since=&until=
  app.get('/crosstab', async (c) => {
    const dimension = c.req.query('dimension') ?? 'duration';
    if (!isCrosstabDimension(dimension)) {
      return c.json({ error: `dimension must be one of: ${CROSSTAB_DIMENSIONS.join(', ')}` }, 400);
    }
    const w = parseWindow(c);
    if ('error' in w) return c.json({ error: w.error }, 400);

    const ids = await loadCohort(metricsDb, w.since, w.until);
    if (ids.length === 0) {
      return c.json({ dimension, rows: [], sampled: false, sampleIntervalMax: 1, truncated: false });
    }

    // Buckets are summed across batches by label.
    const byBucket = new Map<string, { cohort: number; returned: number }>();
    let siMax = 1;
    for (const batch of chunk(ids, MAX_IDS_PER_QUERY)) {
      const { sql, params } = crosstabQuery(AE_DATASET, dimension, batch, w.since, w.until);
      const res = await ae.query<CrosstabRow>(sql, params);
      for (const r of res.rows) {
        const cur = byBucket.get(r.bucket) ?? { cohort: 0, returned: 0 };
        cur.cohort   += Number(r.cohort ?? 0);
        cur.returned += Number(r.returned ?? 0);
        byBucket.set(r.bucket, cur);
      }
      if (res.sampleIntervalMax > siMax) siMax = res.sampleIntervalMax;
    }

    const rows = [...byBucket.entries()]
      .map(([bucket, v]) => ({ bucket, ...v }))
      .sort((a, b) => a.bucket.localeCompare(b.bucket));

    return c.json({
      dimension, rows, since: w.since, until: w.until,
      sampled: siMax > 1, sampleIntervalMax: siMax,
      truncated: ids.length >= MAX_COHORT_PLAYERS,
    });
  });

  // GET /analytics/trace?playerId=&since=&until=&limit=
  app.get('/trace', async (c) => {
    const playerId = c.req.query('playerId');
    if (!playerId || playerId.length > MAX_ID_LEN) {
      return c.json({ error: 'playerId is required and must be at most 64 chars' }, 400);
    }
    const w = parseWindow(c);
    if ('error' in w) return c.json({ error: w.error }, 400);

    const raw = Number(c.req.query('limit') ?? DEFAULT_TRACE_LIMIT);
    const limit = Number.isFinite(raw)
      ? Math.max(1, Math.min(MAX_TRACE_LIMIT, Math.floor(raw)))
      : DEFAULT_TRACE_LIMIT;

    const { sql, params } = traceQuery(AE_DATASET, playerId, w.since, w.until, limit);
    const res = await ae.query<TraceRow>(sql, params);

    return c.json({
      playerId, rows: res.rows, since: w.since, until: w.until,
      // A sampled trace has MISSING EVENTS — it is not a complete history of
      // this player, and the UI must say so rather than imply completeness.
      sampled: res.sampleIntervalMax > 1, sampleIntervalMax: res.sampleIntervalMax,
    });
  });

  return app;
}
```

Wrap the three handlers so an AE transport failure returns **502** with the
upstream message rather than a 500 with a stack — either a `try/catch` in each
handler or Hono's `app.onError`, matching whichever convention the other route
files already use.

Add to `server/src/constants.ts`:

```ts
/** Analytics Engine dataset the admin query proxy reads. Server-side only —
 *  never accepted from a request. */
export const AE_DATASET = 'heap_logs';
```

Points the code above already settles, listed so a reviewer can check them off:
the window parsing is shared (not a fifth copy), the cohort is paged to a
`MAX_COHORT_PLAYERS` ceiling and chunked at `MAX_IDS_PER_QUERY` per AE query,
an empty cohort short-circuits without issuing a query (an empty `IN ()` is a
syntax error), `dimension` is validated by `isCrosstabDimension` before use,
`playerId` is bounded by `MAX_ID_LEN`, `limit` is clamped, the dataset comes
from a server-side constant, and every response carries `sampled` /
`sampleIntervalMax`.

- [ ] **Step 5: Wire it up**

- `server/src/platform/app.ts`: add `aeClient?: AeClient` to the options interface.
- `server/src/app.ts`: 

```ts
  if (opts.aeClient && opts.metricsDb) {
    app.use('/analytics/*', adminGate);
    app.route('/analytics', analyticsRoutes(opts.aeClient, opts.metricsDb));
  }
```

  Both are required — the funnel is meaningless without a cohort source.
- `server/src/index.ts`: construct `new HttpAeClient(env.CF_ACCOUNT_ID, env.CF_ANALYTICS_TOKEN)` when both are present, else leave `aeClient` undefined so the routes stay unmounted. Add both to the `Env` interface.
- `server/tests/routeInventory.test.ts`: pass `aeClient` and `metricsDb` stubs, and update the snapshot so the three `/analytics/*` routes and their wildcard gate appear.

- [ ] **Step 6: Run the tests**

Run: `cd server && npx vitest run tests/analytics.test.ts tests/routeInventory.test.ts tests/metrics.test.ts`
Expected: PASS. The routeInventory snapshot must show `ALL /analytics/*` ahead of the three GET routes.

- [ ] **Step 7: Document the secrets**

Add to `server/wrangler.toml`'s comments (not `[vars]` — these are secrets):

```
# Analytics Engine SQL API, for the admin funnel/crosstab/trace routes.
#   npx wrangler secret put CF_ACCOUNT_ID
#   npx wrangler secret put CF_ANALYTICS_TOKEN   # Account Analytics Read
# When either is absent the /analytics routes are simply not mounted.
```

- [ ] **Step 8: Commit**

```bash
git add server/src/platform/routes/analytics.ts server/src/platform/app.ts server/src/app.ts \
        server/src/index.ts server/src/constants.ts server/wrangler.toml \
        server/tests/analytics.test.ts server/tests/routeInventory.test.ts \
        server/tests/__snapshots__/routeInventory.test.ts.snap
git commit -m "feat(analytics): add admin-gated Analytics Engine query proxy"
```

---

### Task 4: Admin UI — funnel, cross-tab and trace

**Files:**
- Modify: `admin/index.html`

**Interfaces:**
- Consumes: the three routes from Task 3, plus the existing `$`, `adminFetch`, `setStatus`, `escapeHtml`, and `envGeneration` helpers.
- Produces: `renderFunnel`, `renderCrosstab`, `renderTrace`, `loadFunnel`, `loadCrosstab`, `loadTrace`, `bootFunnel`.

Follow every convention Plan 1's acquisition card established, because its final review caught each of these the hard way:

- **Every** interpolated value goes through `escapeHtml` — trace payloads are the highest-risk strings in the whole admin UI, since they are player-supplied JSON.
- Capture `const gen = envGeneration` before each fetch and bail if it changed after, matching `loadCodes`; clear these cards in `applyEnv`.
- `encodeURIComponent` every query param.
- Charts are hand-rolled inline SVG with `viewBox` + `width="100%"`, never a fixed pixel width and never a CDN charting library.

- [ ] **Step 1: Add the three cards**

One card per view, after the Analytics — Acquisition card, following the existing `<div class="card border-l-term-*">` / `<h2 class="card-head">` pattern:

- **Analytics — First-Session Funnel**: date range inputs, Load button, and a horizontal bar per stage (cohort / started run 1 / finished run 1 / started run 2 / started run 3 / returned later), each bar labeled with its count and its percentage of the cohort.
- **Analytics — Churn Cross-tab**: a `<select>` populated with exactly the eight allowlisted dimensions, a date range, and a table of bucket / cohort / returned / rate%.
- **Analytics — Player Trace**: a player-id text input, a date range, and a chronological table of the player's events (time, event type, payload).

- [ ] **Step 2: Add a sampling warning**

Every one of the three cards renders a visible warning when the response has `sampled: true`, stating that Analytics Engine downsampled (showing `sampleIntervalMax`) and that the numbers are estimates. On the **trace** card the warning is stronger: a sampled trace has *missing events*, so it must not be read as a complete history of that player.

- [ ] **Step 3: Wire boot and env reset**

Add the load handlers, register them in `bootFunnel()`, call `bootFunnel()` from `DOMContentLoaded` alongside the existing `boot*` calls, and clear all three cards in `applyEnv`.

- [ ] **Step 4: Verify in the browser**

Run the admin UI against a worker (`cd server && npx wrangler dev` plus `npm run admin`), and confirm each card loads, renders, shows a sensible empty state, and does not produce horizontal scroll at 400px width. With no AE secrets set locally the routes will 404 — confirm each card reports that cleanly rather than throwing.

- [ ] **Step 5: Commit**

```bash
git add admin/index.html
git commit -m "feat(admin): add funnel, cross-tab and player-trace analytics views"
```

---

### Task 5: Validate the queries against the real API

Every earlier task tested against a stub. AE's SQL dialect is a ClickHouse subset whose exact function support is only partly documented — `argMinIf` and `multiIf` in particular are assumed, not verified. This task finds out before the views ship.

**Files:** possibly `server/src/platform/analytics/queries.ts` (fixes only)

- [ ] **Step 1: Run each query against staging**

With `CF_ACCOUNT_ID` and `CF_ANALYTICS_TOKEN` exported locally, POST each of the three generated queries to the SQL API against the **staging** dataset (`heap_logs_staging`), using a real player id from staging. Capture the exact response for each.

- [ ] **Step 2: Fix whatever the dialect rejects**

For each rejected function, substitute a supported equivalent and record the substitution in the module header:
- `argMinIf(x, t, cond)` → `argMin(x, if(cond, t, NULL))`, or an inner filtered subquery.
- `multiIf(...)` → nested `if(...)`.
- `toDate(x / 1000)` → whatever the date-function reference actually supports for a millisecond epoch.

Re-run until all three queries execute. Update `analyticsQueries.test.ts` to match any changed SQL shape.

- [ ] **Step 3: Sanity-check one number by hand**

Pick one player from staging, pull their trace, and count their `run:start` events manually. Confirm the funnel's `startedRun1`/`startedRun2` classification for that player agrees. A funnel that executes but miscounts is worse than one that errors.

- [ ] **Step 4: Commit any fixes**

```bash
git add server/src/platform/analytics/queries.ts server/tests/analyticsQueries.test.ts
git commit -m "fix(analytics): align queries with the AE SQL dialect as verified against staging"
```

---

### Task 6: Full verification

- [ ] **Step 1: No caller-supplied SQL anywhere**

Run: `grep -rn "req.query('sql')\|body.sql\|c.req.json()" server/src/platform/routes/analytics.ts`
Expected: no match. The proxy must never accept SQL from a caller.

- [ ] **Step 2: Gate coverage**

Run: `grep -n "analytics" server/tests/__snapshots__/routeInventory.test.ts.snap`
Expected: the wildcard gate and all three routes present.

- [ ] **Step 3: Full suite and build**

Run: `npm test && npm run build`
Expected: both PASS.

- [ ] **Step 4: Confirm the token never reaches a client**

Run: `grep -rn "CF_ANALYTICS_TOKEN" server/src/ admin/`
Expected: matches only in `server/src/index.ts` (reading it from `env`). Any match under `admin/` is a critical defect.

- [ ] **Step 5: Open the PR**

```bash
git push -u origin feature/analytics-funnel
gh pr create --base main --title "Player analytics 3/3: funnel and churn analysis" --body "..."
```

Note in the body that the views are only meaningful for cohorts formed **after** Plan 2's deploy date (recorded in `docs/superpowers/runbooks/analytics-history-split.md`), and that the AE secrets must be set in production for the routes to mount at all.

---

## Notes for the executor

- **AE SQL is not full SQL.** No JOIN, no UNION, no JSON functions. Subqueries in `FROM` are the only composition tool, and the queries are built around that. If you find yourself wanting a JOIN, the answer is a nested subquery or a second round trip aggregated in Worker code — never string-parsing the payload blob.
- **`double1` and `timestamp` are not interchangeable.** Filter on `timestamp`; SELECT and order on `double1`. `fetch-logs.yml` documents this; do not rediscover it.
- **Never bare-`COUNT()` events.** Use `SUM(_sample_interval)`. Counts of *players* in the outer query are counts of observed players and are exact only while `_sample_interval` is 1 — which is why every response carries it and every view warns on it.
- **This plan's numbers are only as good as Plan 2's deploy date.** Cohorts spanning that boundary see one signed-in human as two players.
- No schema changes and no migrations in this plan.

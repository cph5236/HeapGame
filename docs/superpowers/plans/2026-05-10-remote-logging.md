# Remote Logging & Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-party client + server log capture so errors and gameplay events from player devices land in Cloudflare-owned storage we can query.

**Architecture:** Three replaceable interfaces — `Logger` (client), `Sink` (server), and a stable JSON wire format between them. Client batches via `RemoteLogger`, ships via `sendBeacon`/`fetch` to a new `POST /log` route. Server selects `AnalyticsEngineSink` (default, prod) or `D1Sink` (fallback, local dev) based on binding presence. `NullLogger` keeps call sites compiling when logging is off.

**Tech Stack:** TypeScript 5.9, Vitest, Phaser 3.90, Hono, Cloudflare Workers (D1 + Analytics Engine), Capacitor 8.2.

**Spec:** [docs/superpowers/specs/2026-05-08-remote-logging-design.md](../specs/2026-05-08-remote-logging-design.md)

---

## File map

**New (shared):**
- `shared/logging/Logger.ts` — `Logger` interface + envelope/entry types
- `shared/logging/events.ts` — `GameEvent` discriminated union (7 event types)

**New (client):**
- `src/logging/NullLogger.ts`
- `src/logging/RemoteLogger.ts`
- `src/logging/capture.ts` — window.error / unhandledrejection / fetch wrapper
- `src/logging/index.ts` — `getLogger()` singleton + boot init
- `src/logging/__tests__/RemoteLogger.test.ts`
- `src/logging/__tests__/NullLogger.test.ts`
- `src/logging/__tests__/capture.test.ts`

**New (server):**
- `server/src/logging/Sink.ts`
- `server/src/logging/AnalyticsEngineSink.ts`
- `server/src/logging/D1Sink.ts`
- `server/src/routes/log.ts`
- `server/migrations/0005_logs_table.sql`
- `server/tests/log.test.ts`
- `server/tests/logSinks.test.ts`

**Modify:**
- `server/src/app.ts` — mount `/log` route, accept `logSink` option
- `server/src/index.ts` — construct sink from env bindings, pass to `createApp`
- `server/wrangler.toml` — `LOGS` AE binding + `RL_LOG` rate-limit block
- `src/systems/SaveData.ts` — add `verboseLogging` field + `getVerboseLogging`/`setVerboseLogging`
- `src/systems/HeapClient.ts` — instrument fetch calls (Phase 3)
- `src/systems/ScoreClient.ts` — instrument fetch calls (Phase 3)
- `src/scenes/MenuScene.ts` — settings toggle UI (Phase 5)
- `src/scenes/HeapSelectScene.ts` — `heap:selected` event (Phase 5)
- `src/scenes/GameScene.ts`, `src/scenes/InfiniteGameScene.ts` — `run:start`, `run:end` (Phase 5)
- `src/scenes/ScoreScene.ts` — `score:submitted` (Phase 5)
- `src/systems/PlaceableManager.ts` — `placement:made` (Phase 5)
- `src/scenes/StoreScene.ts` / `src/scenes/UpgradeScene.ts` — `upgrade:purchased` (Phase 5)
- `server/src/routes/scores.ts` — `score:rejected` warn (Phase 6)
- `server/src/routes/heap.ts` — `place:rejected` warn (Phase 6)
- `server/src/middleware/rateLimit.ts` — `rate_limit:hit` warn (Phase 6)
- `vite.config.ts` — inject `VITE_APP_VERSION` from `package.json`
- `package.json` — bump no deps (only `vite.config.ts` reads version)

---

## Phase 1 — Abstraction skeleton

Land the contracts and a `NullLogger`. Zero behavior change. Everything else builds on this.

### Task 1.1: Branch and shared types

**Files:**
- Create: `shared/logging/Logger.ts`
- Create: `shared/logging/events.ts`

- [ ] **Step 1: Create branch**

```bash
git checkout main
git pull
git checkout -b feature/remote-logging
```

- [ ] **Step 2: Write `shared/logging/events.ts`**

```ts
// Discriminated union of gameplay events. Each member's payload is statically
// checked at call sites via the `type` discriminator.

export type GameMode = 'normal' | 'infinite';
export type RunEndCause = 'death' | 'quit';
export type Platform = 'web' | 'android' | 'ios';

export type UpgradesSnapshot = Record<string, number>;

export type GameEvent =
  | { type: 'user:created' }
  | { type: 'heap:selected'; heapId: string }
  | { type: 'run:start'; heapId: string; mode: GameMode }
  | {
      type: 'run:end';
      heapId: string;
      mode: GameMode;
      score: number;
      height: number;
      kills: number;
      durationMs: number;
      cause: RunEndCause;
      upgrades: UpgradesSnapshot;
    }
  | {
      type: 'score:submitted';
      heapId: string;
      score: number;
      accepted: boolean;
      rejectionReason?: string;
    }
  | { type: 'placement:made'; heapId: string; itemType: string }
  | {
      type: 'upgrade:purchased';
      itemType: string;
      newLevel: number;
      cost: number;
      balanceAfter: number;
      upgrades: UpgradesSnapshot;
    };

export type EventType = GameEvent['type'];
```

- [ ] **Step 3: Write `shared/logging/Logger.ts`**

```ts
import type { GameEvent, Platform } from './events';

export type LogLevel = 'error' | 'warn' | 'event';

/** Envelope fields the logger attaches automatically. Read at flush time. */
export interface LogEnvelope {
  userGuid: string;      // 'pre-init' until SaveData hydrates
  sessionId: string;
  appVersion: string;
  platform: Platform;
  userAgent: string;
}

/** One serialized log entry as sent over the wire. */
export interface LogEntry {
  userGuid: string;
  sessionId: string;
  appVersion: string;
  platform: Platform;
  userAgent: string;
  level: LogLevel;
  timestamp: number;
  eventType?: string;
  message?: string;
  payload: Record<string, unknown>;
}

export interface ErrorContext {
  stack?: string;
  url?: string;
  status?: number;
  durationMs?: number;
  bodySnippet?: string;
  [k: string]: unknown;
}

export interface WarnContext {
  [k: string]: unknown;
}

export interface Logger {
  error(message: string, context?: ErrorContext): void;
  warn(message: string, context?: WarnContext): void;
  event<E extends GameEvent>(event: E): void;
  /** Toggle event-level reporting. Errors and warns are always sent. */
  setVerbose(enabled: boolean): void;
}
```

- [ ] **Step 4: Commit**

```bash
git add shared/logging/
git commit -m "feat(logging): add Logger interface and GameEvent union"
```

### Task 1.2: `NullLogger` (TDD)

**Files:**
- Create: `src/logging/__tests__/NullLogger.test.ts`
- Create: `src/logging/NullLogger.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/logging/__tests__/NullLogger.test.ts
import { describe, it, expect } from 'vitest';
import { NullLogger } from '../NullLogger';

describe('NullLogger', () => {
  it('does not throw on any method', () => {
    const log = new NullLogger();
    expect(() => log.error('x')).not.toThrow();
    expect(() => log.warn('y')).not.toThrow();
    expect(() => log.event({ type: 'user:created' })).not.toThrow();
    expect(() => log.setVerbose(true)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module not found)**

```bash
npx vitest run src/logging/__tests__/NullLogger.test.ts
```

- [ ] **Step 3: Implement `NullLogger`**

```ts
// src/logging/NullLogger.ts
import type { Logger, ErrorContext, WarnContext } from '../../shared/logging/Logger';
import type { GameEvent } from '../../shared/logging/events';

export class NullLogger implements Logger {
  error(_message: string, _context?: ErrorContext): void {}
  warn(_message: string, _context?: WarnContext): void {}
  event<E extends GameEvent>(_event: E): void {}
  setVerbose(_enabled: boolean): void {}
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx vitest run src/logging/__tests__/NullLogger.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/logging/NullLogger.ts src/logging/__tests__/NullLogger.test.ts
git commit -m "feat(logging): add NullLogger no-op implementation"
```

### Task 1.3: `getLogger()` singleton returning `NullLogger`

**Files:**
- Create: `src/logging/index.ts`

- [ ] **Step 1: Write `index.ts`**

```ts
// src/logging/index.ts
import type { Logger } from '../../shared/logging/Logger';
import { NullLogger } from './NullLogger';

let _logger: Logger = new NullLogger();

/** Returns the active Logger. Defaults to NullLogger until initLogger() runs. */
export function getLogger(): Logger {
  return _logger;
}

/** Swap in a real Logger. Called once at boot after SaveData is ready. */
export function setLogger(logger: Logger): void {
  _logger = logger;
}

/** Test helper — reset to NullLogger between tests. */
export function _resetLoggerForTests(): void {
  _logger = new NullLogger();
}
```

- [ ] **Step 2: Add smoke test**

```ts
// Append to src/logging/__tests__/NullLogger.test.ts
import { getLogger, setLogger, _resetLoggerForTests } from '../index';

describe('getLogger', () => {
  it('returns a NullLogger by default', () => {
    _resetLoggerForTests();
    expect(() => getLogger().error('hi')).not.toThrow();
  });

  it('returns the logger set via setLogger', () => {
    const calls: string[] = [];
    setLogger({
      error: (m) => calls.push(m),
      warn: () => {},
      event: () => {},
      setVerbose: () => {},
    });
    getLogger().error('boom');
    expect(calls).toEqual(['boom']);
    _resetLoggerForTests();
  });
});
```

- [ ] **Step 3: Run — expect PASS**

```bash
npx vitest run src/logging/__tests__/NullLogger.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/logging/index.ts src/logging/__tests__/NullLogger.test.ts
git commit -m "feat(logging): add getLogger/setLogger singleton"
```

---

## Phase 2 — Server `/log` route + `D1Sink`

The local-dev path. Lets us prove the wire format end-to-end before touching Analytics Engine.

### Task 2.1: Migration `0005_logs_table.sql`

**Files:**
- Create: `server/migrations/0005_logs_table.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- server/migrations/0005_logs_table.sql
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_guid TEXT NOT NULL,
  session_id TEXT NOT NULL,
  level TEXT NOT NULL,
  event_type TEXT,
  message TEXT,
  payload TEXT NOT NULL,
  platform TEXT NOT NULL,
  app_version TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  client_ts INTEGER NOT NULL,
  server_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_user ON logs(user_guid, server_ts DESC);
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level, server_ts DESC);
```

- [ ] **Step 2: Apply to local D1**

```bash
cd server && npx wrangler d1 migrations apply heap --local
```

Expected: `0005_logs_table.sql` reported as applied.

- [ ] **Step 3: Update `server/schema.sql`** — append the same `CREATE TABLE` + indexes (project convention is to mirror final state).

- [ ] **Step 4: Commit**

```bash
git add server/migrations/0005_logs_table.sql server/schema.sql
git commit -m "feat(logging): add logs table migration"
```

### Task 2.2: `Sink` interface + `D1Sink` (TDD)

**Files:**
- Create: `server/src/logging/Sink.ts`
- Create: `server/src/logging/D1Sink.ts`
- Create: `server/tests/logSinks.test.ts`

- [ ] **Step 1: Write `Sink.ts`**

```ts
// server/src/logging/Sink.ts
import type { LogEntry } from '../../../shared/logging/Logger';

/** A normalized log entry as it arrives from the route (with server_ts stamped). */
export interface StampedLogEntry extends LogEntry {
  serverTimestamp: number;
}

export interface Sink {
  write(entries: StampedLogEntry[]): Promise<void>;
}
```

- [ ] **Step 2: Write failing test for `D1Sink`**

```ts
// server/tests/logSinks.test.ts
import { describe, it, expect } from 'vitest';
import { D1Sink } from '../src/logging/D1Sink';
import type { StampedLogEntry } from '../src/logging/Sink';

function fakeD1() {
  // NOTE: each prepare() builds a per-statement closure so that concurrent
  // prepares (e.g. via Promise.all) don't alias each other's SQL through a
  // shared outer variable. Required for correctness if D1Sink ever batches.
  const inserts: { sql: string; params: unknown[] }[] = [];
  const d1 = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return { run: async () => { inserts.push({ sql, params }); } };
        },
      };
    },
    batch: async (_stmts: any[]) => { /* not used here */ },
  } as any;
  return { d1, inserts };
}

const entry = (over: Partial<StampedLogEntry> = {}): StampedLogEntry => ({
  userGuid: 'u', sessionId: 's', appVersion: '1.0.0',
  platform: 'web', userAgent: 'ua', level: 'error',
  timestamp: 100, eventType: undefined, message: 'boom',
  payload: { x: 1 }, serverTimestamp: 200, ...over,
});

describe('D1Sink', () => {
  it('inserts each entry with the expected bound params', async () => {
    const { d1, inserts } = fakeD1();
    const sink = new D1Sink(d1);
    await sink.write([entry()]);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].sql).toMatch(/INSERT INTO logs/);
    expect(inserts[0].params).toEqual([
      'u', 's', 'error', null, 'boom',
      JSON.stringify({ x: 1 }), 'web', '1.0.0', 'ua', 100, 200,
    ]);
  });

  it('writes event_type when level=event and message=null', async () => {
    const { d1, inserts } = fakeD1();
    const sink = new D1Sink(d1);
    await sink.write([entry({ level: 'event', message: undefined, eventType: 'run:start' })]);
    expect(inserts[0].params[2]).toBe('event');
    expect(inserts[0].params[3]).toBe('run:start');
    expect(inserts[0].params[4]).toBeNull();
  });
});
```

- [ ] **Step 3: Run — expect FAIL (module missing)**

```bash
cd server && npx vitest run tests/logSinks.test.ts
```

- [ ] **Step 4: Implement `D1Sink`**

```ts
// server/src/logging/D1Sink.ts
import type { Sink, StampedLogEntry } from './Sink';

const INSERT_SQL = `
  INSERT INTO logs (
    user_guid, session_id, level, event_type, message,
    payload, platform, app_version, user_agent, client_ts, server_ts
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export class D1Sink implements Sink {
  constructor(private db: D1Database) {}

  async write(entries: StampedLogEntry[]): Promise<void> {
    const stmts = entries.map((e) =>
      this.db.prepare(INSERT_SQL).bind(
        e.userGuid,
        e.sessionId,
        e.level,
        e.eventType ?? null,
        e.message ?? null,
        JSON.stringify(e.payload ?? {}),
        e.platform,
        e.appVersion,
        e.userAgent,
        e.timestamp,
        e.serverTimestamp,
      ),
    );
    // Run sequentially via the same prepared statement; tests assert per-bind params.
    for (const s of stmts) {
      await (s as any).run();
    }
  }
}
```

- [ ] **Step 5: Run — expect PASS**

```bash
cd server && npx vitest run tests/logSinks.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add server/src/logging/ server/tests/logSinks.test.ts
git commit -m "feat(logging): add Sink interface and D1Sink"
```

### Task 2.3: `/log` route (TDD)

**Files:**
- Create: `server/src/routes/log.ts`
- Create: `server/tests/log.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// server/tests/log.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { logRoutes } from '../src/routes/log';
import type { Sink, StampedLogEntry } from '../src/logging/Sink';

class MemSink implements Sink {
  written: StampedLogEntry[] = [];
  async write(e: StampedLogEntry[]) { this.written.push(...e); }
}

function makeApp(sink: Sink) {
  const app = new Hono();
  app.route('/', logRoutes(() => sink));
  return app;
}

const validEntry = {
  userGuid: 'u', sessionId: 's', appVersion: '1.0.0',
  platform: 'web', userAgent: 'ua', level: 'error',
  timestamp: 100, message: 'boom', payload: { x: 1 },
};

describe('POST /log', () => {
  let sink: MemSink;
  beforeEach(() => { sink = new MemSink(); });

  it('accepts a valid batch with 204', async () => {
    const app = makeApp(sink);
    const res = await app.request('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [validEntry] }),
    });
    expect(res.status).toBe(204);
    expect(sink.written).toHaveLength(1);
    expect(sink.written[0].serverTimestamp).toEqual(expect.any(Number));
  });

  it('rejects empty batch with 400', async () => {
    const app = makeApp(sink);
    const res = await app.request('/log', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects batches > 25 entries with 400', async () => {
    const app = makeApp(sink);
    const entries = Array.from({ length: 26 }, () => validEntry);
    const res = await app.request('/log', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an entry > 2KB with 400', async () => {
    const big = { ...validEntry, payload: { blob: 'x'.repeat(3000) } };
    const app = makeApp(sink);
    const res = await app.request('/log', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [big] }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects total body > 64KB with 400', async () => {
    const entries = Array.from({ length: 20 }, () => ({
      ...validEntry, payload: { blob: 'x'.repeat(1900) },
    }));
    const app = makeApp(sink);
    const res = await app.request('/log', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    });
    expect(res.status).toBe(400);
  });

  it('truncates userAgent to 200 chars before writing', async () => {
    const longUa = { ...validEntry, userAgent: 'a'.repeat(500) };
    const app = makeApp(sink);
    await app.request('/log', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [longUa] }),
    });
    expect(sink.written[0].userAgent).toHaveLength(200);
  });

  it('strips unknown top-level entry fields', async () => {
    const dirty = { ...validEntry, extra: 'nope' } as Record<string, unknown>;
    const app = makeApp(sink);
    await app.request('/log', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [dirty] }),
    });
    expect(sink.written[0]).not.toHaveProperty('extra');
  });

  it('swallows sink failure and still returns 204 (best-effort)', async () => {
    const failing: Sink = { write: async () => { throw new Error('boom'); } };
    const app = makeApp(failing);
    const res = await app.request('/log', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [validEntry] }),
    });
    // 204 — we never want clients retrying. Server-side error is internal.
    expect(res.status).toBe(204);
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

```bash
cd server && npx vitest run tests/log.test.ts
```

- [ ] **Step 3: Implement `log.ts`**

```ts
// server/src/routes/log.ts
import { Hono } from 'hono';
import type { Sink, StampedLogEntry } from '../logging/Sink';
import type { LogEntry, LogLevel } from '../../../shared/logging/Logger';
import type { Platform } from '../../../shared/logging/events';

const MAX_ENTRIES = 25;
const MAX_ENTRY_BYTES = 2 * 1024;
const MAX_BODY_BYTES = 64 * 1024;
const VALID_LEVELS: ReadonlySet<LogLevel> = new Set(['error', 'warn', 'event']);
const VALID_PLATFORMS: ReadonlySet<Platform> = new Set(['web', 'android', 'ios']);

function coerceStr(v: unknown, max = 1024): string {
  if (typeof v !== 'string') return '';
  return v.length > max ? v.slice(0, max) : v;
}

function normalize(raw: unknown): LogEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const level = r.level;
  const platform = r.platform;
  if (typeof level !== 'string' || !VALID_LEVELS.has(level as LogLevel)) return null;
  if (typeof platform !== 'string' || !VALID_PLATFORMS.has(platform as Platform)) return null;
  const timestamp = typeof r.timestamp === 'number' ? r.timestamp : Date.now();
  const payload = (r.payload && typeof r.payload === 'object') ? r.payload as Record<string, unknown> : {};
  return {
    userGuid:   coerceStr(r.userGuid, 64),
    sessionId:  coerceStr(r.sessionId, 64),
    appVersion: coerceStr(r.appVersion, 32),
    platform:   platform as Platform,
    userAgent:  coerceStr(r.userAgent, 200),
    level:      level as LogLevel,
    timestamp,
    eventType:  typeof r.eventType === 'string' ? coerceStr(r.eventType, 64) : undefined,
    message:    typeof r.message   === 'string' ? coerceStr(r.message, 1024) : undefined,
    payload,
  };
}

export function logRoutes(getSink: () => Sink) {
  const r = new Hono();

  r.post('/log', async (c) => {
    // Body-size gate (cheap before JSON parse on big payloads).
    const lenHeader = c.req.header('content-length');
    if (lenHeader && Number(lenHeader) > MAX_BODY_BYTES) {
      return c.body(null, 400);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.body(null, 400);
    }
    const rawEntries = (body && typeof body === 'object')
      ? (body as Record<string, unknown>).entries
      : undefined;
    if (!Array.isArray(rawEntries) || rawEntries.length === 0 || rawEntries.length > MAX_ENTRIES) {
      return c.body(null, 400);
    }

    let totalBytes = 0;
    const normalized: StampedLogEntry[] = [];
    const serverTimestamp = Date.now();
    for (const raw of rawEntries) {
      const json = JSON.stringify(raw ?? {});
      if (json.length > MAX_ENTRY_BYTES) return c.body(null, 400);
      totalBytes += json.length;
      if (totalBytes > MAX_BODY_BYTES) return c.body(null, 400);
      const e = normalize(raw);
      if (!e) return c.body(null, 400);
      normalized.push({ ...e, serverTimestamp });
    }

    // Best-effort write. Swallow sink errors so abuse / outages don't surface to clients.
    try {
      await getSink().write(normalized);
    } catch {
      // intentionally swallow
    }
    return c.body(null, 204);
  });

  return r;
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd server && npx vitest run tests/log.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/log.ts server/tests/log.test.ts
git commit -m "feat(logging): add POST /log route with validation"
```

### Task 2.4: Wire `/log` into `createApp` + env-driven sink selection

**Files:**
- Modify: `server/src/app.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Add a route-mount test**

Append to `server/tests/log.test.ts`:

```ts
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';

describe('createApp mounts /log', () => {
  it('routes POST /log through the provided sink', async () => {
    const sink = new MemSink();
    const app = createApp(new MockHeapDB(), new MockScoreDB(), { logSink: sink });
    const res = await app.request('/log', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [validEntry] }),
    });
    expect(res.status).toBe(204);
    expect(sink.written).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL (`logSink` not in AppOptions)**

```bash
cd server && npx vitest run tests/log.test.ts
```

- [ ] **Step 3: Update `server/src/app.ts`**

Add to the imports:
```ts
import { logRoutes } from './routes/log';
import type { Sink } from './logging/Sink';
```

Add to `AppOptions`:
```ts
  /** Sink for incoming /log entries. If unset, /log is not mounted. */
  logSink?: Sink;
```

Mount after the existing routes (immediately before `return app`):
```ts
  if (opts.logSink) {
    app.route('/', logRoutes(() => opts.logSink!));
  }
```

> **Mount-order constraint:** any future middleware that targets `/log` (e.g. the rate-limit registered in Task 2.5) MUST register **before** this `app.route('/', logRoutes(...))` call. Hono matches the first handler that responds; if the route mount fires first, the middleware is skipped silently. Keep `app.post('/log', rateLimit(...))` above this block in `createApp`.

- [ ] **Step 4: Run — expect PASS**

```bash
cd server && npx vitest run
```

- [ ] **Step 5: Update `server/src/index.ts`** — wire D1 sink from env

Add to the imports:
```ts
import { D1Sink } from './logging/D1Sink';
```

Add to `Env` (alongside `DB`):
```ts
  // Analytics Engine binding — added in Phase 4. If unset, fall back to D1Sink.
  LOGS?: AnalyticsEngineDataset;
  RL_LOG?: RateLimiter;
```

Inside the fetch handler where `createApp` is constructed, before the call:
```ts
  const logSink = new D1Sink(env.DB); // Phase 4 swaps to AnalyticsEngineSink when env.LOGS is set
```

Pass to `createApp(..., { ..., logSink })`.

- [ ] **Step 6: Manually verify against local wrangler**

```bash
cd server && npx wrangler dev
# in another terminal:
curl -sS -i -X POST http://localhost:8787/log \
  -H 'Content-Type: application/json' \
  -d '{"entries":[{"userGuid":"u","sessionId":"s","appVersion":"0","platform":"web","userAgent":"x","level":"error","timestamp":0,"message":"hi","payload":{}}]}'
npx wrangler d1 execute heap --local --command "SELECT level, message FROM logs ORDER BY id DESC LIMIT 1"
```

Expected: `204 No Content` from curl; one row with `level=error, message=hi`.

- [ ] **Step 7: Commit**

```bash
git add server/src/app.ts server/src/index.ts server/tests/log.test.ts
git commit -m "feat(logging): mount /log route, wire D1Sink in worker"
```

### Task 2.5: CORS allowlist + `RL_LOG` rate limit

**Files:**
- Modify: `server/wrangler.toml`
- Modify: `server/src/app.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Append `RL_LOG` block to `server/wrangler.toml`**

```toml
[[ratelimits]]
name = "RL_LOG"
namespace_id = "1004"
  [ratelimits.simple]
  limit = 100
  period = 60
```

- [ ] **Step 2: Add `log?: RateLimiter` to `AppOptions.limiters`** in `server/src/app.ts`:

```ts
  limiters?: {
    scores?: RateLimiter;
    place?:  RateLimiter;
    global?: RateLimiter;
    log?:    RateLimiter;
  };
```

- [ ] **Step 3: Apply `rateLimit` middleware to `/log`** — add this line where the other per-route rate limits register (after `app.post('/heaps/:id/place', ...)` and **before** the `app.route('/', logRoutes(...))` mount from Task 2.4). Hono matches handlers in registration order; if the route mount fires first the limiter is silently bypassed.

```ts
  app.post('/log', rateLimit(opts.limiters?.log, 'log'));
```

- [ ] **Step 4: Wire `RL_LOG` from env** in `server/src/index.ts`:

```ts
        scores: env.RL_SCORES,
        place:  env.RL_PLACE,
        global: env.RL_GLOBAL,
        log:    env.RL_LOG,
```

- [ ] **Step 5: Add CORS test for capacitor origin**

Append to `server/tests/security.test.ts` (or add a new test file if `security.test.ts` shape differs):

```ts
describe('CORS allowlist includes Capacitor WebView origins', () => {
  it('accepts capacitor://localhost preflight', async () => {
    const app = createApp(new MockHeapDB(), new MockScoreDB(), {
      allowedOrigins: 'https://example.com,capacitor://localhost,https://localhost',
    });
    const res = await app.request('/log', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'capacitor://localhost',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('capacitor://localhost');
  });
});
```

- [ ] **Step 6: Run all server tests — expect PASS**

```bash
cd server && npx vitest run
```

- [ ] **Step 7: Document the production `ALLOWED_ORIGINS` value**

Update the comment in `server/wrangler.toml` near `ALLOWED_ORIGINS`:
```
# Production should be:
#   ALLOWED_ORIGINS = "https://heap.example.com,capacitor://localhost,https://localhost"
```

- [ ] **Step 8: Commit**

```bash
git add server/wrangler.toml server/src/app.ts server/src/index.ts server/tests/security.test.ts
git commit -m "feat(logging): rate-limit /log and document capacitor CORS"
```

---

## Phase 3 — Client `RemoteLogger` + auto-capture

End-to-end errors flowing from a real client into local D1.

### Task 3.1: `vite.config.ts` injects `VITE_APP_VERSION`

**Files:**
- Modify: `vite.config.ts`

- [ ] **Step 1: Read current vite config** and add `define`:

```ts
// vite.config.ts (snippet)
import { defineConfig } from 'vite';
import pkg from './package.json';

export default defineConfig({
  // ...existing config...
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
  },
});
```

If `defineConfig` already has a `define` block, merge into it.

- [ ] **Step 2: Add a smoke test**

Create `src/logging/__tests__/version.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('VITE_APP_VERSION', () => {
  it('is a non-empty semver-like string', () => {
    const v = import.meta.env.VITE_APP_VERSION;
    expect(typeof v).toBe('string');
    expect(v).toMatch(/^\d+\.\d+\.\d+/);
  });
});
```

- [ ] **Step 3: Confirm Vitest sees the value, or wire it explicitly.**

The project's `vite.config.ts` already contains the `test:` block (Vitest reads it directly), so `define` *should* substitute into test runs. But `import.meta.env.VITE_*` substitution in Vitest is historically flaky — verify before assuming.

First run the test as-is:
```bash
npx vitest run src/logging/__tests__/version.test.ts
```

If it passes, skip the rest of this step. If it fails with `undefined`, add an explicit Vitest fallback to the same `vite.config.ts`:

```ts
import pkg from './package.json';

export default defineConfig({
  // ...existing...
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
  },
  test: {
    environment: 'node',
    // Vitest does NOT always inherit top-level `define` — restate here.
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
    },
  },
});
```

Re-run; expect PASS.

- [ ] **Step 4: Run — expect PASS**

```bash
npx vitest run src/logging/__tests__/version.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add vite.config.ts vitest.config.ts src/logging/__tests__/version.test.ts
git commit -m "feat(logging): inject VITE_APP_VERSION from package.json"
```

### Task 3.2: `SaveData.verboseLogging` field

**Files:**
- Modify: `src/systems/SaveData.ts`
- Modify: existing `src/systems/__tests__/SaveData.test.ts` (or create one if absent)

- [ ] **Step 1: Add failing test**

Append to the SaveData test file:
```ts
import { getVerboseLogging, setVerboseLogging, resetCacheForTests } from '../SaveData';

describe('verboseLogging', () => {
  beforeEach(() => { localStorage.clear(); resetCacheForTests(); });

  it('defaults to false on fresh saves', () => {
    expect(getVerboseLogging()).toBe(false);
  });

  it('persists when set', () => {
    setVerboseLogging(true);
    resetCacheForTests();
    expect(getVerboseLogging()).toBe(true);
  });

  it('returns false when field missing on legacy saves', () => {
    localStorage.setItem('heap_save', JSON.stringify({ schemaVersion: 3, balance: 0, upgrades: {}, inventory: {}, placed: {}, selectedHeapId: '', playerGuid: 'g', playerName: 'n', highScores: {} }));
    resetCacheForTests();
    expect(getVerboseLogging()).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run src/systems/__tests__/SaveData.test.ts
```

- [ ] **Step 3: Update `RawSave`** in `src/systems/SaveData.ts`:

Add field to the interface:
```ts
  verboseLogging?: boolean;
```

Below `setPlayerName`, add:
```ts
export function getVerboseLogging(): boolean { return load().verboseLogging ?? false; }
export function setVerboseLogging(enabled: boolean): void {
  const data = load();
  data.verboseLogging = enabled;
  persist(data);
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx vitest run src/systems/__tests__/SaveData.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/systems/SaveData.ts src/systems/__tests__/SaveData.test.ts
git commit -m "feat(logging): add verboseLogging field to SaveData"
```

### Task 3.3: `RemoteLogger` — batching + envelope (TDD)

**Files:**
- Create: `src/logging/RemoteLogger.ts`
- Create: `src/logging/__tests__/RemoteLogger.test.ts`

- [ ] **Step 1: Write failing tests for envelope + severity gating**

```ts
// src/logging/__tests__/RemoteLogger.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RemoteLogger } from '../RemoteLogger';
import type { LogEntry, LogEnvelope } from '../../../shared/logging/Logger';

function makeEnv(over: Partial<LogEnvelope> = {}): LogEnvelope {
  return {
    userGuid: 'guid-1',
    sessionId: 'sess-1',
    appVersion: '1.2.3',
    platform: 'web',
    userAgent: 'Mozilla/5.0',
    ...over,
  };
}

describe('RemoteLogger', () => {
  let sent: LogEntry[][];
  let env: LogEnvelope;
  let logger: RemoteLogger;
  let transport: (entries: LogEntry[]) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    env = makeEnv();
    transport = (entries) => { sent.push(entries); };
    logger = new RemoteLogger({
      getEnvelope: () => env,
      transport: (e) => { transport(e); return true; },
      flushIntervalMs: 5000,
      maxEntries: 10,
      maxBatchBytes: 56 * 1024,
      maxEntryBytes: 2 * 1024,
    });
  });

  afterEach(() => { logger.dispose(); vi.useRealTimers(); });

  it('attaches envelope fields to every entry', () => {
    logger.error('boom', { stack: 'x' });
    logger.flushNow();
    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toMatchObject({
      userGuid: 'guid-1', sessionId: 'sess-1',
      appVersion: '1.2.3', platform: 'web',
      userAgent: 'Mozilla/5.0', level: 'error', message: 'boom',
    });
    expect(sent[0][0].payload).toEqual({ stack: 'x' });
    expect(typeof sent[0][0].timestamp).toBe('number');
  });

  it('drops events when setVerbose(false), sends errors/warns', () => {
    logger.setVerbose(false);
    logger.event({ type: 'user:created' });
    logger.error('e');
    logger.warn('w');
    logger.flushNow();
    expect(sent[0].map((e) => e.level)).toEqual(['error', 'warn']);
  });

  it('sends events when setVerbose(true)', () => {
    logger.setVerbose(true);
    logger.event({ type: 'heap:selected', heapId: 'h1' });
    logger.flushNow();
    expect(sent[0]).toHaveLength(1);
    expect(sent[0][0].level).toBe('event');
    expect(sent[0][0].eventType).toBe('heap:selected');
    expect(sent[0][0].payload).toEqual({ heapId: 'h1' });
  });

  it('flushes after flushIntervalMs', () => {
    logger.error('a');
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(5000);
    expect(sent).toHaveLength(1);
  });

  it('flushes when buffer hits maxEntries', () => {
    for (let i = 0; i < 10; i++) logger.error(`e${i}`);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(10);
  });

  it('flushes before adding when next entry would exceed byte budget', () => {
    logger = new RemoteLogger({
      getEnvelope: () => env,
      transport: (e) => { transport(e); return true; },
      flushIntervalMs: 99999,
      maxEntries: 1000,
      maxBatchBytes: 1000,
      maxEntryBytes: 800,
    });
    logger.error('a', { blob: 'x'.repeat(600) });
    logger.error('b', { blob: 'y'.repeat(600) });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(1);
  });

  it('truncates an oversize entry to a stub', () => {
    logger.error('big', { blob: 'x'.repeat(3000) });
    logger.flushNow();
    const e = sent[0][0];
    expect(e.payload).toMatchObject({ truncated: true });
    expect(typeof (e.payload as any).originalSize).toBe('number');
  });

  it('swallows transport throws and clears buffer', () => {
    const throwingLogger = new RemoteLogger({
      getEnvelope: () => env,
      transport: () => { throw new Error('net'); },
      flushIntervalMs: 99999,
      maxEntries: 10,
      maxBatchBytes: 9999,
      maxEntryBytes: 9999,
    });
    expect(() => { throwingLogger.error('x'); throwingLogger.flushNow(); }).not.toThrow();
    // After failed flush, a subsequent flushNow has nothing to send.
    throwingLogger.flushNow();
    throwingLogger.dispose();
  });

  it('reads envelope at flush time (allows late userGuid hydration)', () => {
    let guid = 'pre-init';
    const lateLogger = new RemoteLogger({
      getEnvelope: () => ({ ...env, userGuid: guid }),
      transport: (e) => { sent.push(e); return true; },
      flushIntervalMs: 99999, maxEntries: 10, maxBatchBytes: 9999, maxEntryBytes: 9999,
    });
    lateLogger.error('a');                // buffered with pre-init guid
    guid = 'real-guid';
    lateLogger.flushNow();
    expect(sent[0][0].userGuid).toBe('real-guid');
    lateLogger.dispose();
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

```bash
npx vitest run src/logging/__tests__/RemoteLogger.test.ts
```

- [ ] **Step 3: Implement `RemoteLogger`**

```ts
// src/logging/RemoteLogger.ts
import type {
  Logger, ErrorContext, WarnContext, LogEntry, LogEnvelope,
} from '../../shared/logging/Logger';
import type { GameEvent } from '../../shared/logging/events';

export interface RemoteLoggerOptions {
  /** Read at flush time so userGuid can hydrate late. */
  getEnvelope: () => LogEnvelope;
  /** Returns false to indicate "send queue full" / unsent (currently unused). */
  transport: (entries: LogEntry[]) => boolean;
  flushIntervalMs?: number;
  maxEntries?: number;
  maxBatchBytes?: number;
  maxEntryBytes?: number;
  startVerbose?: boolean;
}

const DEFAULTS = {
  flushIntervalMs: 5000,
  maxEntries: 10,
  maxBatchBytes: 56 * 1024,
  maxEntryBytes: 2 * 1024,
};

type Pending = { entry: Omit<LogEntry, keyof LogEnvelope>; bytes: number };

export class RemoteLogger implements Logger {
  private readonly opts: Required<RemoteLoggerOptions>;
  private buffer: Pending[] = [];
  private bufferedBytes = 0;
  private verbose: boolean;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: RemoteLoggerOptions) {
    this.opts = {
      ...DEFAULTS,
      startVerbose: false,
      ...opts,
    } as Required<RemoteLoggerOptions>;
    this.verbose = this.opts.startVerbose;
    this.timer = setInterval(() => { this.safeFlush(); }, this.opts.flushIntervalMs);
  }

  dispose(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  setVerbose(enabled: boolean): void { this.verbose = enabled; }

  error(message: string, context: ErrorContext = {}): void {
    try { this.enqueue('error', { message, payload: context }); } catch { /* swallow */ }
  }

  warn(message: string, context: WarnContext = {}): void {
    try { this.enqueue('warn', { message, payload: context }); } catch { /* swallow */ }
  }

  event<E extends GameEvent>(e: E): void {
    if (!this.verbose) return;
    try {
      const { type, ...payload } = e as any;
      this.enqueue('event', { eventType: type, payload });
    } catch { /* swallow */ }
  }

  /** Force a flush. Intended for tests and unload handlers. */
  flushNow(): void { this.safeFlush(); }

  private enqueue(
    level: 'error' | 'warn' | 'event',
    parts: { message?: string; eventType?: string; payload: Record<string, unknown> },
  ): void {
    const raw = {
      level,
      timestamp: Date.now(),
      message: parts.message,
      eventType: parts.eventType,
      payload: parts.payload,
    };
    let json = JSON.stringify(raw);
    if (json.length > this.opts.maxEntryBytes) {
      const stub = {
        ...raw,
        payload: {
          truncated: true,
          originalSize: json.length,
          head: json.slice(0, 1024),
        },
      };
      json = JSON.stringify(stub);
      this.pushOrFlush({ entry: stub, bytes: json.length });
      return;
    }
    this.pushOrFlush({ entry: raw, bytes: json.length });
  }

  private pushOrFlush(p: Pending): void {
    const wouldExceedBytes  = this.bufferedBytes + p.bytes > this.opts.maxBatchBytes;
    const wouldExceedCount  = this.buffer.length + 1 > this.opts.maxEntries;
    if (wouldExceedBytes || wouldExceedCount) {
      this.safeFlush();
    }
    this.buffer.push(p);
    this.bufferedBytes += p.bytes;
    if (this.buffer.length >= this.opts.maxEntries
     || this.bufferedBytes >= this.opts.maxBatchBytes) {
      this.safeFlush();
    }
  }

  private safeFlush(): void {
    if (this.buffer.length === 0) return;
    const env = this.opts.getEnvelope();
    const entries: LogEntry[] = this.buffer.map((p) => ({
      ...env,
      level:     (p.entry as any).level,
      timestamp: (p.entry as any).timestamp,
      message:   (p.entry as any).message,
      eventType: (p.entry as any).eventType,
      payload:   (p.entry as any).payload,
    }));
    this.buffer = [];
    this.bufferedBytes = 0;
    try { this.opts.transport(entries); } catch { /* swallow */ }
  }
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx vitest run src/logging/__tests__/RemoteLogger.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/logging/RemoteLogger.ts src/logging/__tests__/RemoteLogger.test.ts
git commit -m "feat(logging): add RemoteLogger with batching, gating, truncation"
```

### Task 3.4: Boot-time init + transport

**Files:**
- Modify: `src/logging/index.ts`
- Create: `src/logging/transport.ts`

- [ ] **Step 1: Create `transport.ts`**

```ts
// src/logging/transport.ts
import type { LogEntry } from '../../shared/logging/Logger';

const LOG_URL = (() => {
  // Same origin as HeapClient — for Capacitor builds this is the worker URL.
  // Fall back to `/log` for web origins.
  const apiBase = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';
  return `${apiBase}/log`;
})();

/** Best-effort POST. Returns true if a send was attempted; never throws. */
export function defaultTransport(entries: LogEntry[]): boolean {
  try {
    const body = JSON.stringify({ entries });
    const blob = new Blob([body], { type: 'application/json' });
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      // sendBeacon ignores custom headers; the Blob's `type` becomes Content-Type.
      navigator.sendBeacon(LOG_URL, blob);
      return true;
    }
    // Fallback: keepalive fetch (survives unload up to 64KB).
    fetch(LOG_URL, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
    }).catch(() => { /* swallow */ });
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Generate a stable `sessionId` + envelope getter — rewrite `src/logging/index.ts`**

```ts
// src/logging/index.ts
import type { Logger, LogEnvelope } from '../../shared/logging/Logger';
import type { Platform } from '../../shared/logging/events';
import { NullLogger } from './NullLogger';
import { RemoteLogger } from './RemoteLogger';
import { defaultTransport } from './transport';
import { getPlayerGuid, getVerboseLogging } from '../systems/SaveData';
import { Capacitor } from '@capacitor/core';

let _logger: Logger = new NullLogger();

function genSessionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch { /* fall through */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const SESSION_ID = genSessionId();

function detectPlatform(): Platform {
  try {
    const p = Capacitor.getPlatform();
    if (p === 'android' || p === 'ios') return p;
  } catch { /* not a Capacitor build */ }
  return 'web';
}

function getEnvelope(): LogEnvelope {
  let userGuid = 'pre-init';
  try { userGuid = getPlayerGuid() || 'pre-init'; } catch { /* SaveData not ready */ }
  return {
    userGuid,
    sessionId: SESSION_ID,
    appVersion: (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '0.0.0',
    platform: detectPlatform(),
    userAgent: (typeof navigator !== 'undefined' ? navigator.userAgent : '').slice(0, 200),
  };
}

export function getLogger(): Logger { return _logger; }
export function setLogger(l: Logger): void { _logger = l; }
export function _resetLoggerForTests(): void { _logger = new NullLogger(); }

/** Call once at app boot (BootScene), after SaveData module is importable. */
export function initLogger(): void {
  const logger = new RemoteLogger({
    getEnvelope,
    transport: defaultTransport,
    startVerbose: (() => { try { return getVerboseLogging(); } catch { return false; } })(),
  });
  // Flush on page hide / visibility change — final batch before unload.
  if (typeof window !== 'undefined') {
    const flush = () => { try { (logger as any).flushNow(); } catch { /* swallow */ } };
    window.addEventListener('pagehide', flush);
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }
  setLogger(logger);
}
```

- [ ] **Step 3: Add init call** — in `src/scenes/BootScene.ts`, after the existing boot work, add:

```ts
import { initLogger } from '../logging';
// ...inside the scene's create() (or wherever boot completes once):
initLogger();
```

- [ ] **Step 4: Run all client tests**

```bash
npx vitest run
```

Expected: PASS (no new failures).

- [ ] **Step 5: Commit**

```bash
git add src/logging/index.ts src/logging/transport.ts src/scenes/BootScene.ts
git commit -m "feat(logging): boot-time RemoteLogger init with sendBeacon transport"
```

### Task 3.5: Auto-capture — `window.onerror` + `unhandledrejection` (TDD)

**Files:**
- Create: `src/logging/capture.ts`
- Create: `src/logging/__tests__/capture.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/logging/__tests__/capture.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installGlobalErrorHandlers } from '../capture';
import type { Logger } from '../../../shared/logging/Logger';

function spyLogger(): Logger & { errors: any[]; warns: any[]; events: any[] } {
  const errors: any[] = []; const warns: any[] = []; const events: any[] = [];
  return {
    errors, warns, events,
    error: (m, c) => errors.push([m, c]),
    warn:  (m, c) => warns.push([m, c]),
    event: (e) => events.push(e),
    setVerbose: () => {},
  };
}

describe('installGlobalErrorHandlers', () => {
  let log: ReturnType<typeof spyLogger>;
  let uninstall: () => void;

  beforeEach(() => {
    log = spyLogger();
    uninstall = installGlobalErrorHandlers(log);
  });

  afterEach(() => { uninstall(); });

  it('captures window.onerror as logger.error', () => {
    const err = new Error('kaboom');
    window.dispatchEvent(new ErrorEvent('error', {
      message: 'kaboom', error: err, filename: 'x.js', lineno: 1, colno: 2,
    }));
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0][0]).toBe('kaboom');
    expect(log.errors[0][1]).toMatchObject({ filename: 'x.js', lineno: 1, colno: 2 });
  });

  it('captures unhandledrejection as logger.error', () => {
    const reason = new Error('rej');
    const ev = new Event('unhandledrejection') as any;
    ev.reason = reason;
    window.dispatchEvent(ev);
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0][0]).toBe('rej');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run src/logging/__tests__/capture.test.ts
```

- [ ] **Step 3: Implement `capture.ts`**

```ts
// src/logging/capture.ts
import type { Logger } from '../../shared/logging/Logger';

/** Installs window.error + unhandledrejection handlers. Returns an uninstaller. */
export function installGlobalErrorHandlers(logger: Logger): () => void {
  const onError = (ev: ErrorEvent) => {
    try {
      logger.error(ev.message ?? 'window.error', {
        stack: ev.error?.stack,
        filename: ev.filename,
        lineno: ev.lineno,
        colno: ev.colno,
      });
    } catch { /* swallow */ }
  };
  const onRejection = (ev: PromiseRejectionEvent | any) => {
    try {
      const r = ev?.reason;
      const message = (r && typeof r === 'object' && 'message' in r) ? String(r.message) : String(r);
      logger.error(message, { stack: r?.stack });
    } catch { /* swallow */ }
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection as any);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection as any);
  };
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx vitest run src/logging/__tests__/capture.test.ts
```

- [ ] **Step 5: Install on boot** — in `src/logging/index.ts`, inside `initLogger()`, after `setLogger(logger)`:

```ts
  if (typeof window !== 'undefined') {
    installGlobalErrorHandlers(logger);
  }
```

Add import: `import { installGlobalErrorHandlers } from './capture';`

- [ ] **Step 6: Commit**

```bash
git add src/logging/capture.ts src/logging/__tests__/capture.test.ts src/logging/index.ts
git commit -m "feat(logging): capture window.error and unhandledrejection"
```

### Task 3.6: Fetch wrapper inside `HeapClient` + `ScoreClient`

**Files:**
- Modify: `src/systems/HeapClient.ts`
- Modify: `src/systems/ScoreClient.ts`

- [ ] **Step 1: Find the fetch call site in HeapClient**

```bash
grep -n "fetch(" src/systems/HeapClient.ts src/systems/ScoreClient.ts
```

- [ ] **Step 2: Add a small helper at the top of `src/systems/HeapClient.ts`** (not extracted — keeps the change local; if both clients use it, extract to `src/logging/fetchWithLog.ts`):

```ts
import { getLogger } from '../logging';

const SLOW_FETCH_MS = 3000;

async function fetchWithLog(url: string, init?: RequestInit): Promise<Response> {
  const started = performance.now();
  let res: Response | null = null;
  try {
    res = await fetch(url, init);
  } catch (err) {
    const durationMs = Math.round(performance.now() - started);
    getLogger().error('fetch failed', {
      url, durationMs,
      stack: err instanceof Error ? err.stack : undefined,
      reason: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
  const durationMs = Math.round(performance.now() - started);
  if (!res.ok) {
    let bodySnippet = '';
    try { bodySnippet = (await res.clone().text()).slice(0, 256); } catch { /* swallow */ }
    if (res.status >= 500) {
      getLogger().error('fetch 5xx', { url, status: res.status, durationMs, bodySnippet });
    } else if (res.status >= 400) {
      getLogger().warn('fetch 4xx', { url, status: res.status, durationMs, bodySnippet });
    }
  } else if (durationMs > SLOW_FETCH_MS) {
    getLogger().warn('fetch slow', { url, status: res.status, durationMs });
  }
  return res;
}
```

- [ ] **Step 3: Replace every `fetch(` inside `HeapClient.ts` with `fetchWithLog(`.**

- [ ] **Step 4: Repeat for `src/systems/ScoreClient.ts`** — same helper inlined at the top, replace `fetch(` with `fetchWithLog(`.

  If the duplicated helper feels wrong, extract to `src/logging/fetchWithLog.ts` and import in both. The plan prefers extraction once a second consumer exists — do it here.

  Refactor: create `src/logging/fetchWithLog.ts` containing the helper from Step 2, import in both clients.

- [ ] **Step 5: Run all client tests + add a new test**

Create `src/logging/__tests__/fetchWithLog.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchWithLog } from '../fetchWithLog';
import { setLogger, _resetLoggerForTests } from '../index';

function spy() {
  const errors: any[] = []; const warns: any[] = [];
  setLogger({
    error: (m, c) => errors.push([m, c]),
    warn:  (m, c) => warns.push([m, c]),
    event: () => {}, setVerbose: () => {},
  });
  return { errors, warns };
}

describe('fetchWithLog', () => {
  beforeEach(() => { _resetLoggerForTests(); vi.restoreAllMocks(); });

  it('logs an error on 5xx', async () => {
    const s = spy();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 500 })));
    await fetchWithLog('/x');
    expect(s.errors[0][0]).toBe('fetch 5xx');
    expect(s.errors[0][1].status).toBe(500);
  });

  it('logs a warn on 4xx', async () => {
    const s = spy();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    await fetchWithLog('/x');
    expect(s.warns[0][0]).toBe('fetch 4xx');
  });

  it('logs an error on network throw and rethrows', async () => {
    const s = spy();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('net'); }));
    await expect(fetchWithLog('/x')).rejects.toThrow('net');
    expect(s.errors[0][0]).toBe('fetch failed');
  });
});
```

- [ ] **Step 6: Run — expect PASS**

```bash
npx vitest run src/logging/
```

- [ ] **Step 7: Manual smoke test against local server**

Terminal A: `cd server && npx wrangler dev`
Terminal B: `npm run dev`
- Open game, force a bad request (e.g. set `VITE_API_BASE` to invalid URL or kill the worker mid-session).
- Then: `cd server && npx wrangler d1 execute heap --local --command "SELECT level, message, payload FROM logs ORDER BY id DESC LIMIT 5"`
- Expected: error rows with `fetch failed` or `fetch 5xx`.

- [ ] **Step 8: Commit**

```bash
git add src/logging/fetchWithLog.ts src/logging/__tests__/fetchWithLog.test.ts src/systems/HeapClient.ts src/systems/ScoreClient.ts
git commit -m "feat(logging): wrap HeapClient and ScoreClient fetches"
```

---

## Phase 4 — Analytics Engine sink (production)

### Task 4.1: `AnalyticsEngineSink` (TDD)

**Files:**
- Create: `server/src/logging/AnalyticsEngineSink.ts`

- [ ] **Step 1: Append failing test to `server/tests/logSinks.test.ts`**

```ts
import { AnalyticsEngineSink } from '../src/logging/AnalyticsEngineSink';

describe('AnalyticsEngineSink', () => {
  it('maps each entry to writeDataPoint with the documented schema', async () => {
    const calls: any[] = [];
    const fakeAE = { writeDataPoint: (dp: any) => calls.push(dp) } as any;
    const sink = new AnalyticsEngineSink(fakeAE);
    const e: StampedLogEntry = {
      userGuid: '550e8400-e29b-41d4-a716-446655440000',
      sessionId: 'sess',
      appVersion: '1.0.0',
      platform: 'web',
      userAgent: 'ua',
      level: 'event',
      timestamp: 12345,
      eventType: 'run:end',
      message: undefined,
      payload: { heapId: 'h' },
      serverTimestamp: 67890,
    };
    await sink.write([e]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      indexes: ['550e8400e29b41d4a716446655440000'], // hyphens stripped, 32 chars
      blobs: [
        'event', 'run:end', 'web', '1.0.0', 'sess',
        JSON.stringify({ heapId: 'h' }), 'ua',
      ],
      doubles: [12345],
    });
    expect(calls[0].indexes[0]).toHaveLength(32);
  });

  it('uses message for blob2 when no eventType', async () => {
    const calls: any[] = [];
    const sink = new AnalyticsEngineSink({ writeDataPoint: (dp: any) => calls.push(dp) } as any);
    await sink.write([{
      userGuid: '00000000-0000-0000-0000-000000000000',
      sessionId: 's', appVersion: '1', platform: 'web', userAgent: 'u',
      level: 'error', timestamp: 1, message: 'boom', payload: {},
      serverTimestamp: 2,
    }]);
    expect(calls[0].blobs[1]).toBe('boom');
  });

  it('replaces oversize payload with a valid-JSON truncation stub (parseable)', async () => {
    const calls: any[] = [];
    const sink = new AnalyticsEngineSink({ writeDataPoint: (dp: any) => calls.push(dp) } as any);
    await sink.write([{
      userGuid: '00000000-0000-0000-0000-000000000000',
      sessionId: 's', appVersion: '1', platform: 'web', userAgent: 'u',
      level: 'error', timestamp: 1, message: 'm',
      payload: { blob: 'x'.repeat(8000) }, serverTimestamp: 2,
    }]);
    const blob6 = calls[0].blobs[5];
    expect(blob6.length).toBeLessThanOrEqual(4096);
    // Must still parse — slice-mid-string would break downstream JSON.parse queries.
    const parsed = JSON.parse(blob6);
    expect(parsed.truncated).toBe(true);
    expect(typeof parsed.originalSize).toBe('number');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd server && npx vitest run tests/logSinks.test.ts
```

- [ ] **Step 3: Implement**

```ts
// server/src/logging/AnalyticsEngineSink.ts
import type { Sink, StampedLogEntry } from './Sink';

/** Cloudflare AE indexes are capped at 32 bytes. A UUID has 32 hex chars
 *  once hyphens are stripped — a 1:1 reversible mapping that fits exactly. */
function userGuidIndex(uuid: string): string {
  return uuid.replace(/-/g, '').slice(0, 32);
}

const MAX_PAYLOAD_BYTES = 4096;

/** Returns a JSON string for the payload that is guaranteed parseable. If the
 *  serialized payload exceeds MAX_PAYLOAD_BYTES, swap in a truncation stub
 *  rather than slicing mid-string (which would break downstream JSON.parse). */
function payloadJson(payload: Record<string, unknown> | undefined): string {
  const json = JSON.stringify(payload ?? {});
  if (json.length <= MAX_PAYLOAD_BYTES) return json;
  // Keep a small head for human inspection but in a quoted-and-escaped string.
  const head = json.slice(0, 1024);
  const stub = JSON.stringify({ truncated: true, originalSize: json.length, head });
  // Defensive: if stub itself somehow exceeds (very long head), drop the head.
  return stub.length <= MAX_PAYLOAD_BYTES
    ? stub
    : JSON.stringify({ truncated: true, originalSize: json.length });
}

export class AnalyticsEngineSink implements Sink {
  constructor(private ae: AnalyticsEngineDataset) {}

  async write(entries: StampedLogEntry[]): Promise<void> {
    for (const e of entries) {
      this.ae.writeDataPoint({
        indexes: [userGuidIndex(e.userGuid)],
        blobs: [
          e.level,
          e.eventType ?? e.message ?? '',
          e.platform,
          e.appVersion,
          e.sessionId,
          payloadJson(e.payload),
          e.userAgent.slice(0, 200),
        ],
        doubles: [e.timestamp],
      });
    }
  }
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd server && npx vitest run tests/logSinks.test.ts
```

- [ ] **Step 5: Wire selection** — in `server/src/index.ts`, replace the constant `D1Sink` with:

```ts
import { AnalyticsEngineSink } from './logging/AnalyticsEngineSink';
// ...
const logSink = env.LOGS
  ? new AnalyticsEngineSink(env.LOGS)
  : new D1Sink(env.DB);
```

- [ ] **Step 6: Add the AE binding to `server/wrangler.toml`**

```toml
[[analytics_engine_datasets]]
binding = "LOGS"
dataset = "heap_logs"
```

- [ ] **Step 7: Deploy and verify**

```bash
cd server && npx wrangler deploy
```

After deploy, post a synthetic log entry to the deployed `/log` and query:

```bash
# Replace ACCOUNT_ID and AUTH_TOKEN:
curl -sS "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/analytics_engine/sql" \
  -H "Authorization: Bearer <AUTH_TOKEN>" \
  -d "SELECT blob1, blob2, double1 FROM heap_logs ORDER BY double1 DESC LIMIT 5"
```

Expected: at least one row with the synthetic entry.

- [ ] **Step 8: Commit**

```bash
git add server/src/logging/AnalyticsEngineSink.ts server/src/index.ts server/wrangler.toml server/tests/logSinks.test.ts
git commit -m "feat(logging): add AnalyticsEngineSink and bind LOGS dataset"
```

---

## Phase 5 — Gameplay events + settings UI

### Task 5.1: Event call sites

**Files:**
- Modify: `src/scenes/MenuScene.ts` (user:created on first identity creation)
- Modify: `src/scenes/HeapSelectScene.ts` (heap:selected)
- Modify: `src/scenes/GameScene.ts`, `src/scenes/InfiniteGameScene.ts` (run:start, run:end)
- Modify: `src/scenes/ScoreScene.ts` (score:submitted)
- Modify: `src/systems/PlaceableManager.ts` (placement:made)
- Modify: `src/scenes/StoreScene.ts` and/or `src/scenes/UpgradeScene.ts` (upgrade:purchased)

- [ ] **Step 1: Locate the right insertion points**

For each scene below, grep first to confirm the chosen anchor:
```bash
grep -n "createIdentity\|playerGuid\s*=\|generateDefaultName" src/systems/SaveData.ts
grep -n "setSelectedHeapId" src/scenes/HeapSelectScene.ts
grep -n "scene\.start\|scoreSubmitted\|placeItem\|onConfirm\|purchaseUpgrade" src/scenes/*.ts src/systems/*.ts
```

- [ ] **Step 2: `user:created`** — in `src/systems/SaveData.ts` `freshSave()` is the natural anchor, but events should not import logger at the SaveData layer (cyclic). Instead: in `MenuScene.ts` boot path, after loading SaveData, check whether this player's guid has already been logged. **Tie the flag to the guid** so that clearing storage + minting a new guid correctly fires a new event, and a stale flag for a different guid can't suppress it.

```ts
import { getLogger } from '../logging';
import { getPlayerGuid } from '../systems/SaveData';
// in create():
const guid = getPlayerGuid();
const flagKey = `heap_user_created_logged:${guid}`;
if (!localStorage.getItem(flagKey)) {
  getLogger().event({ type: 'user:created' });
  localStorage.setItem(flagKey, '1');
}
```

- [ ] **Step 3: `heap:selected`** — in `HeapSelectScene.ts` where the user confirms:

```ts
import { getLogger } from '../logging';
// ...where setSelectedHeapId is called:
setSelectedHeapId(heapId);
getLogger().event({ type: 'heap:selected', heapId });
```

- [ ] **Step 4: `run:start` and `run:end`** — in `GameScene.ts` and `InfiniteGameScene.ts`.

First, identify **every** scene-exit path so `run:end` is not silently missed on one of them:

```bash
grep -nE "scene\.start\(|gameOver|onQuit|handleDeath|this\.scene\.start" \
  src/scenes/GameScene.ts src/scenes/InfiniteGameScene.ts
```

You should see at least: a death/game-over path and a quit/back-to-menu path. **Every** such transition out of gameplay must emit `run:end` before the `scene.start` call, with the appropriate `cause`. Missing one means a class of runs is silently absent from analytics.

At run start (after init data is available):
```ts
import { getLogger } from '../logging';
private runStartedAt = 0;
// in create() or wherever the run begins:
this.runStartedAt = Date.now();
getLogger().event({ type: 'run:start', heapId: this.heapId, mode: 'normal' /* or 'infinite' */ });
```

At **each** run-end path (death, quit, any other exit):
```ts
getLogger().event({
  type: 'run:end',
  heapId: this.heapId,
  mode: 'normal',                // or 'infinite'
  score: this.score,
  height: this.maxHeight,
  kills: this.killCount,
  durationMs: Date.now() - this.runStartedAt,
  cause,                          // 'death' | 'quit' — set per path
  upgrades: getUpgrades(),       // helper from SaveData; full snapshot
});
```

If `getUpgrades()` doesn't exist, expose one alongside `getVerboseLogging`:
```ts
// in SaveData.ts:
export function getUpgrades(): Record<string, number> { return { ...load().upgrades }; }
```

- [ ] **Step 5: `score:submitted`** — in `ScoreScene.ts` after the submission resolves:

```ts
getLogger().event({
  type: 'score:submitted',
  heapId, score, accepted, rejectionReason,
});
```

- [ ] **Step 6: `placement:made`** — in `PlaceableManager.ts`, after a successful placement:

```ts
getLogger().event({ type: 'placement:made', heapId: this.heapId, itemType: def.id });
```

- [ ] **Step 7: `upgrade:purchased`** — in whichever of `StoreScene.ts`/`UpgradeScene.ts` performs the buy:

```ts
getLogger().event({
  type: 'upgrade:purchased',
  itemType, newLevel, cost,
  balanceAfter: getBalance(),
  upgrades: getUpgrades(),
});
```

- [ ] **Step 8: Run all tests — expect PASS**

```bash
npx vitest run
```

(No behavior change when verbose is off — events are dropped.)

- [ ] **Step 9: Commit**

```bash
git add src/
git commit -m "feat(logging): emit 7 gameplay events at call sites"
```

### Task 5.2: Settings toggle in `MenuScene`

**Files:**
- Modify: `src/scenes/MenuScene.ts`

- [ ] **Step 1: Inspect existing settings UI**

```bash
grep -n "settings\|toggle\|checkbox" src/scenes/MenuScene.ts
```

- [ ] **Step 2: Add a toggle row to the settings panel.**

Pattern matches the existing settings rows (project convention — copy the closest existing row's layout, e.g. the name editor or sound toggle if present). Wire it as:

```ts
import { getVerboseLogging, setVerboseLogging } from '../systems/SaveData';
import { getLogger } from '../logging';

// in the settings panel construction:
const initial = getVerboseLogging();
addToggleRow({
  label: 'Send anonymous gameplay analytics',
  sublabel: 'Errors are always reported.',
  initial,
  onChange: (enabled) => {
    setVerboseLogging(enabled);
    getLogger().setVerbose(enabled);
  },
});
```

If `MenuScene` does not have an `addToggleRow` helper, use the same pattern as the nearest existing setting (e.g. inline `add.text` + `add.image('checkbox-on'|'checkbox-off')` + pointerdown handler). Place it directly below the existing privacy-relevant settings.

- [ ] **Step 3: Manual smoke**

```bash
npm run dev
```

Open Menu → Settings, toggle on, start a run, end it. Tail logs:
```bash
cd server && npx wrangler d1 execute heap --local --command "SELECT event_type FROM logs WHERE level='event' ORDER BY id DESC LIMIT 10"
```

Expected: `run:start`, `run:end`, `heap:selected` rows.

- [ ] **Step 4: Commit**

```bash
git add src/scenes/MenuScene.ts
git commit -m "feat(logging): add 'send analytics' toggle to settings"
```

---

## Phase 6 — Server-side automatic captures

### Task 6.1: `score:rejected` warn in `/scores`

**Files:**
- Modify: `server/src/routes/scores.ts`

- [ ] **Step 1: Find the recompute/reject branch**

```bash
grep -n "reject\|recompute\|mismatch\|server_score" server/src/routes/scores.ts
```

- [ ] **Step 2: Add a `getSink` arg to the route factory** (mirroring `logRoutes`). Or, simpler: expose a thin helper.

Add to `server/src/logging/captureServerEvent.ts`:
```ts
import type { Sink, StampedLogEntry } from './Sink';
import type { LogLevel } from '../../../shared/logging/Logger';

export async function captureServer(
  sink: Sink,
  level: LogLevel,
  message: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const e: StampedLogEntry = {
    userGuid: 'server',
    sessionId: 'server',
    appVersion: 'server',
    platform: 'web',
    userAgent: 'server',
    level, timestamp: Date.now(), message,
    payload, serverTimestamp: Date.now(),
  };
  try { await sink.write([e]); } catch { /* swallow */ }
}
```

- [ ] **Step 3: Thread the sink through `scoreRoutes`.**

Current signature in `server/src/routes/scores.ts`:
```ts
export function scoreRoutes(scoreDb: ScoreDB, heapDb: HeapDB): Hono { ... }
```

Change to:
```ts
import type { Sink } from '../logging/Sink';

export function scoreRoutes(
  scoreDb: ScoreDB,
  heapDb: HeapDB,
  getSink: () => Sink | undefined,
): Hono { ... }
```

Update the call site in `server/src/app.ts`:
```ts
app.route('/scores', scoreRoutes(scoreDb, heapDb, () => opts.logSink));
```

(Note `heapDb` is preserved — the existing signature takes both.)

- [ ] **Step 4: Emit at rejection**

```ts
import { captureServer } from '../logging/captureServerEvent';
// ...in the rejection branch:
const sink = getSink();
if (sink) await captureServer(sink, 'warn', 'score:rejected', { heapId, clientScore, serverScore, reason });
```

- [ ] **Step 5: Test**

In `server/tests/scores.test.ts` add:
```ts
it('writes a score:rejected warn to the sink when scores disagree', async () => {
  const sink = new MemSink();
  // ... build app with sink, post a mismatched score
  expect(sink.written.some((e) => e.message === 'score:rejected')).toBe(true);
});
```
(Adapt to existing test scaffolding.)

- [ ] **Step 6: Run — expect PASS**

```bash
cd server && npx vitest run tests/scores.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add server/src/logging/captureServerEvent.ts server/src/app.ts server/src/routes/scores.ts server/tests/scores.test.ts
git commit -m "feat(logging): server-side capture for score:rejected"
```

### Task 6.2: `place:rejected` warn in `/heaps/:id/place`

**Files:**
- Modify: `server/src/routes/heap.ts`

- [ ] **Step 1: Thread sink through `heapRoutes`.**

Current signature in `server/src/routes/heap.ts`:
```ts
export function heapRoutes(heapDb: HeapDB): Hono { ... }
```

Change to:
```ts
import type { Sink } from '../logging/Sink';

export function heapRoutes(
  heapDb: HeapDB,
  getSink: () => Sink | undefined,
): Hono { ... }
```

Update the call site in `server/src/app.ts`:
```ts
app.route('/heaps', heapRoutes(heapDb, () => opts.logSink));
```

- [ ] **Step 2: At every place-validation failure** add:

```ts
if (sink) await captureServer(sink, 'warn', 'place:rejected', { heapId, reason, x, y, itemType });
```

- [ ] **Step 3: Test + Commit**

```bash
cd server && npx vitest run tests/routes.test.ts
git add server/src/routes/heap.ts server/src/app.ts server/tests/routes.test.ts
git commit -m "feat(logging): server-side capture for place:rejected"
```

### Task 6.3: `rate_limit:hit` warn in rate-limit middleware

**Files:**
- Modify: `server/src/middleware/rateLimit.ts`

- [ ] **Step 1: Inspect middleware**

```bash
cat server/src/middleware/rateLimit.ts
```

- [ ] **Step 2: Plumb sink (via a setter or factory parameter)** — simplest approach: export `setRateLimitSink(getSink: () => Sink | undefined)` and call it in `app.ts` after sink creation.

```ts
let _getSink: (() => Sink | undefined) | null = null;
export function setRateLimitSink(g: () => Sink | undefined): void { _getSink = g; }

// inside rateLimit middleware, on success=false:
const s = _getSink?.();
if (s) await captureServer(s, 'warn', 'rate_limit:hit', { bucket, ip });
```

In `app.ts`, immediately after computing `opts.logSink`:
```ts
if (opts.logSink) setRateLimitSink(() => opts.logSink);
```

- [ ] **Step 3: Test**

Add to `server/tests/security.test.ts`:
```ts
it('emits rate_limit:hit on limiter rejection', async () => {
  // ... use the existing limiter mock that returns success:false
  expect(sink.written.some((e) => e.message === 'rate_limit:hit')).toBe(true);
});
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd server && npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add server/src/middleware/rateLimit.ts server/src/app.ts server/tests/security.test.ts
git commit -m "feat(logging): server-side capture for rate_limit:hit"
```

---

## Final verification

- [ ] **Step 1: Full test suite**

```bash
npx vitest run
cd server && npx vitest run
```

Both pass.

- [ ] **Step 2: End-to-end smoke (local)**

Terminal A: `cd server && npx wrangler dev`
Terminal B: `npm run dev`
- Toggle Send Analytics on. Play one short run. Quit out.
- `cd server && npx wrangler d1 execute heap --local --command "SELECT level, event_type, message FROM logs ORDER BY id DESC LIMIT 20"`
- Confirm a mix of `run:start`, `run:end`, `heap:selected`, plus any captured errors/warns.

- [ ] **Step 3: End-to-end smoke (production)**

Deploy: `cd server && npx wrangler deploy`
Apply migration: `cd server && npx wrangler d1 migrations apply heap --remote`
Build + install Android: `npm run build && npx cap sync android` (per existing project workflow).
On device: toggle analytics on, play one run. Query Analytics Engine via SQL API (Task 4.1 Step 7).

- [ ] **Step 4: PR**

```bash
git push -u origin feature/remote-logging
gh pr create --title "Remote logging & analytics" --body "Implements docs/superpowers/specs/2026-05-08-remote-logging-design.md. See plan at docs/superpowers/plans/2026-05-10-remote-logging.md."
```

---

## Notes for the implementer

- The wire format in `shared/logging/Logger.ts` is the stable contract. Server-side `StampedLogEntry` adds `serverTimestamp` — that is the only difference between what the client sends and what sinks see.
- `getLogger()` always returns a `Logger`. Call sites never null-check.
- Logger code is best-effort: every method wraps its body in try/catch. Tests verify this.
- D1 is the local-dev sink; Analytics Engine is the production sink. Selection is binding-driven in `server/src/index.ts`.
- `RemoteLogger.flushNow()` is intentionally public — boot init wires it to `pagehide`/`visibilitychange`.

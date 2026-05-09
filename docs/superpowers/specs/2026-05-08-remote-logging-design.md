# Remote Logging & Analytics — Design

**Date:** 2026-05-08
**Branch target:** new feature branch off `main`
**Status:** Spec draft — pending user review

---

## Problem

Players are reporting bugs we can't diagnose. Concretely: one tester opens the heap selector and heaps load fine; another tester opens the same screen and nothing loads. We have no way to see what the second tester's device actually saw — no client-side error visibility, no fetch outcome history, no device/platform context.

Google Play Console's Android Vitals only catches native crashes and ANRs, so it does not see this class of bug (the WebView did not crash; it just rendered nothing). We need first-party client and server log capture that we own.

## Goals

1. **Capture client-side errors** (uncaught exceptions, rejected promises, failed fetches) automatically for every user, with enough context to reproduce.
2. **Capture meaningful gameplay events** (run start/end, purchases, placements) for opt-in analytics.
3. **Stay inside Cloudflare** — no new vendors, no new bills, reuse the existing Worker.
4. **Abstract the backend** — call sites must not know whether logs go to Cloudflare Analytics Engine, GlitchTip, Sentry, or D1. Swapping = writing one new class.
5. **Never break the game** — logger failures must not throw, block, or affect gameplay.

## Non-goals

- Real-time alerting or dashboards (query SQL when investigating; build dashboards later if needed).
- Session replay or video capture.
- Per-frame performance traces.
- Logging that requires opt-in for *errors* — errors always send. Only verbose analytics events are opt-in.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  shared/logging/                                            │
│    Logger.ts          ← interface (the contract)            │
│    LogContext.ts      ← envelope + payload types            │
│    events.ts          ← discriminated union of event types  │
└─────────────────────────────────────────────────────────────┘
                             │ imported by both sides
        ┌────────────────────┴────────────────────┐
        ▼                                         ▼
┌──────────────────────┐                ┌──────────────────────────┐
│  src/logging/        │                │  server/src/logging/     │
│    RemoteLogger.ts   │                │    Sink.ts               │
│    NullLogger.ts     │                │    AnalyticsEngineSink.ts│
│    index.ts (init)   │                │    D1Sink.ts             │
│    capture.ts        │                │  server/src/routes/      │
│      (window.onerror,│                │    log.ts (POST /log)    │
│       fetch wrapper) │                │                          │
└──────────────────────┘                └──────────────────────────┘
        │  POST /log { entries: [...] }            ▲
        └──────────────────────────────────────────┘
                                                   │
                                                   ▼
                                  Cloudflare Analytics Engine
                                    binding: env.LOGS
```

### Layered abstraction

Three interfaces, each replaceable:

- **`Logger`** (client) — `error`/`warn`/`event` methods. The only thing call sites depend on.
- **`Sink`** (server) — `write(entries)`. The only thing the `/log` route depends on.
- The wire format between client and server is itself a stable contract; switching the server-side backend (e.g. to GlitchTip) means writing a new `Sink` implementation, not touching the route or the client.

Swap scenarios:
- **Switch to GlitchTip/Sentry:** write `SentryLogger implements Logger` on the client. No server changes (Sentry SDK posts directly to Sentry).
- **Switch backend storage but keep wire format:** write a new `Sink` (e.g. `LogpushSink`, `D1Sink`). No client changes.
- **Disable logging entirely:** `getLogger()` returns `NullLogger`. Build still compiles; call sites still work.

---

## Logger contract (`shared/logging/Logger.ts`)

```ts
export interface Logger {
  error(message: string, context?: ErrorContext): void;
  warn(message: string, context?: WarnContext): void;
  event<E extends GameEvent>(event: E): void;

  /** Toggle gameplay event reporting. Errors and warns are unaffected. */
  setVerbose(enabled: boolean): void;
}
```

### Severity rules (enforced in implementation, not at call sites)

| Level | Always sent? | Use for |
|---|---|---|
| `error` | Yes | Uncaught exceptions, fetch ≥ 500, save corruption, contract violations |
| `warn` | Yes | Cache miss → self-heal, rate limit hit, fetch ≥ 3s, score rejected |
| `event` | Only if `setVerbose(true)` | Gameplay analytics moments |

There is no `info`. Anything that would be info either matters (and is an event) or doesn't (and shouldn't be logged).

---

## Event catalog (`shared/logging/events.ts`)

Seven events. Each is a TypeScript discriminated union member, so payloads are statically checked at call sites.

| Event | Payload | Question it answers |
|---|---|---|
| `user:created` | `{}` | Unique installs |
| `heap:selected` | `{ heapId: string }` | Which heaps are popular |
| `run:start` | `{ heapId, mode, upgradesHash }` | Sessions per heap, mode mix |
| `run:end` | `{ heapId, mode, score, height, kills, durationMs, cause, upgrades }` | Session length, performance, quit-vs-die ratio |
| `score:submitted` | `{ heapId, score, accepted, rejectionReason? }` | Server score-recompute mismatch rate |
| `placement:made` | `{ heapId, itemType }` | Placeable usage |
| `upgrade:purchased` | `{ itemType, newLevel, cost, balanceAfter, upgrades }` | Upgrade economy |

`mode: 'normal' | 'infinite'`. `cause: 'death' | 'quit'`.

### Upgrade-state strategy (loss-tolerant)

- **`run:end`** carries the **full upgrade snapshot** (`upgrades: UpgradesSave`). It is the event of record — losing any other event never corrupts run-state reconstruction.
- **`run:start`** carries only **`upgradesHash`** (first 8 chars of SHA-1 of canonical-JSON-stringified upgrades). Pairs with the `run:end` snapshot in the same session.
- **`upgrade:purchased`** carries the full snapshot too. Bonus signal for purchase-moment analysis; not load-bearing.

This costs ~200 bytes extra per `run:end` versus a hash-only strategy and eliminates the orphan-hash failure mode where a lost `upgrade:purchased` event makes downstream runs unreadable.

---

## Common envelope

`RemoteLogger` enriches every entry before send. Call sites never specify these:

| Field | Source |
|---|---|
| `userGuid` | `SaveData.identity.guid` |
| `sessionId` | `crypto.randomUUID()` once per app launch |
| `appVersion` | `import.meta.env.VITE_APP_VERSION` (set by build) |
| `platform` | `Capacitor.getPlatform()` (`'web' \| 'android' \| 'ios'`) |
| `userAgent` | `navigator.userAgent` truncated to 200 chars |
| `level` | from method called |
| `timestamp` | `Date.now()` (client clock) |

The Worker also stamps `serverTimestamp = Date.now()` on receipt, so client clock skew is recoverable.

---

## Client-side capture

### Automatic (no call-site code needed)

`src/logging/capture.ts` installs three handlers at app boot:

1. **`window.addEventListener('error', ...)`** — uncaught synchronous errors. Captures `message`, `error.stack`, `filename`, `lineno`, `colno`.
2. **`window.addEventListener('unhandledrejection', ...)`** — uncaught promise rejections. Captures `reason.message`, `reason.stack` if present.
3. **`HeapClient` fetch wrapper** — wraps every API call. On non-2xx, calls `logger.error('fetch failed', { url, status, bodySnippet, durationMs })`. On 2xx but slow (> 3s), calls `logger.warn('fetch slow', ...)`.

The fetch wrapper is the highest-value capture point — it is what would have surfaced the heap-selector bug for the affected tester.

### Explicit calls (event reporting)

Call sites use the typed `event` method:

```ts
logger.event({ type: 'run:end', heapId, mode, score, height, kills, durationMs, cause, upgrades });
```

Approximate call-site count (estimated; verify during implementation):
- `MenuScene` — `user:created` once on first identity creation
- `HeapSelectScene` — `heap:selected` on confirm
- `GameScene` / `InfiniteGameScene` — `run:start`, `run:end`
- `ScoreScene` — `score:submitted`
- Placement controller — `placement:made`
- `UpgradeScene` / `StoreScene` — `upgrade:purchased`

---

## Batching, transport, and resilience

`RemoteLogger` does not POST per call. It batches:

- **Buffer:** in-memory array of pending entries.
- **Flush triggers:** every 5s, OR when buffer hits 10 entries, OR on `pagehide` / `visibilitychange → hidden`.
- **Transport:** `navigator.sendBeacon(url, JSON.stringify({entries}))` when available (survives unload); fall back to `fetch(url, { method:'POST', keepalive:true })`.
- **Failure isolation:** all logger code runs inside `try/catch`. Any throw is swallowed. Failed POSTs are dropped silently — we do not retry, do not store offline, do not stack up. Logging is best-effort by design.
- **Hard size cap:** each entry is JSON-stringified and truncated if > 4 KB; replaced with `{ truncated: true, originalSize, head: <first 1KB> }`. Each batch is capped at 50 entries.
- **Sample rate hook:** `RemoteLogger` constructor accepts `sampleRates: { error: number; warn: number; event: number }` (default `{1, 1, 1}`). Future-proofs against volume; not used initially.

---

## Server-side: `/log` route

`server/src/routes/log.ts` — Hono route, registered in `app.ts`.

**Request shape:**
```ts
POST /log
{
  entries: Array<{
    userGuid: string;
    sessionId: string;
    appVersion: string;
    platform: 'web'|'android'|'ios';
    userAgent: string;
    level: 'error'|'warn'|'event';
    timestamp: number;
    eventType?: string;       // for level=event
    message?: string;          // for level=error|warn
    payload: Record<string, unknown>;
  }>
}
```

**Validation:**
- Reject if `entries.length > 50` or `entries.length === 0`.
- Reject if any individual entry > 4 KB after JSON.stringify.
- Strip unknown top-level fields. Coerce missing strings to `''`.
- Cap `userAgent` to 200 chars (defense in depth — client should already truncate).

**Rate limiting:** new `RL_LOG` binding in `wrangler.toml`, modeled on existing rate-limit blocks. Suggested limit: `100` per `60s` per IP. Tunable.

**Response:** `204 No Content` on accept, `400` on validation failure. No body — clients ignore success responses.

**Auth:** none. The `/log` endpoint is anonymous-write by design (the same way Sentry's intake is). Abuse is mitigated by rate limiting plus the size caps.

---

## Server-side: Sink abstraction

```ts
// server/src/logging/Sink.ts
export interface Sink {
  write(entries: LogEntry[]): Promise<void>;
}
```

### `AnalyticsEngineSink` (default)

Wires to `env.LOGS` (Workers Analytics Engine binding declared in `wrangler.toml`). Each entry maps to one `writeDataPoint` call:

```ts
env.LOGS.writeDataPoint({
  indexes: [userGuid],
  blobs: [
    level,                            // blob1
    eventType ?? message ?? '',       // blob2
    platform,                          // blob3
    appVersion,                        // blob4
    sessionId,                         // blob5
    JSON.stringify(payload).slice(0, 4096), // blob6 (full payload as JSON)
    userAgent.slice(0, 200),          // blob7
  ],
  doubles: [timestamp],
});
```

Schema is fixed: `index1=userGuid`, `blob1=level`, `blob2=eventType|message`, `blob3=platform`, `blob4=appVersion`, `blob5=sessionId`, `blob6=payloadJson`, `blob7=userAgent`, `double1=timestamp`.

Querying: Cloudflare Analytics Engine SQL API, e.g.
```sql
SELECT blob6 AS payload, double1 AS ts
FROM heap_logs
WHERE index1 = '<userGuid>' AND blob1 = 'error'
ORDER BY ts DESC LIMIT 100;
```

### `D1Sink` (alternative / local dev)

Writes to a `logs` table. Useful for local development (Analytics Engine is not available in `wrangler dev` without remote bindings) and for low-volume self-hosting.

Migration: `server/migrations/0005_logs_table.sql` creating:
```sql
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_guid TEXT NOT NULL,
  session_id TEXT NOT NULL,
  level TEXT NOT NULL,
  event_type TEXT,
  message TEXT,
  payload TEXT NOT NULL,    -- JSON
  platform TEXT NOT NULL,
  app_version TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  client_ts INTEGER NOT NULL,
  server_ts INTEGER NOT NULL
);
CREATE INDEX idx_logs_user ON logs(user_guid, server_ts DESC);
CREATE INDEX idx_logs_level ON logs(level, server_ts DESC);
```

Selection (`AnalyticsEngineSink` vs `D1Sink`) happens in `app.ts` based on whether `env.LOGS` is bound. Default is `AnalyticsEngineSink`.

---

## Server-side automatic captures

These run inside existing route handlers, no client involvement:

| Where | Level | When |
|---|---|---|
| `/scores` | `warn` | server-recompute disagrees with client score (`score:rejected`) |
| `/place` | `warn` | placement validation fails (`place:rejected`) |
| any rate-limited route | `warn` | RL_* binding reports `success=false` (`rate_limit:hit`) |

These give server-side observability even when zero clients have opted in.

---

## Settings UI (`MenuScene`)

A new toggle in the existing settings panel:

> **Send anonymous gameplay analytics** ☐
> Errors are always reported to help fix bugs.

State stored in `SaveData.meta.verboseLogging: boolean` (default `false`). Toggle handler:

```ts
saveData.meta.verboseLogging = enabled;
saveStore.persist(saveData);
getLogger().setVerbose(enabled);
```

`SaveData` schema gains the field with `verboseLogging?: boolean` so existing saves load without migration; `RemoteLogger.setVerbose` defaults to `false` when reading an absent value.

---

## Configuration changes

### `wrangler.toml`

Add Analytics Engine binding and a rate-limit block:

```toml
[[analytics_engine_datasets]]
binding = "LOGS"
dataset = "heap_logs"

[[ratelimits]]
name = "RL_LOG"
namespace_id = "1004"
  [ratelimits.simple]
  limit = 100
  period = 60
```

### `vite.config.ts`

Inject `VITE_APP_VERSION` from `package.json` at build time so the envelope has a stable version string.

### `package.json`

No new dependencies. Uses only `crypto.randomUUID`, `navigator.sendBeacon`, `fetch`, and Workers built-ins.

---

## Testing strategy

### Unit (Vitest, client)

- `RemoteLogger.batching` — adds entries to buffer; flushes on size threshold; flushes on timer tick (use `vi.useFakeTimers()`).
- `RemoteLogger.severityGating` — `error` and `warn` send when `setVerbose(false)`; `event` does not; all three send when `setVerbose(true)`.
- `RemoteLogger.envelope` — verifies `userGuid`, `sessionId`, `appVersion`, `platform`, `timestamp` are attached.
- `RemoteLogger.truncation` — entry > 4KB is replaced with truncated stub.
- `RemoteLogger.failureIsolation` — when transport throws, `error()` does not throw and the buffer is cleared.
- `NullLogger` — all methods are no-ops; calling does not throw.
- `capture.ts` — `window.error` event triggers `logger.error` with stack; `unhandledrejection` triggers `logger.error` with reason.

### Unit (Vitest, server)

- `/log` route — accepts valid batch (204), rejects oversized entry (400), rejects oversized batch (400), strips unknown fields.
- `Sink` mock — verifies route calls `sink.write` with normalized entries.
- `AnalyticsEngineSink` — given a fake `env.LOGS`, asserts `writeDataPoint` is called with correct schema mapping.
- `D1Sink` — given a fake D1, asserts INSERT shape and bound parameters.

### Integration

- Boot the Worker via `unstable_dev`, POST a known batch, query D1 (`D1Sink` configured), verify rows.
- End-to-end manual: open the game with `?logTest=1`, verify a synthetic `logger.error('test')` lands in Analytics Engine via SQL API.

### TDD ordering

Per `superpowers:test-driven-development`: each component above gets failing tests first, then implementation. The `Logger` interface and `NullLogger` are written first (smallest surface, validates the contract); then `RemoteLogger` against a mock transport; then the `/log` route against a mock `Sink`; then sinks last.

---

## Rollout plan

1. **Branch** off `main` to `feature/remote-logging`.
2. **Phase 1 — abstraction skeleton.** `shared/logging/`, `NullLogger`, `getLogger()` returning `NullLogger`. No behavior change. Land first; everything else builds on it.
3. **Phase 2 — server route + D1 sink.** `/log` route, `D1Sink`, migration `0005_logs_table.sql`. Test locally against `wrangler dev`.
4. **Phase 3 — client `RemoteLogger` + auto-capture.** Wire `window.onerror`, `unhandledrejection`, fetch wrapper. `error`/`warn` only — no events yet, no UI yet. Verify errors land in local D1.
5. **Phase 4 — Analytics Engine sink.** Add `LOGS` binding to `wrangler.toml`, implement `AnalyticsEngineSink`, switch default. Deploy to production. Verify via SQL API.
6. **Phase 5 — events + settings toggle.** Add the seven events to call sites. Add settings UI in `MenuScene`. Default off.
7. **Phase 6 — server-side captures.** Wire `score:rejected`, `place:rejected`, `rate_limit:hit` into existing routes.

Each phase is a reviewable commit. Phases 1–3 can ship without 4–6 and still deliver value (errors visible in D1).

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Logger code throws and crashes the game | All `RemoteLogger` methods wrapped in `try/catch`; unit test for transport failures |
| `/log` becomes an abuse vector | Rate limit `RL_LOG`, size caps on entry and batch, no auth needed because no state mutated |
| Analytics Engine binding unavailable in local dev | `D1Sink` fallback; sink selection driven by binding presence |
| Privacy: sending `userGuid` and userAgent | `userGuid` is opaque (already used for save sync). UserAgent truncated. No display names, no IPs stored. Settings toggle gates everything beyond errors. Label is explicit: "Send anonymous gameplay analytics. Errors are always reported." |
| Cost overrun on Analytics Engine | Free tier is 10M writes/month. Sample-rate hook exists for future use. Estimated current volume: well under 100K/month |
| Lost `upgrade:purchased` events break upgrade analysis | `run:end` carries full upgrade snapshot — purchase event is now redundant context, not load-bearing |

---

## Open questions

None at design time. To revisit during implementation:
- Exact placement of the settings toggle within `MenuScene` (existing settings panel layout).
- Whether to expose a "View recent logs" debug screen for the user with the toggle on (out of scope for v1).

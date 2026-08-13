# Run-Session Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind a submitted score's `elapsedMs` to server-attested wall-clock time, so inflating it can no longer dissolve the climb-rate and kill-rate plausibility caps.

**Architecture:** A new pure module `server/src/runSession.ts` signs and verifies a stateless HMAC-SHA256 token carrying `{playerId, heapId, issuedAt}`. `POST /scores/session` issues one at run start; `POST /scores` verifies it and clamps the elapsed time used *for the caps only*. No database, no migration, no KV. The client holds a session per game-scene lifetime and retries issuance every 15s until it succeeds.

**Tech Stack:** TypeScript 5.9, Hono (Cloudflare Workers), WebCrypto `crypto.subtle`, Vitest, Phaser 3.90.

**Spec:** [docs/superpowers/specs/2026-08-12-run-session-tokens-design.md](../specs/2026-08-12-run-session-tokens-design.md)

## Global Constraints

- Branch off `main`; PR before merge. Never push direct to main. Work happens on `feature/run-session-tokens`.
- `npm run build` must pass before the work is claimed done — it catches TS errors the tests miss.
- Constants, exact values: `GRACE_MS = 5_000`, `MAX_SESSION_MS = 12 * 60 * 60 * 1000`, `MAX_RUN_MS = 60 * 60 * 1000`.
- Reject reasons, exact strings: `no-session`, `bad-session-sig`, `session-mismatch`, `session-expired`.
- When `SESSION_SECRET` is unset the feature is inert and `/scores` behaves exactly as today. Every existing test must keep passing untouched.
- `verifiedElapsedMs` gates the plausibility caps **only**. `buildRunScore` keeps receiving the client's raw `elapsedMs`. Never wire the clamped value into the score.
- Per-player rate limits and admin ban/score-nuke are **out of scope** — a separate project.
- Client server calls key on `getEffectivePlayerId()` from `SaveData`, never bare `getPlayerGuid()`.

---

## File Structure

| File | Responsibility |
|---|---|
| `server/src/runSession.ts` (create) | Pure sign/verify/clamp. No DB, no Hono. |
| `server/tests/runSession.test.ts` (create) | Unit tests for the pure module. |
| `server/src/routes/scores.ts` (modify) | `POST /session` endpoint; verify + clamp in `POST /`. |
| `server/tests/scoreSession.test.ts` (create) | Route-level tests for both. |
| `server/src/app.ts` (modify) | Thread `sessionSecret` option; mount `RL_SESSION`. |
| `server/src/index.ts` (modify) | `Env` gains `SESSION_SECRET`, `RL_SESSION`. |
| `server/wrangler.toml` (modify) | `RL_SESSION` binding, prod 1007 / staging 2007. |
| `shared/scoreTypes.ts` (modify) | `sessionToken` on the request; session req/res types. |
| `src/systems/RunSession.ts` (create) | Client session holder + 15s retry loop. |
| `src/systems/__tests__/RunSession.test.ts` (create) | Retry/stop behavior. |
| `src/systems/ScoreClient.ts` (modify) | `openSession()`; send token on submit. |
| `src/scenes/GameScene.ts` (modify) | Start/stop session; pass token to ScoreScene. |
| `src/scenes/InfiniteGameScene.ts` (modify) | Same. |
| `src/scenes/ScoreScene.ts` (modify) | Accept `sessionToken`, forward to submit. |

---

### Task 1: Pure run-session module

**Files:**
- Create: `server/src/runSession.ts`
- Test: `server/tests/runSession.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `GRACE_MS: number`, `MAX_SESSION_MS: number`, `MAX_RUN_MS: number`
  - `type SessionFailure = 'no-session' | 'bad-session-sig' | 'session-mismatch' | 'session-expired'`
  - `type VerifyResult = { ok: true; issuedAt: number } | { ok: false; reason: SessionFailure }`
  - `signSession(secret: string, playerId: string, heapId: string, issuedAt: number): Promise<string>`
  - `verifySession(secret: string, token: string | undefined, playerId: string, heapId: string, now: number): Promise<VerifyResult>`
  - `clampElapsedMs(claimedMs: number, issuedAt: number, now: number): number`

**Why JSON and not a `|`-delimited payload:** `playerId` comes from the client and is only length-checked. A delimiter payload would let `playerId = "a|heap|9999999999999"` shift the field boundaries and forge an `issuedAt` under a legitimately-signed token. JSON encoding removes the ambiguity entirely.

- [ ] **Step 1: Write the failing test**

Create `server/tests/runSession.test.ts`:

```ts
// server/tests/runSession.test.ts

import { describe, it, expect } from 'vitest';
import {
  signSession,
  verifySession,
  clampElapsedMs,
  GRACE_MS,
  MAX_RUN_MS,
  MAX_SESSION_MS,
} from '../src/runSession';

const SECRET  = 'test-secret-0123456789abcdef';
const PLAYER  = 'player-aaa';
const HEAP    = 'heap-test-001';
const NOW     = 1_700_000_000_000;

describe('signSession / verifySession', () => {
  it('round-trips a freshly signed token', async () => {
    const token = await signSession(SECRET, PLAYER, HEAP, NOW);
    const res   = await verifySession(SECRET, token, PLAYER, HEAP, NOW + 1000);
    expect(res).toEqual({ ok: true, issuedAt: NOW });
  });

  it('rejects an absent token', async () => {
    const res = await verifySession(SECRET, undefined, PLAYER, HEAP, NOW);
    expect(res).toEqual({ ok: false, reason: 'no-session' });
  });

  it('rejects an empty token', async () => {
    const res = await verifySession(SECRET, '', PLAYER, HEAP, NOW);
    expect(res).toEqual({ ok: false, reason: 'no-session' });
  });

  it('rejects a token signed with a different key', async () => {
    const token = await signSession('another-secret', PLAYER, HEAP, NOW);
    const res   = await verifySession(SECRET, token, PLAYER, HEAP, NOW);
    expect(res).toEqual({ ok: false, reason: 'bad-session-sig' });
  });

  it('rejects a tampered payload', async () => {
    const token             = await signSession(SECRET, PLAYER, HEAP, NOW);
    const [, sig]           = token.split('.');
    const forgedPayload     = Buffer.from(
      JSON.stringify({ p: PLAYER, h: HEAP, i: NOW - MAX_SESSION_MS }),
      'utf8',
    ).toString('base64url');
    const res = await verifySession(SECRET, `${forgedPayload}.${sig}`, PLAYER, HEAP, NOW);
    expect(res).toEqual({ ok: false, reason: 'bad-session-sig' });
  });

  it('rejects a tampered signature', async () => {
    const token       = await signSession(SECRET, PLAYER, HEAP, NOW);
    const [payload]   = token.split('.');
    const res = await verifySession(SECRET, `${payload}.AAAA`, PLAYER, HEAP, NOW);
    expect(res).toEqual({ ok: false, reason: 'bad-session-sig' });
  });

  it.each([
    ['no separator',   'abcdef'],
    ['empty payload',  '.AAAA'],
    ['empty sig',      'AAAA.'],
    ['too many parts', 'a.b.c'],
    ['not base64url',  '!!!.???'],
  ])('rejects a malformed token (%s)', async (_label, token) => {
    const res = await verifySession(SECRET, token, PLAYER, HEAP, NOW);
    expect(res.ok).toBe(false);
    expect(res).toHaveProperty('reason', 'bad-session-sig');
  });

  it('rejects a token bound to a different player', async () => {
    const token = await signSession(SECRET, 'player-bbb', HEAP, NOW);
    const res   = await verifySession(SECRET, token, PLAYER, HEAP, NOW);
    expect(res).toEqual({ ok: false, reason: 'session-mismatch' });
  });

  it('rejects a token bound to a different heap', async () => {
    const token = await signSession(SECRET, PLAYER, 'heap-other', NOW);
    const res   = await verifySession(SECRET, token, PLAYER, HEAP, NOW);
    expect(res).toEqual({ ok: false, reason: 'session-mismatch' });
  });

  it('rejects a token older than MAX_SESSION_MS', async () => {
    const token = await signSession(SECRET, PLAYER, HEAP, NOW);
    const res   = await verifySession(SECRET, token, PLAYER, HEAP, NOW + MAX_SESSION_MS + 1);
    expect(res).toEqual({ ok: false, reason: 'session-expired' });
  });

  it('accepts a token exactly at MAX_SESSION_MS', async () => {
    const token = await signSession(SECRET, PLAYER, HEAP, NOW);
    const res   = await verifySession(SECRET, token, PLAYER, HEAP, NOW + MAX_SESSION_MS);
    expect(res).toEqual({ ok: true, issuedAt: NOW });
  });

  it('does not let a delimiter in playerId shift field boundaries', async () => {
    const sneaky = `x|${HEAP}|${NOW}`;
    const token  = await signSession(SECRET, sneaky, HEAP, NOW);
    // The token is valid only for the literal sneaky id, not for 'x'.
    expect(await verifySession(SECRET, token, sneaky, HEAP, NOW)).toEqual({ ok: true, issuedAt: NOW });
    expect(await verifySession(SECRET, token, 'x', HEAP, NOW)).toEqual({ ok: false, reason: 'session-mismatch' });
  });
});

describe('clampElapsedMs', () => {
  it('returns the claim when it fits inside the verified window', () => {
    // claimed 60s, window 120s + grace
    expect(clampElapsedMs(60_000, NOW - 120_000, NOW)).toBe(60_000);
  });

  it('clamps the attack case to the verified window plus grace', () => {
    // 10s-old token, absurd claim -> 10s + 5s grace
    expect(clampElapsedMs(99_999_999, NOW - 10_000, NOW)).toBe(10_000 + GRACE_MS);
  });

  it('clamps to MAX_RUN_MS for a very old token', () => {
    expect(clampElapsedMs(99_999_999, NOW - MAX_SESSION_MS, NOW)).toBe(MAX_RUN_MS);
  });

  it('leaves a late-token run comfortably passable', () => {
    // token arrived 3 min into a 10 min run -> 7 min window
    const claimed = 10 * 60_000;
    const result  = clampElapsedMs(claimed, NOW - 7 * 60_000, NOW);
    expect(result).toBe(7 * 60_000 + GRACE_MS);
    // A real 10-minute run climbs far less than the cap this permits.
    expect(400 * (result / 1000)).toBeGreaterThan(100_000);
  });

  it('never returns a value below 1, even for a future-dated token', () => {
    // Guards against divide-by-zero in the rate caps.
    expect(clampElapsedMs(60_000, NOW + 999_999, NOW)).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/runSession.test.ts`
Expected: FAIL — `Cannot find module '../src/runSession'`.

- [ ] **Step 3: Write the implementation**

Create `server/src/runSession.ts`:

```ts
// Stateless run-session tokens: a server-attested timestamp binding a score
// submission's claimed elapsedMs to real wall-clock time.
// See docs/superpowers/specs/2026-08-12-run-session-tokens-design.md

/** Covers the issue round-trip so honest clients are never clamped by latency. */
export const GRACE_MS = 5_000;
/** A token older than this is dead — hygiene against indefinite hoarding. */
export const MAX_SESSION_MS = 12 * 60 * 60 * 1000;
/** Hard ceiling on creditable run length; this is what defeats token farming. */
export const MAX_RUN_MS = 60 * 60 * 1000;

export type SessionFailure =
  | 'no-session'
  | 'bad-session-sig'
  | 'session-mismatch'
  | 'session-expired';

export type VerifyResult =
  | { ok: true;  issuedAt: number }
  | { ok: false; reason: SessionFailure };

/** Wire payload. Short keys keep the token small; JSON avoids delimiter injection. */
interface Payload { p: string; h: string; i: number }

function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesFromB64url(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin    = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out    = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signSession(
  secret: string,
  playerId: string,
  heapId: string,
  issuedAt: number,
): Promise<string> {
  const payload: Payload = { p: playerId, h: heapId, i: issuedAt };
  const encoded = b64urlFromBytes(new TextEncoder().encode(JSON.stringify(payload)));
  const key     = await importKey(secret);
  const sig     = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded));
  return `${encoded}.${b64urlFromBytes(new Uint8Array(sig))}`;
}

export async function verifySession(
  secret: string,
  token: string | undefined,
  playerId: string,
  heapId: string,
  now: number,
): Promise<VerifyResult> {
  if (!token) return { ok: false, reason: 'no-session' };

  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: 'bad-session-sig' };
  }
  const [encoded, sig] = parts;

  let sigBytes: Uint8Array;
  try {
    sigBytes = bytesFromB64url(sig);
  } catch {
    return { ok: false, reason: 'bad-session-sig' };
  }

  // subtle.verify compares in constant time — never compare signatures with ===.
  const key = await importKey(secret);
  const valid = await crypto.subtle.verify(
    'HMAC', key, sigBytes, new TextEncoder().encode(encoded),
  );
  if (!valid) return { ok: false, reason: 'bad-session-sig' };

  let payload: Payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytesFromB64url(encoded))) as Payload;
  } catch {
    return { ok: false, reason: 'bad-session-sig' };
  }
  if (typeof payload?.i !== 'number' || !Number.isFinite(payload.i)) {
    return { ok: false, reason: 'bad-session-sig' };
  }
  if (payload.p !== playerId || payload.h !== heapId) {
    return { ok: false, reason: 'session-mismatch' };
  }
  if (now - payload.i > MAX_SESSION_MS) {
    return { ok: false, reason: 'session-expired' };
  }
  return { ok: true, issuedAt: payload.i };
}

/**
 * Elapsed time the server is willing to vouch for. Gates the plausibility caps
 * ONLY — never the score, because pace is inversely proportional to elapsed time
 * and clamping it into buildRunScore would inflate scores.
 *
 * Floored at 1 so the rate caps can never divide by zero on a future-dated or
 * same-instant token.
 */
export function clampElapsedMs(claimedMs: number, issuedAt: number, now: number): number {
  const window = (now - issuedAt) + GRACE_MS;
  return Math.max(1, Math.min(claimedMs, window, MAX_RUN_MS));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/runSession.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add server/src/runSession.ts server/tests/runSession.test.ts
git commit -m "feat(server): add stateless run-session token module"
```

---

### Task 2: Issue endpoint and wiring

**Files:**
- Modify: `server/src/routes/scores.ts` (add `POST /session`; extend `scoreRoutes` signature)
- Modify: `server/src/app.ts` (add `sessionSecret` option; mount `RL_SESSION`)
- Modify: `server/src/index.ts` (`Env` gains `SESSION_SECRET`, `RL_SESSION`)
- Modify: `server/wrangler.toml` (`RL_SESSION` bindings)
- Modify: `shared/scoreTypes.ts` (session request/response types)
- Test: `server/tests/scoreSession.test.ts`

**Interfaces:**
- Consumes: `signSession`, `verifySession` from Task 1.
- Produces:
  - `interface OpenSessionRequest { playerId: string; heapId: string }`
  - `interface OpenSessionResponse { token: string; issuedAt: number }`
  - `scoreRoutes(scoreDb, heapDb, getSink, authDb?, playerNameDb?, sessionSecret?: string)`
  - `AppOptions.sessionSecret?: string`

- [ ] **Step 1: Add the shared types**

In `shared/scoreTypes.ts`, append:

```ts
export interface OpenSessionRequest {
  playerId: string;
  heapId:   string;
}

export interface OpenSessionResponse {
  /** Opaque HMAC token. Echo back verbatim on score submit. */
  token:    string;
  issuedAt: number;
}
```

And add the optional field to the existing `SubmitScoreRequest`:

```ts
export interface SubmitScoreRequest {
  heapId:      string;
  playerId:    string;
  /** Optional — only used to seed a first-seen player's name; never updates an existing one. */
  playerName?: string;
  inputs:      SubmitScoreInputs;
  /** Run-session token from POST /scores/session. Required once SESSION_SECRET is set. */
  sessionToken?: string;
}
```

- [ ] **Step 2: Write the failing test**

Create `server/tests/scoreSession.test.ts`:

```ts
// server/tests/scoreSession.test.ts

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import { MockPlayerAuthDB } from './helpers/mockPlayerAuthDb';
import type { OpenSessionResponse } from '../../shared/scoreTypes';

const HEAP_ID = 'heap-test-001';
const PLAYER  = 'player-aaa';
const SECRET  = 'test-session-secret';

function makeApp(opts: { sessionSecret?: string; authDb?: MockPlayerAuthDB } = {}) {
  const heapDb = new MockHeapDB();
  heapDb.seedHeap(HEAP_ID, 1, []);
  return createApp(heapDb, new MockScoreDB(), {
    sessionSecret: opts.sessionSecret,
    playerAuthDb:  opts.authDb,
  });
}

function openSession(
  app: ReturnType<typeof makeApp>,
  body: object,
  token?: string,
) {
  return app.request('/scores/session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Player-Token': token } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('POST /scores/session', () => {
  it('issues a token for a valid request', async () => {
    const app = makeApp({ sessionSecret: SECRET });
    const res = await openSession(app, { playerId: PLAYER, heapId: HEAP_ID });
    expect(res.status).toBe(200);
    const body = await res.json() as OpenSessionResponse;
    expect(typeof body.token).toBe('string');
    expect(body.token.split('.')).toHaveLength(2);
    expect(typeof body.issuedAt).toBe('number');
  });

  it('404s when no session secret is configured', async () => {
    const app = makeApp({});
    const res = await openSession(app, { playerId: PLAYER, heapId: HEAP_ID });
    expect(res.status).toBe(404);
  });

  it('rejects a missing playerId', async () => {
    const app = makeApp({ sessionSecret: SECRET });
    const res = await openSession(app, { heapId: HEAP_ID });
    expect(res.status).toBe(400);
  });

  it('rejects a missing heapId', async () => {
    const app = makeApp({ sessionSecret: SECRET });
    const res = await openSession(app, { playerId: PLAYER });
    expect(res.status).toBe(400);
  });

  it('rejects an over-long playerId', async () => {
    const app = makeApp({ sessionSecret: SECRET });
    const res = await openSession(app, { playerId: 'x'.repeat(200), heapId: HEAP_ID });
    expect(res.status).toBe(400);
  });

  it('403s when the player token does not match a claimed id', async () => {
    const authDb = new MockPlayerAuthDB();
    const app    = makeApp({ sessionSecret: SECRET, authDb });
    // First call claims the id with 'right-token'.
    const first = await openSession(app, { playerId: PLAYER, heapId: HEAP_ID }, 'right-token');
    expect(first.status).toBe(200);
    // A different secret for the same id must be refused.
    const second = await openSession(app, { playerId: PLAYER, heapId: HEAP_ID }, 'wrong-token');
    expect(second.status).toBe(403);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && npx vitest run tests/scoreSession.test.ts`
Expected: FAIL — the 200 case returns 404 because the route does not exist.

- [ ] **Step 4: Add the route**

In `server/src/routes/scores.ts`, extend the imports:

```ts
import { signSession, verifySession, clampElapsedMs } from '../runSession';
import type { OpenSessionRequest, OpenSessionResponse } from '../../../shared/scoreTypes';
```

Change the `scoreRoutes` signature to accept the secret:

```ts
export function scoreRoutes(
  scoreDb: ScoreDB,
  heapDb: HeapDB,
  getSink: () => Sink | undefined,
  authDb?: PlayerAuthDB,
  playerNameDb?: PlayerNameDB,
  sessionSecret?: string,
): Hono {
```

Then add this handler immediately after `const app = new Hono();`:

```ts
  // POST /scores/session — open a run session. The token is a server-attested
  // timestamp, not proof of a genuine client: anyone can call this endpoint.
  // Its value is that a claimed elapsedMs can never exceed real elapsed time.
  app.post('/session', async (c) => {
    if (!sessionSecret) return c.json({ error: 'not found' }, 404);

    let body: OpenSessionRequest;
    try {
      body = await c.req.json<OpenSessionRequest>();
    } catch {
      return c.json({ error: 'invalid session request' }, 400);
    }

    const { playerId, heapId } = body;
    if (typeof playerId !== 'string' || playerId.length === 0 || playerId.length > MAX_ID_LEN) {
      return c.json({ error: 'invalid session request' }, 400);
    }
    if (typeof heapId !== 'string' || heapId.length === 0 || heapId.length > MAX_ID_LEN) {
      return c.json({ error: 'invalid session request' }, 400);
    }

    // Only the owner of a player id may open a session for it.
    const authRes = await enforcePlayerAuth(c, authDb, playerId, getSink, 'scores:session');
    if (authRes) return authRes;

    const issuedAt = Date.now();
    const token    = await signSession(sessionSecret, playerId, heapId, issuedAt);
    const res: OpenSessionResponse = { token, issuedAt };
    return c.json(res);
  });
```

- [ ] **Step 5: Thread the option through app.ts**

In `server/src/app.ts`, add to `AppOptions`:

```ts
  /** HMAC key for run-session tokens. If unset, /scores/session 404s and
   *  score submits skip session verification entirely (legacy behavior). */
  sessionSecret?: string;
```

Add `session` to the `limiters` block in `AppOptions`:

```ts
  limiters?: {
    scores?: RateLimiter;
    place?:  RateLimiter;
    global?: RateLimiter;
    log?:    RateLimiter;
    codes?:  RateLimiter;
    feedback?: RateLimiter;
    session?: RateLimiter;
  };
```

Add the limiter mount beside the existing per-route limiters:

```ts
  app.post('/scores/session', rateLimit(lim.session, 'scores-session', opts.loadTestSecret));
```

And pass the secret at the mount point:

```ts
  app.route('/scores', scoreRoutes(scoreDb, heapDb, () => opts.logSink, opts.playerAuthDb, opts.playerNameDb, opts.sessionSecret));
```

- [ ] **Step 6: Add the bindings in index.ts**

In `server/src/index.ts`, add to `Env`:

```ts
  /** HMAC key for run-session tokens. Set via `wrangler secret put SESSION_SECRET`. */
  SESSION_SECRET?: string;
  RL_SESSION?: RateLimiter;
```

And in the `createApp` options object, add:

```ts
      sessionSecret:  env.SESSION_SECRET,
```

plus `session: env.RL_SESSION,` inside the `limiters` object.

- [ ] **Step 7: Add the rate-limit bindings**

In `server/wrangler.toml`, after the `RL_FEEDBACK` block:

```toml
[[ratelimits]]
name = "RL_SESSION"
namespace_id = "1007"
  [ratelimits.simple]
  limit = 20
  period = 60
```

And in the staging section, after the staging `RL_FEEDBACK` block:

```toml
[[env.staging.ratelimits]]
name = "RL_SESSION"
namespace_id = "2007"
  [env.staging.ratelimits.simple]
  limit = 20
  period = 60
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd server && npx vitest run tests/scoreSession.test.ts`
Expected: PASS, all 6 cases.

Run: `cd server && npx vitest run`
Expected: PASS — no existing test regresses (no `sessionSecret` is configured in them).

- [ ] **Step 9: Commit**

```bash
git add server/src/routes/scores.ts server/src/app.ts server/src/index.ts \
        server/wrangler.toml shared/scoreTypes.ts server/tests/scoreSession.test.ts
git commit -m "feat(server): add POST /scores/session issue endpoint"
```

---

### Task 3: Verify and clamp on score submit

**Files:**
- Modify: `server/src/routes/scores.ts` (`POST /` handler)
- Test: `server/tests/scoreSession.test.ts` (append)

**Interfaces:**
- Consumes: `verifySession`, `clampElapsedMs` from Task 1; `sessionSecret` param from Task 2.
- Produces: no new exports. Behavioral change only.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/scoreSession.test.ts`. Merge these two imports into the
existing import block at the top of the file — do not leave `import` statements
stranded at the bottom:

```ts
import { signSession } from '../src/runSession';
import type { SubmitScoreResponse } from '../../shared/scoreTypes';
```

Then append the rest:

```ts
const VALID_INPUTS = {
  baseHeightPx: 1000,
  kills: { percher: 0, ghost: 0 },
  elapsedMs: 60_000,
  isFailure: true,
};

function submit(app: ReturnType<typeof makeApp>, body: object) {
  return app.request('/scores', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
}

describe('POST /scores session enforcement', () => {
  it('rejects a submit with no session token', async () => {
    const app = makeApp({ sessionSecret: SECRET });
    const res = await submit(app, { heapId: HEAP_ID, playerId: PLAYER, inputs: VALID_INPUTS });
    expect(res.status).toBe(400);
  });

  it('accepts a submit with a valid token', async () => {
    const app   = makeApp({ sessionSecret: SECRET });
    const token = await signSession(SECRET, PLAYER, HEAP_ID, Date.now() - 90_000);
    const res   = await submit(app, {
      heapId: HEAP_ID, playerId: PLAYER, inputs: VALID_INPUTS, sessionToken: token,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as SubmitScoreResponse;
    expect(body.submitted).toBe(true);
  });

  it('rejects a token signed with a different key', async () => {
    const app   = makeApp({ sessionSecret: SECRET });
    const token = await signSession('other-secret', PLAYER, HEAP_ID, Date.now());
    const res   = await submit(app, {
      heapId: HEAP_ID, playerId: PLAYER, inputs: VALID_INPUTS, sessionToken: token,
    });
    expect(res.status).toBe(400);
  });

  it('rejects a token bound to a different heap', async () => {
    const app   = makeApp({ sessionSecret: SECRET });
    const token = await signSession(SECRET, PLAYER, 'heap-other', Date.now());
    const res   = await submit(app, {
      heapId: HEAP_ID, playerId: PLAYER, inputs: VALID_INPUTS, sessionToken: token,
    });
    expect(res.status).toBe(400);
  });

  it('collapses the inflated-elapsedMs attack', async () => {
    const app   = makeApp({ sessionSecret: SECRET });
    // 10s-old token: the clamp allows ~15s, so 400 y/s permits ~6000px.
    const token = await signSession(SECRET, PLAYER, HEAP_ID, Date.now() - 10_000);
    const res   = await submit(app, {
      heapId: HEAP_ID, playerId: PLAYER, sessionToken: token,
      inputs: { ...VALID_INPUTS, baseHeightPx: 500_000, elapsedMs: 99_999_999 },
    });
    expect(res.status).toBe(400);
  });

  it('still admits an honest run whose token arrived late', async () => {
    const app   = makeApp({ sessionSecret: SECRET });
    // Token 7 minutes old, run honestly reported as 10 minutes.
    const token = await signSession(SECRET, PLAYER, HEAP_ID, Date.now() - 7 * 60_000);
    const res   = await submit(app, {
      heapId: HEAP_ID, playerId: PLAYER, sessionToken: token,
      inputs: { ...VALID_INPUTS, baseHeightPx: 20_000, elapsedMs: 10 * 60_000 },
    });
    expect(res.status).toBe(200);
  });

  it('does not let the clamp inflate the pace bonus', async () => {
    // THE regression test for this feature's single most important invariant:
    // verifiedElapsedMs gates the caps ONLY. Pace is height/seconds, so feeding
    // the clamped value into buildRunScore would RAISE the score when it bit.
    //
    // The two arms are chosen so the clamp BITES in one and not the other —
    // otherwise the test passes under the buggy implementation too:
    //   arm A: 10s-old token  -> verified = 10_000 + GRACE(5_000) = 15_000  (bites)
    //   arm B: 200s-old token -> verified = min(100_000, 205_000)  = 100_000 (no bite)
    // Correct impl scores pace floor(1000/100 * 10) = 100 in BOTH arms.
    // Buggy impl scores floor(1000/15 * 10) = 666 in arm A. Scores must match.
    // Both arms clear the climb cap: 1000*1000 <= 400*15_000.
    const inputs = { ...VALID_INPUTS, baseHeightPx: 1000, elapsedMs: 100_000, isFailure: false };

    const appClamped   = makeApp({ sessionSecret: SECRET });
    const clampedToken = await signSession(SECRET, PLAYER, HEAP_ID, Date.now() - 10_000);
    const clampedRes   = await submit(appClamped, {
      heapId: HEAP_ID, playerId: PLAYER, inputs, sessionToken: clampedToken,
    });

    const appUnclamped   = makeApp({ sessionSecret: SECRET });
    const unclampedToken = await signSession(SECRET, PLAYER, HEAP_ID, Date.now() - 200_000);
    const unclampedRes   = await submit(appUnclamped, {
      heapId: HEAP_ID, playerId: PLAYER, inputs, sessionToken: unclampedToken,
    });

    expect(clampedRes.status).toBe(200);
    expect(unclampedRes.status).toBe(200);
    const clampedBody   = await clampedRes.json() as SubmitScoreResponse;
    const unclampedBody = await unclampedRes.json() as SubmitScoreResponse;
    expect(clampedBody.context.player!.score).toBe(unclampedBody.context.player!.score);
  });

  it('is inert when no session secret is configured', async () => {
    const app = makeApp({});
    const res = await submit(app, { heapId: HEAP_ID, playerId: PLAYER, inputs: VALID_INPUTS });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/scoreSession.test.ts`
Expected: FAIL — the no-token, bad-key, wrong-heap and attack cases all return 200 because nothing verifies yet.

- [ ] **Step 3: Add verification and clamping**

In the `POST /` handler of `server/src/routes/scores.ts`, destructure the token alongside the rest of the body. Change:

```ts
    const { heapId, playerId, playerName, inputs } = body;
```

to:

```ts
    const { heapId, playerId, playerName, inputs, sessionToken } = body;
```

Then insert this block immediately **before** the `// Heap-relative validation — needs the heap row` comment:

```ts
    // Run-session verification. Inert when no secret is configured so local dev
    // and the existing test suite behave exactly as before.
    let verifiedElapsedMs = elapsedMs;
    if (sessionSecret) {
      const now     = Date.now();
      const session = await verifySession(sessionSecret, sessionToken, playerId, heapId, now);
      if (!session.ok) {
        console.warn(`[scores] reject: ${session.reason} (heapId=${heapId})`);
        const sink = getSink();
        if (sink) {
          await captureServer(sink, 'warn', 'score:rejected', { reason: session.reason, heapId, playerId });
        }
        return c.json({ error: 'invalid score submission' }, 400);
      }
      verifiedElapsedMs = clampElapsedMs(elapsedMs, session.issuedAt, now);
    }
```

Now change the two rate caps to read `verifiedElapsedMs`. Climb-rate cap:

```ts
    // Climb-rate cap (integer arithmetic to avoid FP rounding at the boundary).
    // Uses verifiedElapsedMs — the elapsed time the server can vouch for.
    if (baseHeightPx * 1000 > MAX_CLIMB_RATE_Y_PER_S * verifiedElapsedMs) {
      console.warn(`[scores] reject: climb rate ${(baseHeightPx * 1000) / verifiedElapsedMs} Y/s exceeds ${MAX_CLIMB_RATE_Y_PER_S} (heapId=${heapId})`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'score:rejected', { reason: 'climb rate too high', heapId, climbRatePerS: (baseHeightPx * 1000) / verifiedElapsedMs });
      }
      return c.json({ error: 'invalid score submission' }, 400);
    }
```

Kill-rate cap:

```ts
    // Kill-rate cap
    if ((percher + ghost + jumper) * 1000 > MAX_KILLS_PER_S * verifiedElapsedMs) {
      console.warn(`[scores] reject: kill rate ${((percher + ghost + jumper) * 1000) / verifiedElapsedMs} /s exceeds ${MAX_KILLS_PER_S} (heapId=${heapId})`);
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'score:rejected', { reason: 'kill rate too high', heapId, killRatePerS: ((percher + ghost + jumper) * 1000) / verifiedElapsedMs });
      }
      return c.json({ error: 'invalid score submission' }, 400);
    }
```

**Leave the `buildRunScore` call exactly as it is** — it must keep receiving the raw `elapsedMs`:

```ts
    const { finalScore } = buildRunScore(
      { baseHeightPx, kills: { percher, ghost, jumper }, elapsedMs, salvageBonus },
      ENEMY_DEFS,
      isFailure,
      heap.score_mult,
    );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx vitest run tests/scoreSession.test.ts`
Expected: PASS, all cases including the pace regression.

Run: `cd server && npx vitest run`
Expected: PASS — no existing test regresses.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/scores.ts server/tests/scoreSession.test.ts
git commit -m "feat(server): verify run session and clamp elapsed time on score submit"
```

---

### Task 4: Client session manager

**Files:**
- Create: `src/systems/RunSession.ts`
- Create: `src/systems/__tests__/RunSession.test.ts`
- Modify: `src/systems/ScoreClient.ts`

**Interfaces:**
- Consumes: `OpenSessionResponse` from Task 2.
- Produces:
  - `ScoreClient.openSession(playerId: string, heapId: string): Promise<string | null>`
  - `class RunSession` with `start(playerId: string, heapId: string): void`, `stop(): void`, `getToken(): string | undefined`
  - `RETRY_MS = 15_000`
  - `ScoreClient.submitScore` gains an optional `sessionToken` param.

- [ ] **Step 1: Write the failing test**

Create `src/systems/__tests__/RunSession.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RunSession, RETRY_MS } from '../RunSession';
import { ScoreClient } from '../ScoreClient';

describe('RunSession', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(()  => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('stores the token when the first attempt succeeds', async () => {
    vi.spyOn(ScoreClient, 'openSession').mockResolvedValue('tok-1');
    const s = new RunSession();
    s.start('p1', 'h1');
    await vi.advanceTimersByTimeAsync(0);
    expect(s.getToken()).toBe('tok-1');
    s.stop();
  });

  it('retries every RETRY_MS until one succeeds', async () => {
    const spy = vi.spyOn(ScoreClient, 'openSession')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('tok-3');
    const s = new RunSession();
    s.start('p1', 'h1');

    await vi.advanceTimersByTimeAsync(0);
    expect(s.getToken()).toBeUndefined();

    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(s.getToken()).toBeUndefined();

    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(s.getToken()).toBe('tok-3');
    expect(spy).toHaveBeenCalledTimes(3);
    s.stop();
  });

  it('stops retrying once a token is held', async () => {
    const spy = vi.spyOn(ScoreClient, 'openSession').mockResolvedValue('tok-1');
    const s = new RunSession();
    s.start('p1', 'h1');
    await vi.advanceTimersByTimeAsync(RETRY_MS * 5);
    expect(spy).toHaveBeenCalledTimes(1);
    s.stop();
  });

  it('stops retrying after stop()', async () => {
    const spy = vi.spyOn(ScoreClient, 'openSession').mockResolvedValue(null);
    const s = new RunSession();
    s.start('p1', 'h1');
    await vi.advanceTimersByTimeAsync(0);
    s.stop();
    await vi.advanceTimersByTimeAsync(RETRY_MS * 5);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not throw when openSession rejects', async () => {
    vi.spyOn(ScoreClient, 'openSession').mockRejectedValue(new Error('offline'));
    const s = new RunSession();
    expect(() => s.start('p1', 'h1')).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.getToken()).toBeUndefined();
    s.stop();
  });

  it('discards a token from a previous start after restart', async () => {
    vi.spyOn(ScoreClient, 'openSession').mockResolvedValue('tok-1');
    const s = new RunSession();
    s.start('p1', 'h1');
    await vi.advanceTimersByTimeAsync(0);
    expect(s.getToken()).toBe('tok-1');
    s.start('p1', 'h2');
    expect(s.getToken()).toBeUndefined();
    s.stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/systems/__tests__/RunSession.test.ts`
Expected: FAIL — `Cannot find module '../RunSession'`.

- [ ] **Step 3: Add openSession to ScoreClient**

In `src/systems/ScoreClient.ts`, extend the type import:

```ts
import type { LeaderboardContext, SubmitScoreInputs, SubmitScoreResponse, PlayerScoreEntry, PlayerScoresResponse, PaginatedLeaderboardResponse, OpenSessionResponse } from '../../shared/scoreTypes';
```

Add this method to the `ScoreClient` class:

```ts
  /**
   * Open a run session. Returns the opaque token, or null if the server is
   * unreachable, has no session secret configured, or rejects the request.
   */
  static async openSession(playerId: string, heapId: string): Promise<string | null> {
    try {
      const res = await fetchWithLog(`${SERVER_URL}/scores/session`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body:    JSON.stringify({ playerId, heapId }),
      });
      if (!res.ok) {
        logIfAuthRejected('scores:session', res.status);
        return null;
      }
      const data = (await res.json()) as OpenSessionResponse;
      return data.token;
    } catch {
      return null;
    }
  }
```

Add the token to `submitScore` — extend its params and body:

```ts
  static async submitScore(params: {
    heapId:     string;
    playerId:   string;
    playerName: string;
    inputs:     SubmitScoreInputs;
    limit?:     number;
    sessionToken?: string;
  }): Promise<LeaderboardContext | null> {
```

and inside the `JSON.stringify({...})` body, add:

```ts
          sessionToken: params.sessionToken,
```

- [ ] **Step 4: Write the RunSession module**

Create `src/systems/RunSession.ts`:

```ts
// Holds the run-session token for one game-scene lifetime.
// See docs/superpowers/specs/2026-08-12-run-session-tokens-design.md
//
// Issuance is fire-and-forget and must never block a frame. On failure it
// retries for the life of the scene, because a run that never obtains a token
// cannot submit a score at all.

import { ScoreClient } from './ScoreClient';

export const RETRY_MS = 15_000;

export class RunSession {
  private token?: string;
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Begin acquiring a token. Safe to call again; discards any previous token. */
  start(playerId: string, heapId: string): void {
    this.stop();
    this.token = undefined;
    const attempt = (): void => {
      void ScoreClient.openSession(playerId, heapId)
        .then((token) => {
          if (!token) return;
          this.token = token;
          this.stop();
        })
        .catch(() => { /* offline — the retry timer handles it */ });
    };
    attempt();
    this.timer = setInterval(attempt, RETRY_MS);
  }

  /** Halt retries. Call from scene shutdown; the held token stays readable. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getToken(): string | undefined {
    return this.token;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/systems/__tests__/RunSession.test.ts`
Expected: PASS, all 6 cases.

- [ ] **Step 6: Commit**

```bash
git add src/systems/RunSession.ts src/systems/__tests__/RunSession.test.ts src/systems/ScoreClient.ts
git commit -m "feat(client): add RunSession manager and ScoreClient.openSession"
```

---

### Task 5: Scene plumbing and full verification

**Files:**
- Modify: `src/scenes/GameScene.ts`
- Modify: `src/scenes/InfiniteGameScene.ts`
- Modify: `src/scenes/ScoreScene.ts`

**Interfaces:**
- Consumes: `RunSession` from Task 4.
- Produces: `ScoreScene` init data gains `sessionToken?: string`.

**Note on `getEffectivePlayerId`:** the session must be opened for the same id the score is submitted under. `ScoreScene` uses `getEffectivePlayerId()`; the game scenes must use it too, never `getPlayerGuid()`.

- [ ] **Step 1: Start the session in GameScene**

In `src/scenes/GameScene.ts`, add the import:

```ts
import { RunSession } from '../systems/RunSession';
import { getEffectivePlayerId } from '../systems/SaveData';
```

(If `getEffectivePlayerId` is already imported, do not duplicate it.)

Add the field beside `private _runStartTime: number | null = null;`:

```ts
  private _runSession = new RunSession();
```

In `create()`, immediately after `this._heapId = heapId;`, add:

```ts
    // Open the run session at scene create, not at first-scored-pixel: this
    // gives issuance a whole run to succeed and makes issuedAt earlier than
    // _runStartTime, which widens the server's verified window.
    this._runSession.start(getEffectivePlayerId(), heapId);
```

In the existing `shutdown()` method, add:

```ts
    this._runSession.stop();
```

- [ ] **Step 2: Pass the token to ScoreScene from GameScene**

`GameScene` launches `ScoreScene` in three places (death, summit, and wall-death). In **each** `this.scene.launch('ScoreScene', { … })` call, add this property alongside `elapsedMs`:

```ts
          sessionToken: this._runSession.getToken(),
```

Verify all three were updated:

Run: `grep -c "sessionToken" src/scenes/GameScene.ts`
Expected: `3`

- [ ] **Step 3: Mirror it in InfiniteGameScene**

In `src/scenes/InfiniteGameScene.ts`, add the imports (`INFINITE_HEAP_ID` is already imported at line 42 — do not duplicate it, and do not duplicate `getEffectivePlayerId` if it is already there):

```ts
import { RunSession } from '../systems/RunSession';
import { getEffectivePlayerId } from '../systems/SaveData';
```

Add the field beside `private _runStartTime: number | null = null;`:

```ts
  private _runSession = new RunSession();
```

In `create()`, immediately after `this._runStartTime = null;`, add:

```ts
    this._runSession.start(getEffectivePlayerId(), INFINITE_HEAP_ID);
```

In the existing `private shutdown(): void` method (around line 801), add:

```ts
    this._runSession.stop();
```

This scene has exactly one `scene.launch('ScoreScene', …)` call. Add to its data object, alongside `elapsedMs`:

```ts
        sessionToken: this._runSession.getToken(),
```

Run: `grep -c "sessionToken" src/scenes/InfiniteGameScene.ts`
Expected: `1`

- [ ] **Step 4: Accept and forward the token in ScoreScene**

In `src/scenes/ScoreScene.ts`, add to the init-data type (beside `checkpointAvailable?: boolean;`):

```ts
    sessionToken?: string;
```

Add the field beside `private checkpointAvailable: boolean = false;`:

```ts
  private sessionToken?: string;
```

In `init()`, beside `this.checkpointAvailable = data.checkpointAvailable ?? false;`:

```ts
    this.sessionToken = data.sessionToken;
```

In the `ScoreClient.submitScore({...})` call, add after `limit: LEADERBOARD_TOP_N,`:

```ts
          sessionToken: this.sessionToken,
```

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS, no regressions.

- [ ] **Step 6: Run the build**

Run: `npm run build`
Expected: exit 0, no TypeScript errors. This is required — it catches type errors the tests miss.

- [ ] **Step 7: Commit**

```bash
git add src/scenes/GameScene.ts src/scenes/InfiniteGameScene.ts src/scenes/ScoreScene.ts
git commit -m "feat(client): open a run session per scene and submit its token"
```

---

### Task 6: Deployment note

**Files:**
- Modify: `server/README.md`

- [ ] **Step 1: Document the secret**

Add to `server/README.md`, under whatever section covers secrets (create a `## Secrets` section if none exists):

```markdown
### SESSION_SECRET

HMAC key for run-session tokens (see
`docs/superpowers/specs/2026-08-12-run-session-tokens-design.md`). Until it is
set, `/scores/session` 404s and score submits skip session verification — the
feature is inert, which is the correct local-dev behavior.

Generate and set it:

```bash
openssl rand -base64 32
npx wrangler secret put SESSION_SECRET
npx wrangler secret put SESSION_SECRET --env staging
```

**Set this on staging and verify there before production.** Once it is live in
production, any client that cannot reach `/scores/session` at run start loses
that run's score, so the client change must be deployed first.
```

- [ ] **Step 2: Commit**

```bash
git add server/README.md
git commit -m "docs(server): document SESSION_SECRET setup"
```

---

## Deployment order (read before shipping)

The server change is backward-compatible only while `SESSION_SECRET` is unset. Setting it makes tokenless submits fail. So:

1. Merge and deploy **everything with `SESSION_SECRET` unset**. Nothing changes for anyone.
2. Confirm the web build is live and issuing sessions (`/scores/session` returns 404 at this stage — that is expected and the client handles it as "no token").
3. Ship the Android release, and wait for the `min_version` gate to push players onto it.
4. **Only then** set `SESSION_SECRET` in production.

Skipping to step 4 silently breaks scoring for every client still on an older build.

## Post-merge verification

- `npm test` and `npm run build` both green.
- Smoke test via the `smoke-testing-heap` skill: play a run to the score screen against a local worker with `SESSION_SECRET` set, and confirm the score is accepted.
- With the secret set, confirm a `curl` submit with `elapsedMs: 99999999` and no token is rejected with 400.
- Watch `score:rejected` in `heap_logs` for the `no-session` reason after enabling in production — a nonzero steady rate means clients are failing to obtain sessions.

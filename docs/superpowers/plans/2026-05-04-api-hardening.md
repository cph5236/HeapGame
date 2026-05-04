# Cloudflare Worker API Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the bar against manual / scripted abuse of the Heap Cloudflare Worker API by combining a CORS allowlist, server-side payload plausibility checks, an admin secret on mutating heap routes, and Cloudflare dashboard rate limits.

**Architecture:** Three code layers + one dashboard layer. (1) Tighten existing `hono/cors` middleware in `app.ts` to an explicit origin allowlist driven by an env binding. (2) Harden the JSON shape and value bounds in `routes/scores.ts` and `routes/heap.ts` to reject anything that couldn't come from honest gameplay. (3) Gate the destructive heap routes (POST/PUT/DELETE) behind a shared `ADMIN_SECRET` Worker secret. (4) Configure per-IP rate limits in the Cloudflare dashboard (manual user task at the end). Turnstile + JWT (originally proposed Layer 4) is intentionally out of scope.

**Tech Stack:** Hono 4 (Worker framework), `hono/cors`, Cloudflare Workers env bindings + secrets, Vitest (in-memory `MockHeapDB` / `MockScoreDB`), `wrangler` CLI.

---

## File Structure

**Modified:**
- `server/src/app.ts` — accept an `env`-derived options object, configure CORS origins from it, mount admin-secret middleware on mutating heap routes.
- `server/src/index.ts` — pass relevant env values (`ALLOWED_ORIGINS`, `ADMIN_SECRET`) into `createApp`.
- `server/src/routes/scores.ts` — tighter payload validation (MAX_SCORE ceiling, finite/integer/length checks).
- `server/src/routes/heap.ts` — finite-coordinate guard on `POST /:id/place`; vertex coordinate sanity guard on `POST /heaps`.
- `server/wrangler.toml` — declare `ALLOWED_ORIGINS` var and document the `ADMIN_SECRET` secret.
- `server/tests/helpers/mockDb.ts` and `server/tests/routes.test.ts` — extend `makeApp()` so tests can pass options (allowed origins, admin secret).
- `server/README.md` — document the new env var, secret, and dashboard rate-limit rules.

**Created:**
- `server/src/middleware/adminAuth.ts` — Hono middleware comparing `X-Admin-Secret` header against the configured secret.
- `server/tests/security.test.ts` — focused tests for CORS allowlist + admin-secret behavior.

---

## Task 1: Configure CORS allowlist via env

**Files:**
- Modify: `server/src/app.ts:1-14`
- Modify: `server/src/index.ts`
- Modify: `server/wrangler.toml`
- Modify: `server/tests/routes.test.ts:23-25` (helper) and add cases
- Create: `server/tests/security.test.ts`

- [ ] **Step 1: Add allowed-origins handling to `createApp`**

Edit `server/src/app.ts` to take an options object and forward it to `cors()`:

```ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { HeapDB } from './db';
import type { ScoreDB } from './scoreDb';
import { heapRoutes } from './routes/heap';
import { scoreRoutes } from './routes/scores';

export interface AppOptions {
  /** Comma-separated origin list, or '*' to allow all (dev only). */
  allowedOrigins?: string;
}

export function createApp(heapDb: HeapDB, scoreDb: ScoreDB, opts: AppOptions = {}): Hono {
  const app = new Hono();

  const raw = (opts.allowedOrigins ?? '*').trim();
  const allowAll = raw === '*';
  const list = allowAll
    ? []
    : raw.split(',').map((s) => s.trim()).filter(Boolean);

  app.use('*', cors({
    origin: (origin) => {
      if (allowAll) return origin ?? '*';
      if (!origin) return null;
      return list.includes(origin) ? origin : null;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-Admin-Secret'],
  }));

  app.route('/heaps',  heapRoutes(heapDb));
  app.route('/scores', scoreRoutes(scoreDb));
  return app;
}
```

- [ ] **Step 2: Wire `ALLOWED_ORIGINS` from `env` in `index.ts`**

Open `server/src/index.ts`, find the `fetch` handler that calls `createApp`, and pass `env.ALLOWED_ORIGINS`:

```ts
// Existing pattern, preserve whatever DB construction is already there:
const app = createApp(heapDb, scoreDb, { allowedOrigins: env.ALLOWED_ORIGINS });
return app.fetch(request, env, ctx);
```

Also add to the `Env` interface in that file:

```ts
interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS?: string;
  ADMIN_SECRET?: string; // used by Task 4
}
```

(If `Env` lives elsewhere, update it there instead. Use `grep -n "ALLOWED_ORIGINS\|interface Env" server/src` to confirm.)

- [ ] **Step 3: Declare `ALLOWED_ORIGINS` in `wrangler.toml`**

Append under the `[vars]` table (create the table if absent):

```toml
[vars]
ALLOWED_ORIGINS = "https://heap.connorhanlin.com,capacitor://localhost,https://localhost"
```

(The exact production domain may need adjusting — leave a comment for the user if unsure.)

- [ ] **Step 4: Update test helper to accept options**

Edit `server/tests/routes.test.ts:23-25`:

```ts
import type { AppOptions } from '../src/app';

function makeApp(opts: AppOptions = {}) {
  return createApp(new MockHeapDB(), new MockScoreDB(), opts);
}
```

- [ ] **Step 5: Write failing CORS tests**

Create `server/tests/security.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';

function makeApp(allowedOrigins?: string) {
  return createApp(new MockHeapDB(), new MockScoreDB(), { allowedOrigins });
}

describe('CORS allowlist', () => {
  it('echoes Access-Control-Allow-Origin for an allowed origin', async () => {
    const res = await makeApp('https://heap.example.com').request('/heaps', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://heap.example.com',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://heap.example.com');
  });

  it('omits Access-Control-Allow-Origin for a disallowed origin', async () => {
    const res = await makeApp('https://heap.example.com').request('/heaps', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://attacker.example.com',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('defaults to wildcard when no allowedOrigins is provided', async () => {
    const res = await makeApp().request('/heaps', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://anywhere.example.com',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://anywhere.example.com');
  });
});
```

- [ ] **Step 6: Run tests, expect CORS tests to pass and all existing tests to still pass**

Run: `cd server && npm test`
Expected: all suites green, including the three new CORS tests.

- [ ] **Step 7: Commit**

```bash
git add server/src/app.ts server/src/index.ts server/wrangler.toml \
        server/tests/routes.test.ts server/tests/security.test.ts
git commit -m "feat(server): tighten CORS to explicit origin allowlist via env"
```

---

## Task 2: Tighten /scores payload validation

**Files:**
- Modify: `server/src/routes/scores.ts:49-75`
- Modify: `server/tests/scores.test.ts` (add cases — append to existing `describe('POST /scores')` block)

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/scores.test.ts` (inside the existing `POST /scores` describe — copy the surrounding helper imports if it's a separate file). Use the same `makeApp()` style already in that file:

```ts
describe('POST /scores hardening', () => {
  const validBody = {
    heapId: 'h1',
    playerId: 'p1',
    playerName: 'Alice',
    score: 100,
  };

  it('rejects non-finite score', async () => {
    const res = await makeApp().request('/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validBody, score: Number.POSITIVE_INFINITY }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects score above MAX_SCORE ceiling', async () => {
    const res = await makeApp().request('/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validBody, score: 100_000_001 }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects oversized playerId', async () => {
    const res = await makeApp().request('/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validBody, playerId: 'p'.repeat(200) }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects empty playerName after trim', async () => {
    const res = await makeApp().request('/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validBody, playerName: '   ' }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the tests, expect them to fail**

Run: `cd server && npx vitest run tests/scores.test.ts -t hardening`
Expected: 4 failures (current handler accepts these payloads).

- [ ] **Step 3: Add the validation in the handler**

Edit `server/src/routes/scores.ts`. Replace the body-validation block in the `POST /` handler (lines 57–62) with:

```ts
const MAX_SCORE       = 100_000_000; // sane absolute ceiling; tune if real scores exceed it
const MAX_ID_LEN      = 64;
const MAX_NAME_LEN    = 32;

const { heapId, playerId, playerName, score } = body;

if (typeof heapId !== 'string' || heapId.length === 0 || heapId.length > MAX_ID_LEN)
  return c.json({ error: 'heapId must be a 1-64 char string' }, 400);
if (typeof playerId !== 'string' || playerId.length === 0 || playerId.length > MAX_ID_LEN)
  return c.json({ error: 'playerId must be a 1-64 char string' }, 400);
if (typeof playerName !== 'string' || playerName.trim().length === 0)
  return c.json({ error: 'playerName must be a non-empty string' }, 400);
if (!Number.isInteger(score) || score <= 0 || score > MAX_SCORE)
  return c.json({ error: `score must be an integer in (0, ${MAX_SCORE}]` }, 400);
```

Also change the `db.upsertScore(...)` call (line 70) to use the trimmed name:

```ts
const submitted = await db.upsertScore(heapId, playerId, playerName.trim().slice(0, MAX_NAME_LEN), score, now);
```

- [ ] **Step 4: Run the tests, expect green**

Run: `cd server && npm test`
Expected: all suites green, including the four new hardening cases.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/scores.ts server/tests/scores.test.ts
git commit -m "feat(server): tighten /scores payload validation (max score, id/name bounds)"
```

---

## Task 3: Tighten /heaps payload validation

**Files:**
- Modify: `server/src/routes/heap.ts:66-99` (POST /heaps) and `:229-281` (POST /:id/place)
- Modify: `server/tests/routes.test.ts` (add cases at the end of the file)

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/routes.test.ts`:

```ts
describe('POST /heaps hardening', () => {
  it('rejects vertices containing non-finite coordinates', async () => {
    const res = await makeApp().request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vertices: [
          { x: 0, y: 0 },
          { x: Number.POSITIVE_INFINITY, y: 100 },
          { x: 100, y: 100 },
        ],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects vertex arrays exceeding 10_000 entries', async () => {
    const huge = Array.from({ length: 10_001 }, (_, i) => ({ x: i, y: i }));
    const res = await makeApp().request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: huge }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /heaps/:id/place hardening', () => {
  async function makeHeap(app: ReturnType<typeof makeApp>) {
    const res = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    return (await res.json() as CreateHeapResponse).id;
  }

  it('rejects non-finite coordinates', async () => {
    const app = makeApp();
    const id = await makeHeap(app);
    const res = await app.request(`/heaps/${id}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: Number.NaN, y: 100 }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the tests, expect them to fail**

Run: `cd server && npx vitest run tests/routes.test.ts -t hardening`
Expected: 3 failures.

- [ ] **Step 3: Tighten POST /heaps vertex validation**

Edit `server/src/routes/heap.ts`. Replace the `vertices` check in the `POST /` handler (lines 75–81) with:

```ts
const MAX_VERTICES = 10_000;
if (
  !Array.isArray(vertices) ||
  vertices.length < 3 ||
  vertices.length > MAX_VERTICES ||
  !vertices.every((v) =>
    v != null &&
    typeof (v as Vertex).x === 'number' && Number.isFinite((v as Vertex).x) &&
    typeof (v as Vertex).y === 'number' && Number.isFinite((v as Vertex).y),
  )
) {
  return c.json({ error: `vertices must be an array of 3-${MAX_VERTICES} {x, y} objects with finite numbers` }, 400);
}
```

- [ ] **Step 4: Tighten POST /:id/place coordinate validation**

In the same file, replace the `x`/`y` check in the `POST /:id/place` handler (lines 238–241) with:

```ts
const { x, y } = body;
if (typeof x !== 'number' || !Number.isFinite(x) ||
    typeof y !== 'number' || !Number.isFinite(y)) {
  return c.json({ error: 'x and y must be finite numbers' }, 400);
}
```

- [ ] **Step 5: Run the tests, expect green**

Run: `cd server && npm test`
Expected: all suites green.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/heap.ts server/tests/routes.test.ts
git commit -m "feat(server): reject non-finite coords + cap vertex arrays on heap routes"
```

---

## Task 4: Gate mutating heap routes behind ADMIN_SECRET

Mutating heap routes (`POST /heaps`, `PUT /heaps/:id/reset`, `PUT /heaps/:id/enemy-params`, `DELETE /heaps/:id`) are admin / seeding operations — the game client never calls them in normal play. Gate them behind a shared secret header `X-Admin-Secret`. Read endpoints and `POST /heaps/:id/place` (which the client *does* call during play) remain open.

**Files:**
- Create: `server/src/middleware/adminAuth.ts`
- Modify: `server/src/app.ts` (extend `AppOptions`, mount middleware before `heapRoutes`)
- Modify: `server/src/index.ts` (pass `env.ADMIN_SECRET`)
- Modify: `server/tests/security.test.ts` (add cases)
- Modify: `scripts/seed-heap.ts` (add header to its requests, if it calls these routes — verify with grep first)

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/security.test.ts`:

```ts
import type { CreateHeapResponse } from '../../shared/heapTypes';

const VERTICES = [
  { x: 100, y: 400 },
  { x: 300, y: 600 },
  { x: 500, y: 400 },
];

describe('Admin secret gate', () => {
  function makeAppWithSecret(secret: string) {
    return createApp(new MockHeapDB(), new MockScoreDB(), { adminSecret: secret });
  }

  it('rejects POST /heaps without X-Admin-Secret', async () => {
    const res = await makeAppWithSecret('s3cret').request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects POST /heaps with wrong X-Admin-Secret', async () => {
    const res = await makeAppWithSecret('s3cret').request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': 'nope' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    expect(res.status).toBe(401);
  });

  it('accepts POST /heaps with correct X-Admin-Secret', async () => {
    const res = await makeAppWithSecret('s3cret').request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': 's3cret' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    expect(res.status).toBe(201);
  });

  it('does not gate read endpoints (GET /heaps)', async () => {
    const res = await makeAppWithSecret('s3cret').request('/heaps');
    expect(res.status).toBe(200);
  });

  it('does not gate POST /heaps/:id/place', async () => {
    const app = createApp(new MockHeapDB(), new MockScoreDB(), { adminSecret: 's3cret' });
    // Seed a heap directly via admin header
    const created = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': 's3cret' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    const { id } = await created.json() as CreateHeapResponse;

    const placeRes = await app.request(`/heaps/${id}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }, // NO admin header
      body: JSON.stringify({ x: 300, y: 100 }),
    });
    expect(placeRes.status).toBe(200);
  });

  it('disables the gate when adminSecret is empty string (dev mode)', async () => {
    const app = createApp(new MockHeapDB(), new MockScoreDB(), { adminSecret: '' });
    const res = await app.request('/heaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices: VERTICES }),
    });
    expect(res.status).toBe(201);
  });
});
```

- [ ] **Step 2: Run the tests, expect all 6 to fail**

Run: `cd server && npx vitest run tests/security.test.ts -t "Admin secret"`
Expected: 6 failures (no gate exists yet; `adminSecret` is not even a typed option).

- [ ] **Step 3: Create the middleware**

Create `server/src/middleware/adminAuth.ts`:

```ts
import type { MiddlewareHandler } from 'hono';

/**
 * Returns Hono middleware that 401s any request whose X-Admin-Secret header
 * does not match `secret`. If `secret` is empty/undefined the middleware is a
 * no-op — allows local dev to run without a secret configured.
 */
export function requireAdminSecret(secret: string | undefined): MiddlewareHandler {
  return async (c, next) => {
    if (!secret) return next();
    const provided = c.req.header('x-admin-secret');
    if (provided !== secret) {
      return c.json({ error: 'admin secret required' }, 401);
    }
    return next();
  };
}
```

- [ ] **Step 4: Wire the middleware in `app.ts`**

Edit `server/src/app.ts`. Extend `AppOptions` and mount the middleware on the four mutating heap paths *before* the route group:

```ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { HeapDB } from './db';
import type { ScoreDB } from './scoreDb';
import { heapRoutes } from './routes/heap';
import { scoreRoutes } from './routes/scores';
import { requireAdminSecret } from './middleware/adminAuth';

export interface AppOptions {
  allowedOrigins?: string;
  /** When set, mutating heap routes require X-Admin-Secret: <value>. */
  adminSecret?: string;
}

export function createApp(heapDb: HeapDB, scoreDb: ScoreDB, opts: AppOptions = {}): Hono {
  const app = new Hono();

  const raw = (opts.allowedOrigins ?? '*').trim();
  const allowAll = raw === '*';
  const list = allowAll ? [] : raw.split(',').map((s) => s.trim()).filter(Boolean);

  app.use('*', cors({
    origin: (origin) => {
      if (allowAll) return origin ?? '*';
      if (!origin) return null;
      return list.includes(origin) ? origin : null;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-Admin-Secret'],
  }));

  const adminGate = requireAdminSecret(opts.adminSecret);
  app.post  ('/heaps',                  adminGate);
  app.put   ('/heaps/:id/reset',        adminGate);
  app.put   ('/heaps/:id/enemy-params', adminGate);
  app.delete('/heaps/:id',              adminGate);

  app.route('/heaps',  heapRoutes(heapDb));
  app.route('/scores', scoreRoutes(scoreDb));
  return app;
}
```

- [ ] **Step 5: Pass `env.ADMIN_SECRET` from `index.ts`**

Update the `createApp(...)` call in `server/src/index.ts`:

```ts
const app = createApp(heapDb, scoreDb, {
  allowedOrigins: env.ALLOWED_ORIGINS,
  adminSecret:    env.ADMIN_SECRET,
});
```

- [ ] **Step 6: Run all tests, expect green**

Run: `cd server && npm test`
Expected: all suites green.

- [ ] **Step 7: Update the seed script if it hits gated routes**

Run: `grep -nE "/heaps['\"]?\s*,\s*\{|reset|enemy-params|method:\s*['\"](POST|PUT|DELETE)" scripts/seed-heap.ts`

If matches show requests to gated routes, add `'X-Admin-Secret': process.env.ADMIN_SECRET ?? ''` to each `headers` object. If the script doesn't hit gated routes, leave it alone.

- [ ] **Step 8: Commit**

```bash
git add server/src/app.ts server/src/index.ts server/src/middleware/adminAuth.ts \
        server/tests/security.test.ts scripts/seed-heap.ts
git commit -m "feat(server): gate mutating heap routes behind X-Admin-Secret header"
```

(Drop `scripts/seed-heap.ts` from `git add` if Step 7 found nothing.)

---

## Task 5: Set the production ADMIN_SECRET via wrangler

**Files:** none (configuration only).

- [ ] **Step 1: Generate a strong random secret locally**

Run: `openssl rand -hex 32`
Copy the output (64 hex chars).

- [ ] **Step 2: Push it as a Worker secret**

Run: `cd server && npx wrangler secret put ADMIN_SECRET`
Paste the value when prompted.

Expected: `✨  Success! Uploaded secret ADMIN_SECRET`.

- [ ] **Step 3: Verify it's set**

Run: `cd server && npx wrangler secret list`
Expected: `ADMIN_SECRET` appears in the list.

- [ ] **Step 4: Save the secret somewhere persistent**

Store it in a password manager. The seed script and any future admin tooling will need it via `ADMIN_SECRET=<value>` in the environment.

---

## Task 6: Configure Cloudflare dashboard rate limits (manual)

**Files:** none — performed by the user in the Cloudflare dashboard.

- [ ] **Step 1: Navigate to the Worker's rate limiting settings**

In the Cloudflare dashboard, open the `heap-server` Worker → **Settings** → **Rate Limiting** (if absent, use the zone's **Security → WAF → Rate limiting rules** instead).

- [ ] **Step 2: Add rule "scores-submit"**

- Match: `http.request.method eq "POST"` AND `http.request.uri.path eq "/scores"`
- Characteristics: `IP source address`
- Period: `60` seconds
- Requests: `10`
- Action: `Block` for `60` seconds

- [ ] **Step 3: Add rule "place-block"**

- Match: `http.request.method eq "POST"` AND `http.request.uri.path matches "^/heaps/[^/]+/place$"`
- Characteristics: `IP source address`
- Period: `60` seconds
- Requests: `30`
- Action: `Block` for `60` seconds

- [ ] **Step 4: Add rule "global-circuit-breaker"**

- Match: `(starts_with(http.request.uri.path, "/heaps") or starts_with(http.request.uri.path, "/scores"))`
- Characteristics: `IP source address`
- Period: `60` seconds
- Requests: `300`
- Action: `Block` for `60` seconds

- [ ] **Step 5: Smoke test from a browser console**

From the deployed site, run a loop hitting `POST /scores` with a junk body 12 times in <60s and confirm the 11th+ request returns `429`.

---

## Task 7: Documentation update

**Files:**
- Modify: `server/README.md`

- [ ] **Step 1: Add a "Security" section after the "Deploying the Worker" section**

Append:

```markdown
---

## Security

The Worker is hardened in three layers:

1. **CORS allowlist** — `ALLOWED_ORIGINS` in `wrangler.toml` is a comma-separated list of origins that may call the API from a browser. `*` (default) disables the allowlist for local dev.
2. **Admin secret** — mutating heap routes (`POST /heaps`, `PUT /heaps/:id/reset`, `PUT /heaps/:id/enemy-params`, `DELETE /heaps/:id`) require an `X-Admin-Secret` header matching the `ADMIN_SECRET` Worker secret. Set with `npx wrangler secret put ADMIN_SECRET`. If the secret is unset (local dev) the gate is bypassed.
3. **Per-IP rate limits** — configured in the Cloudflare dashboard under the Worker's Rate Limiting settings. Current rules: 10/min on `POST /scores`, 30/min on `POST /heaps/:id/place`, 300/min global circuit breaker.

Read endpoints and `POST /heaps/:id/place` (the only mutating route the game client uses during normal play) are intentionally not gated by the admin secret — the rate limiter is the defense for those.
```

- [ ] **Step 2: Commit**

```bash
git add server/README.md
git commit -m "docs(server): document CORS, admin secret, rate limit layers"
```

---

## Verification Checklist

Before marking this plan complete:

- [ ] `cd server && npm test` — all green.
- [ ] Local dev (`cd server && npm run dev`) still serves `GET /heaps` from `http://localhost:3000` (because `ALLOWED_ORIGINS` includes `http://localhost:3000` if you added it, or because no secret is set in dev).
- [ ] Production: `curl -X POST https://<worker-url>/heaps -H 'content-type: application/json' -d '{"vertices":[]}'` returns `401`.
- [ ] Production: `curl -X POST https://<worker-url>/heaps -H 'content-type: application/json' -H 'X-Admin-Secret: <value>' -d '{"vertices":[]}'` returns `400` (passes auth, fails validation).
- [ ] Cloudflare dashboard shows the three rate-limit rules enabled.
- [ ] Smoke test from the deployed game: a normal play session can still submit scores and place blocks.

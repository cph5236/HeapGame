# Run-Session Tokens — Design

**Date:** 2026-08-12
**Status:** Approved, not yet implemented
**Branch:** `feature/run-session-tokens`

## Problem

`POST /scores` validates `elapsedMs` only as `>= 1` ([server/src/routes/scores.ts:145](../../../server/src/routes/scores.ts)).
That value is the denominator of both plausibility caps:

```ts
if (baseHeightPx * 1000 > MAX_CLIMB_RATE_Y_PER_S * elapsedMs)      // :219
if ((percher + ghost + jumper) * 1000 > MAX_KILLS_PER_S * elapsedMs) // :229
```

Inflating `elapsedMs` dissolves both caps at once. At the 400 y/s climb cap, a
single request claiming `elapsedMs: 99999999` yields a ~40,000 km climb.

Nothing else closes this. TOFU write-auth (`server/src/playerAuth.ts`) binds a
score to a player ID, but first write wins — an attacker claims a *fresh* ID with
a self-chosen secret. The origin allowlist is enforced only by browsers; `curl`
ignores CORS. There is no run-session or nonce concept anywhere in `server/`,
`shared/`, or `src/systems/`.

So the cheapest cheat today is one unauthenticated-in-practice HTTP request. No
modified client, no browser, no Android involved.

## Non-goal: proving the client is genuine

This design does **not** establish that a request came from the real game. It
cannot. The session endpoint must be callable by an untrusted client, so `curl`
obtains a valid token exactly as easily as the game does. Nothing embedded in a
client keeps a secret from its owner.

Google Play Integrity was evaluated first and rejected for this reason
(see "Alternatives considered"). What this design buys is narrower and more
durable: a **server-attested timestamp**, which makes score-per-real-second the
binding constraint. A top score costs an attacker the same wall-clock hours it
costs a legitimate player.

## Mechanism

### Token

```
payload = base64url(`${playerId}|${heapId}|${issuedAtMs}`)
token   = `${payload}.${base64url(HMAC-SHA256(SESSION_SECRET, payload))}`
```

`SESSION_SECRET` is a 32-byte Worker secret, never sent to clients:

```
npx wrangler secret put SESSION_SECRET
npx wrangler secret put SESSION_SECRET --env staging
```

Sign and verify through `crypto.subtle.sign` / `crypto.subtle.verify`.
`subtle.verify` compares in constant time — never compare signature strings with
`===`. HMAC-SHA256 is existentially unforgeable, so `issuedAtMs` cannot be
altered or minted without the key.

New module `server/src/runSession.ts`, pure and DB-free.

### Issue endpoint — `POST /scores/session`

Request `{ playerId, heapId }` → response `{ token, issuedAt }`.

Requires `X-Player-Token` and runs `enforcePlayerAuth`, so a session can only be
opened against a player ID the caller already owns. Sits behind a new
`RL_SESSION` rate-limit binding (namespace 1007, staging 2007) at 20/min per IP.

### Validation at `POST /scores`

Reject outright:

| Check | Rule | `score:rejected` reason |
|---|---|---|
| Presence | token supplied | `no-session` |
| Signature | `subtle.verify` passes | `bad-session-sig` |
| Binding | payload `playerId` + `heapId` equal the body's | `session-mismatch` |
| Age | `now - issuedAt <= MAX_SESSION_MS` | `session-expired` |

Then clamp rather than reject:

```ts
const verifiedElapsedMs = Math.min(
  elapsedMs,
  (now - issuedAt) + GRACE_MS,
  MAX_RUN_MS,
);
```

`verifiedElapsedMs` gates the **plausibility caps only**. `buildRunScore` keeps
receiving the client's raw `elapsedMs` — see below.

Constants: `GRACE_MS = 5_000`, `MAX_SESSION_MS = 12h`, `MAX_RUN_MS = 60min`.

### Why the clamp must not reach the score computation

Pace is *inversely* proportional to elapsed time
([shared/buildRunScore.ts](../../../shared/buildRunScore.ts)):

```ts
paceBonus = Math.floor((baseHeightPx / elapsedSeconds) * PACE_BONUS_CONST)
```

Feeding `verifiedElapsedMs` into `buildRunScore` would therefore *raise* the
score whenever the clamp bit, and would score two identical runs differently
based on network luck. So the split is:

- **Caps** use `verifiedElapsedMs` — small is strict.
- **Score** uses the client's raw `elapsedMs` — inflating it is self-penalizing.

Both attacker moves collapse under that split:

- *Inflate* `elapsedMs` to loosen the caps → caps read the clamped value and stay
  tight, while pace approaches zero. Loses on both counts.
- *Deflate* `elapsedMs` to boost pace → the clamp is a `min`, so caps read the
  deflated value and tighten proportionally. Height is bounded by
  `400 × claimedSeconds`, leaving pace bounded by `400 × PACE_BONUS_CONST`.

Total score stays linear in genuine wall-clock time, which is the whole objective.
Both honest edge cases also score correctly: the late-token player's caps run
against a 7-minute window while pace uses their honest 10 minutes, and a player
who paused mid-run has the `min` select their claim, so pausing costs nothing.

### Why clamp instead of reject

A token issued *late* cannot vouch for time that passed before it. If issuance
fails at run start and succeeds three minutes into a ten-minute run, the server
window is ~7 min while the honest `elapsedMs` is 10 min. A strict
`elapsedMs <= window` rule would reject that legitimate run — so strictness and
retry-until-success are incompatible. The client cannot be permitted to declare
how late its token was, because that value is attacker-controlled and would
reopen the hole completely.

Clamping resolves it:

- **Attack.** `elapsedMs: 99999999` on a 10s-old token clamps the denominator to
  ~15s. The climb cap then permits ~6,000px rather than 40,000 km.
- **Late token.** The 3-min-late player gets a 7-min denominator on a 10-min run.
  At 400 y/s that still permits 168,000px, far beyond any real run. Passes.

A late token degrades a run's headroom gracefully instead of voiding it.

### Why `MAX_RUN_MS` carries the weight

It is what defeats aged-token farming — requesting tokens today and submitting
maxed scores tomorrow. A 12-hour-old token still cannot claim more than 60
minutes of climbing, so hoarding buys nothing. `MAX_SESSION_MS` is hygiene on top.

### Fallback when unconfigured

If `SESSION_SECRET` is unset, `runSession.ts` reports not-configured and
`/scores` behaves exactly as it does today. This matches the existing
`requireAdminSecret` and `playerAuthDb` patterns, and keeps local dev and every
current test working untouched.

## Client wiring

`ScoreClient.openSession()` is called from `GameScene.create()` and
`InfiniteGameScene.create()` — not lazily at first-scored-pixel. Issuing at
create gives the request a whole run to succeed and makes `issuedAt` earlier than
`_runStartTime`, widening the verified window.

On failure, retry every 15s for the life of the scene until one succeeds.
Fire-and-forget throughout; issuance never blocks a frame or gates input.

The token rides the existing `scene.launch('ScoreScene', {…})` payload alongside
`elapsedMs`, then into `ScoreClient.submitScore`, which sends it to the server.

One scene lifetime is one session. Checkpoint continue calls
`scene.start('GameScene', { useCheckpoint: true })`
([src/scenes/ScoreScene.ts:864](../../../src/scenes/ScoreScene.ts)), producing a
fresh scene with `_runStartTime` reset — so it correctly opens a new session.

### Clock-skew direction

Every real-world skew pushes the server window *larger* than the claimed elapsed,
which is the safe direction:

- Phaser's scene clock stops while the scene is paused or the app is backgrounded,
  so `elapsedMs` excludes that time while the server window includes it.
- The death animation delays submit by ~1.1s, adding to the window only.

`GRACE_MS` covers the issue round-trip. The clamp is one-sided by construction:
it can only ever reduce the denominator, never inflate it.

## Rollout

Reject-from-day-one: a submit with no token is rejected as `no-session`.

**Accepted cost, stated explicitly.** If a device cannot reach the server for the
entire duration of a run, that run's score is permanently lost even if the device
is back online at the score screen. There is no recovery path — a token minted at
submit time clamps the denominator to ~0. The 15s retry narrows this to runs
spent wholly offline. This lands on web, itch, and Android simultaneously.

Every rejection logs through the existing `score:rejected` sink with the reasons
above, so the real rate is visible in `heap_logs` and the decision is revisitable.

## Testing

- **Unit** (`server/tests/runSession.test.ts`): sign/verify round-trip; tampered
  payload; tampered signature; wrong key; malformed token shapes; expiry.
- **Clamp** (table-driven): claimed vs. window vs. `MAX_RUN_MS`, asserting the
  attack case collapses the denominator and the late-token case stays passable.
- **Cap/score split** — the regression that motivated it: a submit whose clamp
  bites must score identically to one where it does not, proving
  `verifiedElapsedMs` never reaches `buildRunScore` and the pace bonus is not
  inflated by clamping. Plus both attacker directions (inflated and deflated
  `elapsedMs`) yielding a bounded final score.
- **Route**: each reject reason on `POST /scores`; `POST /scores/session` happy
  path, auth rejection, and player/heap binding.
- **Unconfigured**: with no `SESSION_SECRET`, existing score tests pass unchanged.
- **Client**: retry fires on failure and stops after success; token reaches
  `submitScore`; absent token still submits (and is server-rejected).

## Scope

**In:** `server/src/runSession.ts`, `POST /scores/session`, validation and
clamping in `POST /scores`, `RL_SESSION` binding, `ScoreClient.openSession` +
retry, token plumbing through both game scenes and `ScoreScene`.

**Out, deliberately:** per-player rate limits and admin ban / score-nuke —
deferred to a separate project. `MAX_RUN_MS` already closes aged-token farming;
the residual gap is parallel sessions from one machine, which is real but lower
priority. Ship this, watch telemetry, then decide.

**No migration. No new table. No KV. No D1 writes.**

## Alternatives considered

**Google Play Integrity API** (the original request). Rejected: it verifies only
the Play-installed Android build, while Heap ships on web and itch.io as
first-class platforms. An attacker failing integrity simply uses the web build
and is indistinguishable from a legitimate web player. It closes APK modification
while leaving the actual cheapest path — a single `curl` — untouched, and costs a
Google Cloud project, a service account, and RS256 JWT signing inside a Worker.
Reconsider only if a verified-Android leaderboard tier becomes a product goal.

**One-time nonce burn** (D1 table, one session = one submit). Rejected as
guarding a replay that is already worthless: the token binds `playerId` and
`heapId`, and only a player's best score is retained. Costs a migration, a D1
write, and expired-nonce cleanup.

**D1 session rows.** Rejected: writes on every run start, which is far more
frequent than submits, against a free-tier budget.

**Tighter plausibility caps alone.** Rejected: caps the top score rather than
tying it to real time, so a patient scripted attacker still tops the board.

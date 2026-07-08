# Player Write-Auth Design

**Date:** 2026-07-07
**Status:** Approved for planning
**Branch (planned):** `feature/player-write-auth`

## Problem

Player GUIDs are the only credential the API has, and they are public: every
leaderboard/context response includes `playerId` for each entry
(`server/src/routes/scores.ts` — `buildContext` and the paginated route). Anyone
who inspects the JSON can harvest GUIDs and then, acting as that player:

1. **Score/name griefing** — `POST /scores` with a victim's GUID overwrites
   their leaderboard name and can push a fake (plausibility-capped) score under
   their identity (`scoreDb.upsertScore` takes whatever name arrives).
2. **Loadout vandalism** — `PUT /customization/:playerId` has no auth beyond
   the path param.
3. **Reward-code cap burning** — code redemptions are keyed by player GUID, so
   an attacker can consume a victim's per-player redemption allowance.

## Decision summary

Split identity into a **public ID** (the existing `playerGuid`, which stays in
leaderboard responses by design — it is an identifier, not a secret) and a
**private secret** (`playerSecret`) that authenticates writes. The server
stores only a hash of the secret and enforces it per-GUID with
trust-on-first-use semantics, so legacy clients never break.

A cheater can still forge *their own* scores — the secret only prevents
impersonating *someone else*. The existing plausibility caps remain the
defense against self-cheating.

## 1. Identity model (client)

- `SaveData` gains `playerSecret: string`, generated with the existing
  `generateGuid()` helper (`crypto.randomUUID` with fallback).
- Backfilled on load via the same pattern used for `playerGuid`:
  `parsed.playerSecret ?? generateGuid()`. No save-version bump.
- Rides in GPGS cloud saves automatically (whole SaveData blob syncs). That is
  the only recovery path — a player with no cloud save who reinstalls starts a
  fresh identity, same as losing the GUID today. Accepted; the app has no login.
- The secret is never rendered in any UI and never returned by any API
  response.

## 2. Storage (server)

New table in the existing **`heap_scores`** DB (`DB_SCORES` binding). No new
database: the auth table is a standalone point lookup that never joins with
anything, and the writes it protects most (scores, customization) already live
here. `player_customization` stays in `heap_scores` — moving it would break
the leaderboard LEFT JOIN in `getTopScores`/`getScoresPaginated` (D1 cannot
join across databases).

- Migration: `server/migrations/heap_scores/0003_player_auth.sql`
- Schema update: `server/schema/heap_scores.sql`

```sql
CREATE TABLE IF NOT EXISTS player_auth (
  player_id   TEXT NOT NULL PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
```

- `secret_hash` is SHA-256 hex of the raw secret, computed with Workers
  `crypto.subtle`. Raw secrets are never stored — a DB leak yields no usable
  tokens.
- New `PlayerAuthDB` interface + D1 implementation following the existing
  `*Db.ts` pattern (`get`, `insert`, `delete`).
- **No KV caching.** Auth lookups happen only on writes (low volume); skipping
  the cache avoids stale-secret invalidation entirely. `PlayerAuthDB` is a
  separate interface, so the existing cache decorators are untouched.

## 3. Verification core

One function, `verifyOrClaim(authDb, playerId, token)`, returning an outcome
consumed by routes:

| Token sent? | GUID claimed? | Outcome                                   |
|-------------|---------------|-------------------------------------------|
| yes         | no            | claim: insert hash, **allow** (`claimed`) |
| yes         | yes, match    | **allow** (`verified`)                    |
| yes         | yes, mismatch | **403** (`rejected-mismatch`)             |
| no          | no            | **allow** (`legacy`)                      |
| no          | yes           | **403** (`rejected-tokenless-claimed`)    |

Trust-on-first-use rollout: no config flag, no coordinated deploy. Old clients
keep working until they update; a player's first tokened write claims their own
GUID. Residual risk — an attacker can claim a GUID whose owner never updates —
is accepted and mitigated by the admin unclaim endpoint plus logging below.

## 4. Route integration

Token travels as the **`X-Player-Token`** request header (kept out of request
bodies so it can never leak through body logging / `captureServer` values).

Enforced on exactly three writes:

- `POST /scores` (playerId from body)
- `PUT /customization/:playerId` (playerId from path)
- `POST /codes/redeem` (playerGuid from body)

Wiring: the codes route receives the auth DB (backed by `DB_SCORES`) alongside
its rewards DB in `app.ts`/`index.ts`.

403 responses use a generic error body that does not reveal whether the GUID is
claimed.

CORS: the allowlist middleware's `Access-Control-Allow-Headers` gains
`X-Player-Token` so browser/YouTube Playables builds pass preflight.

**Deferred:** `POST /heaps/:id/place` enforcement — the route currently has no
player identity in its request; adding it pairs with per-player placement
attribution / contribution leaderboards. Tracked in `Todo/Todo.md`.

**Excluded:** feedback submissions (playerGuid is telemetry attribution only;
forging it has no player-visible effect). Read endpoints unchanged.

## 5. Logging / detection

- **Server:** every 403 fires
  `captureServer(sink, 'warn', 'auth:rejected', { playerId, route, reason })`
  where `reason` distinguishes `mismatch` from `tokenless-claimed`. First-time
  claims log `auth:claimed` (info) with playerId, so adoption is observable.
- **Client:** a 403 on any enforced write logs an **error-level**
  `auth:rejected` event through the existing remote logger, so it lands in the
  Analytics Engine `heap_logs` dataset and surfaces in the existing
  crash-log triage workflow.
- **Client UX:** the 403 is otherwise handled as the existing submit-failure
  path (local score still shown; leaderboard simply doesn't update). No new UI.
  Revisit only if telemetry shows real lockouts.

## 6. Admin escape hatch

A `DELETE` endpoint on the existing `ADMIN_SECRET`-gated admin surface removes
a `player_auth` row (unclaim). Used to manually rescue a player whose GUID was
claimed by someone else; their next tokened write re-claims it.

## 7. Client changes

- `SaveData`: add `playerSecret` (section 1).
- `ScoreClient`, `CustomizationClient`, `CodeClient`: attach `X-Player-Token`
  on writes; on 403, fire the remote log event and fall through to the
  existing failure handling.

## 8. Testing

TDD throughout. Coverage:

- **Server:** all five matrix rows per enforced route; admin unclaim
  (including re-claim after unclaim); codes-route wiring against the
  scores-DB-backed auth table; hash correctness (known vector).
- **Client:** header attachment on each write client; 403 → remote log +
  graceful-fail path.

## Out of scope

- `/place` enforcement (deferred — see Todo/Todo.md)
- Feedback-route enforcement
- Read-endpoint protection or hiding GUIDs from leaderboards
- Secret rotation
- Self-healing identity reset on repeated 403s
- Play Integrity API (separate Todo item)

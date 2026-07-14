# /place Player Auth Design

**Date:** 2026-07-14
**Status:** Approved for implementation
**Branch:** `feature/place-auth` (off `main`)
**PR target:** `main`
**Depends on:** nothing (player write-auth core merged in PR #94)

## Problem

`POST /heaps/:id/place` is the only player-driven write with no player identity:
the request body is bare `{ x, y }`. This was explicitly deferred from the
player write-auth design (`docs/superpowers/specs/2026-07-07-player-write-auth-design.md`
§4). Adding identity + auth here is the prerequisite for per-player placement
attribution (contribution tracking, next PR in this stack).

## Design

### Request shape

`PlaceRequest` (`shared/heapTypes.ts`) gains an **optional** `playerGuid`:

```ts
export interface PlaceRequest {
  x: number;
  y: number;
  playerGuid?: string;
}
```

The auth token rides the existing `X-Player-Token` header (never the body),
same as scores/customization/codes.

### Server enforcement (`server/src/routes/heap.ts`)

- `heapRoutes()` gains an optional `authDb?: PlayerAuthDB` parameter (same
  pattern as `scoreRoutes`); `app.ts` passes `opts.playerAuthDb` through.
- In the `/place` handler, after JSON/coord validation and **before** the CAS
  loop:
  - If `playerGuid` is present but not a string, or is empty, or exceeds 64
    chars (`MAX_ID_LEN` convention from scores route) → 400 `invalid placement`
    with a `place:rejected` capture (`reason: 'bad playerGuid'`).
  - If `playerGuid` is present and valid → run the existing
    `enforcePlayerAuth(c, authDb, playerGuid, getSink, 'heaps:place')`. A
    non-null return (403) is returned as-is. This gives the full
    verifyOrClaim matrix: claim on first tokened write, verify, reject
    mismatch, reject tokenless-claimed.
  - If `playerGuid` is absent → **legacy path, no auth at all**, behavior
    byte-identical to today. Old clients keep working forever.

### Client (`src/systems/HeapClient.ts` + `src/scenes/GameScene.ts`)

- `HeapClient.append(heapId, x, y, playerGuid?)` — new optional 4th param.
  When provided it is included in the JSON body; `authHeaders()` from
  `src/systems/authToken.ts` is always spread into the request headers
  (harmless when the server ignores it).
- On `!res.ok`, call `logIfAuthRejected('heaps:place', res.status)` before
  returning null (mirrors ScoreClient). Fire-and-forget behavior unchanged.
- The one gameplay call site (`GameScene.ts:686`) passes
  `getEffectivePlayerId()` — **never** bare `getPlayerGuid()` (project
  convention).

### Out of scope

- Contribution counting (next PR, stacked on this branch).
- Rate-limit changes, CORS changes (`X-Player-Token` already allowlisted).
- No migration — `player_auth` table already exists.

## Testing

- Server: all five verifyOrClaim matrix rows against `/heaps/:id/place`
  (guid+token unclaimed → claim+accept; guid+token match → accept;
  guid+token mismatch → 403; guid, no token, unclaimed → accept (legacy row);
  guid, no token, claimed → 403), plus no-guid legacy passthrough and bad-guid
  400. Follow the existing `server/tests/authEnforcement.test.ts` patterns.
- Client: `HeapClient.append` includes `playerGuid` in body and
  `X-Player-Token` header; omits `playerGuid` field when not passed.
- 403 handling: append returns null and fires the remote `auth:rejected` log.

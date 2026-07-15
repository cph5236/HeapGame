# Player Name Validation + Name Table Design

**Date:** 2026-07-14
**Status:** Approved for implementation
**Branch:** `feature/player-name-validation` (off `feature/place-contributions`)
**PR target:** `feature/place-contributions` (retarget as parents merge)
**Depends on:** `feature/place-contributions` (migration numbering + scores-stack code)

## Problem

1. Player names are stored per-score-row (`score.name`), duplicated across
   heaps, and only updated when a new high score lands — a rename doesn't
   propagate until the player beats their score on each heap.
2. Names are completely unfiltered: renames (available whenever the player is
   not GPGS-signed-in) can contain slurs/profanity and land on public
   leaderboards.

## Design decisions (user-approved 2026-07-14)

- Profanity filtering via the **`obscenity`** npm package (maintained matcher,
  leet/obfuscation-aware), wrapped in shared logic used identically client
  and server side.
- **Grandfathering:** existing DB names are backfilled verbatim — only *new*
  names (renames, first-seen players) are validated.
- Names move to a dedicated `player_name` table; score submit stops updating
  names; the `score.name` column is dropped **later** (separate cleanup
  migration after this deploys — never in this PR, so an in-flight old worker
  can't 500 on a missing column).

## 1. Shared validation (`shared/playerName.ts`)

```ts
export const MAX_PLAYER_NAME_LEN = 20; // matches client SaveData cap

export type NameValidation =
  | { ok: true; name: string }              // trimmed canonical form
  | { ok: false; reason: 'empty' | 'too-long' | 'profanity' };

export function validatePlayerName(raw: string): NameValidation;
export function generateDefaultPlayerName(): string; // "Trashbag#NNNNN"
```

- Trim → empty check → length ≤ 20 → `obscenity` `RegExpMatcher` with
  `englishDataset` + `englishRecommendedTransformers` → `hasMatch` rejects.
- The matcher is module-level (built once).
- `generateDefaultPlayerName()` is the existing SaveData `generateDefaultName`
  logic **moved** to shared (SaveData imports it — single source of truth,
  server uses it for seed fallback).
- Dependency: `obscenity` added to root `package.json` `dependencies` (shared/
  is bundled into the client; the server resolves it from the root
  node_modules via normal upward resolution — verify server tests + build).

## 2. Storage (`heap_scores` migration 0005 + schema mirror)

```sql
CREATE TABLE IF NOT EXISTS player_name (
  player_id  TEXT NOT NULL PRIMARY KEY,
  name       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Backfill: one row per player, name taken from their most recently updated
-- score row (SQLite bare-column-with-MAX semantics), copied verbatim.
INSERT INTO player_name (player_id, name, updated_at)
SELECT player_id, name, MAX(updated_at) FROM score GROUP BY player_id
ON CONFLICT (player_id) DO NOTHING;
```

New `server/src/playerNameDb.ts` (playerAuthDb pattern, no KV cache):

```ts
export interface PlayerNameDB {
  getName(playerId: string): Promise<string | null>;
  setName(playerId: string, name: string, now: string): Promise<void>; // upsert
}
```

## 3. Rename endpoint

`PUT /players/:playerId/name`, new `server/src/routes/players.ts`:

- Body `{ name: string }`.
- `validatePlayerName` → 400 `{ error: 'invalid name', reason }` on failure.
- `enforcePlayerAuth(c, authDb, playerId, getSink, 'players:rename')` → 403 on
  mismatch (same TOFU matrix as every other player write).
- Upsert into `player_name`, return `{ name }` (canonical trimmed form).
- Mounted in `app.ts` when `playerNameDb` is wired; shares the `scores`
  rate-limit bucket (like customization).

## 4. Score submit changes (`server/src/routes/scores.ts`)

- `SubmitScoreRequest.playerName` becomes **optional** (shared type). If
  present it must still be a string (else 400) — but it **never updates** an
  existing name row.
- **Seed-if-missing:** after auth passes, if the player has no `player_name`
  row: validate the submitted name — valid → seed it; invalid/absent → seed
  `generateDefaultPlayerName()`. (Covers legacy clients and new players who
  never renamed; an old client can't be prompted to retry, hence the default
  fallback rather than a 400.)
- `scoreRoutes` gains a `playerNameDb?: PlayerNameDB` parameter.

## 5. Name resolution in reads (`server/src/scoreDb.ts`)

- `upsertScore` drops its `name` parameter. The D1 INSERT writes `''` into the
  legacy `score.name` column (still NOT NULL until the later drop migration);
  the UPDATE no longer touches it.
- `getTopScores`, `getScoresPaginated`, `getScore`, `getPlayerScores` LEFT JOIN
  `player_name` and surface `COALESCE(pn.name, 'Anonymous') AS name` — the
  `ScoreRow.name` field keeps existing so routes/clients are unchanged.
- `CachedScoreDB` + `MockScoreDB` updated to match. **Known/accepted:** a
  rename does not invalidate per-heap KV leaderboard caches; stale names age
  out with the existing scores TTL.

## 6. Client

- `src/systems/PlayerNameClient.ts` (new): `updateName(playerId, name)` → PUT
  with `authHeaders()`; returns canonical name or null; 403 →
  `logIfAuthRejected('players:rename', status)`.
- MenuScene name editor (modal around `MenuScene.ts:483`): on save, run
  `validatePlayerName` first — invalid → inline error in the modal, name not
  saved. Valid → existing local `setPlayerName` + fire-and-forget
  `PlayerNameClient.updateName(getEffectivePlayerId(), name)`.
- `ScoreClient.submitScore` keeps sending `playerName` (it now only seeds
  first-seen players server-side). No change to the submit path.
- `SaveData.generateDefaultName` replaced by the shared
  `generateDefaultPlayerName` import (behavior identical).

## Out of scope

- Dropping `score.name` (follow-up migration after deploy — add a Todo line).
- Filtering GPGS-provided display names beyond the same shared pipeline.
- Retroactive filtering of grandfathered names.
- Any change to reward-code, customization, feedback flows.

## Deployment note

Migration 0005 must be applied to remote `heap_scores` at release, **before or
with** the worker deploy (new worker reads `player_name`; old worker ignores
it — either order is safe because `score.name` is not dropped).

## Testing

- Shared: valid names, trim, 20-char boundary, empty, profanity, leet-speak
  obfuscations (`sh1t`, spaced letters), clean words that contain risky
  substrings (e.g. "Class", "Scunthorpe"-style false-positive guard — assert
  the lib passes them).
- Server: rename route (valid, invalid 400 w/ reason, auth matrix 403s,
  claim-on-first-rename); seed-if-missing (valid seed, invalid → default,
  existing row never overwritten by submit); leaderboard reads resolve names
  through the join with 'Anonymous' fallback; mock/D1 parity.
- Client: PlayerNameClient payload/header/403 logging; validation gating in
  the rename flow.

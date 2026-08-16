# Admin Shadow Ban — Design

**Date:** 2026-08-16
**Branch:** `feature/admin-shadow-ban`
**Status:** approved, ready for implementation planning

## Problem

There is no way to remove a cheating or abusive player from the leaderboard. A
visible ban tells the offender they were caught, which invites them to re-roll a
GUID and come back. We want a *shadow* ban: the player's client behaves exactly
as it does today — their score submits, their rank card renders, their board
looks populated — while every other player stops seeing them.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Where the flag lives | New `player_ban` table keyed on `player_id` | Global across heaps, survives score pruning, can pre-date the player's first score, carries an audit trail |
| Self-visibility | SQL predicate, not post-hoc splicing | The viewer's id is a bind parameter; ordering, ranks and pagination all fall out of the same query, so no list-rebuilding code |
| Blast radius | Leaderboard reads + heap placements | Score submission stays untouched (a 4xx there is the loudest possible tell) |
| Enforcement point | Server only | The client is assumed hostile; nothing about ban state is ever sent to a game client |

Accepted consequences, confirmed with the product owner:

- **Ranks shift for everyone else.** Hiding a banned player above you moves you
  from rank 4 to rank 3 on other screens. The banned player continues to see
  their original rank. The two boards genuinely differ; that is the feature.
- **Score rows are never deleted.** A ban is purely a view filter, so unbanning
  restores the player instantly with their score intact.
- **A banned player can briefly vanish from their own top-N.** `MemoBanDB`'s
  per-isolate memo is also what `CachedScoreDB.getTopScores` consults to decide
  whether to bypass its cache for a self-view; a "not banned" entry memoised
  just before the ban lands can serve the banned-filtered public blob to the
  banned player for up to that entry's TTL (≤60s). Self-healing, and cosmetic
  only — their own rank card (`getScore` + `getRank`) never touches this memo
  and stays correct throughout.

## Schema

New migration `server/migrations/heap_scores/0007_player_ban.sql`, mirrored into
`server/schema/heap_scores.sql` (two-file rule — see the `adding-d1-migrations`
skill, which drives this change).

```sql
CREATE TABLE IF NOT EXISTS player_ban (
  player_id TEXT NOT NULL PRIMARY KEY,
  reason    TEXT,
  banned_at TEXT NOT NULL
);
```

No secondary index: every access is a point lookup or a join on the primary key.
`reason` is nullable admin free-text, never exposed to a game client.

## Data access

### `BanDB` — `server/src/banDb.ts`

```ts
export interface BanRow { player_id: string; reason: string | null; banned_at: string }

export interface BanDB {
  isBanned(playerId: string): Promise<boolean>;
  get(playerId: string): Promise<BanRow | null>;
  list(): Promise<BanRow[]>;
  ban(playerId: string, reason: string | null, now: string): Promise<void>;   // idempotent upsert
  unban(playerId: string): Promise<void>;                                     // idempotent delete
}
```

`D1BanDB` for production, `MockBanDB` in `server/tests/helpers/` alongside the
existing `MockScoreDB` / `MockHeapDB`.

### `MemoBanDB` — in-isolate memo

`isBanned` sits on the leaderboard hot path, so it is wrapped in a decorator that
memoises results in module scope for 60s. Workers reuse isolates across requests,
so the D1 read amortises to near zero without adding a KV read. `ban` / `unban`
clear the memo in the calling isolate; other isolates converge within the TTL.

Staleness bound: a ban takes effect for all viewers within 60s. That is the same
*duration* as `SCORES_TTL`, though not the same literal — 60_000 ms here against
60 s there. The two windows do not only work in the ban's favour: see the
self-view consequence in Accepted consequences above, where a memo entry cached
just before a ban lands can briefly hide the banned player from their own top-N.

### `ScoreDB` filter

Every leaderboard read gains an optional trailing `viewerId?: string`, bound into
one shared predicate:

```sql
FROM score s
LEFT JOIN player_ban b ON b.player_id = s.player_id
WHERE s.heap_id = ?1 AND (b.player_id IS NULL OR s.player_id = ?viewer)
```

`viewerId` binds as `''` when absent, which matches no player.

Applied to:

| Method | Note |
|---|---|
| `getTopScores(heapId, limit, viewerId?)` | the context board |
| `getScoresPaginated(heapId, offset, limit, viewerId?)` | the paginated browser |
| `countScores(heapId, viewerId?)` | **must** be filtered, or the total leaves a phantom row and the last page renders short |
| `getRank(heapId, score, viewerId?)` | **must** be filtered, or hidden players inflate everyone else's rank |
| `getPlayerScores(playerId)` | self-scoped; the `RANK()` window filters banned players but always retains the subject |

`pruneScores` is left alone: it retains the top 1000 by raw score, and a banned
player occupying one of those slots costs nothing.

New admin-only methods, unfiltered and ban-annotated. `countScores` with no
viewer returns the *filtered* count, so the admin table needs its own total or
its pagination would stop short of the banned rows it is meant to show:

```ts
listScoresForAdmin(heapId, offset, limit): Promise<Array<ScoreRow & { banned: boolean }>>
countAllScores(heapId): Promise<number>   // unfiltered
```

### Cache — `CachedScoreDB`

`CachedScoreDB` gains a `BanDB` constructor dependency (the memoised one), wired
in `server/src/index.ts` where `CachedScoreDB` is already constructed. It is
required, not optional — a silently-absent ban source would fail open and serve
banned players to everyone.

The cached top-N blob remains the **public** board and keeps its existing key and
TTL. `getTopScores` consults `isBanned(viewerId)`:

- viewer not banned (the overwhelming majority) → today's behaviour, unchanged
- viewer banned → bypass the cache entirely, straight through to D1 with `viewerId`

Ban and unban require **no** cache invalidation: `SCORES_TTL` is 60s, so the
public board self-corrects within a minute. Documented as a comment at the ban
route, so nobody later "fixes" it by adding a fan-out delete across every heap.

## API

All admin routes are gated by the existing `requireAdminSecret` middleware, wired
per-path in `server/src/app.ts` the same way `/feedback`, `/codes` and `/config`
already are.

| Method | Path | Gate | Purpose |
|---|---|---|---|
| `GET` | `/scores/:heapId?page&limit&playerId` | public | **changed** — new optional `playerId` becomes the viewer |
| `GET` | `/scores/:heapId/context?playerId` | public | **changed** — existing `playerId` now also feeds the filter |
| `POST` | `/scores` | player auth | unchanged; returned context respects the filter |
| `GET` | `/scores/admin/:heapId?page&limit` | admin | unfiltered page, each row carries `banned` |
| `GET` | `/bans` | admin | list every ban |
| `GET` | `/bans/:playerId` | admin | status + name + cross-heap scores |
| `PUT` | `/bans/:playerId` | admin | ban; body `{ reason?: string }`; idempotent |
| `DELETE` | `/bans/:playerId` | admin | unban; idempotent |

`banRoutes` takes `banDb`, `scoreDb` and `playerNameDb`: `GET /bans/:playerId`
composes ban status with the player's name and their cross-heap scores from
`getPlayerScores`, so one admin lookup answers "who is this and what have they
done" without a second request.

Route ordering: `/scores/admin/:heapId` must register before `/scores/:heapId`
and `/scores/:heapId/context`, the same hazard already called out in
`routes/scores.ts` for `/scores/:heapId/context`.

`playerId` on the public reads is unauthenticated, as leaderboard reads are
today. The only thing an attacker gains by guessing a banned player's id is
sight of that one player — which is what a shadow ban tolerates by design.

## Placements

`POST /heaps/:id/place` already has a legitimate no-op response for a placement
that fails to widen the silhouette (`routes/heap.ts`, the `extendsEnvelope`
branch):

```ts
return c.json({ accepted: false, version: row.version } satisfies PlaceResponse);
```

A banned player receives byte-identical output. The check goes immediately after
`enforcePlayerAuth` and before the band window read, so nothing reaches
`commitPlacement`, no ghost points are minted, and no `bonusCoins` are awarded —
exactly as for any other unaccepted placement. Because the response is one the
client already sees routinely, blocking placements here carries no tell, which a
4xx would.

## Client

One change: `ScoreClient.getLeaderboardPage(heapId, page, limit)` gains a
`playerId` argument, passed from `getEffectivePlayerId()` by
`src/scenes/LeaderboardScene.ts`. Per repo convention this is the effective id
(GPGS id if signed in, else GUID), never the bare GUID.

`ScoreScene`'s podium and showcase already read `/scores/:heapId/context`, which
sends `playerId` today, so they are covered without modification. No client code
learns anything about ban state.

## Admin UI

A new **Players** card in `admin/index.html`, built with the existing
`adminFetch` helper and the established card / table styling:

```
PLAYERS                          [heap: main v] [Refresh]

#   PLAYER ID              NAME     SCORE   STATUS
1   a3f9-…-71cd            Alice    9,800   ok      [Ban]
2   77b2-…-0e14            BadGuy   9,510   BANNED  [Unban]
3   c150-…-9a02            Carl     9,100   ok      [Ban]
                                          < prev  next >

Look up / ban by ID: [________________]  [Look up]
```

- Heap picker reuses the heap list the page already loads.
- Table is fed by `GET /scores/admin/:heapId`; banned rows stay visible, flagged.
- Row actions call `PUT` / `DELETE /bans/:playerId` then refresh the page in
  place. Ban prompts for an optional reason.
- The lookup box calls `GET /bans/:playerId` and renders status, `banned_at`,
  reason, and the player's scores across heaps — for banning someone whose id
  came from a crash log or feedback report rather than the visible page.

## Testing

Server (`server/tests/`), following the existing route/db test split:

- **Ban filtering** — banned player absent from `getTopScores`,
  `getScoresPaginated`, and the `countScores` total; present for a viewer whose
  id matches; ranks of other players close up over the hidden row.
- **Self-view** — banned viewer sees themselves at their true position and their
  original rank via both `/scores/:heapId?playerId=` and `/context?playerId=`.
- **Placement** — banned player's `/place` returns `{ accepted: false }` with the
  unchanged version and writes no band; identical response shape to the
  `extendsEnvelope` no-op.
- **Submission unaffected** — banned player's `POST /scores` still returns 200
  and still upserts.
- **Admin routes** — 401 without the secret; ban/unban idempotent; lookup returns
  status and scores; `/scores/admin/:heapId` returns banned rows with the flag.
- **Cache** — non-banned viewer served from the cached blob; banned viewer
  bypasses it.
- `MockScoreDB` and a new `MockBanDB` updated to the new signatures.

Client: `LeaderboardScene` passes the effective player id through to
`getLeaderboardPage`.

`npm run build` must pass before the work is called done.

## Rollout

1. Migration 0007 applies locally, then remotely per the `adding-d1-migrations`
   skill.
2. Worker deploys via the Cloudflare Git integration on merge to `main`.
3. Admin UI ships with the same merge.
4. Smoke test: ban a throwaway id, confirm it vanishes from another browser's
   board within 60s while its own board is unchanged, then unban.

## Out of scope

- Hiding ghost points (declined — ghosts are anonymous jitter around a
  placement, not attributable to a player in the rendered world).
- Any client-side enforcement or ban notification.
- Banning by IP, device, or GPGS account — a re-rolled GUID escapes this ban, and
  that is accepted for now.
- Bulk ban import/export, ban expiry, or a moderation audit log beyond
  `banned_at` / `reason`.

# Placement Contribution Tracking Design

**Date:** 2026-07-14
**Status:** Approved for implementation
**Branch:** `feature/place-contributions` (off `feature/place-auth`)
**PR target:** `feature/place-auth` (retarget to `main` after parent merges)
**Depends on:** `feature/place-auth` (authenticated playerGuid on /place)

## Problem

We want to know how many blocks each player has contributed to each heap —
for a future leaderboard display and GPGS achievements. Per design decision
(2026-07-14): the count ticks **server-side when an authenticated /place is
accepted**, not via a client-reported score-submit flag. This PR is
**DB-only**: no UI, no GPGS wiring, no read API consumed by the client yet.

## Design

### Storage

New table in `heap_scores` (`DB_SCORES` binding) — a **separate table**, not a
column on `score`, because an authenticated placement can happen before the
player has any score row on that heap.

Migration `server/migrations/heap_scores/0004_player_contribution.sql`
(+ mirrored in `server/schema/heap_scores.sql` — two-file rule):

```sql
CREATE TABLE IF NOT EXISTS player_contribution (
  heap_id    TEXT    NOT NULL,
  player_id  TEXT    NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL,
  PRIMARY KEY (heap_id, player_id)
);
```

### DB access

New `server/src/contributionDb.ts` following the `playerAuthDb.ts` pattern
(interface + D1 impl, **no KV cache** — increment is a low-volume write and
nothing reads it on a hot path yet):

```ts
export interface ContributionDB {
  increment(heapId: string, playerId: string, now: string): Promise<void>;
  getCount(heapId: string, playerId: string): Promise<number>; // 0 when no row
}
```

Increment is a single atomic upsert:

```sql
INSERT INTO player_contribution (heap_id, player_id, count, updated_at)
VALUES (?1, ?2, 1, ?3)
ON CONFLICT (heap_id, player_id) DO UPDATE SET count = count + 1, updated_at = ?3
```

### Tick rule (in the /place handler)

After a placement commits with `accepted: true`, tick **iff all hold**:

1. `contributionDb` is wired,
2. the request carried a `playerGuid`,
3. the request carried an `X-Player-Token` header.

Because the auth gate (previous PR) already 403'd mismatches, guid+token
surviving to the accept path means the outcome was `verified` or `claimed`.
Tokenless or guid-less legacy placements are allowed but **never tick** — a
harvested public GUID must not let an attacker inflate someone's count.

No tick on: `accepted: false` (point inside polygon), any 400/403/404, or the
409 CAS-exhaustion path.

The increment is wrapped in try/catch: a contribution write failure logs a
`warn` capture (`place:contribution-failed`) but never fails the placement
response.

### Wiring

- `heapRoutes(db, getSink, authDb?, contributionDb?)` — new optional 4th param.
- `AppOptions.contributionDb?: ContributionDB` in `app.ts`, passed through.
- `index.ts`: `new D1ContributionDB(env.DB_SCORES)`.

### Out of scope (explicitly deferred)

- Any UI (leaderboard/score screen display of counts).
- GPGS incremental achievement (needs a Play Console achievement created by a
  human first).
- Read endpoint exposing counts to the client.
- Backfill of historical placements (unattributed — impossible).

## Deployment note

Migration 0004 must be applied to remote `heap_scores` at release time (see
`adding-d1-migrations` skill). Until applied, the worker would 500 on the
increment — but the try/catch confines that to a warn log, so placements
survive even a missed migration.

## Testing

Server tests only (no client change in this PR):

- guid+token accepted placement → count 1; placing again → count 2.
- guid without token (unclaimed → legacy allow) → placement accepted, count 0.
- no guid → accepted, count 0.
- `accepted: false` (duplicate point inside polygon) → no tick.
- contributionDb not wired → placement accepted, no crash.
- increment throwing → placement still returns accepted: true.
- `getCount` on missing row → 0.
- Mock parity: `MockContributionDB` used by route tests mirrors the D1 SQL
  semantics (insert-1 / +1 upsert).

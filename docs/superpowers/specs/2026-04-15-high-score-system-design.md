# High Score System — Design Spec

**Date:** 2026-04-15  
**Status:** Approved

---

## Overview

Add a heap-scoped high score system with local persistence and a server-side leaderboard. Players are identified by a generated GUID stored in their save data, with a customisable display name defaulting to `Trashbag#XXXXX`. Local high scores are tracked per heap GUID. When a run beats the local high score, the score is submitted to the server and the score screen displays the player's rank alongside the top entries for that heap.

---

## 1. Data Model

### SaveData (localStorage)

Three new fields added to `RawSave`:

```ts
playerGuid:  string                   // crypto.randomUUID(), generated once on first load
playerName:  string                   // defaults to "Trashbag#XXXXX" (5 random digits, 00000–99999)
highScores:  Record<string, number>   // keyed by heapId, value is best score
```

Populated lazily in `load()` — existing saves without these fields get them auto-generated transparently, matching the existing pattern for `inventory` and `placed`.

**New exported functions in `SaveData.ts`:**

```ts
getPlayerGuid(): string
getPlayerName(): string
setPlayerName(name: string): void          // trims, enforces max 20 chars
getLocalHighScore(heapId: string): number  // returns 0 if no entry
setLocalHighScore(heapId: string, score: number): void
```

### D1 Schema — new `score` table

```sql
CREATE TABLE score (
  heap_id    TEXT    NOT NULL,
  player_id  TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  score      INTEGER NOT NULL,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL,
  PRIMARY KEY (heap_id, player_id)
);

CREATE INDEX idx_score_heap_score ON score (heap_id, score DESC);
```

- Composite primary key `(heap_id, player_id)` enforces 1 score per player per heap at the DB level.
- The index makes rank queries (`COUNT(*) WHERE score > ?`) fast.
- Top-1000 cap enforced in the upsert handler: after insert/update, delete rows ranked > 1000 for that heap.

---

## 2. Server API

**New route file:** `server/src/routes/scores.ts`  
**New DB interface:** `ScoreDB` (same pattern as `HeapDB` — allows `MockScoreDB` in tests)  
**Mounted at:** `/scores` in `server/src/app.ts`

### Shared types (new file: `shared/scoreTypes.ts`)

```ts
interface LeaderboardEntry {
  rank:     number
  playerId: string
  name:     string
  score:    number
}

interface LeaderboardContext {
  top:    LeaderboardEntry[]     // top N entries for this heap
  player: LeaderboardEntry | null  // requesting player's entry; null if unranked
}
```

### `POST /scores`

Submit a score. Only updates server record if the submitted score beats the player's existing best.

**Request body:**
```ts
{ heapId: string, playerId: string, playerName: string, score: number }
```

**Validation:** all fields required; `score` must be a positive integer.

**Server logic:**
1. Look up existing `(heap_id, player_id)` row.
2. If no existing row, insert. If existing row and `score > existing.score`, update score + name + updated_at.
3. After upsert, delete rows ranked > 1000 for this heap (by score DESC).
4. Query top-N entries for heap (N = `limit` query param, default 5).
5. Query player rank: `SELECT COUNT(*) + 1 WHERE heap_id = ? AND score > playerScore`.

**Response:**
```ts
{
  submitted: boolean          // true if score was a new best and was accepted
  context:   LeaderboardContext
}
```

### `GET /scores/:heapId/context?playerId=X&limit=5`

Read-only. Returns the same `LeaderboardContext` shape without writing. Used by future leaderboard screen.

### `GET /scores/:heapId?page=0&limit=50`

Paginated full leaderboard. Response:
```ts
{ entries: LeaderboardEntry[], total: number, page: number }
```

For future heap selector / full leaderboard screen.

---

## 3. Client Architecture

### New file: `src/systems/ScoreClient.ts`

```ts
class ScoreClient {
  async submitScore(params: {
    heapId:     string
    playerId:   string
    playerName: string
    score:      number
    limit?:     number
  }): Promise<LeaderboardContext | null>   // null = offline or error

  async getContext(params: {
    heapId:    string
    playerId:  string
    limit?:    number
  }): Promise<LeaderboardContext | null>
}
```

Both methods catch all network and parse errors and return `null`. The score screen treats `null` as offline.

### `ScoreScene` init changes

Two new params added:

```ts
init(data: {
  score:                number
  heapId:               string   // ← new; sourced from GameScene
  isPeak?:              boolean
  isFailure?:           boolean
  checkpointAvailable?: boolean
})
```

**Score screen flow on `create()`:**

1. Compare `score` vs `getLocalHighScore(heapId)`.
2. If new high score → call `setLocalHighScore(heapId, score)`, set `isNewHighScore = true`.
3. Show "NEW HIGH SCORE!" badge immediately if `isNewHighScore`.
4. Render all existing panels (title, score, coins, balance, checkpoint, menu prompt) immediately — no waiting.
5. If `isNewHighScore` → fire `ScoreClient.submitScore(...)` non-blocking (`.then(ctx => renderLeaderboard(ctx))`).
6. Show loading placeholder in leaderboard panel slot.
7. When promise resolves: render leaderboard panel (or hide placeholder silently if `null`).

### Configurable constant

```ts
// constants.ts
LEADERBOARD_TOP_N = 5
```

---

## 4. Score Screen UI

Layout (top → bottom), additions in **bold**:

1. Title ("HEAP SUCCESSFUL" / "HEAP FAILURE") — unchanged
2. Score display with count-up tween — unchanged
3. **"NEW HIGH SCORE!" badge** — gold, glowing, same style as title; only shown if local high score beaten
4. Coins panel — unchanged
5. **Leaderboard panel** — new async panel
6. Balance — unchanged
7. Checkpoint button / menu prompt — unchanged

### Leaderboard panel states

**Loading:**
```
Loading leaderboard...
```
Dim monospace, subtle pulse animation.

**Loaded:**
```
#1  Trashbag#6667    6800
#2  TrashKing#11234  6200
#3  GarbageLord#004  5900
#4  BinDiver#77701   5400
#5  WasteWalker#332  5100
    ·  ·  ·
#45 YourName#91234   4500   ← player row, gold tint if new high score
```

- Gap (`· · ·`) only shown if player rank > N.
- Player row always shown at the bottom of the panel.
- If player is within top-N, no gap — just highlight their row in the list.
- If `player` is `null` (unranked or offline): panel shows top-N only, no player row.

**Offline / error:** panel slot hidden entirely, no message shown.

---

## 5. Menu Scene — Name Setup

A name display element added inline to `MenuScene` — no new scene required.

**Appearance:**
```
Trashbag#91234  [edit]
```

Positioned near the bottom of the menu (exact position set during implementation).

**Behavior:**
- Tapping opens `window.prompt()` pre-filled with current name (works on mobile Capacitor).
- On confirm: trim, enforce max 20 chars, call `setPlayerName(name)`, refresh display text.
- On cancel or empty string: keep existing name unchanged.
- Name change only affects future score submissions — does not retroactively update server records.

---

## 6. Testing Strategy

### Server — `server/tests/scores.test.ts`

Uses `MockScoreDB` implementing `ScoreDB`. Covers:

- `POST /scores` — accepts new score (no existing record)
- `POST /scores` — accepts score that beats existing best; `submitted: true`
- `POST /scores` — rejects score that does not beat existing best; `submitted: false`, context still returned
- `POST /scores` — upserts name alongside score update
- `POST /scores` — enforces top-1000 cap (insert 1001, verify lowest pruned)
- `POST /scores` — returns correct `LeaderboardContext` (top-N + player rank)
- `POST /scores` — input validation: missing fields → 400, negative score → 400, non-integer score → 400
- `GET /scores/:heapId/context` — returns correct top-N + player rank
- `GET /scores/:heapId/context` — returns `player: null` for unknown playerId
- `GET /scores/:heapId?page=0&limit=50` — paginated results with correct `total`

### Client — `src/systems/__tests__/ScoreClient.test.ts`

- `submitScore` returns `null` on network failure
- `submitScore` returns `null` on non-200 response
- `getContext` returns `null` on failure

### SaveData — additions to `src/systems/__tests__/SaveData.test.ts`

- `getPlayerGuid()` generates and persists a valid UUID on first call
- `getPlayerGuid()` returns identical GUID on subsequent calls
- `getPlayerName()` defaults to `Trashbag#` + 5 digits
- `setPlayerName()` / `getPlayerName()` round-trip
- `setPlayerName()` enforces max 20 chars (truncates or rejects — pick one during implementation)
- `getLocalHighScore()` returns `0` for unknown heapId
- `setLocalHighScore()` / `getLocalHighScore()` round-trip, correctly keyed by heapId
- Multiple heapIds stored independently

---

## Open Questions / Notes

- **Name uniqueness:** No server-side uniqueness enforced on `playerName`. Two players can share the same display name — they are differentiated by `playerId` (GUID).
- **Save data loss:** If a player clears localStorage, a new GUID is generated. Their previous server scores become orphaned under the old GUID. Acceptable for now.
- **`setPlayerName` truncation vs rejection:** Spec says enforce max 20 chars — decide during implementation whether to silently truncate or reject and show a warning.
- **Score screen layout space:** Leaderboard panel adds vertical content. If layout becomes cramped, the panel can scroll or the balance/checkpoint elements can shift down.

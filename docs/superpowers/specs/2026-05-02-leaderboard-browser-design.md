# Leaderboard Browser — Design

Date: 2026-05-02
Branch: feature/ScoresBrowser

## Goal

Make per-heap high scores browseable from the heap selector. The selector
shows each player's personal record + rank inline with each heap row, and a
trophy button on each row opens a paginated modal listing every score for
that heap, with the player's row highlighted and a "jump to my score"
control.

## Non-goals

- No changes to score submission, score formula, or pruning behavior.
- No global "all heaps" leaderboard view — strictly per-heap.
- No social features (follow, message, profile pages).

## Server changes

### New endpoint

`GET /scores/player/:playerId` — returns the player's score and current rank
for every heap they have ever scored on. Heaps with no entry for the player
are omitted.

```ts
// shared/scoreTypes.ts
export interface PlayerScoreEntry {
  heapId: string;
  rank:   number;   // 1-based
  score:  number;
  name:   string;
}

export interface PlayerScoresResponse {
  entries: PlayerScoreEntry[];
}
```

Implemented in `server/src/routes/scores.ts`. Backed by a new
`ScoreDB.getPlayerScores(playerId)` method in `server/src/scoreDb.ts`.

SQL approach (D1/SQLite supports window functions):

```sql
WITH ranked AS (
  SELECT heap_id, player_id, name, score,
         RANK() OVER (PARTITION BY heap_id ORDER BY score DESC) AS rank
    FROM scores
)
SELECT heap_id, name, score, rank
  FROM ranked
 WHERE player_id = ?
```

(A correlated subquery using `COUNT(*)+1 WHERE s2.score > s.score` is an
acceptable fallback if window functions prove problematic on D1.)

### Tests (server/tests/)

- `scoreDb.test.ts`:
  - returns `[]` for unknown player
  - returns one entry per heap the player has scored on
  - rank is correct including ties (ties share the lower rank — `RANK()`
    semantics)
- `scores.routes.test.ts`:
  - `GET /scores/player/:playerId` returns 200 with `{ entries: [...] }`
  - empty player returns `{ entries: [] }`
  - URL-encoded playerId handled

## Client changes

### ScoreClient additions

`src/systems/ScoreClient.ts` gains:

```ts
static async getPlayerScores(playerId: string)
  : Promise<Map<string, PlayerScoreEntry> | null>;

static async getLeaderboardPage(heapId: string, page: number, limit: number)
  : Promise<PaginatedLeaderboardResponse | null>;
```

Both return `null` on network or HTTP error (consistent with existing
methods).

Tests in `src/systems/ScoreClient.test.ts` cover happy path and failure
returning `null`.

### HeapSelectScene row layout

On `create()`, kick off `ScoreClient.getPlayerScores(playerId)` in parallel
with the existing setup. Cache result in a local `Map<heapId,
PlayerScoreEntry>`. When the promise resolves, re-render the `YOU` stat per
row.

Per row layout changes:

- A new bottom-left stat appears immediately right of the difficulty stars,
  on the same vertical line as the stars. Format:
  - `PR: 8,420   Rank: #14`
  - `—` while loading and if no entry returned for that heap
  - Muted label color for `PR:` / `Rank:`, bright value color for the
    numbers (matches the existing right-side stat style).
- A new 🏆 trophy button on the far right edge of each row (outside the
  existing SPAWN/COIN/SCORE column), vertically centered. Tap launches the
  leaderboard modal:
  ```ts
  this.scene.launch('LeaderboardScene',
    { heapId, heapName, playerId });
  this.scene.pause();
  ```
- The trophy button stops pointer event propagation so the row's
  select-this-heap handler does not also fire.
- Existing tap-to-select on the row body is unchanged. SPAWN/COIN/SCORE
  column on the right is unchanged.

### LeaderboardScene (new)

`src/scenes/LeaderboardScene.ts`. Modal-style overlay registered alongside
existing scenes in the Phaser game config.

Init data: `{ heapId: string, heapName: string, playerId: string }`.

Layout:

- Semi-transparent black backdrop covering the full viewport, blocks input
  to the paused scene below.
- Centered panel ~90% width, ~85% height.
- Header: heap name (bold) on the left, `✕` close button on the right.
- Body: scrollable list of rows
  `#rank   NAME   ················   SCORE`
  - Player's row uses the active-highlight orange tint and bright text.
  - Other rows alternate stripe colors matching the selector's row
    striping.
  - Loading: centered "Loading…" text.
  - Error: centered "Couldn't load — tap to retry" with retry handler.
- Footer:
  - Left: `‹ Prev`  `Page X / Y`  `Next ›`. Prev disabled at page 0; Next
    disabled when `(page + 1) * limit >= total`.
  - Right: `Jump to my score` button, hidden if the player has no entry on
    this heap.

Scrolling:

- Body container clipped via a rectangle mask.
- Drag-to-scroll on touch, mouse wheel on desktop.
- Up/Down arrow keys scroll line-by-line; PageUp/PageDown jump a viewport.

Data flow:

- On `create()`:
  1. Fetch page 0 via `ScoreClient.getLeaderboardPage(heapId, 0, 50)`.
  2. Fetch player context via `ScoreClient.getContext({ heapId, playerId,
     limit: 0 })` to learn the player's rank (used by Jump button).
- On Prev/Next: fetch the adjacent page and re-render the body. Keep page
  state local.
- On Jump-to-my-score:
  1. `targetPage = floor((playerRank - 1) / 50)`
  2. If already on that page, scroll the player row into view and flash
     it. Otherwise fetch the page first, then scroll + flash.
  3. Flash = brief tween on the row's background alpha or stroke.
- On close (✕ or ESC): `this.scene.resume('HeapSelectScene')` and
  `this.scene.stop()`.

### No automated UI tests

Phaser scenes in this project are not unit tested (consistent with
`ScoreScene` and `HeapSelectScene`). Coverage comes from a manual smoke
test recorded below.

## Manual smoke test

- Selector: each row shows `PR: …  Rank: #…` after the player-scores fetch
  resolves; rows where the player has no entry show `—`.
- Trophy button opens the modal and does NOT also select the heap.
- Modal: page 1 loads with rank #1 at top; Prev disabled, Next enabled
  when more pages exist.
- Navigate Next/Prev — page indicator updates, content reloads.
- Player's row highlighted in orange when its page is on screen.
- Jump-to-my-score: scrolls (and pages, if needed) so player row is
  visible and flashes briefly.
- Player with no entry: Jump button hidden; rest of modal still works.
- ESC and ✕ both close the modal and return focus to HeapSelectScene.
- Server unreachable: selector shows `—` per row, modal shows retry text;
  retry succeeds when server returns.

## Out of scope / follow-ups

- Pagination size larger than 50 per page (server cap is `MAX_LIMIT = 50`).
- Search / filter within the leaderboard.
- Per-row player profile pop-out.

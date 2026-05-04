# Leaderboard Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make per-heap high scores browseable from the heap selector — each row shows the player's PR + rank, and a trophy button opens a paginated modal with jump-to-my-score.

**Architecture:** New server endpoint `/scores/player/:playerId` returns ranked entries for one player across all heaps in a single round trip. `HeapSelectScene` fetches that on enter and renders `PR: …  Rank: #…` per row. Trophy button launches a new overlay `LeaderboardScene` that reuses the existing paginated `/scores/:heapId` and `/scores/:heapId/context` endpoints.

**Tech Stack:** TypeScript, Phaser 3.90, Hono on Cloudflare Workers + D1, Vitest.

**Spec:** [docs/superpowers/specs/2026-05-02-leaderboard-browser-design.md](../specs/2026-05-02-leaderboard-browser-design.md)

---

## File Map

**Create:**
- `src/scenes/LeaderboardScene.ts` — overlay scene with paginated list, jump-to-me, scrolling.

**Modify:**
- `shared/scoreTypes.ts` — add `PlayerScoreEntry` and `PlayerScoresResponse`.
- `server/src/scoreDb.ts` — add `getPlayerScores(playerId)` to `ScoreDB` interface and `D1ScoreDB`.
- `server/tests/helpers/mockScoreDb.ts` — add `getPlayerScores` to `MockScoreDB`.
- `server/src/routes/scores.ts` — add `GET /player/:playerId` route.
- `server/tests/scores.test.ts` — add route tests.
- `src/systems/ScoreClient.ts` — add `getPlayerScores(playerId)` and `getLeaderboardPage(heapId, page, limit)`.
- `src/systems/__tests__/ScoreClient.test.ts` — add tests for the two new methods.
- `src/scenes/HeapSelectScene.ts` — add `PR/Rank` stat next to difficulty stars and trophy button on each row.
- `src/main.ts` — register `LeaderboardScene` in scene array.

---

## Task 1: Add shared types for player-scores response

**Files:**
- Modify: `shared/scoreTypes.ts`

- [ ] **Step 1: Add new types**

Append to `shared/scoreTypes.ts`:

```ts
export interface PlayerScoreEntry {
  heapId: string;
  rank:   number;
  score:  number;
  name:   string;
}

export interface PlayerScoresResponse {
  entries: PlayerScoreEntry[];
}
```

- [ ] **Step 2: Verify type-check passes**

Run: `npm run typecheck` (or `npx tsc --noEmit`)
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add shared/scoreTypes.ts
git commit -m "feat(shared): add PlayerScoreEntry / PlayerScoresResponse types"
```

---

## Task 2: Add `getPlayerScores` to MockScoreDB (failing test)

We extend the in-memory mock first so the route tests can use it.

**Files:**
- Modify: `server/src/scoreDb.ts`
- Modify: `server/tests/helpers/mockScoreDb.ts`
- Test: `server/tests/scoreDb.mock.test.ts` (new)

- [ ] **Step 1: Add interface method to `ScoreDB`**

Add this method to the `ScoreDB` interface in `server/src/scoreDb.ts` (just after `getScoresPaginated`):

```ts
  /**
   * Returns one entry per heap the player has scored on, ranked within that heap.
   * Rank uses RANK() semantics (ties share the lower rank). Empty array if none.
   */
  getPlayerScores(playerId: string): Promise<Array<{
    heapId: string;
    name:   string;
    score:  number;
    rank:   number;
  }>>;
```

- [ ] **Step 2: Write failing tests for the mock**

Create `server/tests/scoreDb.mock.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MockScoreDB } from './helpers/mockScoreDb';

describe('MockScoreDB.getPlayerScores', () => {
  it('returns empty array for unknown player', async () => {
    const db = new MockScoreDB();
    db.seed('heap-a', 'other', 'Other', 1000);
    const out = await db.getPlayerScores('unknown');
    expect(out).toEqual([]);
  });

  it('returns one entry per heap the player has scored on, with correct rank', async () => {
    const db = new MockScoreDB();
    // heap-a: player ranks #2 of 3
    db.seed('heap-a', 'top', 'Top', 9000);
    db.seed('heap-a', 'me',  'Me',  5000);
    db.seed('heap-a', 'low', 'Low', 1000);
    // heap-b: player ranks #1 of 1
    db.seed('heap-b', 'me', 'Me', 7000);
    // heap-c: player not present
    db.seed('heap-c', 'other', 'Other', 100);

    const out = await db.getPlayerScores('me');
    const sorted = out.sort((a, b) => a.heapId.localeCompare(b.heapId));
    expect(sorted).toEqual([
      { heapId: 'heap-a', name: 'Me', score: 5000, rank: 2 },
      { heapId: 'heap-b', name: 'Me', score: 7000, rank: 1 },
    ]);
  });

  it('uses RANK() semantics on ties (tied scores share the lower rank)', async () => {
    const db = new MockScoreDB();
    db.seed('heap-a', 'a', 'A', 5000);
    db.seed('heap-a', 'b', 'B', 5000);
    db.seed('heap-a', 'c', 'C', 4000);

    const a = (await db.getPlayerScores('a'))[0];
    const b = (await db.getPlayerScores('b'))[0];
    const c = (await db.getPlayerScores('c'))[0];
    expect(a.rank).toBe(1);
    expect(b.rank).toBe(1);
    expect(c.rank).toBe(3);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run from `server/`: `npx vitest run tests/scoreDb.mock.test.ts`
Expected: FAIL — `getPlayerScores is not a function` (or similar) because `MockScoreDB` does not yet implement it.

- [ ] **Step 4: Implement `getPlayerScores` on `MockScoreDB`**

Add to `server/tests/helpers/mockScoreDb.ts` (before the `seed` helper):

```ts
  async getPlayerScores(playerId: string): Promise<Array<{
    heapId: string; name: string; score: number; rank: number;
  }>> {
    const all = Array.from(this.rows.values());
    const playerRows = all.filter(r => r.player_id === playerId);
    return playerRows.map(r => {
      const rank = all.filter(o =>
        o.heap_id === r.heap_id && o.score > r.score
      ).length + 1;
      return { heapId: r.heap_id, name: r.name, score: r.score, rank };
    });
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run from `server/`: `npx vitest run tests/scoreDb.mock.test.ts`
Expected: PASS — all 3 tests green.

- [ ] **Step 6: Commit**

```bash
git add server/src/scoreDb.ts server/tests/helpers/mockScoreDb.ts server/tests/scoreDb.mock.test.ts
git commit -m "feat(server): add MockScoreDB.getPlayerScores with RANK() semantics"
```

---

## Task 3: Implement `getPlayerScores` on D1ScoreDB

**Files:**
- Modify: `server/src/scoreDb.ts`

- [ ] **Step 1: Add the D1 implementation**

In `server/src/scoreDb.ts`, append to the `D1ScoreDB` class (after `getScoresPaginated`, before the closing brace):

```ts
  async getPlayerScores(playerId: string): Promise<Array<{
    heapId: string; name: string; score: number; rank: number;
  }>> {
    const result = await this.d1
      .prepare(`
        WITH ranked AS (
          SELECT heap_id, player_id, name, score,
                 RANK() OVER (PARTITION BY heap_id ORDER BY score DESC) AS rank
            FROM score
        )
        SELECT heap_id AS heapId, name, score, rank
          FROM ranked
         WHERE player_id = ?1
      `)
      .bind(playerId)
      .all<{ heapId: string; name: string; score: number; rank: number }>();
    return result.results;
  }
```

Note: the table is named `score` (singular), per the existing queries in this file.

- [ ] **Step 2: Verify type-check passes**

Run from `server/`: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run all server tests to confirm nothing broke**

Run from `server/`: `npx vitest run`
Expected: all existing tests still PASS.

- [ ] **Step 4: Commit**

```bash
git add server/src/scoreDb.ts
git commit -m "feat(server): implement D1ScoreDB.getPlayerScores with RANK() window"
```

---

## Task 4: Add `GET /scores/player/:playerId` route (TDD)

**Files:**
- Modify: `server/tests/scores.test.ts`
- Modify: `server/src/routes/scores.ts`

- [ ] **Step 1: Write failing route tests**

Append to `server/tests/scores.test.ts` (after the existing describes):

```ts
// ── GET /scores/player/:playerId ──────────────────────────────────────────────

import type { PlayerScoresResponse } from '../../shared/scoreTypes';

describe('GET /scores/player/:playerId', () => {
  it('returns empty entries for player with no scores', async () => {
    const res  = await makeApp().request('/scores/player/nobody');
    expect(res.status).toBe(200);
    const body = await res.json() as PlayerScoresResponse;
    expect(body.entries).toEqual([]);
  });

  it('returns ranked entries across multiple heaps for a known player', async () => {
    const db = new MockScoreDB();
    db.seed('heap-a', 'top',     'Top',  9000);
    db.seed('heap-a', PLAYER_A,  'Me',   5000);
    db.seed('heap-b', PLAYER_A,  'Me',   7000);
    const res  = await makeApp(db).request(`/scores/player/${PLAYER_A}`);
    expect(res.status).toBe(200);
    const body = await res.json() as PlayerScoresResponse;
    const sorted = body.entries.sort((a, b) => a.heapId.localeCompare(b.heapId));
    expect(sorted).toEqual([
      { heapId: 'heap-a', name: 'Me', score: 5000, rank: 2 },
      { heapId: 'heap-b', name: 'Me', score: 7000, rank: 1 },
    ]);
  });

  it('handles URL-encoded playerId', async () => {
    const db   = new MockScoreDB();
    const id   = 'has space/slash';
    db.seed('heap-a', id, 'Me', 5000);
    const res  = await makeApp(db).request(`/scores/player/${encodeURIComponent(id)}`);
    expect(res.status).toBe(200);
    const body = await res.json() as PlayerScoresResponse;
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].heapId).toBe('heap-a');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `server/`: `npx vitest run tests/scores.test.ts -t "GET /scores/player"`
Expected: FAIL — 404 status (route not registered yet).

- [ ] **Step 3: Add the route**

In `server/src/routes/scores.ts`, add a new route **above** the `app.get('/:heapId/context'...)` handler (route order matters in Hono — the more specific path must be registered first):

```ts
  // GET /scores/player/:playerId — all of a player's scores across heaps with rank
  app.get('/player/:playerId', async (c) => {
    const playerId = c.req.param('playerId');
    const rows     = await db.getPlayerScores(playerId);
    const entries  = rows.map(r => ({
      heapId: r.heapId,
      rank:   r.rank,
      score:  r.score,
      name:   r.name,
    }));
    return c.json({ entries } satisfies PlayerScoresResponse);
  });
```

Also extend the import at the top of the file:

```ts
import type {
  SubmitScoreRequest,
  SubmitScoreResponse,
  LeaderboardEntry,
  LeaderboardContext,
  PaginatedLeaderboardResponse,
  PlayerScoresResponse,
} from '../../../shared/scoreTypes';
```

- [ ] **Step 4: Run tests to verify they pass**

Run from `server/`: `npx vitest run tests/scores.test.ts`
Expected: all green, including the three new route tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/scores.ts server/tests/scores.test.ts
git commit -m "feat(server): add GET /scores/player/:playerId endpoint"
```

---

## Task 5: Add `ScoreClient.getPlayerScores` (TDD)

**Files:**
- Modify: `src/systems/ScoreClient.ts`
- Modify: `src/systems/__tests__/ScoreClient.test.ts`

- [ ] **Step 1: Write failing test**

Append to `src/systems/__tests__/ScoreClient.test.ts`:

```ts
// ── getPlayerScores ───────────────────────────────────────────────────────────

import type { PlayerScoresResponse } from '../../../shared/scoreTypes';

describe('ScoreClient.getPlayerScores', () => {
  const MOCK_RESPONSE: PlayerScoresResponse = {
    entries: [
      { heapId: 'heap-a', rank: 2, score: 5000, name: 'Me' },
      { heapId: 'heap-b', rank: 1, score: 7000, name: 'Me' },
    ],
  };

  it('returns a Map keyed by heapId on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => MOCK_RESPONSE,
    }));
    const result = await ScoreClient.getPlayerScores('me');
    expect(result).not.toBeNull();
    expect(result!.size).toBe(2);
    expect(result!.get('heap-a')?.rank).toBe(2);
    expect(result!.get('heap-b')?.score).toBe(7000);
  });

  it('returns null on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')));
    const result = await ScoreClient.getPlayerScores('me');
    expect(result).toBeNull();
  });

  it('returns null on non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 500 }));
    const result = await ScoreClient.getPlayerScores('me');
    expect(result).toBeNull();
  });

  it('URL-encodes the playerId', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => ({ entries: [] } as PlayerScoresResponse),
    });
    vi.stubGlobal('fetch', fetchMock);
    await ScoreClient.getPlayerScores('has space/slash');
    const calledUrl = (fetchMock.mock.calls[0] as [string])[0];
    expect(calledUrl).toContain('/scores/player/has%20space%2Fslash');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run from repo root: `npx vitest run src/systems/__tests__/ScoreClient.test.ts -t "getPlayerScores"`
Expected: FAIL — `getPlayerScores is not a function`.

- [ ] **Step 3: Implement the method**

Append to `src/systems/ScoreClient.ts` (inside the `ScoreClient` class, before the closing brace):

```ts
  /**
   * Fetch all of a player's high scores across heaps, ranked.
   * Returns a Map keyed by heapId, or null on failure.
   */
  static async getPlayerScores(playerId: string)
    : Promise<Map<string, PlayerScoreEntry> | null>
  {
    try {
      const url = `${SERVER_URL}/scores/player/${encodeURIComponent(playerId)}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = (await res.json()) as PlayerScoresResponse;
      return new Map(data.entries.map(e => [e.heapId, e]));
    } catch {
      return null;
    }
  }
```

Update the import at the top of the file:

```ts
import type {
  LeaderboardContext,
  SubmitScoreResponse,
  PlayerScoreEntry,
  PlayerScoresResponse,
} from '../../shared/scoreTypes';
```

- [ ] **Step 4: Run tests to verify they pass**

Run from repo root: `npx vitest run src/systems/__tests__/ScoreClient.test.ts`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/systems/ScoreClient.ts src/systems/__tests__/ScoreClient.test.ts
git commit -m "feat(client): add ScoreClient.getPlayerScores returning Map<heapId, entry>"
```

---

## Task 6: Add `ScoreClient.getLeaderboardPage` (TDD)

**Files:**
- Modify: `src/systems/ScoreClient.ts`
- Modify: `src/systems/__tests__/ScoreClient.test.ts`

- [ ] **Step 1: Write failing test**

Append to `src/systems/__tests__/ScoreClient.test.ts`:

```ts
// ── getLeaderboardPage ────────────────────────────────────────────────────────

import type { PaginatedLeaderboardResponse } from '../../../shared/scoreTypes';

describe('ScoreClient.getLeaderboardPage', () => {
  const PAGE: PaginatedLeaderboardResponse = {
    entries: [{ rank: 1, playerId: 'p1', name: 'Alpha', score: 9000 }],
    total:   1,
    page:    0,
  };

  it('returns the page payload on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => PAGE,
    }));
    const result = await ScoreClient.getLeaderboardPage('heap-1', 0, 50);
    expect(result).toEqual(PAGE);
  });

  it('passes page and limit query params', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => PAGE,
    });
    vi.stubGlobal('fetch', fetchMock);
    await ScoreClient.getLeaderboardPage('heap-1', 3, 25);
    const url = (fetchMock.mock.calls[0] as [string])[0];
    expect(url).toContain('page=3');
    expect(url).toContain('limit=25');
  });

  it('returns null on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')));
    const result = await ScoreClient.getLeaderboardPage('heap-1', 0, 50);
    expect(result).toBeNull();
  });

  it('returns null on non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 500 }));
    const result = await ScoreClient.getLeaderboardPage('heap-1', 0, 50);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run from repo root: `npx vitest run src/systems/__tests__/ScoreClient.test.ts -t "getLeaderboardPage"`
Expected: FAIL — `getLeaderboardPage is not a function`.

- [ ] **Step 3: Implement the method**

Append to `src/systems/ScoreClient.ts` (inside the class):

```ts
  /**
   * Fetch one page of the per-heap leaderboard. Returns null on failure.
   */
  static async getLeaderboardPage(heapId: string, page: number, limit: number)
    : Promise<PaginatedLeaderboardResponse | null>
  {
    try {
      const url = `${SERVER_URL}/scores/${encodeURIComponent(heapId)}?page=${page}&limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      return (await res.json()) as PaginatedLeaderboardResponse;
    } catch {
      return null;
    }
  }
```

Update the import to include `PaginatedLeaderboardResponse`:

```ts
import type {
  LeaderboardContext,
  SubmitScoreResponse,
  PlayerScoreEntry,
  PlayerScoresResponse,
  PaginatedLeaderboardResponse,
} from '../../shared/scoreTypes';
```

- [ ] **Step 4: Run tests to verify they pass**

Run from repo root: `npx vitest run src/systems/__tests__/ScoreClient.test.ts`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/systems/ScoreClient.ts src/systems/__tests__/ScoreClient.test.ts
git commit -m "feat(client): add ScoreClient.getLeaderboardPage"
```

---

## Task 7: Add PR/Rank stat next to difficulty stars in HeapSelectScene

**Files:**
- Modify: `src/scenes/HeapSelectScene.ts`

This task only adds the YOU stat (no trophy button yet). The trophy button comes in Task 9 after `LeaderboardScene` exists.

- [ ] **Step 1: Add fields and import**

At the top of `src/scenes/HeapSelectScene.ts`, add:

```ts
import { ScoreClient } from '../systems/ScoreClient';
import { getPlayerGuid } from '../systems/SaveData';
import type { PlayerScoreEntry } from '../../shared/scoreTypes';
```

(If `getPlayerGuid` is not already exported from `SaveData.ts`, search for the function name in `src/scenes/ScoreScene.ts` — it is used there with the same import. Mirror that import.)

Add these private fields to the `HeapSelectScene` class (next to the existing `private` declarations near the top):

```ts
  private playerScores: Map<string, PlayerScoreEntry> = new Map();
  private youTextByRow: Map<number, Phaser.GameObjects.Text> = new Map();
```

- [ ] **Step 2: Render placeholder YOU text in `drawRow`**

In `drawRow`, immediately after the `drawDifficulty(...)` call, add:

```ts
    // YOU stat — renders to the right of the difficulty stars on the same line
    const starsRightX = lx + 20 * 5 + 8;  // 5 stars * 20px + small gap; matches DifficultyStars sizing
    const youText = this.add.text(starsRightX, y + 58,
      'PR: —   Rank: —',
      {
        fontSize: '13px', color: '#7799bb',
        stroke: '#000000', strokeThickness: 2,
      },
    ).setOrigin(0, 0.5);
    this.youTextByRow.set(rowIndex, youText);
```

- [ ] **Step 3: Kick off the player-scores fetch in `create()`**

At the end of `create()` (after `this.refreshHighlight();`), add:

```ts
    void this.fetchPlayerScores();
```

Then add a new private method to the class:

```ts
  private async fetchPlayerScores(): Promise<void> {
    const playerId = getPlayerGuid();
    const map = await ScoreClient.getPlayerScores(playerId);
    if (!map) return;  // network failure — leave placeholders
    this.playerScores = map;
    this.refreshYouStats();
  }

  private refreshYouStats(): void {
    this.sorted.forEach((heap, i) => {
      const txt = this.youTextByRow.get(i);
      if (!txt) return;
      const entry = this.playerScores.get(heap.id);
      if (!entry) {
        txt.setText('PR: —   Rank: —');
        return;
      }
      txt.setText(`PR: ${entry.score.toLocaleString()}   Rank: #${entry.rank}`);
      txt.setColor('#ffcc88');
    });
  }
```

- [ ] **Step 4: Verify type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (If `getPlayerGuid` is not exported, fix the import path now.)

- [ ] **Step 5: Manual smoke test**

```bash
npm run dev
```

Open `http://localhost:3000`, navigate to the heap selector. Verify:
- Each row shows `PR: —   Rank: —` to the right of the stars while loading.
- Once the fetch resolves, rows where the player has scored show `PR: <number>   Rank: #<n>` in orange.
- Heaps with no entry continue to show the dash placeholder.

Stop the dev server (Ctrl-C) before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/scenes/HeapSelectScene.ts
git commit -m "feat(selector): show player PR + rank per heap row"
```

---

## Task 8: Create LeaderboardScene skeleton

**Files:**
- Create: `src/scenes/LeaderboardScene.ts`
- Modify: `src/main.ts`

This task creates a launchable, closable scene that shows just the panel + header + close button. Data and pagination come in Task 10.

- [ ] **Step 1: Create the scene file**

Create `src/scenes/LeaderboardScene.ts`:

```ts
import Phaser from 'phaser';
import { ScoreClient } from '../systems/ScoreClient';
import type { LeaderboardEntry, PaginatedLeaderboardResponse } from '../../shared/scoreTypes';

const PAGE_LIMIT = 50;

export interface LeaderboardSceneData {
  heapId:   string;
  heapName: string;
  playerId: string;
}

export class LeaderboardScene extends Phaser.Scene {
  private heapId!:   string;
  private heapName!: string;
  private playerId!: string;

  constructor() { super({ key: 'LeaderboardScene' }); }

  init(data: LeaderboardSceneData): void {
    this.heapId   = data.heapId;
    this.heapName = data.heapName;
    this.playerId = data.playerId;
  }

  create(): void {
    const W = this.scale.width;
    const H = this.scale.height;

    // Backdrop — blocks input to scene below
    this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.7)
      .setInteractive();

    // Panel
    const panelW = Math.floor(W * 0.92);
    const panelH = Math.floor(H * 0.86);
    const panelX = Math.floor((W - panelW) / 2);
    const panelY = Math.floor((H - panelH) / 2);
    this.add.rectangle(W / 2, H / 2, panelW, panelH, 0x10131f)
      .setStrokeStyle(2, 0x334466);

    // Header
    this.add.text(panelX + 16, panelY + 20, this.heapName, {
      fontSize: '18px', fontStyle: 'bold', color: '#ffcc88',
      stroke: '#000000', strokeThickness: 3,
    });

    const close = this.add.text(panelX + panelW - 20, panelY + 20, '✕', {
      fontSize: '20px', color: '#667799',
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    close.on('pointerover', () => close.setColor('#ffffff'));
    close.on('pointerout',  () => close.setColor('#667799'));
    close.on('pointerup',   () => this.closeModal());

    // Header underline
    this.add.rectangle(W / 2, panelY + 56, panelW - 32, 1, 0x334466);

    // Placeholder body — replaced in Task 10
    this.add.text(W / 2, H / 2, 'Loading…', {
      fontSize: '16px', color: '#8899aa',
    }).setOrigin(0.5);

    this.input.keyboard?.on('keydown-ESC', () => this.closeModal());
  }

  private closeModal(): void {
    this.scene.resume('HeapSelectScene');
    this.scene.stop();
  }
}
```

- [ ] **Step 2: Register the scene**

In `src/main.ts`, add the import and append to the scene array:

```ts
import { LeaderboardScene } from './scenes/LeaderboardScene';
```

Then update the existing scene array (line 34) to include `LeaderboardScene` at the end:

```ts
scene: [BootScene, MenuScene, HeapSelectScene, GameScene, ScoreScene, UpgradeScene, StoreScene, InfiniteGameScene, TexturePreviewScene, LeaderboardScene],
```

- [ ] **Step 3: Verify type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (`PAGE_LIMIT`, `ScoreClient`, `LeaderboardEntry`, `PaginatedLeaderboardResponse` are imported but unused for now — that's OK because they're used in Task 10. If your tsconfig flags unused imports as errors, temporarily remove them and reintroduce in Task 10.)

If the imports are flagged: remove the `ScoreClient`, `LeaderboardEntry`, `PaginatedLeaderboardResponse`, and `PAGE_LIMIT` lines for now.

- [ ] **Step 4: Commit**

```bash
git add src/scenes/LeaderboardScene.ts src/main.ts
git commit -m "feat(leaderboard): scaffold LeaderboardScene with panel + close button"
```

---

## Task 9: Add trophy button on HeapSelectScene rows that launches the modal

**Files:**
- Modify: `src/scenes/HeapSelectScene.ts`

- [ ] **Step 1: Import `getPlayerGuid` if not already**

Confirm `getPlayerGuid` is imported (from Task 7). If not, add:

```ts
import { getPlayerGuid } from '../systems/SaveData';
```

- [ ] **Step 2: Add trophy button in `drawRow`**

In `drawRow`, after the existing right-side stat block (after the `SCORE` row), add:

```ts
    // Trophy button — opens leaderboard modal
    const trophyX = this.scale.width - ROW_PAD_X - 4;
    const trophy  = this.add.text(trophyX, midY, '🏆', {
      fontSize: '20px',
    }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });
    trophy.on('pointerover', () => trophy.setAlpha(0.7));
    trophy.on('pointerout',  () => trophy.setAlpha(1));
    trophy.on('pointerup', (pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      this.openLeaderboard(heap);
    });
```

Note: `pointer` and the unused params are present so the `event` parameter is correctly typed.

- [ ] **Step 3: Add `openLeaderboard` method**

Add to the `HeapSelectScene` class:

```ts
  private openLeaderboard(heap: HeapSummary): void {
    this.scene.launch('LeaderboardScene', {
      heapId:   heap.id,
      heapName: heap.params.name,
      playerId: getPlayerGuid(),
    });
    this.scene.pause();
  }
```

- [ ] **Step 4: Shift the SPAWN/COIN/SCORE column left to make room for the trophy**

Find the line in `drawRow`:

```ts
const rx = this.scale.width - ROW_PAD_X - 14;
```

Change it to leave room for the trophy:

```ts
const rx = this.scale.width - ROW_PAD_X - 36;  // shifted left ~22px to leave room for trophy
```

- [ ] **Step 5: Manual smoke test**

```bash
npm run dev
```

Verify:
- Each row has a 🏆 on the far right.
- Tapping the trophy opens the (placeholder) `LeaderboardScene` overlay showing the heap name and a Loading… text. Selector underneath is paused (does not respond to clicks).
- Tapping ✕ or pressing ESC closes the modal and returns to the selector.
- Tapping the trophy does NOT also select the heap (you remain on the selector after closing the modal — the active heap badge has not changed).
- Tapping the row body (not the trophy) still selects the heap as before.

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/scenes/HeapSelectScene.ts
git commit -m "feat(selector): trophy button on each row launches LeaderboardScene"
```

---

## Task 10: LeaderboardScene — list, pagination, jump-to-me

**Files:**
- Modify: `src/scenes/LeaderboardScene.ts`

- [ ] **Step 1: Replace placeholder body with full implementation**

Replace the entire contents of `src/scenes/LeaderboardScene.ts` with:

```ts
import Phaser from 'phaser';
import { ScoreClient } from '../systems/ScoreClient';
import type { LeaderboardEntry } from '../../shared/scoreTypes';

const PAGE_LIMIT = 50;
const ROW_H      = 28;

export interface LeaderboardSceneData {
  heapId:   string;
  heapName: string;
  playerId: string;
}

export class LeaderboardScene extends Phaser.Scene {
  private heapId!:   string;
  private heapName!: string;
  private playerId!: string;

  private page:        number = 0;
  private total:       number = 0;
  private playerRank:  number | null = null;

  private bodyContainer!: Phaser.GameObjects.Container;
  private statusText!:    Phaser.GameObjects.Text;
  private pageLabel!:     Phaser.GameObjects.Text;
  private prevBtn!:       Phaser.GameObjects.Text;
  private nextBtn!:       Phaser.GameObjects.Text;
  private jumpBtn!:       Phaser.GameObjects.Text;

  private bodyTop:    number = 0;
  private bodyBottom: number = 0;
  private bodyLeft:   number = 0;
  private bodyWidth:  number = 0;
  private scrollY:    number = 0;
  private contentH:   number = 0;

  constructor() { super({ key: 'LeaderboardScene' }); }

  init(data: LeaderboardSceneData): void {
    this.heapId   = data.heapId;
    this.heapName = data.heapName;
    this.playerId = data.playerId;
    this.page     = 0;
    this.total    = 0;
    this.playerRank = null;
    this.scrollY  = 0;
  }

  create(): void {
    const W = this.scale.width;
    const H = this.scale.height;

    // Backdrop — blocks input to scene below
    this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.7).setInteractive();

    // Panel
    const panelW = Math.floor(W * 0.92);
    const panelH = Math.floor(H * 0.86);
    const panelX = Math.floor((W - panelW) / 2);
    const panelY = Math.floor((H - panelH) / 2);
    this.add.rectangle(W / 2, H / 2, panelW, panelH, 0x10131f)
      .setStrokeStyle(2, 0x334466);

    // Header
    this.add.text(panelX + 16, panelY + 20, this.heapName, {
      fontSize: '18px', fontStyle: 'bold', color: '#ffcc88',
      stroke: '#000000', strokeThickness: 3,
    });
    const close = this.add.text(panelX + panelW - 20, panelY + 20, '✕', {
      fontSize: '20px', color: '#667799',
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    close.on('pointerover', () => close.setColor('#ffffff'));
    close.on('pointerout',  () => close.setColor('#667799'));
    close.on('pointerup',   () => this.closeModal());
    this.add.rectangle(W / 2, panelY + 56, panelW - 32, 1, 0x334466);

    // Body region geometry
    const FOOTER_H  = 50;
    this.bodyTop    = panelY + 70;
    this.bodyBottom = panelY + panelH - FOOTER_H;
    this.bodyLeft   = panelX + 16;
    this.bodyWidth  = panelW - 32;

    // Body container (clipped via mask)
    this.bodyContainer = this.add.container(0, 0);
    const maskShape = this.make.graphics({ x: 0, y: 0 });
    maskShape.fillStyle(0xffffff);
    maskShape.fillRect(this.bodyLeft, this.bodyTop, this.bodyWidth, this.bodyBottom - this.bodyTop);
    this.bodyContainer.setMask(maskShape.createGeometryMask());

    this.statusText = this.add.text(W / 2, (this.bodyTop + this.bodyBottom) / 2, 'Loading…', {
      fontSize: '16px', color: '#8899aa',
    }).setOrigin(0.5);

    // Footer
    const footerY = panelY + panelH - 24;
    this.prevBtn = this.add.text(panelX + 16, footerY, '‹ Prev', {
      fontSize: '14px', color: '#7799bb',
    }).setInteractive({ useHandCursor: true });
    this.prevBtn.on('pointerup', () => this.gotoPage(this.page - 1));

    this.pageLabel = this.add.text(panelX + 100, footerY, '', {
      fontSize: '13px', color: '#8899aa',
    });

    this.nextBtn = this.add.text(panelX + 200, footerY, 'Next ›', {
      fontSize: '14px', color: '#7799bb',
    }).setInteractive({ useHandCursor: true });
    this.nextBtn.on('pointerup', () => this.gotoPage(this.page + 1));

    this.jumpBtn = this.add.text(panelX + panelW - 16, footerY, 'Jump to my score', {
      fontSize: '14px', color: '#ffcc88',
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    this.jumpBtn.on('pointerup', () => this.jumpToPlayer());
    this.jumpBtn.setVisible(false);  // hidden until we know playerRank

    this.input.keyboard?.on('keydown-ESC', () => this.closeModal());

    // Wheel scroll for desktop
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _x: number, deltaY: number) => {
      this.scrollBy(deltaY);
    });

    // Drag scroll for touch
    let dragStartY = 0;
    let dragStartScroll = 0;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.y < this.bodyTop || p.y > this.bodyBottom) return;
      dragStartY = p.y;
      dragStartScroll = this.scrollY;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.isDown) return;
      if (p.y < this.bodyTop || p.y > this.bodyBottom) return;
      this.scrollY = dragStartScroll - (p.y - dragStartY);
      this.clampScroll();
      this.bodyContainer.y = -this.scrollY;
    });

    void this.loadInitial();
  }

  private async loadInitial(): Promise<void> {
    const [page0, ctx] = await Promise.all([
      ScoreClient.getLeaderboardPage(this.heapId, 0, PAGE_LIMIT),
      ScoreClient.getContext({ heapId: this.heapId, playerId: this.playerId, limit: 0 }),
    ]);
    if (!page0) {
      this.showError();
      return;
    }
    this.playerRank = ctx?.player?.rank ?? null;
    this.jumpBtn.setVisible(this.playerRank !== null);
    this.renderPage(page0.entries, page0.total, page0.page);
  }

  private async gotoPage(page: number): Promise<void> {
    if (page < 0) return;
    if (this.total > 0 && page * PAGE_LIMIT >= this.total) return;
    this.statusText.setText('Loading…').setVisible(true);
    this.bodyContainer.removeAll(true);
    const data = await ScoreClient.getLeaderboardPage(this.heapId, page, PAGE_LIMIT);
    if (!data) {
      this.showError();
      return;
    }
    this.renderPage(data.entries, data.total, data.page);
  }

  private renderPage(entries: LeaderboardEntry[], total: number, page: number): void {
    this.statusText.setVisible(false);
    this.bodyContainer.removeAll(true);
    this.scrollY = 0;
    this.bodyContainer.y = 0;
    this.page  = page;
    this.total = total;

    entries.forEach((entry, i) => {
      const rowY    = this.bodyTop + i * ROW_H + ROW_H / 2;
      const isMe    = entry.playerId === this.playerId;
      const stripe  = isMe ? 0x3a2a14 : (i % 2 === 0 ? 0x141629 : 0x0f1020);
      const stroke  = isMe ? 0xff9922 : 0x1e2a44;

      const bg = this.add.rectangle(
        this.bodyLeft + this.bodyWidth / 2, rowY,
        this.bodyWidth, ROW_H - 2,
        stripe,
      ).setStrokeStyle(isMe ? 2 : 1, stroke);
      this.bodyContainer.add(bg);

      const rankColor = isMe ? '#ffcc88' : '#7799bb';
      const nameColor = isMe ? '#ffffff' : '#ccddee';

      const rankText = this.add.text(this.bodyLeft + 12, rowY,
        `#${entry.rank}`, { fontSize: '13px', color: rankColor },
      ).setOrigin(0, 0.5);
      const nameText = this.add.text(this.bodyLeft + 70, rowY,
        entry.name, { fontSize: '13px', color: nameColor },
      ).setOrigin(0, 0.5);
      const scoreText = this.add.text(this.bodyLeft + this.bodyWidth - 12, rowY,
        entry.score.toLocaleString(), {
          fontSize: '13px', fontStyle: 'bold',
          color: isMe ? '#ffcc88' : '#88ddff',
        },
      ).setOrigin(1, 0.5);
      this.bodyContainer.add([rankText, nameText, scoreText]);
    });

    this.contentH = entries.length * ROW_H;
    this.updateFooter();
  }

  private updateFooter(): void {
    const totalPages = Math.max(1, Math.ceil(this.total / PAGE_LIMIT));
    this.pageLabel.setText(`Page ${this.page + 1} / ${totalPages}`);
    this.prevBtn.setColor(this.page === 0 ? '#445566' : '#7799bb');
    const atEnd = (this.page + 1) >= totalPages;
    this.nextBtn.setColor(atEnd ? '#445566' : '#7799bb');
  }

  private async jumpToPlayer(): Promise<void> {
    if (this.playerRank === null) return;
    const targetPage = Math.floor((this.playerRank - 1) / PAGE_LIMIT);
    if (targetPage !== this.page) {
      await this.gotoPage(targetPage);
    }
    // Scroll the player's row into view
    const indexOnPage = (this.playerRank - 1) - targetPage * PAGE_LIMIT;
    const rowCenterY  = this.bodyTop + indexOnPage * ROW_H + ROW_H / 2;
    const viewportH   = this.bodyBottom - this.bodyTop;
    const desiredScroll = Math.max(0, Math.min(
      this.contentH - viewportH,
      rowCenterY - this.bodyTop - viewportH / 2,
    ));
    this.scrollY = desiredScroll;
    this.bodyContainer.y = -this.scrollY;
    this.flashPlayerRow(indexOnPage);
  }

  private flashPlayerRow(indexOnPage: number): void {
    // Locate the rectangle for that row (first child of the trio per index).
    // Each row contributed 1 rect + 3 texts = 4 children. Rect is at index*4.
    const child = this.bodyContainer.list[indexOnPage * 4];
    if (!(child instanceof Phaser.GameObjects.Rectangle)) return;
    this.tweens.add({
      targets:  child,
      alpha:    { from: 1, to: 0.3 },
      duration: 180,
      yoyo:     true,
      repeat:   2,
    });
  }

  private scrollBy(deltaY: number): void {
    this.scrollY += deltaY;
    this.clampScroll();
    this.bodyContainer.y = -this.scrollY;
  }

  private clampScroll(): void {
    const viewportH = this.bodyBottom - this.bodyTop;
    const max = Math.max(0, this.contentH - viewportH);
    if (this.scrollY < 0)   this.scrollY = 0;
    if (this.scrollY > max) this.scrollY = max;
  }

  private showError(): void {
    this.statusText
      .setText('Couldn’t load — tap to retry')
      .setColor('#ff7777')
      .setVisible(true)
      .setInteractive({ useHandCursor: true })
      .once('pointerup', () => {
        this.statusText.disableInteractive().setColor('#8899aa');
        void this.loadInitial();
      });
  }

  private closeModal(): void {
    this.scene.resume('HeapSelectScene');
    this.scene.stop();
  }
}
```

- [ ] **Step 2: Verify type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual smoke test — happy path**

```bash
npm run dev
```

For a heap with multiple scores submitted:
- Open the trophy modal. Page 1 loads with `#1` at the top.
- Player's row (if any) is highlighted in orange and `Jump to my score` is visible.
- `Prev` is greyed; `Next` is active when `total > 50`.
- Click `Next` → page advances, content reloads, page label updates.
- Click `Jump to my score` → if player is on a different page, it loads that page; player row is centered in view and flashes briefly.

For a player with no score on this heap:
- `Jump to my score` button is hidden.

Stop the dev server.

- [ ] **Step 4: Manual smoke test — error path**

Stop the local server (`server/`), then in the running game open the modal. Verify it shows "Couldn't load — tap to retry". Restart the server, tap retry — content loads.

- [ ] **Step 5: Run all tests**

```bash
npm run test
```

Expected: all client tests pass.

```bash
cd server && npx vitest run
```

Expected: all server tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/scenes/LeaderboardScene.ts
git commit -m "feat(leaderboard): paginated list with player highlight + jump-to-me"
```

---

## Task 11: Final verification

**Files:** none

- [ ] **Step 1: Run the entire test suite**

```bash
npm run test
cd server && npx vitest run && cd ..
```

Expected: all green.

- [ ] **Step 2: Type-check both projects**

```bash
npx tsc --noEmit
cd server && npx tsc --noEmit && cd ..
```

Expected: no errors.

- [ ] **Step 3: Walk through the full smoke-test checklist from the spec**

From `docs/superpowers/specs/2026-05-02-leaderboard-browser-design.md` § "Manual smoke test":

- Selector shows `PR: …  Rank: #…` after fetch resolves; `—` for heaps without entry.
- Trophy opens modal without selecting heap.
- Modal page 1 loads, Prev disabled, Next enabled when more pages exist.
- Player row highlighted in orange; Jump scrolls (and pages) and flashes.
- No-score player: Jump hidden.
- ESC and ✕ close.
- Server unreachable: rows show `—`, modal shows retry.

- [ ] **Step 4: Confirm no uncommitted changes**

```bash
git status
```

Expected: clean working tree.

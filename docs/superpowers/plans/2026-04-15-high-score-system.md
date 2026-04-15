# High Score System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-heap local and server high scores, a player identity (GUID + display name), and a leaderboard panel on the score screen.

**Architecture:** A new `shared/scoreTypes.ts` defines all score-related types. A new `server/src/scoreDb.ts` + `server/src/routes/scores.ts` adds the `/scores` API. A new `src/systems/ScoreClient.ts` handles client-side score submission and leaderboard fetching. `SaveData.ts` gains `playerGuid`, `playerName`, and `highScores` fields. `ScoreScene` gains an async leaderboard panel; `MenuScene` gains an inline name editor.

**Tech Stack:** Hono + Cloudflare D1 (server), Phaser 3 + localStorage (client), Vitest (tests both sides).

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `shared/scoreTypes.ts` | All score-related TS types shared between client and server |
| Create | `server/src/scoreDb.ts` | `ScoreDB` interface + `D1ScoreDB` implementation |
| Create | `server/src/routes/scores.ts` | Hono handlers for POST/GET `/scores` endpoints |
| Create | `server/tests/helpers/mockScoreDb.ts` | In-memory `ScoreDB` for tests |
| Create | `server/tests/scores.test.ts` | Integration tests for all score endpoints |
| Create | `src/systems/ScoreClient.ts` | Client wrapper for score API (null on failure) |
| Create | `src/systems/__tests__/ScoreClient.test.ts` | Unit tests for ScoreClient |
| Modify | `server/schema.sql` | Add `score` table DDL |
| Modify | `server/src/app.ts` | Accept `ScoreDB` param; mount `/scores` route |
| Modify | `server/src/index.ts` | Instantiate `D1ScoreDB` and pass to `createApp` |
| Modify | `server/tests/routes.test.ts` | Update `makeApp()` to pass `MockScoreDB` |
| Modify | `src/systems/SaveData.ts` | Add `playerGuid`, `playerName`, `highScores` |
| Modify | `src/systems/__tests__/SaveData.test.ts` | Tests for new SaveData functions |
| Modify | `src/constants.ts` | Add `LEADERBOARD_TOP_N = 5` |
| Modify | `src/scenes/ScoreScene.ts` | Add `heapId`, high score badge, leaderboard panel |
| Modify | `src/scenes/GameScene.ts` | Pass `heapId` in all three `ScoreScene` launches |
| Modify | `src/scenes/MenuScene.ts` | Add player name display + `window.prompt` edit |

---

## Task 1: Shared score types

**Files:**
- Create: `shared/scoreTypes.ts`

- [ ] **Step 1: Create the types file**

```typescript
// shared/scoreTypes.ts

export interface LeaderboardEntry {
  rank:     number;
  playerId: string;
  name:     string;
  score:    number;
}

export interface LeaderboardContext {
  top:    LeaderboardEntry[];
  player: LeaderboardEntry | null;
}

export interface SubmitScoreRequest {
  heapId:     string;
  playerId:   string;
  playerName: string;
  score:      number;
}

export interface SubmitScoreResponse {
  submitted: boolean;
  context:   LeaderboardContext;
}

export interface PaginatedLeaderboardResponse {
  entries: LeaderboardEntry[];
  total:   number;
  page:    number;
}
```

- [ ] **Step 2: Commit**

```bash
git add shared/scoreTypes.ts
git commit -m "feat: add shared score types (LeaderboardEntry, LeaderboardContext, score API shapes)"
```

---

## Task 2: SaveData — player identity and high scores

**Files:**
- Modify: `src/systems/SaveData.ts`
- Modify: `src/systems/__tests__/SaveData.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/systems/__tests__/SaveData.test.ts` (after the existing `save migration` describe block):

```typescript
// ── Player identity ───────────────────────────────────────────────────────────

describe('getPlayerGuid', () => {
  it('generates a UUID on first call', () => {
    const guid = getPlayerGuid();
    expect(typeof guid).toBe('string');
    expect(guid.length).toBeGreaterThan(0);
  });

  it('returns the same GUID on subsequent calls', () => {
    const first  = getPlayerGuid();
    const second = getPlayerGuid();
    expect(first).toBe(second);
  });

  it('generates a new GUID after resetAllData', () => {
    const before = getPlayerGuid();
    resetAllData();
    const after = getPlayerGuid();
    // Both are valid GUIDs; they may or may not differ (RNG), but both must be non-empty
    expect(typeof after).toBe('string');
    expect(after.length).toBeGreaterThan(0);
    // Statistically certain to differ; document the intent
    expect(before).not.toBe(after);
  });
});

describe('getPlayerName / setPlayerName', () => {
  it('defaults to Trashbag#XXXXX format', () => {
    const name = getPlayerName();
    expect(name).toMatch(/^Trashbag#\d{5}$/);
  });

  it('setPlayerName persists across calls', () => {
    setPlayerName('GarbageLord');
    expect(getPlayerName()).toBe('GarbageLord');
  });

  it('setPlayerName trims whitespace', () => {
    setPlayerName('  SpaceyTrash  ');
    expect(getPlayerName()).toBe('SpaceyTrash');
  });

  it('setPlayerName enforces max 20 chars (truncates)', () => {
    setPlayerName('A'.repeat(25));
    expect(getPlayerName().length).toBeLessThanOrEqual(20);
  });

  it('setPlayerName with empty string after trim keeps existing name', () => {
    setPlayerName('KeepMe');
    setPlayerName('   ');
    expect(getPlayerName()).toBe('KeepMe');
  });
});

// ── High scores ───────────────────────────────────────────────────────────────

describe('getLocalHighScore / setLocalHighScore', () => {
  it('returns 0 for unknown heapId', () => {
    expect(getLocalHighScore('unknown-heap')).toBe(0);
  });

  it('setLocalHighScore persists and getLocalHighScore retrieves', () => {
    setLocalHighScore('heap-aaa', 4200);
    expect(getLocalHighScore('heap-aaa')).toBe(4200);
  });

  it('each heapId is stored independently', () => {
    setLocalHighScore('heap-aaa', 4200);
    setLocalHighScore('heap-bbb', 8800);
    expect(getLocalHighScore('heap-aaa')).toBe(4200);
    expect(getLocalHighScore('heap-bbb')).toBe(8800);
  });

  it('overwriting a heapId score stores the new value', () => {
    setLocalHighScore('heap-aaa', 4200);
    setLocalHighScore('heap-aaa', 9999);
    expect(getLocalHighScore('heap-aaa')).toBe(9999);
  });
});

describe('save migration — missing playerGuid/playerName/highScores', () => {
  it('generates playerGuid when field is absent in stored save', () => {
    store['heap_save'] = JSON.stringify({ balance: 100, upgrades: {} });
    expect(typeof getPlayerGuid()).toBe('string');
    expect(getPlayerGuid().length).toBeGreaterThan(0);
  });

  it('defaults playerName to Trashbag#XXXXX when field is absent', () => {
    store['heap_save'] = JSON.stringify({ balance: 100, upgrades: {} });
    expect(getPlayerName()).toMatch(/^Trashbag#\d{5}$/);
  });

  it('defaults highScores to {} when field is absent', () => {
    store['heap_save'] = JSON.stringify({ balance: 100, upgrades: {} });
    expect(getLocalHighScore('any-heap')).toBe(0);
  });
});
```

Also add the new imports to the top of the test file's import list:

```typescript
import {
  getPlayerConfig,
  resetAllData,
  getItemQuantity,
  addItem,
  spendItem,
  getPlaced,
  addPlaced,
  removePlaced,
  updatePlacedMeta,
  removeExpiredPlaced,
  purchaseItem,
  getBalance,
  addBalance,
  getPlayerGuid,
  getPlayerName,
  setPlayerName,
  getLocalHighScore,
  setLocalHighScore,
} from '../SaveData';
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/systems/__tests__/SaveData.test.ts
```

Expected: multiple failures — `getPlayerGuid is not a function`, etc.

- [ ] **Step 3: Update `src/systems/SaveData.ts`**

Update `RawSave` interface to add new fields:

```typescript
interface RawSave {
  balance:    number;
  upgrades:   Record<string, number>;
  inventory:  Record<string, number>;
  placed:     PlacedItemSave[];
  playerGuid: string;
  playerName: string;
  highScores: Record<string, number>;
}
```

Update `DEFAULT` to include placeholder values (overridden during load):

```typescript
const DEFAULT: RawSave = {
  balance:    0,
  upgrades:   {},
  inventory:  {},
  placed:     [],
  playerGuid: '',
  playerName: '',
  highScores: {},
};
```

Add a helper function above `load()`:

```typescript
function generateDefaultName(): string {
  const n = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
  return `Trashbag#${n}`;
}
```

Update `load()` — replace the `result` construction block:

```typescript
const result: RawSave = {
  ...DEFAULT,
  ...parsed,
  inventory:  parsed.inventory  ?? {},
  placed:     parsed.placed     ?? [],
  highScores: parsed.highScores ?? {},
  playerGuid: parsed.playerGuid ?? crypto.randomUUID(),
  playerName: parsed.playerName ?? generateDefaultName(),
};
```

Update the `fresh` fallback at the bottom of `load()`:

```typescript
const fresh: RawSave = {
  ...DEFAULT,
  upgrades:   {},
  inventory:  {},
  placed:     [],
  highScores: {},
  playerGuid: crypto.randomUUID(),
  playerName: generateDefaultName(),
};
```

Add the new exported functions at the end of `SaveData.ts` (after `resetAllData`):

```typescript
// ── Player identity ───────────────────────────────────────────────────────────

export function getPlayerGuid(): string {
  return load().playerGuid;
}

export function getPlayerName(): string {
  return load().playerName;
}

export function setPlayerName(name: string): void {
  const trimmed = name.trim().slice(0, 20);
  if (!trimmed) return;
  const data = load();
  data.playerName = trimmed;
  persist(data);
}

// ── High scores ───────────────────────────────────────────────────────────────

export function getLocalHighScore(heapId: string): number {
  return load().highScores[heapId] ?? 0;
}

export function setLocalHighScore(heapId: string, score: number): void {
  const data = load();
  data.highScores[heapId] = score;
  persist(data);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/systems/__tests__/SaveData.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/systems/SaveData.ts src/systems/__tests__/SaveData.test.ts
git commit -m "feat: add player identity (playerGuid, playerName) and per-heap high scores to SaveData"
```

---

## Task 3: D1 schema + ScoreDB interface

**Files:**
- Modify: `server/schema.sql`
- Create: `server/src/scoreDb.ts`

- [ ] **Step 1: Add score table to schema.sql**

Append to `server/schema.sql`:

```sql

-- High scores — one row per (heap, player), enforced by PRIMARY KEY
CREATE TABLE IF NOT EXISTS score (
  heap_id    TEXT    NOT NULL,
  player_id  TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  score      INTEGER NOT NULL,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL,
  PRIMARY KEY (heap_id, player_id)
);

-- Fast rank queries: COUNT(*) WHERE heap_id=? AND score > ?
CREATE INDEX IF NOT EXISTS idx_score_heap_score ON score (heap_id, score DESC);
```

- [ ] **Step 2: Create `server/src/scoreDb.ts`**

```typescript
// server/src/scoreDb.ts

export interface ScoreRow {
  heap_id:    string;
  player_id:  string;
  name:       string;
  score:      number;
  created_at: string;
  updated_at: string;
}

/**
 * Abstraction over D1 for score operations.
 * Allows MockScoreDB in tests.
 */
export interface ScoreDB {
  /** Returns the existing score row for this player+heap, or null. */
  getScore(heapId: string, playerId: string): Promise<ScoreRow | null>;

  /**
   * Insert or update score only if newScore > existing score.
   * Also updates name (player may have renamed).
   * Returns true if the row was inserted or updated, false if existing score was >= newScore.
   */
  upsertScore(heapId: string, playerId: string, name: string, score: number, now: string): Promise<boolean>;

  /** Returns top `limit` entries for a heap, ordered by score DESC. */
  getTopScores(heapId: string, limit: number): Promise<ScoreRow[]>;

  /**
   * Returns the 1-indexed rank of `score` in `heapId`.
   * Rank = (number of rows with score strictly higher) + 1.
   */
  getRank(heapId: string, score: number): Promise<number>;

  /** Returns total number of score rows for a heap. */
  countScores(heapId: string): Promise<number>;

  /**
   * Deletes rows for heapId ranked beyond the top 1000 (by score DESC).
   * No-op if fewer than 1000 rows exist.
   */
  pruneScores(heapId: string): Promise<void>;

  /** Returns paginated entries for a heap, ordered by score DESC. */
  getScoresPaginated(heapId: string, offset: number, limit: number): Promise<ScoreRow[]>;
}

/** Production implementation backed by Cloudflare D1. */
export class D1ScoreDB implements ScoreDB {
  constructor(private d1: D1Database) {}

  async getScore(heapId: string, playerId: string): Promise<ScoreRow | null> {
    const row = await this.d1
      .prepare('SELECT * FROM score WHERE heap_id=?1 AND player_id=?2')
      .bind(heapId, playerId)
      .first<ScoreRow>();
    return row ?? null;
  }

  async upsertScore(heapId: string, playerId: string, name: string, score: number, now: string): Promise<boolean> {
    const existing = await this.getScore(heapId, playerId);
    if (existing && score <= existing.score) return false;

    if (existing) {
      await this.d1
        .prepare('UPDATE score SET name=?1, score=?2, updated_at=?3 WHERE heap_id=?4 AND player_id=?5')
        .bind(name, score, now, heapId, playerId)
        .run();
    } else {
      await this.d1
        .prepare('INSERT INTO score (heap_id, player_id, name, score, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6)')
        .bind(heapId, playerId, name, score, now, now)
        .run();
    }
    return true;
  }

  async getTopScores(heapId: string, limit: number): Promise<ScoreRow[]> {
    const result = await this.d1
      .prepare('SELECT * FROM score WHERE heap_id=?1 ORDER BY score DESC LIMIT ?2')
      .bind(heapId, limit)
      .all<ScoreRow>();
    return result.results;
  }

  async getRank(heapId: string, score: number): Promise<number> {
    const result = await this.d1
      .prepare('SELECT COUNT(*) as cnt FROM score WHERE heap_id=?1 AND score>?2')
      .bind(heapId, score)
      .first<{ cnt: number }>();
    return (result?.cnt ?? 0) + 1;
  }

  async countScores(heapId: string): Promise<number> {
    const result = await this.d1
      .prepare('SELECT COUNT(*) as cnt FROM score WHERE heap_id=?1')
      .bind(heapId)
      .first<{ cnt: number }>();
    return result?.cnt ?? 0;
  }

  async pruneScores(heapId: string): Promise<void> {
    // Delete all rows for this heap except the top 1000 by score.
    // The subquery selects player_ids of the top 1000; rows not in that set are deleted.
    await this.d1
      .prepare(`
        DELETE FROM score
        WHERE heap_id=?1
          AND player_id NOT IN (
            SELECT player_id FROM score
            WHERE heap_id=?2
            ORDER BY score DESC
            LIMIT 1000
          )
      `)
      .bind(heapId, heapId)
      .run();
  }

  async getScoresPaginated(heapId: string, offset: number, limit: number): Promise<ScoreRow[]> {
    const result = await this.d1
      .prepare('SELECT * FROM score WHERE heap_id=?1 ORDER BY score DESC LIMIT ?2 OFFSET ?3')
      .bind(heapId, limit, offset)
      .all<ScoreRow>();
    return result.results;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add server/schema.sql server/src/scoreDb.ts
git commit -m "feat: add score table schema and ScoreDB interface with D1ScoreDB implementation"
```

---

## Task 4: MockScoreDB

**Files:**
- Create: `server/tests/helpers/mockScoreDb.ts`

- [ ] **Step 1: Create the mock**

```typescript
// server/tests/helpers/mockScoreDb.ts

import type { ScoreDB, ScoreRow } from '../../src/scoreDb';

/**
 * In-memory ScoreDB for use in tests. No D1 or Workers runtime needed.
 */
export class MockScoreDB implements ScoreDB {
  // key: `${heapId}::${playerId}`
  private rows = new Map<string, ScoreRow>();

  private key(heapId: string, playerId: string): string {
    return `${heapId}::${playerId}`;
  }

  async getScore(heapId: string, playerId: string): Promise<ScoreRow | null> {
    return this.rows.get(this.key(heapId, playerId)) ?? null;
  }

  async upsertScore(heapId: string, playerId: string, name: string, score: number, now: string): Promise<boolean> {
    const existing = await this.getScore(heapId, playerId);
    if (existing && score <= existing.score) return false;

    this.rows.set(this.key(heapId, playerId), {
      heap_id:    heapId,
      player_id:  playerId,
      name,
      score,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    });
    return true;
  }

  async getTopScores(heapId: string, limit: number): Promise<ScoreRow[]> {
    return Array.from(this.rows.values())
      .filter(r => r.heap_id === heapId)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async getRank(heapId: string, score: number): Promise<number> {
    const above = Array.from(this.rows.values())
      .filter(r => r.heap_id === heapId && r.score > score)
      .length;
    return above + 1;
  }

  async countScores(heapId: string): Promise<number> {
    return Array.from(this.rows.values()).filter(r => r.heap_id === heapId).length;
  }

  async pruneScores(heapId: string): Promise<void> {
    const sorted = Array.from(this.rows.values())
      .filter(r => r.heap_id === heapId)
      .sort((a, b) => b.score - a.score);
    const toDelete = sorted.slice(1000);
    for (const row of toDelete) {
      this.rows.delete(this.key(row.heap_id, row.player_id));
    }
  }

  async getScoresPaginated(heapId: string, offset: number, limit: number): Promise<ScoreRow[]> {
    return Array.from(this.rows.values())
      .filter(r => r.heap_id === heapId)
      .sort((a, b) => b.score - a.score)
      .slice(offset, offset + limit);
  }

  /** Test helper — seed a score row directly. */
  seed(heapId: string, playerId: string, name: string, score: number): void {
    this.rows.set(this.key(heapId, playerId), {
      heap_id:    heapId,
      player_id:  playerId,
      name,
      score,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/tests/helpers/mockScoreDb.ts
git commit -m "test: add MockScoreDB in-memory implementation for score route tests"
```

---

## Task 5: Server scores route + tests

**Files:**
- Create: `server/tests/scores.test.ts`
- Create: `server/src/routes/scores.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/tests/scores.test.ts`:

```typescript
// server/tests/scores.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';
import { MockScoreDB } from './helpers/mockScoreDb';
import type { SubmitScoreResponse, PaginatedLeaderboardResponse } from '../../shared/scoreTypes';

const HEAP_ID   = 'heap-test-001';
const PLAYER_A  = 'player-aaa';
const PLAYER_B  = 'player-bbb';

function makeApp(scoreDb = new MockScoreDB()) {
  return createApp(new MockHeapDB(), scoreDb);
}

async function submitScore(app: ReturnType<typeof makeApp>, body: object, limit?: number) {
  const url = limit ? `/scores?limit=${limit}` : '/scores';
  return app.request(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
}

// ── POST /scores ──────────────────────────────────────────────────────────────

describe('POST /scores — submission', () => {
  it('accepts a new score and returns submitted: true', async () => {
    const res = await submitScore(makeApp(), {
      heapId: HEAP_ID, playerId: PLAYER_A, playerName: 'Trashbag#00001', score: 5000,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as SubmitScoreResponse;
    expect(body.submitted).toBe(true);
  });

  it('returns submitted: false when score does not beat existing best', async () => {
    const db  = new MockScoreDB();
    db.seed(HEAP_ID, PLAYER_A, 'Trashbag#00001', 5000);
    const res = await submitScore(makeApp(db), {
      heapId: HEAP_ID, playerId: PLAYER_A, playerName: 'Trashbag#00001', score: 3000,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as SubmitScoreResponse;
    expect(body.submitted).toBe(false);
  });

  it('updates the record when new score beats existing', async () => {
    const db  = new MockScoreDB();
    db.seed(HEAP_ID, PLAYER_A, 'Trashbag#00001', 3000);
    const res = await submitScore(makeApp(db), {
      heapId: HEAP_ID, playerId: PLAYER_A, playerName: 'Trashbag#00001', score: 7000,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as SubmitScoreResponse;
    expect(body.submitted).toBe(true);
    expect(body.context.player?.score).toBe(7000);
  });

  it('updates player name alongside score', async () => {
    const db = new MockScoreDB();
    db.seed(HEAP_ID, PLAYER_A, 'OldName#11111', 3000);
    await submitScore(makeApp(db), {
      heapId: HEAP_ID, playerId: PLAYER_A, playerName: 'NewName#22222', score: 7000,
    });
    const row = await db.getScore(HEAP_ID, PLAYER_A);
    expect(row?.name).toBe('NewName#22222');
  });
});

describe('POST /scores — leaderboard context in response', () => {
  it('returns top entries in rank order', async () => {
    const db = new MockScoreDB();
    db.seed(HEAP_ID, 'p1', 'Alpha', 9000);
    db.seed(HEAP_ID, 'p2', 'Beta',  7000);
    db.seed(HEAP_ID, 'p3', 'Gamma', 5000);

    const res  = await submitScore(makeApp(db), {
      heapId: HEAP_ID, playerId: 'p4', playerName: 'Delta', score: 3000,
    }, 3);
    const body = await res.json() as SubmitScoreResponse;

    expect(body.context.top).toHaveLength(3);
    expect(body.context.top[0].rank).toBe(1);
    expect(body.context.top[0].score).toBe(9000);
    expect(body.context.top[1].rank).toBe(2);
    expect(body.context.top[2].rank).toBe(3);
  });

  it('returns the submitting player in context.player', async () => {
    const res  = await submitScore(makeApp(), {
      heapId: HEAP_ID, playerId: PLAYER_A, playerName: 'Trashbag#00001', score: 5000,
    });
    const body = await res.json() as SubmitScoreResponse;
    expect(body.context.player?.playerId).toBe(PLAYER_A);
    expect(body.context.player?.score).toBe(5000);
    expect(body.context.player?.rank).toBe(1);
  });

  it('returns context.player even when submitted: false', async () => {
    const db = new MockScoreDB();
    db.seed(HEAP_ID, PLAYER_A, 'Trashbag#00001', 5000);
    const res  = await submitScore(makeApp(db), {
      heapId: HEAP_ID, playerId: PLAYER_A, playerName: 'Trashbag#00001', score: 1000,
    });
    const body = await res.json() as SubmitScoreResponse;
    expect(body.submitted).toBe(false);
    expect(body.context.player?.score).toBe(5000); // existing best
  });

  it('includes player at correct rank when not in top N', async () => {
    const db = new MockScoreDB();
    for (let i = 1; i <= 5; i++) {
      db.seed(HEAP_ID, `p${i}`, `Player${i}`, i * 1000);
    }
    const res  = await submitScore(makeApp(db), {
      heapId: HEAP_ID, playerId: 'late', playerName: 'LateEntry', score: 500,
    }, 3);
    const body = await res.json() as SubmitScoreResponse;
    expect(body.context.top).toHaveLength(3);
    expect(body.context.player?.rank).toBe(6);
  });
});

describe('POST /scores — top-1000 cap', () => {
  it('enforces the 1000-entry cap after insert', async () => {
    const db = new MockScoreDB();
    // Seed 1000 players
    for (let i = 0; i < 1000; i++) {
      db.seed(HEAP_ID, `player-${i}`, `P${i}`, (i + 1) * 10);
    }
    // New player with a very low score (rank 1001)
    await submitScore(makeApp(db), {
      heapId: HEAP_ID, playerId: 'loser', playerName: 'Loser', score: 1,
    });
    const total = await db.countScores(HEAP_ID);
    expect(total).toBeLessThanOrEqual(1000);
  });
});

describe('POST /scores — validation', () => {
  it('returns 400 when heapId is missing', async () => {
    const res = await submitScore(makeApp(), { playerId: PLAYER_A, playerName: 'X', score: 100 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when playerId is missing', async () => {
    const res = await submitScore(makeApp(), { heapId: HEAP_ID, playerName: 'X', score: 100 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when playerName is missing', async () => {
    const res = await submitScore(makeApp(), { heapId: HEAP_ID, playerId: PLAYER_A, score: 100 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when score is missing', async () => {
    const res = await submitScore(makeApp(), { heapId: HEAP_ID, playerId: PLAYER_A, playerName: 'X' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when score is not a positive integer', async () => {
    const res = await submitScore(makeApp(), { heapId: HEAP_ID, playerId: PLAYER_A, playerName: 'X', score: -1 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when score is zero', async () => {
    const res = await submitScore(makeApp(), { heapId: HEAP_ID, playerId: PLAYER_A, playerName: 'X', score: 0 });
    expect(res.status).toBe(400);
  });
});

// ── GET /scores/:heapId/context ───────────────────────────────────────────────

describe('GET /scores/:heapId/context', () => {
  it('returns top N entries + player context', async () => {
    const db = new MockScoreDB();
    db.seed(HEAP_ID, PLAYER_A, 'Alpha', 9000);
    db.seed(HEAP_ID, PLAYER_B, 'Beta',  7000);

    const res  = await makeApp(db).request(
      `/scores/${HEAP_ID}/context?playerId=${PLAYER_A}&limit=5`,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { top: unknown[]; player: unknown };
    expect(body.top).toHaveLength(2);
    expect(body.player).not.toBeNull();
  });

  it('returns player: null for unknown playerId', async () => {
    const db = new MockScoreDB();
    db.seed(HEAP_ID, PLAYER_A, 'Alpha', 9000);

    const res  = await makeApp(db).request(
      `/scores/${HEAP_ID}/context?playerId=nobody&limit=5`,
    );
    const body = await res.json() as { player: null };
    expect(body.player).toBeNull();
  });

  it('returns empty top array for heap with no scores', async () => {
    const res  = await makeApp().request(
      `/scores/empty-heap/context?playerId=${PLAYER_A}&limit=5`,
    );
    const body = await res.json() as { top: unknown[]; player: null };
    expect(body.top).toHaveLength(0);
    expect(body.player).toBeNull();
  });
});

// ── GET /scores/:heapId (paginated) ──────────────────────────────────────────

describe('GET /scores/:heapId paginated', () => {
  it('returns paginated entries and total', async () => {
    const db = new MockScoreDB();
    for (let i = 0; i < 10; i++) {
      db.seed(HEAP_ID, `p${i}`, `Player${i}`, (10 - i) * 100);
    }
    const res  = await makeApp(db).request(`/scores/${HEAP_ID}?page=0&limit=3`);
    expect(res.status).toBe(200);
    const body = await res.json() as PaginatedLeaderboardResponse;
    expect(body.entries).toHaveLength(3);
    expect(body.total).toBe(10);
    expect(body.page).toBe(0);
    expect(body.entries[0].rank).toBe(1);
  });

  it('second page returns next set of entries', async () => {
    const db = new MockScoreDB();
    for (let i = 0; i < 6; i++) {
      db.seed(HEAP_ID, `p${i}`, `Player${i}`, (6 - i) * 100);
    }
    const res  = await makeApp(db).request(`/scores/${HEAP_ID}?page=1&limit=3`);
    const body = await res.json() as PaginatedLeaderboardResponse;
    expect(body.entries).toHaveLength(3);
    expect(body.entries[0].rank).toBe(4);
    expect(body.page).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && npx vitest run tests/scores.test.ts
```

Expected: all fail — `createApp` signature mismatch (not yet updated), `/scores` routes don't exist.

- [ ] **Step 3: Create `server/src/routes/scores.ts`**

```typescript
// server/src/routes/scores.ts

import { Hono } from 'hono';
import type { ScoreDB } from '../scoreDb';
import type {
  SubmitScoreRequest,
  SubmitScoreResponse,
  LeaderboardEntry,
  LeaderboardContext,
  PaginatedLeaderboardResponse,
} from '../../../shared/scoreTypes';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT     = 50;

async function buildContext(
  db:       ScoreDB,
  heapId:   string,
  playerId: string,
  limit:    number,
): Promise<LeaderboardContext> {
  const topRows = await db.getTopScores(heapId, limit);
  const top: LeaderboardEntry[] = topRows.map((row, i) => ({
    rank:     i + 1,
    playerId: row.player_id,
    name:     row.name,
    score:    row.score,
  }));

  const playerRow = await db.getScore(heapId, playerId);
  if (!playerRow) return { top, player: null };

  const rank: number = await db.getRank(heapId, playerRow.score);
  const player: LeaderboardEntry = {
    rank,
    playerId: playerRow.player_id,
    name:     playerRow.name,
    score:    playerRow.score,
  };
  return { top, player };
}

export function scoreRoutes(db: ScoreDB): Hono {
  const app = new Hono();

  // POST /scores — submit score; returns LeaderboardContext in response
  app.post('/', async (c) => {
    let body: SubmitScoreRequest;
    try {
      body = await c.req.json<SubmitScoreRequest>();
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    const { heapId, playerId, playerName, score } = body;

    if (!heapId || typeof heapId !== 'string')       return c.json({ error: 'heapId is required' }, 400);
    if (!playerId || typeof playerId !== 'string')   return c.json({ error: 'playerId is required' }, 400);
    if (!playerName || typeof playerName !== 'string') return c.json({ error: 'playerName is required' }, 400);
    if (!Number.isInteger(score) || score <= 0)      return c.json({ error: 'score must be a positive integer' }, 400);

    const limit = Math.min(
      parseInt(c.req.query('limit') ?? String(DEFAULT_LIMIT)) || DEFAULT_LIMIT,
      MAX_LIMIT,
    );

    const now       = new Date().toISOString();
    const submitted = await db.upsertScore(heapId, playerId, playerName, score, now);
    if (submitted) await db.pruneScores(heapId);

    const context = await buildContext(db, heapId, playerId, limit);
    return c.json({ submitted, context } satisfies SubmitScoreResponse);
  });

  // GET /scores/:heapId/context — read-only context (future leaderboard screen)
  // NOTE: must be registered before /:heapId to prevent "context" matching as heapId
  app.get('/:heapId/context', async (c) => {
    const heapId   = c.req.param('heapId');
    const playerId = c.req.query('playerId') ?? '';
    const limit    = Math.min(
      parseInt(c.req.query('limit') ?? String(DEFAULT_LIMIT)) || DEFAULT_LIMIT,
      MAX_LIMIT,
    );
    const context = await buildContext(db, heapId, playerId, limit);
    return c.json(context);
  });

  // GET /scores/:heapId — paginated full leaderboard
  app.get('/:heapId', async (c) => {
    const heapId = c.req.param('heapId');
    const page   = parseInt(c.req.query('page') ?? '0') || 0;
    const limit  = Math.min(
      parseInt(c.req.query('limit') ?? '50') || 50,
      MAX_LIMIT,
    );
    const offset = page * limit;

    const [rows, total] = await Promise.all([
      db.getScoresPaginated(heapId, offset, limit),
      db.countScores(heapId),
    ]);

    const entries: LeaderboardEntry[] = rows.map((row, i) => ({
      rank:     offset + i + 1,
      playerId: row.player_id,
      name:     row.name,
      score:    row.score,
    }));

    return c.json({ entries, total, page } satisfies PaginatedLeaderboardResponse);
  });

  return app;
}
```

- [ ] **Step 4: Run tests again — still expect failures (app.ts not updated yet)**

```bash
cd server && npx vitest run tests/scores.test.ts
```

Expected: tests fail because `createApp` does not yet accept `ScoreDB` and `/scores` is not mounted.

---

## Task 6: Wire scores into app.ts, index.ts, and update existing test

**Files:**
- Modify: `server/src/app.ts`
- Modify: `server/src/index.ts`
- Modify: `server/tests/routes.test.ts`

- [ ] **Step 1: Update `server/src/app.ts`**

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { HeapDB } from './db';
import type { ScoreDB } from './scoreDb';
import { heapRoutes } from './routes/heap';
import { scoreRoutes } from './routes/scores';

export function createApp(heapDb: HeapDB, scoreDb: ScoreDB): Hono {
  const app = new Hono();
  app.use('*', cors());
  app.route('/heaps',  heapRoutes(heapDb));
  app.route('/scores', scoreRoutes(scoreDb));
  return app;
}
```

- [ ] **Step 2: Update `server/src/index.ts`**

```typescript
import { createApp } from './app';
import { D1HeapDB } from './db';
import { D1ScoreDB } from './scoreDb';

export interface Env {
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const app = createApp(new D1HeapDB(env.DB), new D1ScoreDB(env.DB));
    return app.fetch(request);
  },
};
```

- [ ] **Step 3: Update `server/tests/routes.test.ts` — fix makeApp()**

Find the `makeApp` function in `server/tests/routes.test.ts` (line 22) and update it:

```typescript
import { MockScoreDB } from './helpers/mockScoreDb';

// ...existing imports...

function makeApp() {
  return createApp(new MockHeapDB(), new MockScoreDB());
}
```

- [ ] **Step 4: Run all server tests**

```bash
cd server && npx vitest run
```

Expected: all tests pass — heap routes tests still green, scores tests now pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/app.ts server/src/index.ts server/src/routes/scores.ts \
        server/tests/routes.test.ts server/tests/scores.test.ts \
        server/tests/helpers/mockScoreDb.ts
git commit -m "feat: add /scores API (submit, context, paginated leaderboard) with full test coverage"
```

---

## Task 7: ScoreClient

**Files:**
- Create: `src/systems/__tests__/ScoreClient.test.ts`
- Create: `src/systems/ScoreClient.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/systems/__tests__/ScoreClient.test.ts`:

```typescript
// src/systems/__tests__/ScoreClient.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SubmitScoreResponse, LeaderboardContext } from '../../../shared/scoreTypes';

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem:    () => null,
    setItem:    () => {},
    removeItem: () => {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

const { ScoreClient } = await import('../ScoreClient');

const MOCK_CONTEXT: LeaderboardContext = {
  top:    [{ rank: 1, playerId: 'p1', name: 'Alpha', score: 5000 }],
  player: { rank: 1, playerId: 'p1', name: 'Alpha', score: 5000 },
};

// ── submitScore ───────────────────────────────────────────────────────────────

describe('ScoreClient.submitScore', () => {
  it('returns LeaderboardContext on success', async () => {
    const mockResponse: SubmitScoreResponse = { submitted: true, context: MOCK_CONTEXT };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => mockResponse,
    }));
    const result = await ScoreClient.submitScore({
      heapId: 'heap-1', playerId: 'p1', playerName: 'Alpha', score: 5000,
    });
    expect(result).toEqual(MOCK_CONTEXT);
  });

  it('returns null on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('Network error')));
    const result = await ScoreClient.submitScore({
      heapId: 'heap-1', playerId: 'p1', playerName: 'Alpha', score: 5000,
    });
    expect(result).toBeNull();
  });

  it('returns null on non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 500 }));
    const result = await ScoreClient.submitScore({
      heapId: 'heap-1', playerId: 'p1', playerName: 'Alpha', score: 5000,
    });
    expect(result).toBeNull();
  });

  it('returns null on malformed JSON response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => { throw new SyntaxError('bad json'); },
    }));
    const result = await ScoreClient.submitScore({
      heapId: 'heap-1', playerId: 'p1', playerName: 'Alpha', score: 5000,
    });
    expect(result).toBeNull();
  });

  it('passes limit query param when provided', async () => {
    const mockResponse: SubmitScoreResponse = { submitted: true, context: MOCK_CONTEXT };
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => mockResponse,
    });
    vi.stubGlobal('fetch', fetchMock);
    await ScoreClient.submitScore({
      heapId: 'heap-1', playerId: 'p1', playerName: 'Alpha', score: 5000, limit: 10,
    });
    const calledUrl = (fetchMock.mock.calls[0] as [string])[0];
    expect(calledUrl).toContain('limit=10');
  });
});

// ── getContext ────────────────────────────────────────────────────────────────

describe('ScoreClient.getContext', () => {
  it('returns LeaderboardContext on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => MOCK_CONTEXT,
    }));
    const result = await ScoreClient.getContext({ heapId: 'heap-1', playerId: 'p1' });
    expect(result).toEqual(MOCK_CONTEXT);
  });

  it('returns null on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')));
    const result = await ScoreClient.getContext({ heapId: 'heap-1', playerId: 'p1' });
    expect(result).toBeNull();
  });

  it('returns null on non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 503 }));
    const result = await ScoreClient.getContext({ heapId: 'heap-1', playerId: 'p1' });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/systems/__tests__/ScoreClient.test.ts
```

Expected: all fail — `ScoreClient` module not found.

- [ ] **Step 3: Create `src/systems/ScoreClient.ts`**

```typescript
// src/systems/ScoreClient.ts

import type { LeaderboardContext, SubmitScoreResponse } from '../../shared/scoreTypes';

const SERVER_URL: string =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_HEAP_SERVER_URL ??
  'http://localhost:8787';

export class ScoreClient {
  /**
   * Submit a score for a heap. Returns the leaderboard context on success,
   * or null if the server is unreachable or returns an error.
   */
  static async submitScore(params: {
    heapId:     string;
    playerId:   string;
    playerName: string;
    score:      number;
    limit?:     number;
  }): Promise<LeaderboardContext | null> {
    try {
      const url = params.limit
        ? `${SERVER_URL}/scores?limit=${params.limit}`
        : `${SERVER_URL}/scores`;

      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          heapId:     params.heapId,
          playerId:   params.playerId,
          playerName: params.playerName,
          score:      params.score,
        }),
      });

      if (!res.ok) return null;
      const data = (await res.json()) as SubmitScoreResponse;
      return data.context;
    } catch {
      return null;
    }
  }

  /**
   * Fetch leaderboard context without submitting. Returns null on failure.
   */
  static async getContext(params: {
    heapId:    string;
    playerId:  string;
    limit?:    number;
  }): Promise<LeaderboardContext | null> {
    try {
      const limit = params.limit ?? 5;
      const res   = await fetch(
        `${SERVER_URL}/scores/${params.heapId}/context?playerId=${params.playerId}&limit=${limit}`,
      );
      if (!res.ok) return null;
      return (await res.json()) as LeaderboardContext;
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/systems/__tests__/ScoreClient.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Run full client test suite**

```bash
npx vitest run
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/systems/ScoreClient.ts src/systems/__tests__/ScoreClient.test.ts
git commit -m "feat: add ScoreClient for score submission and leaderboard context fetching"
```

---

## Task 8: LEADERBOARD_TOP_N constant

**Files:**
- Modify: `src/constants.ts`

- [ ] **Step 1: Add constant to `src/constants.ts`**

Find the end of `src/constants.ts` and append:

```typescript
// ── High scores ───────────────────────────────────────────────────────────────

export const LEADERBOARD_TOP_N = 5;   // number of top entries shown in leaderboard panel
```

- [ ] **Step 2: Commit**

```bash
git add src/constants.ts
git commit -m "feat: add LEADERBOARD_TOP_N constant (default 5)"
```

---

## Task 9: ScoreScene — heapId param, high score badge, leaderboard panel

**Files:**
- Modify: `src/scenes/ScoreScene.ts`

This task modifies `ScoreScene` to:
1. Accept `heapId` in `init()`
2. Check + update local high score in `create()`
3. Render a "NEW HIGH SCORE!" badge when beaten
4. Reserve a leaderboard slot; show loading → async panel → silent fail

The existing balance, checkpoint button, and menu prompt y-positions shift down to make room.

- [ ] **Step 1: Add imports and new private fields**

At the top of `ScoreScene.ts`, add to the existing imports:

```typescript
import {
  getLocalHighScore,
  setLocalHighScore,
  getPlayerGuid,
  getPlayerName,
} from '../systems/SaveData';
import { ScoreClient } from '../systems/ScoreClient';
import type { LeaderboardContext, LeaderboardEntry } from '../../shared/scoreTypes';
import { LEADERBOARD_TOP_N } from '../constants';
```

Add private fields to the `ScoreScene` class (alongside the existing private fields):

```typescript
private heapId:          string  = '';
private isNewHighScore:  boolean = false;
```

- [ ] **Step 2: Update `init()` to accept heapId**

Replace the existing `init()` method:

```typescript
init(data: {
  score:                number;
  heapId?:              string;
  isPeak?:              boolean;
  checkpointAvailable?: boolean;
  isFailure?:           boolean;
}): void {
  this.score               = data.score               ?? 0;
  this.heapId              = data.heapId              ?? '';
  this.isPeak              = data.isPeak              ?? false;
  this.checkpointAvailable = data.checkpointAvailable ?? false;
  this.isFailure           = data.isFailure           ?? false;
}
```

- [ ] **Step 3: Update `create()` to check high score and launch leaderboard**

Replace the existing `create()` method with:

```typescript
create(): void {
  // Check and update local high score before rendering anything
  if (this.heapId && this.score > 0) {
    const prev = getLocalHighScore(this.heapId);
    if (this.score > prev) {
      setLocalHighScore(this.heapId, this.score);
      this.isNewHighScore = true;
    }
  }

  const cfg    = getPlayerConfig();
  const result = buildCoinBreakdown({
    score:           this.score,
    scoreToCoins:    SCORE_TO_COINS_DIVISOR,
    moneyMultiplier: cfg.moneyMultiplier,
    isPeak:          this.isPeak,
    peakMultiplier:  cfg.peakMultiplier,
    isFailure:       this.isFailure,
  });

  if (!this._coinsAwarded) {
    this._coinsAwarded = true;
    addBalance(result.finalCoins);
  }
  const balance = getBalance();

  this.createBackground();
  this.createStarField();
  if (!this.isFailure) this.createConfetti();
  if (this.isFailure)  this.createFailureGlow();

  this.createTitle();
  this.createScoreDisplay();
  if (this.isNewHighScore) this.createHighScoreBadge();
  this.createCoinsPanel(result.rows, result.finalCoins);
  this.createLeaderboardPanel();
  this.createBalance(balance);
  this.createCheckpointButton();
  this.createMenuPrompt();
}
```

- [ ] **Step 4: Add `createHighScoreBadge()` method**

Add this method after `createScoreDisplay()`:

```typescript
private createHighScoreBadge(): void {
  const color = '#ffdd44';
  this.add.text(CX, GAME_HEIGHT * 0.36, 'NEW HIGH SCORE!', {
    fontSize:      '18px',
    fontFamily:    'monospace',
    color,
    letterSpacing: 3,
    fontStyle:     'bold',
  }).setOrigin(0.5).setShadow(0, 0, color, 10, true, true);
}
```

- [ ] **Step 5: Add `createLeaderboardPanel()` method**

Add this method after `createCoinsPanel()`:

```typescript
private createLeaderboardPanel(): void {
  if (!this.heapId) return;

  const PANEL_TOP = GAME_HEIGHT * 0.64;
  const PANEL_W   = GAME_WIDTH * 0.88;
  const PANEL_X   = CX;
  const ROW_H     = 20;

  // Loading placeholder
  const loading = this.add.text(PANEL_X, PANEL_TOP + 8, 'Loading leaderboard...', {
    fontSize:   '11px',
    fontFamily: 'monospace',
    color:      '#557799',
  }).setOrigin(0.5, 0).setAlpha(0);

  // Fade placeholder in after score count-up (800ms) + 300ms
  this.time.delayedCall(1100, () => {
    this.tweens.add({ targets: loading, alpha: 1, duration: 300, ease: 'Linear' });
  });

  // Kick off server call
  const playerId   = getPlayerGuid();
  const playerName = getPlayerName();
  const call       = this.isNewHighScore
    ? ScoreClient.submitScore({
        heapId: this.heapId, playerId, playerName,
        score:  this.score, limit: LEADERBOARD_TOP_N,
      })
    : ScoreClient.getContext({ heapId: this.heapId, playerId, limit: LEADERBOARD_TOP_N });

  call.then((ctx) => {
    loading.destroy();
    if (!ctx) return; // offline — silently show nothing

    this.renderLeaderboardEntries(ctx, PANEL_TOP, PANEL_W, ROW_H);
  });
}

private renderLeaderboardEntries(
  ctx:      LeaderboardContext,
  panelTop: number,
  panelW:   number,
  rowH:     number,
): void {
  const PAD_X  = 14;
  const left   = CX - panelW / 2 + PAD_X;
  const right  = CX + panelW / 2 - PAD_X;

  // Panel background
  const totalRows = ctx.top.length + (ctx.player && !this.playerInTop(ctx) ? 2 : 0); // +1 for gap, +1 for player
  const panelH    = totalRows * rowH + 8;
  const bg = this.add.graphics();
  bg.fillStyle(0x002244, 0.5);
  bg.lineStyle(1, 0x336699, 0.3);
  bg.fillRoundedRect(CX - panelW / 2, panelTop, panelW, panelH, 6);
  bg.strokeRoundedRect(CX - panelW / 2, panelTop, panelW, panelH, 6);

  let y = panelTop + 4;

  // Top N rows
  for (const entry of ctx.top) {
    const isPlayer = entry.playerId === (ctx.player?.playerId ?? '');
    const nameCol  = isPlayer && this.isNewHighScore ? '#ffdd44' : '#aaccee';
    const rankCol  = isPlayer && this.isNewHighScore ? '#ffdd44' : '#668899';

    this.add.text(left, y, `#${entry.rank}`, {
      fontSize: '11px', fontFamily: 'monospace', color: rankCol,
    });
    this.add.text(left + 36, y, entry.name, {
      fontSize: '11px', fontFamily: 'monospace', color: nameCol,
    });
    this.add.text(right, y, String(entry.score), {
      fontSize: '11px', fontFamily: 'monospace', color: nameCol,
    }).setOrigin(1, 0);
    y += rowH;
  }

  // Gap + player row if player is not already in top N
  if (ctx.player && !this.playerInTop(ctx)) {
    this.add.text(CX, y, '·  ·  ·', {
      fontSize: '10px', fontFamily: 'monospace', color: '#335566',
    }).setOrigin(0.5, 0);
    y += rowH;

    const p      = ctx.player;
    const pColor = this.isNewHighScore ? '#ffdd44' : '#aaccee';
    this.add.text(left, y, `#${p.rank}`, {
      fontSize: '11px', fontFamily: 'monospace', color: pColor,
    });
    this.add.text(left + 36, y, p.name, {
      fontSize: '11px', fontFamily: 'monospace', color: pColor,
    });
    this.add.text(right, y, String(p.score), {
      fontSize: '11px', fontFamily: 'monospace', color: pColor,
    }).setOrigin(1, 0);
  }
}

private playerInTop(ctx: LeaderboardContext): boolean {
  if (!ctx.player) return false;
  return ctx.top.some(e => e.playerId === ctx.player!.playerId);
}
```

- [ ] **Step 6: Shift lower elements down to make room for leaderboard**

Update `createBalance()` — change `GAME_HEIGHT * 0.73` to `GAME_HEIGHT * 0.82`:

```typescript
private createBalance(balance: number): void {
  this.add.text(CX, GAME_HEIGHT * 0.82, `Balance: ${balance} coins`, {
    fontSize:   '16px',
    fontFamily: 'monospace',
    color:      '#aaddff',
  }).setOrigin(0.5).setAlpha(0.85);
}
```

Update `createCheckpointButton()` — change `GAME_HEIGHT * 0.79` to `GAME_HEIGHT * 0.87`:

```typescript
private createCheckpointButton(): void {
  if (!this.checkpointAvailable) return;

  const btn = this.add.text(CX, GAME_HEIGHT * 0.87, 'Respawn at Checkpoint', {
    fontSize:        '12px',
    fontFamily:      'monospace',
    color:           '#88aaff',
    backgroundColor: '#112266cc',
    padding:         { x: 16, y: 8 },
  }).setOrigin(0.5).setInteractive({ useHandCursor: true });

  btn.on('pointerover', () => btn.setColor('#ffffff'));
  btn.on('pointerout',  () => btn.setColor('#88aaff'));
  btn.once('pointerup', () => {
    this.scene.stop('ScoreScene');
    this.scene.stop('GameScene');
    this.scene.start('GameScene', { useCheckpoint: true });
  });
}
```

- [ ] **Step 7: Run the full client test suite**

```bash
npx vitest run
```

Expected: all tests pass (ScoreScene has no unit tests — it's validated visually).

- [ ] **Step 8: Commit**

```bash
git add src/scenes/ScoreScene.ts src/systems/ScoreClient.ts
git commit -m "feat: add high score badge and async leaderboard panel to ScoreScene"
```

---

## Task 10: GameScene — pass heapId to ScoreScene

**Files:**
- Modify: `src/scenes/GameScene.ts`

There are three places where `ScoreScene` is launched. All need `heapId: this._heapId` added.

- [ ] **Step 1: Update all three ScoreScene launch calls**

Find line 156 (trash wall swallows player):
```typescript
this.scene.launch('ScoreScene', { score, isPeak: false, checkpointAvailable, isFailure: true });
```
Replace with:
```typescript
this.scene.launch('ScoreScene', { score, heapId: this._heapId, isPeak: false, checkpointAvailable, isFailure: true });
```

Find line 402 (player places block at summit):
```typescript
this.scene.launch('ScoreScene', { score, isPeak });
```
Replace with:
```typescript
this.scene.launch('ScoreScene', { score, heapId: this._heapId, isPeak });
```

Find line 482 (enemy damage):
```typescript
this.scene.launch('ScoreScene', { score, isPeak: false, checkpointAvailable, isFailure: true });
```
Replace with:
```typescript
this.scene.launch('ScoreScene', { score, heapId: this._heapId, isPeak: false, checkpointAvailable, isFailure: true });
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/scenes/GameScene.ts
git commit -m "feat: pass heapId from GameScene to ScoreScene for high score tracking"
```

---

## Task 11: MenuScene — player name display and edit

**Files:**
- Modify: `src/scenes/MenuScene.ts`

- [ ] **Step 1: Add SaveData imports**

In `src/scenes/MenuScene.ts`, add `getPlayerName` and `setPlayerName` to the SaveData import:

```typescript
import { getBalance, getPlaced, resetAllData, getPlayerName, setPlayerName } from '../systems/SaveData';
```

- [ ] **Step 2: Add a private field for the name text object**

Add to the class private fields (alongside `balanceText` etc.):

```typescript
private playerNameText!: Phaser.GameObjects.Text;
```

- [ ] **Step 3: Add `createPlayerName()` method**

Add this method after `createBalanceText()`:

```typescript
private createPlayerName(): void {
  const name = getPlayerName();
  this.playerNameText = this.add.text(
    GAME_WIDTH / 2, 748,
    `${name}  [edit]`,
    {
      fontSize:   '13px',
      fontFamily: 'monospace',
      color:      '#8899aa',
      stroke:     '#000000',
      strokeThickness: 1,
    },
  ).setOrigin(0.5).setAlpha(0).setDepth(8)
   .setInteractive({ useHandCursor: true });

  this.playerNameText.on('pointerover', () => this.playerNameText.setColor('#aabbcc'));
  this.playerNameText.on('pointerout',  () => this.playerNameText.setColor('#8899aa'));
  this.playerNameText.on('pointerup',   () => this.promptNameChange());
}

private promptNameChange(): void {
  const current = getPlayerName();
  const input   = window.prompt('Enter your player name (max 20 chars):', current);
  if (input === null) return;  // cancelled
  setPlayerName(input);
  this.playerNameText.setText(`${getPlayerName()}  [edit]`);
}
```

- [ ] **Step 4: Call `createPlayerName()` in `create()`**

In the `create()` method, add the call after `createBalanceText()`:

```typescript
this.createBalanceText();
this.createPlayerName();
this.createPrompts(im);
```

- [ ] **Step 5: Make `playerNameText` fade in during entrance sequence**

Find `runEntranceSequence()` in MenuScene.ts. The method fades in various text objects. Add `this.playerNameText` to the same fade-in tween that handles `this.balanceText`. Look for the tween that targets `balanceText` and add `playerNameText` to its targets array.

The fade-in tween for `balanceText` will look something like:
```typescript
this.tweens.add({
  targets:  [/* ... */, this.balanceText],
  // ...
});
```
Add `this.playerNameText` to that same `targets` array.

- [ ] **Step 6: Run tests**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/scenes/MenuScene.ts
git commit -m "feat: add player name display and edit prompt to MenuScene"
```

---

## Verification

After all tasks are complete, run the full test suite for both sides:

```bash
# Client tests (from repo root)
npx vitest run

# Server tests
cd server && npx vitest run
```

Expected totals: all existing tests pass, plus new tests from Tasks 2, 5, and 7.

To smoke test the full flow locally:
1. Start the server: `cd server && npm run dev`
2. Start the client: `npm run dev` (from repo root)
3. Play a run and verify:
   - Score screen shows "NEW HIGH SCORE!" on first run
   - Leaderboard panel loads with the submitted score at rank #1
   - Score screen shows previous high score badge (not "new") on a lower run
   - Menu shows player name with `[edit]` tap target
   - Name change persists after menu close/reopen

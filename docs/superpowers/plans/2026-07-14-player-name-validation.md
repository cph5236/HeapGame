# Player Name Validation + Name Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Names move from `score.name` to a dedicated `player_name` table with profanity-validated renames (client+server via one shared module); score submit only seeds first-seen players and never updates names.

**Architecture:** `shared/playerName.ts` wraps the `obscenity` matcher; migration 0005 creates + backfills `player_name`; `PlayerNameDB` follows the playerAuthDb pattern; a new auth-gated `PUT /players/:playerId/name` route handles renames; scoreDb reads resolve names via LEFT JOIN with `'Anonymous'` fallback. `score.name` is NOT dropped in this PR.

**Tech Stack:** obscenity (npm), Cloudflare D1, Hono, Vitest, Phaser (MenuScene modal).

## Global Constraints

- Branch `feature/player-name-validation` off `feature/place-contributions` (NOT main). PR targets `feature/place-contributions`.
- Migration follows the **two-file rule** (numbered migration + `server/schema/heap_scores.sql` mirror). Invoke the `adding-d1-migrations` skill first. This branch's migration is **0005** (0004 is taken by contributions on the parent branch).
- `MAX_PLAYER_NAME_LEN = 20`. Grandfathered names are copied verbatim in the backfill — never re-validated.
- Do NOT drop or stop-satisfying the `score.name` column: inserts write `''`.
- Client identity is always `getEffectivePlayerId()`; token header via `authHeaders()` — no literals.
- Existing tests that assert the old behavior (required playerName, upsert-updates-name) must be UPDATED to the new contract, not deleted.
- Run `npm test`, `cd server && npx vitest run`, `npm run build` before declaring done.
- Commits per task; style `feat(names): …`.

---

### Task 1: `obscenity` dep + shared validation module (TDD)

**Files:**
- Modify: `package.json` (root — `npm install obscenity` adds to dependencies)
- Create: `shared/playerName.ts`
- Create: `shared/__tests__/playerName.test.ts` (match where existing shared tests live — check `shared/` for a `__tests__` dir and follow it)
- Modify: `src/systems/SaveData.ts` (~line 76: replace local `generateDefaultName` with the shared import; keep call sites working)

**Interfaces:**
- Produces:

```ts
export const MAX_PLAYER_NAME_LEN = 20;
export type NameValidation =
  | { ok: true; name: string }
  | { ok: false; reason: 'empty' | 'too-long' | 'profanity' };
export function validatePlayerName(raw: string): NameValidation;
export function generateDefaultPlayerName(): string; // Trashbag#NNNNN (5 digits)
```

- [ ] **Step 1: Install** — `npm install obscenity` (repo root). Confirm it lands in `dependencies`.

- [ ] **Step 2: Write failing tests** (`shared/__tests__/playerName.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { validatePlayerName, generateDefaultPlayerName, MAX_PLAYER_NAME_LEN } from '../playerName';

describe('validatePlayerName', () => {
  it('accepts a plain name and returns it trimmed', () => {
    expect(validatePlayerName('  Connor  ')).toEqual({ ok: true, name: 'Connor' });
  });
  it('accepts names at exactly 20 chars', () => {
    const n = 'a'.repeat(MAX_PLAYER_NAME_LEN);
    expect(validatePlayerName(n)).toEqual({ ok: true, name: n });
  });
  it('rejects empty / whitespace-only', () => {
    expect(validatePlayerName('   ')).toEqual({ ok: false, reason: 'empty' });
  });
  it('rejects names over 20 chars (post-trim)', () => {
    expect(validatePlayerName('a'.repeat(21))).toEqual({ ok: false, reason: 'too-long' });
  });
  it('rejects profanity', () => {
    expect(validatePlayerName('shithead')).toEqual({ ok: false, reason: 'profanity' });
  });
  it('rejects leet-speak obfuscation', () => {
    expect(validatePlayerName('sh1thead')).toEqual({ ok: false, reason: 'profanity' });
  });
  it('does not false-positive on clean words', () => {
    expect(validatePlayerName('Classy Grass')).toEqual({ ok: true, name: 'Classy Grass' });
    expect(validatePlayerName('Trashbag#12345').ok).toBe(true);
  });
});

describe('generateDefaultPlayerName', () => {
  it('matches Trashbag#NNNNN', () => {
    expect(generateDefaultPlayerName()).toMatch(/^Trashbag#\d{5}$/);
  });
  it('passes its own validation', () => {
    expect(validatePlayerName(generateDefaultPlayerName()).ok).toBe(true);
  });
});
```

- [ ] **Step 3: Run, verify fail.** `npx vitest run shared/__tests__/playerName.test.ts`

- [ ] **Step 4: Implement** `shared/playerName.ts`:

```ts
// Shared player-name rules: one implementation for client (rename modal) and
// server (rename endpoint + first-seen seeding). Grandfathered DB names are
// never re-validated — only new names pass through here.
import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from 'obscenity';

export const MAX_PLAYER_NAME_LEN = 20;

const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

export type NameValidation =
  | { ok: true; name: string }
  | { ok: false; reason: 'empty' | 'too-long' | 'profanity' };

export function validatePlayerName(raw: string): NameValidation {
  const name = raw.trim();
  if (name.length === 0) return { ok: false, reason: 'empty' };
  if (name.length > MAX_PLAYER_NAME_LEN) return { ok: false, reason: 'too-long' };
  if (matcher.hasMatch(name)) return { ok: false, reason: 'profanity' };
  return { ok: true, name };
}

export function generateDefaultPlayerName(): string {
  const n = Array.from({ length: 5 }, () => Math.floor(Math.random() * 10)).join('');
  return `Trashbag#${n}`;
}
```

In `src/systems/SaveData.ts`: delete the local `generateDefaultName` function, add `import { generateDefaultPlayerName } from '../../shared/playerName';` (check how SaveData already imports from shared — match the existing relative path style used elsewhere in `src/systems/`), and rename all `generateDefaultName()` call sites to `generateDefaultPlayerName()`.

- [ ] **Step 5: Run, verify pass** — the new test file AND `npm test` (SaveData tests must stay green).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json shared/playerName.ts shared/__tests__/playerName.test.ts src/systems/SaveData.ts
git commit -m "feat(names): shared validatePlayerName (obscenity) + shared default-name generator"
```

---

### Task 2: Migration 0005 + schema mirror

**Files:**
- Create: `server/migrations/heap_scores/0005_player_name.sql`
- Modify: `server/schema/heap_scores.sql`

- [ ] **Step 1: Invoke the `adding-d1-migrations` skill; follow it for heap_scores.**

- [ ] **Step 2: Write** `server/migrations/heap_scores/0005_player_name.sql`:

```sql
-- Dedicated player-name table. Names previously lived per-score-row; renames
-- now write here and leaderboard reads JOIN it. score.name stays (unread,
-- '' on new inserts) until a later cleanup migration drops it.
CREATE TABLE IF NOT EXISTS player_name (
  player_id  TEXT NOT NULL PRIMARY KEY,
  name       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Backfill verbatim (grandfathered — no validation): one row per player,
-- name from their most recently updated score row.
INSERT INTO player_name (player_id, name, updated_at)
SELECT player_id, name, MAX(updated_at) FROM score GROUP BY player_id
ON CONFLICT (player_id) DO NOTHING;
```

- [ ] **Step 3: Mirror the CREATE TABLE (not the backfill INSERT) into `server/schema/heap_scores.sql`**, and add a comment on the `score.name` column noting it is legacy/unread pending a drop migration.

- [ ] **Step 4: Apply locally** (NEVER --remote): `cd server && npx wrangler d1 migrations apply heap_scores --local` → 0005 applied.

- [ ] **Step 5: Commit**

```bash
git add server/migrations/heap_scores/0005_player_name.sql server/schema/heap_scores.sql
git commit -m "feat(names): player_name table + verbatim backfill (heap_scores 0005)"
```

---

### Task 3: PlayerNameDB (TDD)

**Files:**
- Create: `server/src/playerNameDb.ts`
- Create: `server/tests/playerNameDb.test.ts`
- Mock: `MockPlayerNameDB` colocated with the existing mocks (follow `server/tests/helpers/` conventions).

**Interfaces:**
- Produces:

```ts
export interface PlayerNameDB {
  getName(playerId: string): Promise<string | null>;
  setName(playerId: string, name: string, now: string): Promise<void>; // upsert
}
export class D1PlayerNameDB implements PlayerNameDB { constructor(d1: D1Database) }
```

- [ ] **Step 1: Failing tests** (mock semantics, mirroring how contributionDb/playerAuth mocks are tested):

```ts
// getName unknown → null
// setName then getName → the name
// setName twice → second name wins (upsert)
```

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Implement** `server/src/playerNameDb.ts`:

```ts
/** Abstraction over D1 for the player_name table. */
export interface PlayerNameDB {
  getName(playerId: string): Promise<string | null>;
  setName(playerId: string, name: string, now: string): Promise<void>;
}

export class D1PlayerNameDB implements PlayerNameDB {
  constructor(private d1: D1Database) {}

  async getName(playerId: string): Promise<string | null> {
    const row = await this.d1
      .prepare('SELECT name FROM player_name WHERE player_id=?1')
      .bind(playerId)
      .first<{ name: string }>();
    return row?.name ?? null;
  }

  async setName(playerId: string, name: string, now: string): Promise<void> {
    await this.d1
      .prepare(`
        INSERT INTO player_name (player_id, name, updated_at) VALUES (?1, ?2, ?3)
        ON CONFLICT (player_id) DO UPDATE SET name = ?2, updated_at = ?3
      `)
      .bind(playerId, name, now)
      .run();
  }
}
```

Plus `MockPlayerNameDB` (Map-backed, identical semantics).

- [ ] **Step 4: Verify pass. Step 5: Commit** — `feat(names): PlayerNameDB interface, D1 impl, mock`.

---

### Task 4: scoreDb name-join refactor (TDD)

**Files:**
- Modify: `server/src/scoreDb.ts`
- Modify: `server/src/cache/CachedScoreDB.ts`
- Modify: mock ScoreDB + its tests (`server/tests/scoreDb.mock.test.ts` and helpers)
- Modify: any test constructing `upsertScore(…, name, …)`.

**Interfaces:**
- Produces: `upsertScore(heapId, playerId, score, now): Promise<boolean>` (name param REMOVED). `ScoreRow.name` still present on reads — now resolved from `player_name` with `'Anonymous'` fallback.
- Consumes: Task 3's table.

- [ ] **Step 1: Write/adjust failing tests** — in the mock scoreDb tests: upsert without name; reads resolve names through an attached `MockPlayerNameDB` (give MockScoreDB a constructor/setter reference to a PlayerNameDB-like lookup — pick the least invasive wiring the existing helper structure allows); missing name row → `'Anonymous'`.

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Implement.** In `D1ScoreDB`:

- `upsertScore(heapId, playerId, score, now)`: existing-row UPDATE becomes `UPDATE score SET score=?1, updated_at=?2 WHERE …` (no name); INSERT writes `''` for the legacy NOT NULL name column:

```ts
      await this.d1
        .prepare("INSERT INTO score (heap_id, player_id, name, score, created_at, updated_at) VALUES (?1,?2,'',?3,?4,?5)")
        .bind(heapId, playerId, score, now, now)
        .run();
```

- `getTopScores` / `getScoresPaginated`: change `SELECT s.*, pc.loadout AS loadout` to also resolve the name:

```sql
SELECT s.heap_id, s.player_id, s.score, s.created_at, s.updated_at,
       COALESCE(pn.name, 'Anonymous') AS name,
       pc.loadout AS loadout
  FROM score s
  LEFT JOIN player_name pn          ON pn.player_id = s.player_id
  LEFT JOIN player_customization pc ON pc.player_id = s.player_id
 WHERE s.heap_id=?1
 ORDER BY s.score DESC
```

- `getScore`: same COALESCE join (explicit column list, no `SELECT *`).
- `getPlayerScores`: join `player_name` in the CTE (or outer query) and emit `COALESCE(pn.name, 'Anonymous') AS name`.
- `CachedScoreDB.upsertScore` signature updated to match; passthrough unchanged otherwise.
- Update `server/src/routes/scores.ts` call site: `scoreDb.upsertScore(heapId, playerId, finalScore, now)` (the name-trim slice moves out — Task 5 handles what happens to the submitted name).

- [ ] **Step 4: Full server suite green** (`cd server && npx vitest run`) — update any remaining fixtures that constructed score rows with names.

- [ ] **Step 5: Commit** — `feat(names): scoreDb reads resolve names via player_name join; upsertScore drops name param`.

---

### Task 5: Score submit — optional playerName + seed-if-missing (TDD)

**Files:**
- Modify: `shared/scoreTypes.ts` (`playerName?: string`)
- Modify: `server/src/routes/scores.ts`
- Modify: `server/src/app.ts` (pass `playerNameDb` into `scoreRoutes`)
- Test: `server/tests/scores.test.ts` (update) + new cases

**Interfaces:**
- Produces: `scoreRoutes(scoreDb, heapDb, getSink, authDb?, playerNameDb?)`.
- Consumes: `validatePlayerName`, `generateDefaultPlayerName` from `shared/playerName`; `PlayerNameDB`.

- [ ] **Step 1: Failing tests:**

```ts
// 1. submit with NO playerName field → 200, score recorded (was 400 before — update old test)
// 2. playerName present but non-string (42) → 400
// 3. first submit, valid playerName 'Alice' → player_name row seeded 'Alice'
// 4. first submit, profane playerName → row seeded matching /^Trashbag#\d{5}$/
// 5. first submit, NO playerName → row seeded Trashbag#NNNNN
// 6. player already has a name row 'Bob' → submit with playerName 'Mallory' → row still 'Bob'
// 7. leaderboard context returned by the submit reflects the seeded/kept name
```

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Implement** in `server/src/routes/scores.ts`:

- Replace the hard playerName rejection with: `if (playerName !== undefined && typeof playerName !== 'string') → 400` (keep the capture/log pattern of the surrounding rejects).
- After the auth gate passes and after computing `now`, before `upsertScore`:

```ts
    // First-seen name seeding: score submit never updates an existing name.
    if (playerNameDb) {
      const existingName = await playerNameDb.getName(playerId);
      if (existingName === null) {
        const validated = playerName !== undefined ? validatePlayerName(playerName) : null;
        const seedName = validated && validated.ok ? validated.name : generateDefaultPlayerName();
        await playerNameDb.setName(playerId, seedName, now);
      }
    }
```

- `app.ts`: `scoreRoutes(scoreDb, heapDb, () => opts.logSink, opts.playerAuthDb, opts.playerNameDb)` with the new `AppOptions.playerNameDb?: PlayerNameDB` (wired in Task 6 alongside the route mount, fine to add the option here).

- [ ] **Step 4: Suites green. Step 5: Commit** — `feat(names): score submit seeds first-seen names, never updates them; playerName optional`.

---

### Task 6: Rename endpoint + wiring (TDD)

**Files:**
- Create: `server/src/routes/players.ts`
- Modify: `server/src/app.ts` (mount + rate limit), `server/src/index.ts` (D1PlayerNameDB on `env.DB_SCORES`)
- Test: `server/tests/players.test.ts` (new)

**Interfaces:**
- Produces: `PUT /players/:playerId/name` — body `{ name }`; 200 `{ name }` (canonical), 400 `{ error: 'invalid name', reason }`, 403 generic.

- [ ] **Step 1: Failing tests:**

```ts
// 1. valid rename w/ token, unclaimed guid → 200 { name: 'NewName' }, name row updated, auth row claimed
// 2. rename w/ matching token on claimed guid → 200
// 3. rename w/ WRONG token on claimed guid → 403, name unchanged
// 4. tokenless rename on claimed guid → 403
// 5. profane name → 400 { error: 'invalid name', reason: 'profanity' }, nothing written
// 6. 21-char name → 400 reason 'too-long'
// 7. '  Padded  ' → 200 { name: 'Padded' } (canonical trim stored)
// 8. invalid JSON body → 400
```

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Implement** `server/src/routes/players.ts`:

```ts
// server/src/routes/players.ts
import { Hono } from 'hono';
import type { PlayerNameDB } from '../playerNameDb';
import type { PlayerAuthDB } from '../playerAuthDb';
import type { Sink } from '../logging/Sink';
import { captureServer } from '../logging/captureServerEvent';
import { enforcePlayerAuth } from '../playerAuth';
import { validatePlayerName } from '../../../shared/playerName';

export function playerRoutes(
  nameDb: PlayerNameDB,
  getSink: () => Sink | undefined,
  authDb?: PlayerAuthDB,
): Hono {
  const app = new Hono();

  // PUT /players/:playerId/name — validated, auth-gated rename
  app.put('/:playerId/name', async (c) => {
    const playerId = c.req.param('playerId');
    let body: { name?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid name', reason: 'empty' }, 400);
    }
    if (typeof body.name !== 'string') {
      return c.json({ error: 'invalid name', reason: 'empty' }, 400);
    }

    const validated = validatePlayerName(body.name);
    if (!validated.ok) {
      const sink = getSink();
      if (sink) {
        await captureServer(sink, 'warn', 'name:rejected', { playerId, reason: validated.reason });
      }
      return c.json({ error: 'invalid name', reason: validated.reason }, 400);
    }

    const authRes = await enforcePlayerAuth(c, authDb, playerId, getSink, 'players:rename');
    if (authRes) return authRes;

    await nameDb.setName(playerId, validated.name, new Date().toISOString());
    return c.json({ name: validated.name });
  });

  return app;
}
```

`app.ts` (inside `createApp`, following the customization block's pattern):

```ts
  if (opts.playerNameDb) {
    app.put('/players/:playerId/name', rateLimit(lim.scores, 'players-rename'));
    app.route('/players', playerRoutes(opts.playerNameDb, () => opts.logSink, opts.playerAuthDb));
  }
```

`index.ts`: `playerNameDb: new D1PlayerNameDB(env.DB_SCORES),` next to the playerAuthDb line, with import.

- [ ] **Step 4: Suites green. Step 5: Commit** — `feat(names): auth-gated PUT /players/:playerId/name rename endpoint`.

---

### Task 7: Client — rename validation + server sync (TDD where testable)

**Files:**
- Create: `src/systems/PlayerNameClient.ts`
- Create: `src/systems/__tests__/PlayerNameClient.test.ts`
- Modify: `src/scenes/MenuScene.ts` (name-editor modal save path, ~line 483)

**Interfaces:**
- Consumes: Task 6 endpoint; `authHeaders`/`logIfAuthRejected`; shared `validatePlayerName`.
- Produces: `PlayerNameClient.updateName(playerId: string, name: string): Promise<string | null>`.

- [ ] **Step 1: Failing client tests** (mirror `ScoreClient` test style — mock fetch):

```ts
// 1. updateName PUTs to /players/<id>/name with JSON { name } and X-Player-Token header
// 2. 200 { name: 'Canon' } → resolves 'Canon'
// 3. 403 → resolves null and logs auth:rejected (mock logger)
// 4. network throw → resolves null
```

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Implement** `src/systems/PlayerNameClient.ts`:

```ts
import { fetchWithLog } from '../logging/fetchWithLog';
import { authHeaders, logIfAuthRejected } from './authToken';

const SERVER_URL: string =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_HEAP_SERVER_URL ??
  'http://localhost:8787';

export class PlayerNameClient {
  /** Push a validated rename to the server. Returns the canonical stored name, or null on failure. */
  static async updateName(playerId: string, name: string): Promise<string | null> {
    try {
      const res = await fetchWithLog(`${SERVER_URL}/players/${encodeURIComponent(playerId)}/name`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body:    JSON.stringify({ name }),
      });
      if (!res.ok) {
        logIfAuthRejected('players:rename', res.status);
        return null;
      }
      const data = (await res.json()) as { name: string };
      return data.name;
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 4: MenuScene modal.** Read the whole name-editor modal block around `MenuScene.ts:483` first. Change the save handler to:

```ts
      const validated = validatePlayerName(input.value);
      if (!validated.ok) {
        // Inline rejection: reuse the modal's existing styling — show a short
        // red message and keep the modal open. Reasons map to copy:
        // empty → 'Name cannot be empty', too-long → 'Max 20 characters',
        // profanity → 'That name isn't allowed'
        …show/refresh an error element inside the modal, return without closing…
      }
      setPlayerName(validated.name);
      void PlayerNameClient.updateName(getEffectivePlayerId(), validated.name);
      …existing close/refresh flow…
```

Implement the error element with the same DOM style the modal already uses (inspect it — it is a DOM overlay). Keep it minimal: one `<div>` whose textContent switches per reason, hidden until first rejection.

- [ ] **Step 5: Verify.** `npm test` green, `cd server && npx vitest run` green, `npm run build` green. Then use the `heap-scene-preview` skill to screenshot MenuScene once (default device) to confirm the menu still renders — the modal itself is DOM and fine to leave to the user's smoke test.

- [ ] **Step 6: Commit**

```bash
git add src/systems/PlayerNameClient.ts src/systems/__tests__/PlayerNameClient.test.ts src/scenes/MenuScene.ts
git commit -m "feat(names): rename modal validates via shared rules and syncs to server"
```

---

### Task 8: Todo follow-up line

**Files:**
- Modify: `Todo/Todo.md`

- [ ] **Step 1:** Remove/replace the three feature bullets ONLY if they exactly match the implemented scope — otherwise leave them and just ADD:

```md
- Drop legacy `score.name` column (cleanup migration in heap_scores) once the player-name-table release is deployed and confirmed — reads already moved to `player_name`.
```

Actually: do NOT remove the original three bullets (the orchestrator handles Todo cleanup after merges) — only add the drop-column follow-up bullet.

- [ ] **Step 2: Commit** — `chore(todo): note score.name drop-column follow-up`.

---

## Self-review checklist (before PR)

- [ ] `score.name` never read anywhere in server/src after this branch (grep `s.name` / `\.name` in scoreDb queries) — writes only `''` on insert.
- [ ] Migration 0005 backfill copies verbatim (no validation call in SQL path).
- [ ] Rename staleness note (KV TTL) mentioned in PR body.
- [ ] All three verification commands green; outputs pasted into PR body.

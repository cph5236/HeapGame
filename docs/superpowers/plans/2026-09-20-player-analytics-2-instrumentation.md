# Player Analytics (Plan 2 of 3) — Instrumentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make gameplay events actually reach Analytics Engine, keyed so they can be joined to the new-player cohorts Plan 1 already exposes — without blowing the free-tier quota.

**Architecture:** Four independent changes that must ship together: widen the Analytics Engine index so a non-UUID player id survives it, stamp the effective player id into the log envelope so events and `player_auth` share a key, flip gameplay analytics from opt-in to opt-out, and roll per-grab pickup events into the existing `run:end` payload to cut per-run data-point cost before the opt-out default multiplies the participating player count. The two effects are multiplicative, not offsetting — the roll-up trims per-run cost roughly 60%, while default-on can multiply participating players by one to two orders of magnitude, so it does not "pay for" the increase. Watch actual data points for a week post-release before considering the $5 paid tier (see the spec's risk table). Plus the privacy surfaces that must move in the same release.

**Tech Stack:** TypeScript 5.9, Phaser 3.90, Cloudflare Workers Analytics Engine, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-19-player-analytics-design.md` (Phase 2 and Phase 4; Phase 3 is deferred — see Global Constraints)

## Global Constraints

- Branch is `feature/analytics-instrumentation`, **stacked on `feature/player-analytics`** (Plan 1, open as PR #188 and not yet merged). Its PR targets `feature/player-analytics`, not `main`, so the diff shows only this plan's work. Never push direct to `main`. Do not rebase onto `main` while PR #188 is open.
- **Tutorial instrumentation (spec Phase 3) is OUT OF SCOPE.** It is deferred until the tutorial entry flow is restructured. Do not add `tutorial:*` events, do not touch `TutorialScene.ts`, `TutorialDirector.ts`, or `src/data/tutorialFixture.ts`.
- New save fields go in `save/game.ts`, never `save/core.ts` — but this plan adds **no new save field**; `verboseLogging` already exists in `save/core.ts` and only its *default* changes.
- Do not reorder the spreads in `migrate()` or `mergeCloudSave()`. That ordering is what makes the `playerSecret` invariant structural.
- Import from the `SaveData` barrel, never `save/core` or `save/game` directly.
- The AE column layout is **append-only**: `blob1`=level, `blob2`=eventType, `blob3`=platform, `blob4`=appVersion, `blob5`=sessionId, `blob6`=payload JSON, `blob7`=userAgent, `double1`=client timestamp, `index1`=player id. Changing an existing position silently reinterprets every row already stored. Task 1 changes only what goes *into* `index1`; Task 6 **appends** `double2..double6` and `blob8` without touching anything above. Never reuse or reorder an existing position.
- `MAX_ID_LEN` is 64 (`server/src/constants.ts`). Cloudflare's documented AE index limit is 96 bytes.
- `npm test` and `npm run build` must both pass before any task is considered done.
- A pre-existing, unrelated `tsc` error in `shared/__tests__/pickupScores.test.ts` predates this work. Ignore it; do not fix it.

---

### Task 1: Widen the Analytics Engine index

`AnalyticsEngineSink.userGuidIndex()` slices its input to 32 characters, with a comment asserting that AE indexes cap at 32 bytes and that the input is always a UUID. Both premises are wrong for what Task 2 is about to feed it: Cloudflare's limit is 96 bytes, and a GPGS player id is not a UUID — hyphen-stripping is a no-op on it and it may be up to `MAX_ID_LEN` (64) characters. Truncating it is irreversible, so the Plan 3 cohort join would fail for exactly the signed-in Play Store players it exists to measure, and two ids sharing a 32-character prefix would collide into one player.

This is not a live bug today (the envelope still stamps a raw GUID). It becomes one the instant Task 2 lands, so it goes first.

**Files:**
- Modify: `server/src/platform/logging/AnalyticsEngineSink.ts:3-7`
- Test: `server/tests/logSinks.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: no exported API change — `userGuidIndex` stays private to the module. Behavior change only: ids up to 64 characters pass through intact.

- [ ] **Step 1: Write the failing tests**

Append to the `AnalyticsEngineSink` describe block in `server/tests/logSinks.test.ts`:

```ts
it('preserves a 64-char non-UUID player id in the index', async () => {
  const { ae, points } = fakeAE();
  const gpgsId = 'g'.repeat(64); // GPGS ids are opaque and not UUIDs
  await new AnalyticsEngineSink(ae).write([entry({ userGuid: gpgsId })]);
  expect(points[0].indexes[0]).toBe(gpgsId);
});

it('does not collide two ids that share a 32-char prefix', async () => {
  const { ae, points } = fakeAE();
  const a = 'x'.repeat(32) + 'aaaa';
  const b = 'x'.repeat(32) + 'bbbb';
  await new AnalyticsEngineSink(ae).write([entry({ userGuid: a }), entry({ userGuid: b })]);
  expect(points[0].indexes[0]).not.toBe(points[1].indexes[0]);
});

it('still maps a hyphenated UUID to its 32-char hex form', async () => {
  const { ae, points } = fakeAE();
  await new AnalyticsEngineSink(ae).write([
    entry({ userGuid: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' }),
  ]);
  expect(points[0].indexes[0]).toBe('3f2504e04f8911d39a0c0305e82c3301');
});

it('truncates an over-long id at the AE byte limit rather than silently exceeding it', async () => {
  const { ae, points } = fakeAE();
  await new AnalyticsEngineSink(ae).write([entry({ userGuid: 'z'.repeat(200) })]);
  expect(points[0].indexes[0].length).toBeLessThanOrEqual(96);
});
```

If the file has no `fakeAE()` helper yet, add one next to the existing `fakeD1()`, following its shape:

```ts
function fakeAE() {
  const points: { indexes: string[]; blobs: string[]; doubles: number[] }[] = [];
  const ae = { writeDataPoint: (p: any) => { points.push(p); } } as any;
  return { ae, points };
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npx vitest run tests/logSinks.test.ts -t 'index'`
Expected: the 64-char and collision tests FAIL (both indexes truncate to 32 `x`s, so they compare equal); the UUID test passes already.

- [ ] **Step 3: Widen the function**

Replace the function and its comment in `server/src/platform/logging/AnalyticsEngineSink.ts`:

```ts
/**
 * The AE index for a player. Cloudflare caps an index at 96 bytes.
 *
 * A raw player GUID is a UUID, and stripping its hyphens yields exactly 32 hex
 * chars — a 1:1 reversible mapping, which is why that shape is preserved here.
 * But the envelope stamps `getEffectivePlayerId()`, which for a signed-in
 * player is a Google Play Games id: opaque, NOT a UUID, and up to MAX_ID_LEN
 * (64) characters. Hyphen-stripping is a no-op on it.
 *
 * Slicing to 32 would silently truncate such an id, irreversibly — two ids
 * sharing a 32-char prefix would collide into one player, and neither could be
 * mapped back to `player_auth.player_id` for a cohort join. So the cap is the
 * real AE limit, not 32.
 */
const MAX_INDEX_BYTES = 96;

function userGuidIndex(playerId: string): string {
  return playerId.replace(/-/g, '').slice(0, MAX_INDEX_BYTES);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx vitest run tests/logSinks.test.ts`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add server/src/platform/logging/AnalyticsEngineSink.ts server/tests/logSinks.test.ts
git commit -m "fix(logging): widen AE index so a non-UUID player id survives intact"
```

---

### Task 2: Stamp the effective player id into the log envelope

`src/logging/index.ts` builds the envelope with `getPlayerGuid()`. Cohorts in `player_auth` key on `getEffectivePlayerId()`. While these differ, no event can be joined to a cohort for any signed-in player — the same bare-`getPlayerGuid()` trap that broke leaderboard cosmetics in PR #93 and that CLAUDE.md names explicitly.

**Files:**
- Modify: `src/logging/index.ts:33-34`
- Test: `src/logging/__tests__/envelope.test.ts` (create)

**Interfaces:**
- Consumes: Task 1's widened index (an effective id longer than 32 chars would otherwise be truncated downstream).
- Produces: `getLogEnvelope().userGuid` now carries the effective player id. The field name stays `userGuid` — renaming it would ripple through `shared/logging/Logger.ts`, both sinks, the D1 `logs` table column, and `fetch-logs.yml`'s queries for no behavioral gain.

- [ ] **Step 1: Write the failing test**

Create `src/logging/__tests__/envelope.test.ts`:

```ts
// src/logging/__tests__/envelope.test.ts
//
// The envelope's id must match what player_auth keys on, or no event can be
// joined to a new-player cohort. See PR #93 for the same trap in another guise.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../systems/SaveData', () => ({
  getPlayerGuid: vi.fn(() => 'guid-aaaa'),
  getEffectivePlayerId: vi.fn(() => 'guid-aaaa'),
  getVerboseLogging: vi.fn(() => true),
}));

import { getLogEnvelope } from '../index';
import { getEffectivePlayerId, getPlayerGuid } from '../../systems/SaveData';

describe('log envelope identity', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('stamps the effective player id, not the raw guid', () => {
    vi.mocked(getPlayerGuid).mockReturnValue('guid-aaaa');
    vi.mocked(getEffectivePlayerId).mockReturnValue('gpgs-1234567890');
    expect(getLogEnvelope().userGuid).toBe('gpgs-1234567890');
  });

  it('falls back to the guid when no GPGS id is set (they are equal)', () => {
    vi.mocked(getEffectivePlayerId).mockReturnValue('guid-aaaa');
    expect(getLogEnvelope().userGuid).toBe('guid-aaaa');
  });

  it("uses 'pre-init' when SaveData is not ready", () => {
    vi.mocked(getEffectivePlayerId).mockImplementation(() => { throw new Error('not ready'); });
    expect(getLogEnvelope().userGuid).toBe('pre-init');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/logging/__tests__/envelope.test.ts`
Expected: FAIL on the first test — returns `'guid-aaaa'`, because the envelope still calls `getPlayerGuid()`.

- [ ] **Step 3: Change the envelope**

In `src/logging/index.ts`, update the import and the `getEnvelope()` body:

```ts
import { getEffectivePlayerId, getVerboseLogging } from '../systems/SaveData';
```

```ts
function getEnvelope(): LogEnvelope {
  // The effective player id (GPGS id when signed in, else the GUID) — the same
  // key player_auth uses, so events can be joined to a new-player cohort. A
  // bare getPlayerGuid() here would silently orphan every signed-in player's
  // events; see PR #93 for the same mistake in the cosmetics path.
  let userGuid = 'pre-init';
  try { userGuid = getEffectivePlayerId() || 'pre-init'; } catch { /* SaveData not ready */ }
  return {
    userGuid,
    sessionId: SESSION_ID,
    appVersion: APP_VERSION,
    platform: detectPlatform(),
    userAgent: (typeof navigator !== 'undefined' ? navigator.userAgent : '').slice(0, 200),
  };
}
```

If `getPlayerGuid` is now unused in this file, remove it from the import. If it is still used elsewhere in the file, leave it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/logging/__tests__/envelope.test.ts src/logging/__tests__/RemoteLogger.test.ts`
Expected: PASS.

- [ ] **Step 5: Record the deploy-date caveat**

Append to `docs/superpowers/runbooks/` a new file `analytics-history-split.md`:

```markdown
# Analytics history split

The log envelope stamped `getPlayerGuid()` (raw GUID) until the deploy of
`feature/analytics-instrumentation`, and `getEffectivePlayerId()` after it.

For a signed-in player those are DIFFERENT STRINGS, so any query spanning that
boundary sees one human as two players.

**Funnel and cohort queries must start at the deploy date. Fill it in below when
this ships.**

- Deploy date: `TBD — fill in at release`
- Version: `TBD — fill in at release`

Pre-deploy rows are deliberately not backfilled (see the spec's Non-goals).
```

Leave the two `TBD` values — they are filled at release, not now. This is the one
place in either plan where a placeholder is correct.

- [ ] **Step 6: Commit**

```bash
git add src/logging/index.ts src/logging/__tests__/envelope.test.ts docs/superpowers/runbooks/analytics-history-split.md
git commit -m "feat(logging): stamp the effective player id into the log envelope"
```

---

### Task 3: Flip gameplay analytics to default-on

`getVerboseLogging()` returns `parsed.verboseLogging ?? false`. The toggle that sets it is buried in Settings, so in practice almost nobody has it on and the event stream is a self-selected near-empty sample. Flipping the default makes the denominator real. A stored value must stay authoritative so an existing opt-out is never overridden.

**Files:**
- Modify: `src/systems/save/core.ts:235`
- Test: `src/systems/__tests__/verboseLoggingDefault.test.ts` (create)

**Interfaces:**
- Consumes: nothing
- Produces: `getVerboseLogging()` returns `true` when unset. The Settings toggle at `src/scenes/SettingsScene.ts:363` is unchanged — same label, same position — and simply becomes an opt-*out*.

- [ ] **Step 1: Write the failing test**

Create `src/systems/__tests__/verboseLoggingDefault.test.ts`:

```ts
// src/systems/__tests__/verboseLoggingDefault.test.ts
//
// Analytics is opt-OUT: on unless the player turned it off. The stored value
// must win in BOTH directions — a player who opted out before the default
// flipped must stay opted out.

import { describe, it, expect, beforeEach } from 'vitest';
import { getVerboseLogging, setVerboseLogging, resetCacheForTests } from '../SaveData';

describe('verboseLogging default', () => {
  beforeEach(() => {
    localStorage.clear();
    resetCacheForTests();
  });

  it('defaults to true on a fresh save', () => {
    expect(getVerboseLogging()).toBe(true);
  });

  it('respects a stored false — an existing opt-out survives the default flip', () => {
    setVerboseLogging(false);
    resetCacheForTests();
    expect(getVerboseLogging()).toBe(false);
  });

  it('respects a stored true', () => {
    setVerboseLogging(true);
    resetCacheForTests();
    expect(getVerboseLogging()).toBe(true);
  });
});
```

If the SaveData barrel does not export `resetCacheForTests`, use whatever reset helper the neighbouring save tests in `src/systems/__tests__/` already use — match the file's existing convention rather than inventing one.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/systems/__tests__/verboseLoggingDefault.test.ts`
Expected: FAIL on the first test — returns `false`.

- [ ] **Step 3: Flip the default**

In `src/systems/save/core.ts`:

```ts
/** Analytics is opt-OUT: on unless the player turned it off in Settings. A
 *  STORED value always wins, so a player who opted out before this default
 *  flipped stays opted out. Errors and warnings are sent regardless of this
 *  flag and always have been — only `event`-level logging is gated here. */
export function getVerboseLogging(): boolean { return load().verboseLogging ?? true; }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/systems/__tests__/verboseLoggingDefault.test.ts && npx vitest run src/systems/__tests__/`
Expected: PASS, and no pre-existing save test regresses.

- [ ] **Step 5: Commit**

```bash
git add src/systems/save/core.ts src/systems/__tests__/verboseLoggingDefault.test.ts
git commit -m "feat(analytics): default gameplay analytics to on, keeping the opt-out"
```

---

### Task 4: Extract a single `run:end` emit site

`run:end` is emitted from four near-identical copy-pasted sites — `GameScene.ts:279`, `:756`, `:942`, and `InfiniteGameScene.ts:665` — each re-deriving `killCount` by hand. Task 5 adds two fields to that payload. Adding them to four hand-maintained copies is how one gets missed, producing a dataset that is silently partial but looks fine.

This task is **behavior-preserving**: extract first, with the existing tests green, then add fields in one place in Task 5.

**Files:**
- Create: `src/systems/runEndEvent.ts`
- Modify: `src/scenes/GameScene.ts` (3 sites), `src/scenes/InfiniteGameScene.ts` (1 site)
- Test: `src/systems/__tests__/runEndEvent.test.ts`

**Interfaces:**
- Consumes: `GameEvent`'s `run:end` member from `shared/logging/events.ts`, unchanged.
- Produces:

```ts
export interface RunEndFacts {
  heapId: string;
  mode: GameMode;
  cause: RunEndCause;
  score: number;
  height: number;
  durationMs: number;
  /** Per-enemy-type kill counts; summed internally. */
  kills: Record<string, number>;
}
export function emitRunEnd(facts: RunEndFacts): void;
```

- [ ] **Step 1: Write the failing test**

Create `src/systems/__tests__/runEndEvent.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const event = vi.fn();
vi.mock('../../logging', () => ({ getLogger: () => ({ event }) }));
vi.mock('../SaveData', () => ({ getUpgrades: () => ({ jump: 2 }) }));

import { emitRunEnd } from '../runEndEvent';

describe('emitRunEnd', () => {
  beforeEach(() => { event.mockClear(); });

  it('sums the kills map into a total', () => {
    emitRunEnd({
      heapId: 'h1', mode: 'normal', cause: 'death',
      score: 100, height: 50, durationMs: 1234,
      kills: { rat: 2, vulture: 3 },
    });
    expect(event).toHaveBeenCalledTimes(1);
    expect(event.mock.calls[0][0]).toMatchObject({
      type: 'run:end', heapId: 'h1', mode: 'normal', cause: 'death',
      score: 100, height: 50, durationMs: 1234, kills: 5,
    });
  });

  it('reports zero kills for an empty map', () => {
    emitRunEnd({
      heapId: 'h1', mode: 'infinite', cause: 'quit',
      score: 0, height: 0, durationMs: 1, kills: {},
    });
    expect(event.mock.calls[0][0].kills).toBe(0);
  });

  it('attaches the upgrades snapshot', () => {
    emitRunEnd({
      heapId: 'h1', mode: 'normal', cause: 'death',
      score: 1, height: 1, durationMs: 1, kills: {},
    });
    expect(event.mock.calls[0][0].upgrades).toEqual({ jump: 2 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/systems/__tests__/runEndEvent.test.ts`
Expected: FAIL — cannot resolve `../runEndEvent`.

- [ ] **Step 3: Write the module**

Create `src/systems/runEndEvent.ts`:

```ts
// src/systems/runEndEvent.ts
//
// The single `run:end` emit site. It used to be four copy-pasted blocks across
// GameScene (3) and InfiniteGameScene (1), each re-deriving the kill total by
// hand — so any new field had to be added in four places, and a dataset missing
// one of them looks complete until you go looking for the gap.

import { getLogger } from '../logging';
import { getUpgrades } from './SaveData';
import type { GameMode, RunEndCause } from '../../shared/logging/events';

export interface RunEndFacts {
  heapId: string;
  mode: GameMode;
  cause: RunEndCause;
  score: number;
  height: number;
  durationMs: number;
  /** Per-enemy-type kill counts; summed here so callers never do it themselves. */
  kills: Record<string, number>;
}

export function emitRunEnd(facts: RunEndFacts): void {
  const killCount = Object.values(facts.kills).reduce((sum, v) => sum + v, 0);
  getLogger().event({
    type: 'run:end',
    heapId: facts.heapId,
    mode: facts.mode,
    score: facts.score,
    height: facts.height,
    kills: killCount,
    durationMs: facts.durationMs,
    cause: facts.cause,
    upgrades: getUpgrades(),
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/systems/__tests__/runEndEvent.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Replace all four call sites**

In `src/scenes/GameScene.ts`, at each of the three `getLogger().event({ type: 'run:end', ... })` blocks, delete the block **and** the `const killCount = Object.values(this._runKills)...` line immediately above it, replacing both with:

```ts
emitRunEnd({
  heapId: this._heapId,
  mode: 'normal',
  cause: 'death', // 'quit' at the site that currently passes 'quit'
  score: runResult.finalScore,
  height: baseHeightPx,
  durationMs: elapsedMs,
  kills: this._runKills,
});
```

Keep each site's existing `cause` value — two are `'death'`, one is `'quit'`. Add the import at the top of the file:

```ts
import { emitRunEnd } from '../systems/runEndEvent';
```

In `src/scenes/InfiniteGameScene.ts`, the same, with `heapId: INFINITE_HEAP_ID`, `mode: 'infinite'`, `cause: 'death'`, and `height: score`.

Verify with `grep -n "type: 'run:end'" src/scenes/*.ts` — it must return **nothing**. Then `grep -cn "emitRunEnd" src/scenes/GameScene.ts` must be 4 (one import + three calls) and `src/scenes/InfiniteGameScene.ts` must be 2.

- [ ] **Step 6: Verify nothing changed behaviorally**

Run: `npm test`
Expected: PASS. This task adds three tests and changes no observable behavior — any other test that moves is a real regression, not an expected churn.

- [ ] **Step 7: Commit**

```bash
git add src/systems/runEndEvent.ts src/systems/__tests__/runEndEvent.test.ts \
        src/scenes/GameScene.ts src/scenes/InfiniteGameScene.ts
git commit -m "refactor(logging): extract the four run:end emit sites into one helper"
```

---

### Task 5: Roll pickups into the `run:end` payload

Every log entry is one `writeDataPoint`. `pickup:grab` fires once per grab, many times per run — with analytics default-on it becomes the single largest consumer of the AE quota. Folding a per-run tally into the `run:end` event that already fires costs **zero additional data points**.

This cuts per-run cost, but it does not offset default-on: default-on multiplies
the participating player count by one to two orders of magnitude, which
dominates the ~60% per-run reduction this task buys. This task reduces the
size of the increase; it does not pay for it. Watch actual AE data points for a
week after release before deciding whether the $5 paid tier is needed.

**Files:**
- Create: `src/systems/pickupTally.ts`
- Modify: `shared/logging/events.ts`, `src/systems/PickupManager.ts`, `src/systems/runEndEvent.ts`
- Test: `src/systems/__tests__/pickupTally.test.ts` (create), `src/systems/__tests__/runEndEvent.test.ts` (extend)

**Interfaces:**
- Consumes: `emitRunEnd` / `RunEndFacts` from Task 4.
- Produces:
  - `src/systems/pickupTally.ts`: `interface PickupTally { pickups: Record<string, number>; pickupBonus: number }`, `emptyTally(): PickupTally`, `recordGrab(tally, itemId, scoreBonus, rarity): PickupTally`
  - `PickupManager.getRunPickups(): PickupTally`
  - `RunEndFacts` gains `pickups: Record<string, number>` and `pickupBonus: number`; the `run:end` event payload gains the same two fields.
  - `pickup:grab` is **removed** from the `GameEvent` union.

Two details that are easy to get wrong, both called out in the spec:

- **Sum the awarded bonus, not the base.** The current event sends `pickup.def.scoreBonus`, but the value actually awarded is `Math.round(def.scoreBonus * RARITY_SCORE_MULT[rarity])` (`PickupManager.ts:259`). Carrying the base forward makes every pickup-value number systematically low.
- **Tally on grab, not from `carried`.** Shield items are granted without ever entering `carried` (`PickupManager.ts:251`), so reading the tally off `getCarriedItems()` would erase them from the data entirely.

- [ ] **Step 1: Write the failing tally test**

`PickupManager` takes a live Phaser `Scene` and `Player`, and no existing test
constructs one — stubbing it would be a large, brittle harness for three lines of
arithmetic. This repo's established pattern for exactly this case is a pure logic
module with real unit tests (`buffMath.ts`, `chunkCulling.ts`, `eyePhysics.ts`),
so the tally goes there and `PickupManager` delegates to it.

Create `src/systems/__tests__/pickupTally.test.ts`:

```ts
// src/systems/__tests__/pickupTally.test.ts

import { describe, it, expect } from 'vitest';
import { emptyTally, recordGrab } from '../pickupTally';

describe('pickupTally', () => {
  it('starts empty', () => {
    expect(emptyTally()).toEqual({ pickups: {}, pickupBonus: 0 });
  });

  it('counts a grab and sums the RARITY-SCALED bonus, not the base', () => {
    // mythic multiplier is 2.00 (shared/pickupScores.ts), so a base of 10 awards 20.
    const t = recordGrab(emptyTally(), 'rust_bolt', 10, 'mythic');
    expect(t).toEqual({ pickups: { rust_bolt: 1 }, pickupBonus: 20 });
  });

  it('rounds the scaled bonus the same way the award does', () => {
    // common multiplier is 0.75 -> 10 * 0.75 = 7.5 -> Math.round -> 8
    const t = recordGrab(emptyTally(), 'rust_bolt', 10, 'common');
    expect(t.pickupBonus).toBe(8);
  });

  it('accumulates repeat grabs of the same item id', () => {
    let t = emptyTally();
    t = recordGrab(t, 'rust_bolt', 10, 'rare');
    t = recordGrab(t, 'rust_bolt', 10, 'rare');
    expect(t.pickups).toEqual({ rust_bolt: 2 });
    expect(t.pickupBonus).toBe(20); // rare multiplier is 1.00
  });

  it('keeps distinct item ids separate', () => {
    let t = emptyTally();
    t = recordGrab(t, 'rust_bolt', 10, 'rare');
    t = recordGrab(t, 'cracked_lens', 4, 'rare');
    expect(t.pickups).toEqual({ rust_bolt: 1, cracked_lens: 1 });
    expect(t.pickupBonus).toBe(14);
  });

  it('does not mutate the tally it was given', () => {
    const before = emptyTally();
    const after = recordGrab(before, 'rust_bolt', 10, 'rare');
    expect(before).toEqual({ pickups: {}, pickupBonus: 0 });
    expect(after).not.toBe(before);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/systems/__tests__/pickupTally.test.ts`
Expected: FAIL — cannot resolve `../pickupTally`.

- [ ] **Step 3: Write the pure tally module**

Create `src/systems/pickupTally.ts`:

```ts
// src/systems/pickupTally.ts
//
// Per-run pickup tally. Pure so it can be tested without a Phaser scene —
// PickupManager owns an instance and delegates to these functions.
//
// This replaces the old per-grab `pickup:grab` event, which cost one Analytics
// Engine data point for every pickup in every run and was the single largest
// consumer of the free-tier quota once analytics defaulted on. The tally rides
// along in the `run:end` event that already fires, for zero extra data points.

import { RARITY_SCORE_MULT, type Rarity } from '../../shared/pickupScores';

export interface PickupTally {
  /** Grab count per item id. */
  pickups: Record<string, number>;
  /** Sum of the AWARDED (rarity-scaled) bonuses. */
  pickupBonus: number;
}

export function emptyTally(): PickupTally {
  return { pickups: {}, pickupBonus: 0 };
}

/**
 * Records one grab, returning a new tally.
 *
 * `scoreBonus` is the item's BASE bonus; the figure added here is the
 * rarity-scaled one the player actually received. The old `pickup:grab` event
 * logged the base instead, which made every pickup-value number come out low —
 * do not reintroduce that by dropping the multiplier.
 */
export function recordGrab(
  tally: PickupTally, itemId: string, scoreBonus: number, rarity: Rarity,
): PickupTally {
  return {
    pickups: { ...tally.pickups, [itemId]: (tally.pickups[itemId] ?? 0) + 1 },
    pickupBonus: tally.pickupBonus + Math.round(scoreBonus * RARITY_SCORE_MULT[rarity]),
  };
}
```

- [ ] **Step 4: Run the test, then wire PickupManager to it**

Run: `npx vitest run src/systems/__tests__/pickupTally.test.ts`
Expected: PASS — 6 tests.

Then in `src/systems/PickupManager.ts`, add the field next to the existing
`private carried: CarriedPickup[] = [];`:

```ts
/** Per-run pickup tally, folded into run:end instead of one AE data point per
 *  grab. A PickupManager is constructed per scene, so a new run starts clean. */
private tally: PickupTally = emptyTally();
```

with the import:

```ts
import { emptyTally, recordGrab, type PickupTally } from './pickupTally';
```

At the grab site (currently `PickupManager.ts:265`), **delete** the
`getLogger().event({ type: 'pickup:grab', ... })` line and put this in its place:

```ts
// Tallied here rather than read off `carried`, because a shield item is granted
// without ever entering `carried` (see the grantsShield branch above) and would
// otherwise vanish from the data entirely.
this.tally = recordGrab(this.tally, pickup.def.id, pickup.def.scoreBonus, pickup.rarity);
```

That line sits after the `if (pickup.def.grantsShield) { … } else { … }` block, in
the position the deleted `getLogger().event(...)` call already occupied — which
already runs for both branches, shields included.

Add the getter next to `getCarriedItems()`:

```ts
/** This run's pickup tally, for the run:end payload. */
getRunPickups(): PickupTally { return this.tally; }
```

If `getLogger` is now unused in this file, remove its import.

- [ ] **Step 5: Remove `pickup:grab` from the event union**

In `shared/logging/events.ts`, delete this member:

```ts
  | { type: 'pickup:grab'; itemId: string; bonus: number }
```

and add the two fields to the `run:end` member:

```ts
  | {
      type: 'run:end';
      heapId: string;
      mode: GameMode;
      score: number;
      height: number;
      kills: number;
      durationMs: number;
      cause: RunEndCause;
      upgrades: UpgradesSnapshot;
      /** Per-item grab counts for the run — replaces the old per-grab
       *  `pickup:grab` event, which cost one AE data point per pickup. */
      pickups: Record<string, number>;
      /** Sum of the AWARDED (rarity-scaled) bonuses for those grabs. */
      pickupBonus: number;
    }
```

- [ ] **Step 6: Thread the fields through `emitRunEnd`**

In `src/systems/runEndEvent.ts`, add to `RunEndFacts`:

```ts
  pickups: Record<string, number>;
  pickupBonus: number;
```

and to the emitted object:

```ts
    pickups: facts.pickups,
    pickupBonus: facts.pickupBonus,
```

Extend `src/systems/__tests__/runEndEvent.test.ts` — add `pickups: {}, pickupBonus: 0` to the existing three calls, and add:

```ts
it('passes the pickup tally straight through', () => {
  emitRunEnd({
    heapId: 'h1', mode: 'normal', cause: 'death',
    score: 1, height: 1, durationMs: 1, kills: {},
    pickups: { rust_bolt: 3 }, pickupBonus: 60,
  });
  expect(event.mock.calls[0][0]).toMatchObject({ pickups: { rust_bolt: 3 }, pickupBonus: 60 });
});
```

- [ ] **Step 7: Pass the tally at all four call sites**

At each `emitRunEnd({ ... })` call in `GameScene.ts` (3) and `InfiniteGameScene.ts` (1), add:

```ts
  ...this.pickupManager.getRunPickups(),
```

The spread supplies both `pickups` and `pickupBonus` in one line and keeps the four sites identical. TypeScript will fail the build at any site that misses it, which is the point of Task 4's extraction.

- [ ] **Step 8: Verify**

Run: `npm test && npm run build`
Expected: both PASS. The build is what proves no `pickup:grab` reference survives anywhere — a stale emit site is a type error now that the union member is gone.

- [ ] **Step 9: Commit**

```bash
git add shared/logging/events.ts src/systems/pickupTally.ts src/systems/PickupManager.ts \
        src/systems/runEndEvent.ts src/systems/__tests__/pickupTally.test.ts \
        src/systems/__tests__/runEndEvent.test.ts \
        src/scenes/GameScene.ts src/scenes/InfiniteGameScene.ts
git commit -m "feat(analytics): roll per-grab pickup events into the run:end payload"
```

---

### Task 6: Project run facts into dedicated AE columns

Analytics Engine SQL has **no JSON functions** — its string functions are only
`length`/`empty`/`lower`/`upper`/`startsWith`/`endsWith`/`position`/`substring`/
`format`/`extract`. So every number inside the payload JSON in `blob6` is
invisible to a query. That makes `run:end`'s `durationMs`, `score`, `height`,
`kills`, `cause` and `pickupBonus` unqueryable — and those are exactly the
dimensions Plan 3's churn cross-tab splits on.

Promote them into real AE columns. AE allows 20 blobs and 20 doubles; the sink
uses 7 and 1, so this is spare capacity. It must ship here, not in Plan 3,
because it changes what is *written*: rows logged before it have no such columns.

**Files:**
- Create: `shared/logging/aeProjection.ts`, `shared/__tests__/aeProjection.test.ts`
- Modify: `shared/logging/Logger.ts` (add `metrics` to `LogEntry`), `src/logging/RemoteLogger.ts` (populate it), `server/src/platform/logging/AnalyticsEngineSink.ts` (append it)
- Test: `server/tests/logSinks.test.ts` (extend)

**Interfaces:**
- Consumes: the `run:end` shape from Task 5 (with `pickups`/`pickupBonus`).
- Produces:
  - `LogEntry.metrics?: { doubles?: number[]; blobs?: string[] }` — game-agnostic.
  - `projectEventMetrics(e: GameEvent): { doubles?: number[]; blobs?: string[] } | undefined`
  - AE column meanings, appended after the frozen layout: `double2`=score, `double3`=height, `double4`=kills, `double5`=durationMs, `double6`=pickupBonus, `blob8`=cause.

**The platform/game seam matters here.** `server/src/platform/logging/` must not learn what a `run:end` is — it appends whatever numbers it is handed, positionally, without interpreting them. All game knowledge lives in the `shared/logging/aeProjection.ts` mapper.

- [ ] **Step 1: Write the failing projection test**

Create `shared/__tests__/aeProjection.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { projectEventMetrics } from '../logging/aeProjection';

describe('projectEventMetrics', () => {
  it('projects run:end facts in the documented column order', () => {
    const out = projectEventMetrics({
      type: 'run:end', heapId: 'h1', mode: 'normal',
      score: 1200, height: 340, kills: 5, durationMs: 61000,
      cause: 'death', upgrades: {}, pickups: { rust_bolt: 2 }, pickupBonus: 40,
    });
    // double2..double6
    expect(out?.doubles).toEqual([1200, 340, 5, 61000, 40]);
    // blob8
    expect(out?.blobs).toEqual(['death']);
  });

  it('distinguishes quit from death in the cause column', () => {
    const out = projectEventMetrics({
      type: 'run:end', heapId: 'h1', mode: 'infinite',
      score: 0, height: 0, kills: 0, durationMs: 1,
      cause: 'quit', upgrades: {}, pickups: {}, pickupBonus: 0,
    });
    expect(out?.blobs).toEqual(['quit']);
  });

  it('projects nothing for events with no numeric facts', () => {
    expect(projectEventMetrics({ type: 'user:created' })).toBeUndefined();
    expect(projectEventMetrics({ type: 'run:start', heapId: 'h1', mode: 'normal' })).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run shared/__tests__/aeProjection.test.ts`
Expected: FAIL — cannot resolve `../logging/aeProjection`.

- [ ] **Step 3: Write the mapper**

Create `shared/logging/aeProjection.ts`:

```ts
// shared/logging/aeProjection.ts
//
// Promotes a few run facts out of the payload JSON and into dedicated Analytics
// Engine columns.
//
// Why this exists: AE SQL has NO JSON functions (its string functions are only
// length/empty/lower/upper/startsWith/endsWith/position/substring/format/
// extract), so anything inside the payload blob is invisible to a query. The
// churn cross-tab splits on exactly these numbers, so they have to be columns.
//
// This file is the ONLY place that knows which game fields map to which column.
// The AE sink appends whatever it is handed, positionally, and stays free of
// game concepts.

import type { GameEvent } from './events';

export interface EventMetrics {
  /** Appended after double1 — so index 0 here is `double2`. */
  doubles?: number[];
  /** Appended after blob7 — so index 0 here is `blob8`. */
  blobs?: string[];
}

/**
 * Column assignments. Documented here because a query cannot see them and a
 * reader of the SQL has nothing else to go on:
 *
 *   double2 = score        double5 = durationMs
 *   double3 = height       double6 = pickupBonus
 *   double4 = kills        blob8   = cause ('death' | 'quit')
 *
 * These positions are APPEND-ONLY. Reusing one for a different field would
 * silently reinterpret every row already stored.
 */
export function projectEventMetrics(e: GameEvent): EventMetrics | undefined {
  if (e.type !== 'run:end') return undefined;
  return {
    doubles: [e.score, e.height, e.kills, e.durationMs, e.pickupBonus],
    blobs: [e.cause],
  };
}
```

- [ ] **Step 4: Run the projection test**

Run: `npx vitest run shared/__tests__/aeProjection.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Carry `metrics` through the log entry**

In `shared/logging/Logger.ts`, add to `LogEntry`:

```ts
  /** Optional extra AE columns, appended positionally by the sink. The sink
   *  never interprets these — see shared/logging/aeProjection.ts. */
  metrics?: { doubles?: number[]; blobs?: string[] };
```

In `src/logging/RemoteLogger.ts`, in `event()`, attach the projection:

```ts
  event<E extends GameEvent>(e: E): void {
    if (!this.verbose) return;
    try {
      const { type, ...payload } = e as any;
      this.enqueue('event', { eventType: type, payload, metrics: projectEventMetrics(e) });
    } catch { /* swallow */ }
  }
```

Widen `enqueue`'s `parts` parameter to accept the optional `metrics` and copy it onto the raw entry alongside `eventType` and `payload`. Import `projectEventMetrics` from `../../shared/logging/aeProjection`.

- [ ] **Step 6: Append the columns in the AE sink**

In `server/src/platform/logging/AnalyticsEngineSink.ts`, extend `writeDataPoint`:

```ts
      this.ae.writeDataPoint({
        indexes: [userGuidIndex(e.userGuid)],
        blobs: [
          e.level,
          e.eventType ?? e.message ?? '',
          e.platform,
          e.appVersion,
          e.sessionId,
          payloadJson(e.payload),
          e.userAgent.slice(0, 200),
          // blob8+ — caller-supplied, never interpreted here. Keeping this
          // sink free of game concepts is why the mapping lives in
          // shared/logging/aeProjection.ts instead.
          ...(e.metrics?.blobs ?? []),
        ],
        doubles: [e.timestamp, ...(e.metrics?.doubles ?? [])],
      });
```

- [ ] **Step 7: Test the sink's appending**

Add to `server/tests/logSinks.test.ts`:

```ts
it('appends caller-supplied metric columns after the fixed layout', async () => {
  const { ae, points } = fakeAE();
  await new AnalyticsEngineSink(ae).write([entry({
    level: 'event', eventType: 'run:end',
    metrics: { doubles: [1200, 340, 5, 61000, 40], blobs: ['death'] },
  })]);
  // double1 stays the client timestamp; the projection follows it
  expect(points[0].doubles).toEqual([100, 1200, 340, 5, 61000, 40]);
  // blob8 follows the seven fixed blobs
  expect(points[0].blobs).toHaveLength(8);
  expect(points[0].blobs[7]).toBe('death');
});

it('writes the fixed layout unchanged when no metrics are supplied', async () => {
  const { ae, points } = fakeAE();
  await new AnalyticsEngineSink(ae).write([entry()]);
  expect(points[0].doubles).toEqual([100]);
  expect(points[0].blobs).toHaveLength(7);
});
```

- [ ] **Step 8: Verify**

Run: `npm test && npm run build`
Expected: both PASS.

- [ ] **Step 9: Commit**

```bash
git add shared/logging/aeProjection.ts shared/__tests__/aeProjection.test.ts \
        shared/logging/Logger.ts src/logging/RemoteLogger.ts \
        server/src/platform/logging/AnalyticsEngineSink.ts server/tests/logSinks.test.ts
git commit -m "feat(analytics): promote run:end facts into queryable AE columns"
```

---

### Task 7: Privacy surfaces

Default-on analytics changes what Heap collects without the player doing anything. The policy and the Play Console declaration must say so in the same release, not after it.

**Files:**
- Modify: `PRIVACY_POLICY.md` (§ "Data collected automatically", § "Changing or withdrawing your consent")
- Create: `docs/superpowers/runbooks/play-data-safety-analytics.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Update the privacy policy**

In `PRIVACY_POLICY.md` under **"Data collected automatically"**, add gameplay analytics as a collected-by-default category. Describe what is actually sent, which is exactly the `GameEvent` union in `shared/logging/events.ts` after Task 5: run starts and ends (score, height reached, kills, duration, how the run ended, upgrade levels, items picked up), heap selection, placements, score submissions, shares, and purchases — plus the envelope (an anonymous player id, a session id, app version, platform, and user agent).

State plainly that this is **on by default** and can be turned off at any time in **Settings → "Send anonymous gameplay analytics"**, and that error and crash reports are sent regardless of that setting (which is already true and already stated in the in-game copy).

In **"Changing or withdrawing your consent"**, add the same Settings path so the two sections agree.

Do not claim the data is anonymised beyond what is true: the player id is a stable pseudonymous identifier, not an anonymous one — it is exactly how a player's events are linked across sessions.

- [ ] **Step 2: Write the Play Data Safety runbook**

Create `docs/superpowers/runbooks/play-data-safety-analytics.md` recording what must change in the Play Console **Data safety** form when this ships, and why: which data types are now collected by default rather than optionally, that collection is now on by default with an in-app opt-out, and that the form must be resubmitted with the release rather than left describing the old opt-in behavior. Note that the form's answers must match `PRIVACY_POLICY.md` — a mismatch between them is the specific thing Play review flags.

- [ ] **Step 3: Commit**

```bash
git add PRIVACY_POLICY.md docs/superpowers/runbooks/play-data-safety-analytics.md
git commit -m "docs: record default-on analytics in the privacy policy and Data Safety runbook"
```

---

### Task 8: Full verification

**Files:** none modified — checks only.

- [ ] **Step 1: Confirm the old event is fully gone**

Run: `grep -rn "pickup:grab" src/ shared/ server/ --include=*.ts`
Expected: **no matches.** A match in a test or a type means Task 5 is incomplete.

- [ ] **Step 2: Confirm one emit site**

Run: `grep -rn "type: 'run:end'" src/ --include=*.ts`
Expected: exactly one match, in `src/systems/runEndEvent.ts`.

- [ ] **Step 3: Confirm the envelope id**

Run: `grep -n "getPlayerGuid\|getEffectivePlayerId" src/logging/index.ts`
Expected: `getEffectivePlayerId` present; `getPlayerGuid` absent (or clearly used for something other than the envelope).

- [ ] **Step 4: Full suite and build**

Run: `npm test && npm run build`
Expected: both PASS.

- [ ] **Step 5: Deploy to staging and verify the pipeline end to end**

This plan's whole point is data actually arriving, correctly keyed, in columns a
query can read. Unit tests cannot prove that — only a real round trip can.

```bash
cd server && npx wrangler deploy --env staging
```

Then run the client against staging:

```bash
VITE_HEAP_SERVER_URL=https://heap-server-staging.hanlinsoftwaresws.workers.dev npm run dev
```

Play a run to completion (grab at least one salvage item, and ideally one shield
item, so the tally has something in it). Wait ~1 minute for AE ingestion, then
query `heap_logs_staging` via the SQL API and confirm, in order:

1. A `run:end` row exists (`blob2 = 'run:end'`).
2. Its `index1` is the **effective player id** — equal to your GPGS id when
   signed in, not the raw GUID.
3. `double2..double6` carry score / height / kills / durationMs / pickupBonus,
   and `blob8` carries `'death'` or `'quit'`. These being non-zero is the whole
   proof that Task 6 works — if they are all 0, the projection is not wired.
4. **No** `pickup:grab` rows exist in the window (Task 5 removed them).
5. The payload blob still parses as JSON.

`.github/workflows/fetch-logs.yml` hardcodes `FROM heap_logs` and cannot read the
staging dataset — query the SQL API directly rather than reaching for it, or add
a `dataset` input to that workflow first.

- [ ] **Step 6: Smoke test**

This changes what the running game sends. Use the `smoke-testing-heap` skill to verify in a browser that a run start → run end round trip produces exactly one `run:end` request carrying `pickups`/`pickupBonus`, and **no** `pickup:grab` requests, with analytics left at its new default. Confirm the Settings toggle still turns event sending off.

- [ ] **Step 7: Open the PR**

```bash
git push -u origin feature/analytics-instrumentation
gh pr create --base feature/player-analytics \
  --title "Player analytics 2/3: instrumentation" --body "..."
```

The base is Plan 1's branch, not `main` — this is a stacked PR. Retarget it to
`main` once PR #188 merges.

In the body, state explicitly that this changes data collection defaults, that `PRIVACY_POLICY.md` and the Data Safety runbook ship with it, and that the Play Console form must be resubmitted at release.

---

## Notes for the executor

- **No schema changes and no migrations in this plan.** If you are writing SQL DDL, you have misread it.
- **Do not touch the tutorial.** Spec Phase 3 is deferred; `TutorialScene.ts`, `TutorialDirector.ts` and `tutorialFixture.ts` are out of scope.
- `user:created` in `MenuScene.ts:126` is **correct as-is — do not "fix" it.** Its localStorage flag is set whether or not the event actually sends, so existing players (who all have the flag set from before analytics defaulted on) will never emit it, and only genuinely-new installs will. That is the desired behavior for a new-user signal.
- Task 1 must land before Task 2. The index widening is what stops Task 2 from silently truncating signed-in players' ids.
- Task 6 must land in this plan, not Plan 3. It changes what is *written*, so any run logged before it is missing the columns Plan 3's cross-tab needs. Landing it here means history splits exactly once, at the same deploy as Task 2's key change.
- Task 4 must land before Task 5, as its own commit, with tests green. That ordering is the whole point: it turns "add a field to four copy-pasted blocks" into "add it once."

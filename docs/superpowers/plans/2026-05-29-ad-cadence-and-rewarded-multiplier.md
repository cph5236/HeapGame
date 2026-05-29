# Ad Cadence & Rewarded 2× Multiplier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pace ads to ~every 2–5 runs, offer a rewarded 2× only on those "ad runs" (watching it suppresses the exit interstitial), and commit coins once on exit at `finalCoins × multiplier` — eliminating the current double-award.

**Architecture:** A new `AdCadence` module owns *when* an ad appears (persisted run counter + random target in SaveData); providers stay responsible for *how*. `AdProvider.enabled` lets web/NullProvider opt out of ad runs entirely. `buildCoinBreakdown` gains an `adBonusMultiplier` that appends an `ad_bonus` row. ScoreScene defers the balance write to its exit paths and rebuilds the coins panel when 2× is applied.

**Tech Stack:** TypeScript, Phaser 3, Vitest. Spec: `docs/superpowers/specs/2026-05-29-ad-cadence-and-rewarded-multiplier-design.md`.

---

## File Structure

- `src/systems/ads/AdProvider.ts` — add `readonly enabled: boolean` to the interface.
- `src/systems/ads/NullProvider.ts` / `AdMobProvider.ts` — implement `enabled` (`false` / `true`).
- `src/systems/SaveData.ts` — add `adRunsSinceLast` / `adRunTarget` fields + `getAdRunState` / `setAdRunState`; preserve them through `migrate` and `mergeCloudSave`.
- `src/systems/ads/AdCadence.ts` — **new**: `rollTarget`, `decideAdRun` (pure), `registerRun(enabled, rand?)`.
- `src/systems/ads/__tests__/AdCadence.test.ts` — **new**: unit tests for the above.
- `src/systems/coinBreakdown.ts` — add `ad_bonus` row type + `adBonusMultiplier` input.
- `src/systems/__tests__/coinBreakdown.test.ts` — add tests for `adBonusMultiplier`.
- `src/scenes/ScoreScene.ts` — deferred award, ad-run gating, interstitial suppression, rebuildable coins panel + 2× row, leaderboard shift.

---

### Task 1: Add `enabled` capability to the ad provider interface

**Files:**
- Modify: `src/systems/ads/AdProvider.ts`
- Modify: `src/systems/ads/NullProvider.ts`
- Modify: `src/systems/ads/AdMobProvider.ts`

- [ ] **Step 1: Add `enabled` to the interface**

In `src/systems/ads/AdProvider.ts`, add the property as the first member:

```ts
export interface AdProvider {
  readonly enabled: boolean;
  initialize(): Promise<void>;
  showInterstitial(): Promise<void>;
  showRewarded(): Promise<boolean>;
}
```

- [ ] **Step 2: Implement in NullProvider**

In `src/systems/ads/NullProvider.ts`, add the field to the class:

```ts
export class NullProvider implements AdProvider {
  readonly enabled = false;
  async initialize(): Promise<void> {}
  async showInterstitial(): Promise<void> {}
  async showRewarded(): Promise<boolean> { return false; }
}
```

- [ ] **Step 3: Implement in AdMobProvider**

In `src/systems/ads/AdMobProvider.ts`, add the field at the top of the class body (just before `async initialize()`):

```ts
export class AdMobProvider implements AdProvider {
  readonly enabled = true;

  async initialize(): Promise<void> {
```

- [ ] **Step 4: Verify the project still type-checks**

Run: `npm run build`
Expected: `✓ built` with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/systems/ads/AdProvider.ts src/systems/ads/NullProvider.ts src/systems/ads/AdMobProvider.ts
git commit -m "feat(ads): add enabled capability to AdProvider"
```

---

### Task 2: SaveData ad-run pacing state

**Files:**
- Modify: `src/systems/SaveData.ts` (RawSave interface ~37-51; migrate ~96-112; mergeCloudSave return ~425-437; new accessors near the balance section ~183)
- Test: `src/systems/__tests__/SaveData.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/systems/__tests__/SaveData.test.ts` (add `getAdRunState`, `setAdRunState` to the import list from `../SaveData` at the top of the file):

```ts
describe('ad-run pacing state', () => {
  it('defaults to runsSinceLast 0 and target 0 (unseeded) on a fresh save', () => {
    expect(getAdRunState()).toEqual({ runsSinceLast: 0, target: 0 });
  });

  it('round-trips through setAdRunState', () => {
    setAdRunState({ runsSinceLast: 2, target: 4 });
    expect(getAdRunState()).toEqual({ runsSinceLast: 2, target: 4 });
  });

  it('persists across a cache reset (reload from storage)', () => {
    setAdRunState({ runsSinceLast: 1, target: 3 });
    resetCacheForTests();
    expect(getAdRunState()).toEqual({ runsSinceLast: 1, target: 3 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/systems/__tests__/SaveData.test.ts`
Expected: FAIL — `getAdRunState is not a function` (or import error).

- [ ] **Step 3: Add the RawSave fields**

In `src/systems/SaveData.ts`, add to the `RawSave` interface (after `soundSettings?`):

```ts
  soundSettings?: SoundSettings;
  adRunsSinceLast?: number;
  adRunTarget?:     number;
```

- [ ] **Step 4: Preserve the fields through migrate**

In `migrate`, inside the `version === CURRENT_SCHEMA` returned object, add after `soundSettings: ...`:

```ts
      soundSettings:  parsed.soundSettings  ?? { ...DEFAULT_SOUND_SETTINGS },
      adRunsSinceLast: parsed.adRunsSinceLast,
      adRunTarget:     parsed.adRunTarget,
```

- [ ] **Step 5: Preserve local pacing through a cloud merge**

In `mergeCloudSave`, add to the returned object (after `verboseLogging: local.verboseLogging,`) — pacing is device-local, so always keep the local values:

```ts
    verboseLogging: local.verboseLogging,
    adRunsSinceLast: local.adRunsSinceLast,
    adRunTarget:     local.adRunTarget,
```

- [ ] **Step 6: Add the accessors**

In `src/systems/SaveData.ts`, immediately after `addBalance` (~line 183), add:

```ts
// ── Ad-run pacing (device-local; not cloud-synced) ──────────────────────────────

export function getAdRunState(): { runsSinceLast: number; target: number } {
  const data = load();
  return { runsSinceLast: data.adRunsSinceLast ?? 0, target: data.adRunTarget ?? 0 };
}

export function setAdRunState(state: { runsSinceLast: number; target: number }): void {
  const data = load();
  data.adRunsSinceLast = state.runsSinceLast;
  data.adRunTarget     = state.target;
  persist(data);
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test -- src/systems/__tests__/SaveData.test.ts`
Expected: PASS (all existing SaveData tests still green too).

- [ ] **Step 8: Commit**

```bash
git add src/systems/SaveData.ts src/systems/__tests__/SaveData.test.ts
git commit -m "feat(savedata): persist device-local ad-run pacing state"
```

---

### Task 3: `AdCadence` module

**Files:**
- Create: `src/systems/ads/AdCadence.ts`
- Test: `src/systems/ads/__tests__/AdCadence.test.ts`

Notes for the engineer: `decideAdRun` and `rollTarget` are pure (a random source is injected so tests are deterministic). `registerRun` takes `enabled` as a parameter (rather than importing `AdClient`) so it can be tested without the singleton — the caller passes `AdClient.enabled`. Target range is inclusive [2, 5]. A `target` of `0` means "unseeded" — `registerRun` seeds it on first use, which guarantees run 1 is never an ad (the counter must reach a target ≥ 2).

- [ ] **Step 1: Write the failing test**

Create `src/systems/ads/__tests__/AdCadence.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { rollTarget, decideAdRun, registerRun, AD_CADENCE_MIN, AD_CADENCE_MAX } from '../AdCadence';
import { getAdRunState, setAdRunState, resetCacheForTests } from '../../SaveData';

// Stub localStorage — vitest runs in node environment
const store: Record<string, string> = {};
beforeAll(() => {
  Object.defineProperty(global, 'localStorage', {
    value: {
      getItem:    (k: string) => store[k] ?? null,
      setItem:    (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear:      () => { Object.keys(store).forEach(k => delete store[k]); },
    },
    configurable: true,
  });
});
beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
  resetCacheForTests();
});

describe('rollTarget', () => {
  it('returns AD_CADENCE_MIN when rand is 0', () => {
    expect(rollTarget(() => 0)).toBe(AD_CADENCE_MIN);
  });
  it('returns AD_CADENCE_MAX when rand approaches 1', () => {
    expect(rollTarget(() => 0.999)).toBe(AD_CADENCE_MAX);
  });
  it('stays within [MIN, MAX]', () => {
    for (let i = 0; i < 50; i++) {
      const t = rollTarget();
      expect(t).toBeGreaterThanOrEqual(AD_CADENCE_MIN);
      expect(t).toBeLessThanOrEqual(AD_CADENCE_MAX);
    }
  });
});

describe('decideAdRun', () => {
  it('does not fire before the target is reached', () => {
    const { next, isAdRun } = decideAdRun({ runsSinceLast: 0, target: 3 });
    expect(isAdRun).toBe(false);
    expect(next).toEqual({ runsSinceLast: 1, target: 3 });
  });

  it('fires and re-rolls when the counter reaches the target', () => {
    const { next, isAdRun } = decideAdRun({ runsSinceLast: 2, target: 3 }, () => 0);
    expect(isAdRun).toBe(true);
    expect(next).toEqual({ runsSinceLast: 0, target: AD_CADENCE_MIN }); // rand=0 -> MIN
  });

  it('never fires on run 1 even at the minimum target', () => {
    const { isAdRun } = decideAdRun({ runsSinceLast: 0, target: AD_CADENCE_MIN });
    expect(isAdRun).toBe(false);
  });
});

describe('registerRun', () => {
  it('returns false and does not mutate state when ads are disabled', () => {
    setAdRunState({ runsSinceLast: 1, target: 3 });
    expect(registerRun(false)).toBe(false);
    expect(getAdRunState()).toEqual({ runsSinceLast: 1, target: 3 });
  });

  it('seeds an unseeded target and increments when enabled', () => {
    expect(registerRun(true, () => 0)).toBe(false);          // seeds target=MIN(2), runsSinceLast 0->1
    expect(getAdRunState()).toEqual({ runsSinceLast: 1, target: AD_CADENCE_MIN });
  });

  it('fires on the run that reaches the target', () => {
    setAdRunState({ runsSinceLast: 1, target: 2 });
    expect(registerRun(true, () => 0)).toBe(true);           // 1->2 reaches target -> ad run
    expect(getAdRunState()).toEqual({ runsSinceLast: 0, target: AD_CADENCE_MIN });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/systems/ads/__tests__/AdCadence.test.ts`
Expected: FAIL — cannot find module `../AdCadence`.

- [ ] **Step 3: Write the implementation**

Create `src/systems/ads/AdCadence.ts`:

```ts
import { getAdRunState, setAdRunState } from '../SaveData';

export const AD_CADENCE_MIN = 2;
export const AD_CADENCE_MAX = 5;

export interface AdRunState {
  runsSinceLast: number;
  target:        number;
}

/** Random target in the inclusive range [AD_CADENCE_MIN, AD_CADENCE_MAX]. */
export function rollTarget(rand: () => number = Math.random): number {
  const span = AD_CADENCE_MAX - AD_CADENCE_MIN + 1;
  return AD_CADENCE_MIN + Math.floor(rand() * span);
}

/**
 * Pure decision: increment the counter and decide whether THIS run is an ad run.
 * On a fire, the counter resets to 0 and the target is re-rolled.
 */
export function decideAdRun(
  state: AdRunState,
  rand: () => number = Math.random,
): { next: AdRunState; isAdRun: boolean } {
  const runsSinceLast = state.runsSinceLast + 1;
  if (runsSinceLast >= state.target) {
    return { next: { runsSinceLast: 0, target: rollTarget(rand) }, isAdRun: true };
  }
  return { next: { runsSinceLast, target: state.target }, isAdRun: false };
}

/**
 * Register a completed run and report whether an ad should appear.
 * `enabled` is passed in (AdClient.enabled) so this stays testable without the singleton.
 * Returns false without mutating state when ads are disabled (web/dev).
 */
export function registerRun(enabled: boolean, rand: () => number = Math.random): boolean {
  if (!enabled) return false;
  const raw   = getAdRunState();
  const state: AdRunState = raw.target > 0 ? raw : { runsSinceLast: 0, target: rollTarget(rand) };
  const { next, isAdRun } = decideAdRun(state, rand);
  setAdRunState(next);
  return isAdRun;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/systems/ads/__tests__/AdCadence.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/systems/ads/AdCadence.ts src/systems/ads/__tests__/AdCadence.test.ts
git commit -m "feat(ads): add AdCadence run-pacing module"
```

---

### Task 4: `adBonusMultiplier` in `buildCoinBreakdown`

**Files:**
- Modify: `src/systems/coinBreakdown.ts`
- Test: `src/systems/__tests__/coinBreakdown.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/systems/__tests__/coinBreakdown.test.ts`:

```ts
describe('adBonusMultiplier', () => {
  it('appends an ad_bonus row and doubles finalCoins when set to 2', () => {
    const result = buildCoinBreakdown({
      score: 500,
      scoreToCoins: 100,
      moneyMultiplier: 1,
      isPeak: false,
      peakMultiplier: 1.25,
      isFailure: false,
      adBonusMultiplier: 2,
    });
    // base = 5, then x2 ad bonus = 10
    expect(result.finalCoins).toBe(10);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]).toEqual({ type: 'ad_bonus', multiplier: 2, runningTotal: 10 });
  });

  it('is a no-op when omitted (default 1)', () => {
    const result = buildCoinBreakdown({
      score: 500,
      scoreToCoins: 100,
      moneyMultiplier: 1,
      isPeak: false,
      peakMultiplier: 1.25,
      isFailure: false,
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows.some(r => r.type === 'ad_bonus')).toBe(false);
    expect(result.finalCoins).toBe(5);
  });

  it('applies after the death penalty', () => {
    const result = buildCoinBreakdown({
      score: 1000,
      scoreToCoins: 100,
      moneyMultiplier: 1,
      isPeak: false,
      peakMultiplier: 1.25,
      isFailure: true,          // base 10 -> x0.5 = 5
      adBonusMultiplier: 2,     // -> x2 = 10
    });
    expect(result.finalCoins).toBe(10);
    expect(result.rows[result.rows.length - 1]).toEqual({ type: 'ad_bonus', multiplier: 2, runningTotal: 10 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/systems/__tests__/coinBreakdown.test.ts`
Expected: FAIL — ad_bonus not produced / `adBonusMultiplier` not accepted by the type.

- [ ] **Step 3: Add `ad_bonus` to the row type**

In `src/systems/coinBreakdown.ts`, extend the `MultiplierRow` type union:

```ts
export type MultiplierRow = {
  type: 'money_mult' | 'heap_coin_mult' | 'peak_hunter' | 'death_penalty' | 'off_peak_bonus' | 'ad_bonus';
  multiplier: number;
  runningTotal: number;
};
```

- [ ] **Step 4: Add the input field**

In the `BreakdownInput` interface, add (after `offPeakBonus?`):

```ts
  offPeakBonus?:   number;  // flat coins added when placement is off-peak
  adBonusMultiplier?: number; // rewarded-ad multiplier applied last (default 1)
```

- [ ] **Step 5: Apply the multiplier last**

In `buildCoinBreakdown`, add `adBonusMultiplier = 1` to the destructuring, and add this block immediately before `return { rows, finalCoins: running };`:

```ts
  if (adBonusMultiplier > 1) {
    running = Math.floor(running * adBonusMultiplier);
    rows.push({ type: 'ad_bonus', multiplier: adBonusMultiplier, runningTotal: running });
  }

  return { rows, finalCoins: running };
```

The destructuring line becomes:

```ts
  const { score, scoreToCoins, moneyMultiplier, heapCoinMult = 1, isPeak, peakMultiplier, isFailure, offPeakBonus = 0, adBonusMultiplier = 1 } = input;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- src/systems/__tests__/coinBreakdown.test.ts`
Expected: PASS (existing cases still green).

- [ ] **Step 7: Commit**

```bash
git add src/systems/coinBreakdown.ts src/systems/__tests__/coinBreakdown.test.ts
git commit -m "feat(coins): support adBonusMultiplier row in buildCoinBreakdown"
```

---

### Task 5: ScoreScene — defer the coin award to exit

**Files:**
- Modify: `src/scenes/ScoreScene.ts`

This task removes the eager `addBalance` and commits coins once on exit. (No unit test — Phaser scene; verified by build + the smoke checklist in Task 8.)

- [ ] **Step 1: Add per-run fields**

In the field block (~line 54-56, near `_rewardedUsed`), add:

```ts
  private _rewardedUsed:   boolean                        = false;
  private _rewardedWatched: boolean                       = false;
  private _multiplier:     number                         = 1;
  private _coinsCommitted: boolean                        = false;
  private _balanceText:    Phaser.GameObjects.Text | null = null;
  private _finalCoins:     number                         = 0;
```

- [ ] **Step 2: Reset the new fields in `init()`**

In `init()`, in the "Reset per-run state" block (~line 92-99), add:

```ts
    this._rewardedUsed     = false;
    this._rewardedWatched  = false;
    this._multiplier       = 1;
    this._coinsCommitted   = false;
```

- [ ] **Step 3: Remove the eager award and make NEW BALANCE a preview**

In `create()`, replace this block (~148-153):

```ts
    if (!this._coinsAwarded) {
      this._coinsAwarded = true;
      addBalance(result.finalCoins);
    }
    this._finalCoins = result.finalCoins;
    const balance = getBalance();
```

with (coins are no longer added here; the panel shows the projected balance):

```ts
    this._finalCoins = result.finalCoins;
    const balance = getBalance() + result.finalCoins * this._multiplier;
```

The now-unused `_coinsAwarded` field (declared ~line 36 and reset ~line 94) can be deleted in this step — remove its declaration and its reset line.

- [ ] **Step 4: Add `commitCoins()`**

Add a private method (place it just above `createBottomButtons` ~line 693):

```ts
  private commitCoins(): void {
    if (this._coinsCommitted) return;
    this._coinsCommitted = true;
    addBalance(this._finalCoins * this._multiplier);
  }
```

- [ ] **Step 5: Commit coins on the checkpoint exit**

In `createCheckpointButtonAt`, inside the `pointerup` handler (~727-731), add `this.commitCoins();` as the first line:

```ts
      btn.once('pointerup', () => {
        this.commitCoins();
        this.scene.stop('ScoreScene');
        this.scene.stop('GameScene');
        this.scene.start('GameScene', { useCheckpoint: true });
      });
```

- [ ] **Step 6: Commit coins on the menu exit**

In `createMenuPrompt`, at the top of `goMenu` (~949-953), add `this.commitCoins();` as the first line (interstitial gating comes in Task 6):

```ts
    const goMenu = () => {
      this.commitCoins();
      AdClient.showInterstitial(); // fire-and-forget; shows as menu loads
      this.scene.stop(this._heapParams.isInfinite ? 'InfiniteGameScene' : 'GameScene');
      this.scene.start('MenuScene');
    };
```

- [ ] **Step 7: Verify build**

Run: `npm run build`
Expected: `✓ built`, no TS errors (confirms `_coinsAwarded` removal left no dangling references).

- [ ] **Step 8: Commit**

```bash
git add src/scenes/ScoreScene.ts
git commit -m "fix(score): defer coin award to scene exit (no double-award)"
```

---

### Task 6: ScoreScene — ad-run gating & interstitial suppression

**Files:**
- Modify: `src/scenes/ScoreScene.ts`

- [ ] **Step 1: Import AdCadence**

At the top of `src/scenes/ScoreScene.ts`, below the existing AdClient import (line 3):

```ts
import { AdClient } from '../systems/ads/AdClient';
import * as AdCadence from '../systems/ads/AdCadence';
```

- [ ] **Step 2: Add the `_isAdRun` field**

In the field block, add:

```ts
  private _isAdRun: boolean = false;
```

- [ ] **Step 3: Register the run in `create()`**

In `create()`, immediately after `AudioManager.play('music-score');` (~line 117), add. Preview/dev runs (identified by mock data) must not mutate the real counter:

```ts
    const isPreview = this._mockLeaderboard !== null || this._forceBreakdownOpen
      || Object.keys(this._mockPlayerConfig).length > 0;
    this._isAdRun = isPreview ? false : AdCadence.registerRun(AdClient.enabled);
```

- [ ] **Step 4: Gate the rewarded button on ad runs**

In `createBottomButtons` (~693-695), change the `showAd` condition:

```ts
    const btnY     = this.scale.height * 0.87;
    const showAd   = this._isAdRun && !this._rewardedUsed;
    const showCkpt = this.checkpointAvailable;
```

- [ ] **Step 5: Suppress the interstitial when the rewarded ad was watched**

In `createMenuPrompt`'s `goMenu` (modified in Task 5), change the interstitial line to gate on ad-run + not-watched:

```ts
    const goMenu = () => {
      this.commitCoins();
      if (this._isAdRun && !this._rewardedWatched) AdClient.showInterstitial();
      this.scene.stop(this._heapParams.isInfinite ? 'InfiniteGameScene' : 'GameScene');
      this.scene.start('MenuScene');
    };
```

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: `✓ built`, no TS errors.

- [ ] **Step 7: Commit**

```bash
git add src/scenes/ScoreScene.ts
git commit -m "feat(score): gate ads on cadence; suppress interstitial after rewarded watch"
```

---

### Task 7: ScoreScene — rebuildable coins panel & 2× row

**Files:**
- Modify: `src/scenes/ScoreScene.ts`

This makes the coins panel re-renderable so the `×2 AD BONUS` row can be inserted after a successful watch, and shifts the leaderboard down by the added row height so nothing overlaps.

- [ ] **Step 1: Add object-tracking + state fields for rebuild**

In the field block, add:

```ts
  private _coinsPanelObjects:  Phaser.GameObjects.GameObject[] = [];
  private _leaderboardObjects: Phaser.GameObjects.GameObject[] = [];
  private _coinsPanelBottom:   number = 0;
```

These hold the live coins-panel objects (destroyed on rebuild) and the leaderboard objects (shifted on rebuild). `_coinsPanelBottom` is the panel's current bottom Y.

- [ ] **Step 2: Track coins-panel objects so they can be destroyed on rebuild**

In `createCoinsPanel`, every `this.add.*(...)` call that creates a panel object must also be pushed into `this._coinsPanelObjects`. At the start of the method body (first line), reset and reuse the array:

```ts
  private createCoinsPanel(rows: BreakdownRow[], finalCoins: number, balance: number): number {
    this._coinsPanelObjects.forEach(o => o.destroy());
    this._coinsPanelObjects = [];
```

Then push each created top-level object. The objects created in this method are: `bg` (graphics), `headerText`, `divG`, the `rowObjects` (already a local array — push them too), `toggleText` (if present), `balDivG`, `balLbl`, `balVal`. Add `this._coinsPanelObjects.push(o)` for each. For the `rowObjects` local array, after `renderRows` runs, push its contents; and in the `renderRows` closure, also track newly created row objects. Concretely:
  - After `const bg = this.add.graphics();` → `this._coinsPanelObjects.push(bg);`
  - After `const headerText = this.add.text(...)` → `this._coinsPanelObjects.push(headerText);`
  - After `const divG = this.add.graphics();` (the header divider, ~543) → `this._coinsPanelObjects.push(divG);`
  - Inside `renderRows`, change `rowObjects.forEach(o => o.destroy()); rowObjects.length = 0;` to also remove them from the tracked array is unnecessary because `renderRows` re-runs within one panel build; instead, after the final `renderRows(collapsed)` call that produces the displayed rows, do `this._coinsPanelObjects.push(...rowObjects);`. (The collapse toggle re-renders rows live; that interactive path is unchanged and its objects are still parented to the scene — acceptable, as the rebuild path destroys via the tracked set captured at build time. To keep it correct, also push any rowObjects created by the toggle handler: in the toggle `pointerup`, after `renderRows(collapsed)`, add `this._coinsPanelObjects.push(...rowObjects);`.)
  - After `toggleText = this.add.text(...)` → `if (toggleText) this._coinsPanelObjects.push(toggleText);`
  - After `balDivG`, `balLbl`, `balVal` are created → `this._coinsPanelObjects.push(balDivG, balLbl, balVal);`

At the end of the method, record the bottom and return it:

```ts
    this._coinsPanelBottom = PANEL_TOP + panelHeight(collapsed) + 40;
    return this._coinsPanelBottom;
```

- [ ] **Step 3: Add `ad_bonus` to the panel color map and label map**

In `createCoinsPanel`'s `ROW_COLORS` (~490-496), add:

```ts
      off_peak_bonus: { accent: 0x44aaff, accentHex: '#44aaff', labelHex: '#88ccff' },
      ad_bonus:       { accent: 0xffcc00, accentHex: '#ffcc00', labelHex: '#ffdd66' },
```

In `rowLabel` (~680-689), widen the type and add the label:

```ts
  private rowLabel(type: 'money_mult' | 'heap_coin_mult' | 'peak_hunter' | 'death_penalty' | 'off_peak_bonus' | 'ad_bonus'): string {
    const labels: Record<string, string> = {
      money_mult:     'Coin Multiplier',
      heap_coin_mult: 'Heap Coin Bonus',
      peak_hunter:    'Peak Bonus ✶',
      death_penalty:  'Death Penalty 💀',
      off_peak_bonus: 'Off-Peak Bonus',
      ad_bonus:       'Ad Bonus ▶',
    };
    return labels[type] ?? type;
  }
```

- [ ] **Step 4: Track leaderboard objects so they can be shifted**

In `renderLeaderboardEntries`, push every created object (the `HIGH SCORES` label, `bg`, each `stripe`, every `this.add.text(...)`, the gap dots, and the player-row texts) into `this._leaderboardObjects`. At the top of the method add `const lb = this._leaderboardObjects;` and replace each bare `this.add.text(...)`/`this.add.graphics()` result with a tracked push, e.g.:

```ts
    const label = this.add.text(left, panelTop + 4, 'HIGH SCORES', { /* …unchanged… */ }).setOrigin(0, 1);
    lb.push(label);
```

Apply the same `lb.push(x)` to `bg`, `stripe`, the rank/name/score texts in the loop, the gap-dots text, and the player-row rank/name/score texts. (Functionally identical rendering; we just keep references.)

- [ ] **Step 5: Store the breakdown inputs needed to recompute on 2×**

The 2× rebuild must recompute the breakdown with `adBonusMultiplier: 2`. Save the exact input used in `create()`. Add a field:

```ts
  private _breakdownInput: import('../systems/coinBreakdown').BreakdownInput | null = null;
```

In `create()`, where `buildCoinBreakdown({...})` is called (~137), assign the object to a local and store it:

```ts
    const breakdownInput = {
      score:           this.score,
      scoreToCoins:    SCORE_TO_COINS_DIVISOR,
      moneyMultiplier: cfg.moneyMultiplier,
      heapCoinMult:    this._heapParams.coinMult,
      isPeak:          this.isPeak,
      peakMultiplier:  cfg.peakMultiplier,
      isFailure:       this.isFailure,
      offPeakBonus:    this._bonusCoins,
    };
    this._breakdownInput = breakdownInput;
    const result = buildCoinBreakdown(breakdownInput);
```

- [ ] **Step 6: Apply the 2× on a successful watch (rebuild panel + shift leaderboard)**

In `createRewardedAdButtonAt`'s `pointerup` handler, replace the `if (watched) { … }` success branch (~771-776) with logic that sets the multiplier, marks watched, recomputes the breakdown, rebuilds the coins panel, and shifts the leaderboard down by the height the panel grew:

```ts
      const watched = await AdClient.showRewarded();
      if (watched) {
        this._rewardedWatched = true;
        this._multiplier      = 2;

        const prevBottom = this._coinsPanelBottom;
        const result2    = buildCoinBreakdown({ ...this._breakdownInput!, adBonusMultiplier: 2 });
        const newBalance = getBalance() + result2.finalCoins; // preview (coins commit on exit)
        const newBottom  = this.createCoinsPanel(result2.rows, result2.finalCoins, newBalance);

        const delta = newBottom - prevBottom;
        if (delta !== 0 && this._leaderboardObjects.length > 0) {
          this.tweens.add({
            targets:  this._leaderboardObjects,
            y:        `+=${delta}`,
            duration: 250,
            ease:     'Cubic.Out',
          });
        }

        label.setText('2× coins awarded!');
        this.time.delayedCall(1200, () => this.tweens.add({ targets: btn, alpha: 0, duration: 300 }));
      } else {
        this.tweens.add({ targets: btn, alpha: 0, duration: 200 });
      }
```

Note: the rebuilt panel's intro fade is the 1100ms delayed tween inside `createCoinsPanel`; on rebuild it re-applies alpha-0→1, which is fine (a quick re-fade). If a flash is undesirable during smoke testing, that is a polish follow-up, not a correctness issue.

Timing edge: the leaderboard renders asynchronously (server call), populating `_leaderboardObjects`. A rewarded video runs ~15–30s, so the leaderboard will essentially always have rendered before the watch completes, and the shift applies. In the rare case it has not yet rendered, `_leaderboardObjects` is empty (no shift) and it would render at the pre-grow position. To make this robust regardless of order, base the leaderboard's top on the live panel bottom: in `createLeaderboardPanel`/`renderLeaderboardEntries`, compute `PANEL_TOP` from `this._coinsPanelBottom` at render time instead of the captured `topY` argument. This is a small change and removes the ordering assumption.

- [ ] **Step 7: Verify build**

Run: `npm run build`
Expected: `✓ built`, no TS errors.

- [ ] **Step 8: Run the scene preview to eyeball the panel**

Run (requires `npm run dev` in another terminal):
`npm run scene-preview -- ScoreScene '{"score":5000,"isFailure":false}' pixel7`
Then read `screenshots/preview.png`. Expected: coins panel and leaderboard render without overlap (1× state — the 2× row only appears after a watched ad, which the NullProvider preview won't trigger).

- [ ] **Step 9: Commit**

```bash
git add src/scenes/ScoreScene.ts
git commit -m "feat(score): show 2x as an ad-bonus row; rebuild panel and shift leaderboard"
```

---

### Task 8: Full verification & spec status

**Files:**
- Modify: `docs/superpowers/specs/2026-05-29-ad-cadence-and-rewarded-multiplier-design.md`

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass (634 prior + the new AdCadence, SaveData, and coinBreakdown cases).

- [ ] **Step 2: Run the web build**

Run: `npm run build`
Expected: `✓ built`, no TS errors.

- [ ] **Step 3: Run the Android build**

Run: `npm run build:android`
Expected: build + `cap sync` succeed.

- [ ] **Step 4: Mark the spec implemented**

In the spec file, change the header `**Status:** Approved, pending implementation` to `**Status:** Implemented`.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-05-29-ad-cadence-and-rewarded-multiplier-design.md
git commit -m "docs(ads): mark ad-cadence spec implemented"
```

- [ ] **Step 6: Device smoke checklist (manual, on device)**

Build/sync (`npm run build:android && npx cap run android`) and verify:
- First run after a fresh install shows **no** interstitial and **no** 2× button.
- Within 2–5 runs, a run shows the 2× button; leaving without tapping it fires one interstitial.
- On a 2× run, tapping "▶ 2× coins" plays a rewarded ad, adds the `×2 AD BONUS` row, doubles the displayed total/NEW BALANCE, and leaving that run fires **no** interstitial.
- Coin balance increases by the displayed amount exactly once per run (no double-award), via both the menu exit and the checkpoint exit.
- Non-ad runs show neither the button nor an interstitial.

---

## Self-Review Notes

- **Spec coverage:** §3.1 enabled → Task 1; §3.2 AdCadence → Task 3; §3.3 SaveData → Task 2; §4.1 run registration → Task 6 (preview-guarded); §4.2 button gating → Task 6; §4.3 deferred award → Task 5; §4.4 interstitial suppression → Task 6; §4.5 + §5 2× row / rebuildable panel → Task 7; testing → Tasks 2/3/4 + Task 8.
- **Type consistency:** `ad_bonus` added to `MultiplierRow` (Task 4) and consumed in `ROW_COLORS`/`rowLabel` (Task 7); `AdRunState`/`registerRun(enabled, rand?)` defined in Task 3 and called as `AdCadence.registerRun(AdClient.enabled)` in Task 6; `getAdRunState`/`setAdRunState` defined in Task 2 and used in Task 3; `_breakdownInput` typed as `BreakdownInput`.
- **Refinement vs spec:** `registerRun` takes `enabled` as a parameter (caller passes `AdClient.enabled`) instead of importing the singleton — pure refinement for testability; same behavior. Noted in Task 3.

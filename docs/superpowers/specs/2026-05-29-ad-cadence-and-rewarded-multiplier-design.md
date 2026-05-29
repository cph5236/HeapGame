# Ad Cadence & Rewarded 2× Multiplier — Design

**Date:** 2026-05-29
**Branch:** feature/ad-integration (PR #33)
**Status:** Implemented

## Problem

The ad integration currently:

1. **Double-awards / awards too eagerly.** Coins are added to the balance in `ScoreScene.create()` (line ~150), and the rewarded 2× button adds the same amount *again* (line ~772). The award happens before the player has decided anything, which is fragile and makes the 2× a second mutation rather than a clean multiplier.
2. **Offers the 2× button every run.** No pacing.
3. **Fires an interstitial on every exit to menu.** No pacing, and it can stack with the rewarded ad (two ads back-to-back).

## Goals

- One ad cadence: an ad appears roughly every 2–5 runs, never on run 1.
- On an "ad run", offer the rewarded 2× button. Watching it grants the reward **and suppresses the exit interstitial** (never two ads on one run). Skipping it lets the interstitial fire on exit.
- Non-ad runs show neither the button nor an interstitial.
- Coins are committed to the balance **once, on leaving the score screen**, at `finalCoins × multiplier` — eliminating the double-award.
- The 2× shows in the coins breakdown **as a multiplier row**, with the header and NEW BALANCE updating.
- Web/dev (NullProvider) has no ad runs at all — no dead 2× button.

## Non-goals

- No frequency-cap config UI (AdMob console handles real-world caps; this is in-app pacing).
- No change to interstitial/rewarded provider plumbing (`AdMobProvider`/`NullProvider` internals).
- No change to the score/coin formula itself beyond the new ad-bonus row.

## Architecture

A dedicated **`AdCadence`** module owns *when* an ad should appear; `AdClient`/providers stay responsible for *how* to show one. ScoreScene consumes both.

### 3.1 `AdProvider.enabled` capability

Add a boolean to the interface so pacing can be skipped entirely when no real ads exist:

```ts
export interface AdProvider {
  readonly enabled: boolean;            // NEW
  initialize(): Promise<void>;
  showInterstitial(): Promise<void>;
  showRewarded(): Promise<boolean>;
}
```

- `NullProvider.enabled = false`
- `AdMobProvider.enabled = true`

### 3.2 `AdCadence` module (`src/systems/ads/AdCadence.ts`)

Owns the persisted run counter and the random target. Pure logic + SaveData persistence; no Phaser dependency except `Phaser.Math.Between` (or `Math.random` wrapper) for the roll — to keep it unit-testable, the random source is injectable or wrapped.

State (persisted in SaveData, device-local):
- `adRunsSinceLast: number` — runs completed since the last ad fired.
- `adRunTarget: number` — current target (2–5). Seeded with a random 2–5 on first use, so the earliest possible ad is run 2+ and run 1 is never an ad.

API:

```ts
// Increment the run counter and decide whether THIS run is an ad run.
// Returns true at most once per `target` runs. On a true result, resets the
// counter to 0 and re-rolls the target to Between(2,5).
// Always returns false when AdClient.enabled is false (web/dev).
AdCadence.registerRun(): boolean
```

Behaviour:
- If `!AdClient.enabled` → return `false` without mutating the counter (web never shows ads, so pacing state is irrelevant there).
- Else: `adRunsSinceLast++`. If `adRunsSinceLast >= adRunTarget` → set `adRunsSinceLast = 0`, `adRunTarget = roll(2,5)`, persist, return `true`. Otherwise persist and return `false`.

### 3.3 SaveData changes

Add the two fields to the raw save structure with safe defaults (treat missing as: `adRunsSinceLast = 0`, `adRunTarget = roll(2,5)` lazily on first `registerRun`). These are **local pacing state and are excluded from cloud merge** (`mergeCloudSave` ignores them) — they describe this device's ad rhythm, not player progress.

## ScoreScene changes

### 4.1 Run registration

In `create()` (or early `init()`), once per arrival and **skipped in dev/preview mock mode** (when `_mockLeaderboard`/`_forceBreakdownOpen`/`_mockPlayerConfig` indicate a preview):

```ts
this._isAdRun = AdCadence.registerRun();
```

New instance fields (reset in `init()` alongside the existing per-run resets):
- `_isAdRun: boolean`
- `_multiplier: number` (1 or 2)
- `_rewardedWatched: boolean`
- `_coinsCommitted: boolean`

### 4.2 Button gating

`createBottomButtons()`: rewarded button shows when `this._isAdRun && !this._rewardedUsed` (was `!this._rewardedUsed`). Checkpoint logic unchanged; side-by-side layout when both present is unchanged.

### 4.3 Deferred award

- Remove the `addBalance(result.finalCoins)` block from `create()`.
- NEW BALANCE in the coins panel becomes a **preview**: `getBalance() + finalCoins × _multiplier` (initially `_multiplier = 1`).
- New `private commitCoins()`:
  ```ts
  if (this._coinsCommitted) return;
  this._coinsCommitted = true;
  addBalance(this._finalCoins * this._multiplier);
  ```
- Call `commitCoins()` from **both** exit paths:
  - `goMenu()` (the menu-prompt handler)
  - the checkpoint button `pointerup` handler (before `scene.start('GameScene', { useCheckpoint: true })`)

### 4.4 Interstitial suppression

`goMenu()`:
```ts
this.commitCoins();
if (this._isAdRun && !this._rewardedWatched) AdClient.showInterstitial();
this.scene.stop(...); this.scene.start('MenuScene');
```

### 4.5 Rewarded watch → 2× multiplier row

In the rewarded button handler, on `watched === true`:
- `this._rewardedWatched = true; this._multiplier = 2;`
- Recompute the breakdown with `adBonusMultiplier: 2` and **rebuild the coins panel** (see 5), inserting the `×2 AD BONUS` row, updating the `+N coins earned` header to the doubled total, and animating NEW BALANCE preview upward.
- Button shows confirmation then fades.
- On `watched === false` (declined / no fill): no multiplier change, no suppression — the interstitial will still fire on exit. Button fades. `_rewardedUsed` is already set so it won't re-show.

## Coins breakdown changes (`buildCoinBreakdown`)

Add an optional input `adBonusMultiplier?: number` (default `1`):
- When `> 1`: append an `ad_bonus` row (multiplier-style, value = doubled running total) and multiply `finalCoins` by it.
- When `1` (default): output is byte-for-byte identical to today.

`createCoinsPanel` becomes **rebuildable**: it tracks all its created game objects in an instance array and exposes a way to tear down + re-render with a new rows/finalCoins/balance set. The `ad_bonus` row gets an entry in `ROW_COLORS` and `rowLabel` (label e.g. `AD BONUS ▶`).

## Data flow

```
finish run → ScoreScene.init() (reset per-run state)
           → ScoreScene.create():
               _isAdRun = AdCadence.registerRun()   // persists counter
               buildCoinBreakdown(adBonusMultiplier=1) → render panel (preview balance)
               createBottomButtons(): show 2× iff _isAdRun
           → [optional] tap 2×:
               AdClient.showRewarded() → true:
                 _multiplier=2, _rewardedWatched=true
                 rebuild panel with adBonusMultiplier=2
           → exit (menu): commitCoins(); interstitial iff _isAdRun && !_rewardedWatched
             exit (checkpoint): commitCoins(); → GameScene
```

## Testing

- **`AdCadence`** (unit): run 1 never an ad; fires when counter reaches target; counter resets and target re-rolls on fire; target always in [2,5]; returns false (no ad) when provider disabled; persistence round-trips through SaveData.
- **`buildCoinBreakdown`** (unit): `adBonusMultiplier=2` appends one `ad_bonus` row and doubles `finalCoins`; default (omitted / `1`) output unchanged vs. current snapshot.
- **Regression:** existing ScoreScene / coinBreakdown tests stay green.

## Edge cases

- **Checkpoint + ad run:** checkpoint exit commits coins but does not fire the interstitial (interstitial is menu-exit only); if the player watched the 2× before respawning, the multiplier is committed.
- **Rewarded fails after tap:** treated as not-watched → interstitial fires on exit, 1× committed.
- **Dev/preview:** `registerRun()` skipped so previews don't mutate the real counter; 2× button can still be force-shown via existing mock flags if desired (out of scope to change).
- **Web/NullProvider:** `enabled=false` → never an ad run → no button, no interstitial, coins commit at 1× on exit.

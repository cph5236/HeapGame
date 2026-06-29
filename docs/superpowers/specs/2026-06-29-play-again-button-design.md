# Play Again Button — Design

## Goal

Add a **PLAY AGAIN** button to the score screen ([ScoreScene](../../../src/scenes/ScoreScene.ts)).
It occupies the same slot the **RESPAWN AT CHECKPOINT** button uses, and is shown
only when **no checkpoint is active** — when a checkpoint *is* active, RESPAWN takes
the slot instead. The result: the score screen always has a primary action button.

## Behavior

Tapping **PLAY AGAIN** starts a fresh run of the current heap directly (no menu detour):

```ts
this.commitCoins();
if (this._isAdRun && !this._rewardedWatched) AdClient.showInterstitial();
this.scene.stop('ScoreScene');
this.scene.stop(infinite ? 'InfiniteGameScene' : 'GameScene');
this.scene.start(infinite ? 'InfiniteGameScene' : 'GameScene');   // fresh run, no checkpoint
```

The active heap already lives in `game.registry` (set at menu/heap-select), so no heap
data needs to be passed — this mirrors `MenuScene.startGame`. `infinite` comes from
`this._heapParams.isInfinite` (same source ScoreScene already uses in `goMenu`).

Rationale for restarting directly rather than routing through `MenuScene`: routing through
the menu would run `MenuScene.create()` and flash the menu for a frame before bouncing back
into the game — wasted work and a visible flicker, with no benefit since the menu's only role
(reading the active heap from the registry) is already done.

The same 1.5s tap-delay guard the checkpoint button uses applies, so a stray tap carried over
from gameplay can't trigger an instant restart.

## Layout

Refactor [`createBottomButtons()`](../../../src/scenes/ScoreScene.ts#L757) to choose a
**primary** button — checkpoint if a checkpoint is active, else play-again — and lay it out
exactly as RESPAWN is laid out today:

- `showAd && primary`  → primary compact @ x=0.25·W, ad compact @ x=0.75·W
- `primary` only       → primary full-width @ center

`showAd` is `_isAdRun && !_rewardedUsed` (unchanged). Since there is now always a primary
button, the old `else if (showAd)` solo-ad branch is no longer reachable but is kept harmless.

## Testable core (pure function)

Following the codebase's pure-helper pattern (`hudLogic`, `hotbarLayout`, `buildRunScore`),
extract the slot-selection decision into a pure function in a new
`src/scenes/scoreLayout.ts` (or co-located module):

```ts
export type BottomButtonKind = 'checkpoint' | 'playAgain' | 'rewardedAd';
export interface BottomButtonSlot {
  kind: BottomButtonKind;
  cx: number;          // logical x
  compact: boolean;
}
export function bottomButtonLayout(
  opts: { checkpointAvailable: boolean; showAd: boolean },
  width: number,
): BottomButtonSlot[];
```

Rules:
- primary kind = `checkpointAvailable ? 'checkpoint' : 'playAgain'`
- if `showAd`: `[primary @0.25·W compact, rewardedAd @0.75·W compact]`
- else: `[primary @0.5·W full]`

`createBottomButtons()` maps the returned slots to the existing `create*ButtonAt` helpers,
adding a new `createPlayAgainButtonAt`.

## Visuals

`createPlayAgainButtonAt` mirrors `createCheckpointButtonAt`'s structure/sizing — label
`PLAY AGAIN` (compact: `PLAY AGAIN`), distinct color from RESPAWN's green (amber/blue),
1.5s delayed interactivity.

## Tests

`bottomButtonLayout` unit tests covering the four combinations of
`{checkpointAvailable} × {showAd}`: correct kinds, positions, and compact flags.

## Scope

Single feature, one scene + one small new helper + its test file. No server, no migration.

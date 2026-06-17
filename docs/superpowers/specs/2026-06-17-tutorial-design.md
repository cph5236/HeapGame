# Tutorial — Design Spec

**Date:** 2026-06-17
**Branch:** `feature/tutorial`
**Status:** Approved design, ready for implementation plan

## Goal

Give new players a guided, hands-on introduction to Heap's full gameplay loop on
a tiny, easy, hand-authored heap. The tutorial auto-launches the first time a new
player opens the game and is replayable later from the menu. It teaches every core
move through interactive "now you try it" practice, then drops the player straight
into a real run.

## Requirements (from the product brief)

- A simple example heap that is very easy to climb.
- Spawn ~1 rat to stomp, and ~1 item to pick up.
- Pop-up messages that pause the game so the player can read.
- A "Skip Tutorial" button available throughout.
- Walk the player through the **full** gameplay loop.

### Confirmed decisions

- **Trigger:** auto-launch on first launch (SaveData flag) **and** replayable from
  a menu button.
- **Step style:** interactive gated practice — info pop-ups explain a move, then the
  game waits until the player actually performs it before advancing.
- **Mechanics covered, in order:** move → jump → wall-jump → dash → dive → stomp the
  rat → pick up the item → place a block at the top.
- **Abilities:** dash, dive, and wall-jump are normally upgrade-gated
  (`getUpgradeLevel('dash'|'dive'|'wall_jump') > 0` in `SaveData.getPlayerConfig`).
  The tutorial **grants all three temporarily** via a tutorial-only `PlayerConfig`;
  because only the tutorial scene's `Player` uses it, real runs revert automatically.
- **Ending:** on finish or skip, mark the tutorial done and go **straight into a real
  run** (`GameScene` with the default boot-loaded heap), not back to the menu.

## Architecture

**Approach: a dedicated `TutorialScene`** (chosen over branching `GameScene` or
subclassing it). The tutorial world is deliberately tiny and fixed, so the scene is
actually *simpler* than the 893-line `GameScene` — it needs no server load, band
streaming, checkpoints, trash wall, live zones, or ScoreScene. Isolation keeps both
`GameScene` and the tutorial independently testable and leaves `GameScene` untouched.

Shared setup (collider wiring, stomp/damage overlap) is extracted into a small helper
**only if** real duplication appears during implementation — not preemptively.

### Components

#### 1. `TutorialScene` — `src/scenes/TutorialScene.ts`

Registered in `src/main.ts`. Builds a minimal world:

- **Asset loading (first-run requirement)**: gameplay assets (rat/item/player
  sprites, sounds, heap tiles) are normally loaded by `MenuScene.create()` via
  `loadGameAssets()`. The first-run path starts `TutorialScene` *before* MenuScene
  ever runs, so the tutorial must call `loadGameAssets(this)` itself and defer world
  construction until `registry.gameAssetsReady === true` (it's already true if the
  player reached the tutorial via the menu replay button — `loadGameAssets` is
  idempotent). Build the world in a `startWhenAssetsReady()` step that either runs
  immediately or waits once on the `gameAssetsReady` event, mirroring BootScene's
  dev-launch pattern (`BootScene.ts:152, 173-175`). Until then, show a lightweight
  loading state.
- **Fixed heap fixture** (`src/data/tutorialFixture.ts`): a hand-authored `Vertex[]`
  forming a short, gentle staircase with one wall section (forces a wall-jump), one
  gap (forces a dash), and a flat top zone for the final block placement. Rendered
  through the existing `HeapChunkRenderer` + walkable/wall static groups, mirroring
  `GameScene`'s collider setup.
- **Granted-abilities `PlayerConfig`**: `{ ...getPlayerConfig(), dash: true, dive:
  true, wallJump: true }`. Scoped to this scene's `Player` only.
- **One rat**: a single `EnemyManager` (or direct) spawn at a scripted position on
  the path.
- **One salvage item**: a single `PickupManager` spawn at a scripted position.
- **Win condition**: place a block in the top zone (reusing the existing place flow).
- **Excluded**: trash wall, checkpoints, server load, band streaming, live zones,
  ScoreScene.
- `update()` drives player, animator, enemy, pickup, camera, joystick, **and**
  `director.tick()` / forwards detected actions to the director.

#### 2. `TutorialDirector` — `src/systems/TutorialDirector.ts`

A pure, unit-testable step machine. Holds an ordered `TutorialStep[]` and a cursor.

```ts
type PlayerAction =
  | 'move' | 'jump' | 'walljump' | 'dash' | 'dive'
  | 'stomp' | 'pickup' | 'placeBlock';

interface TutorialStep {
  id: string;
  message: string;
  advanceOn: 'tap' | PlayerAction;
  setup?: (scene: TutorialScene) => void;   // e.g. spawn rat, position camera
  onAdvance?: (scene: TutorialScene) => void;
}
```

API:
- `start()` — begin at step 0, run its `setup`, request the appropriate popup.
- `notify(action: PlayerAction)` — called by the scene when a gameplay action occurs;
  advances iff it matches the current step's `advanceOn`.
- `tapNext()` — advances a `'tap'`-gated step.
- `skip()` — jump straight to complete.

Callbacks to the scene: `onShowPopup(message, mode)`, `onHidePopup()`, `onComplete()`.

#### 3. `TutorialOverlay` — `src/ui/TutorialOverlay.ts`

Phaser UI on the UI camera (scrollFactor 0). Two display modes:

- **Info popup** (tap-gated): dim full-screen layer + centered message panel + **Next**
  button. **Freezes gameplay** while showing — satisfies "pause the game so the player
  can read." `physics.pause()` alone is insufficient: `Player.update()` still runs
  every frame on an active scene and a buffered tap would leak a jump on dismiss
  (this is exactly why PauseScene also clears input —
  `PauseScene.ts:143-145`). The freeze model, owned by the tutorial:
  - A `gameplayFrozen` flag on `TutorialScene`. While set, `update()` early-returns
    before driving player / enemy / pickup / placeable logic (the overlay, camera,
    and director still tick so the **Next** button stays responsive).
  - On show: `InputManager.setSuppressionRect('tutorial', <full screen>)` so taps
    don't reach gameplay; on dismiss: clear that rect **and**
    `clearBufferedActions()` so the dismiss tap can't fire a jump on resume.
  This keeps the popup and its button live (same-scene UI) without the separate-scene
  `scene.pause()` dance, while matching PauseScene's input-safety guarantees.
- **Action hint** (action-gated): a *non-blocking* banner (e.g. "Try it: swipe to
  dash"). `gameplayFrozen` is **false** so the player can actually perform the move.
- Persistent **Skip Tutorial** button in a corner, always visible → `director.skip()`.

### Detection plumbing

- **Player change (budgeted, not free plumbing):** the current `Player` emits **no**
  events. This design adds four `this.scene.events.emit('player-action', kind)` calls
  at its existing fire points — jump and wall-jump (`Player.ts:214-216`), dash
  (`Player.ts:456`), dive (`Player.ts:551`) — emitting `'jump' | 'walljump' | 'dash'
  | 'dive'`. These sites already compute the fire booleans/transitions, so the change
  is small and local, but it is a real modification to a shared entity: it carries its
  own task and unit test (emit fires exactly once per action, at the right site).
  Only `TutorialScene` subscribes; other scenes have no listener, so cost is
  negligible. `'move'` is detected by the scene polling player velocity (no Player
  change needed).
- **Stomp** and **pickup** are detected directly in `TutorialScene`'s own overlap /
  pickup handlers, which call `director.notify('stomp' | 'pickup')`.
- **placeBlock** is detected via the existing place-complete hook → `director.notify('placeBlock')`.

### Step script (ordered)

| # | Step        | Gate          | Notes |
|---|-------------|---------------|-------|
| 1 | Welcome     | tap           | "Welcome to Heap! Climb to the top." |
| 2 | Move        | `move`        | "Use the joystick / arrow keys to move." |
| 3 | Jump        | `jump`        | "Tap / press up to jump." |
| 4 | Wall-jump   | `walljump`    | At the wall section. |
| 5 | Dash        | `dash`        | Across the gap. |
| 6 | Dive        | `dive`        | "Swipe down to dive." |
| 7 | Stomp rat   | `stomp`       | Rat spawned just ahead. |
| 8 | Pickup item | `pickup`      | Salvage item on the path. |
| 9 | At the top  | tap           | "You reached the top zone!" |
| 10| Place block | `placeBlock`  | "Hold PLACE to drop your block." |
| 11| Complete    | tap           | "You're ready!" → start real run. |

The fixture geometry is authored so each move is genuinely required to progress.

### First-run detection & entry

- **`SaveData`**: add `tutorialDone: boolean` (default `false`) to the save, with
  `getTutorialDone()` / `setTutorialDone(value)`, behind a `schemaVersion` bump that
  follows the existing migration pattern (new saves and migrated old saves default to
  `false`).
- **`BootScene`**: first scene = `getTutorialDone() ? 'MenuScene' : 'TutorialScene'`.
  The heap catalog load continues async in the background regardless. Because this
  bypasses MenuScene, `TutorialScene` is responsible for `loadGameAssets()` (see the
  TutorialScene asset-loading bullet above).
- **`MenuScene`**: a compact **"How to Play"** button that launches `TutorialScene`
  to replay anytime.
- **On finish or skip**: `setTutorialDone(true)`, then start `GameScene` if
  `registry.heapPolygon` is set; otherwise wait once for the `heapCatalogReady` event
  then start it. Safety fallback to `MenuScene` if the catalog is empty/offline.

## Testing

- **Unit — `TutorialDirector`**: advances on the correct tap/action; ignores a wrong
  action; `skip()` jumps to complete; `onComplete` fires once.
- **Unit — `SaveData`**: `getTutorialDone`/`setTutorialDone` round-trip; migration of
  an old save defaults `tutorialDone` to `false`.
- **Unit — `Player` emits**: each of jump / wall-jump / dash / dive emits
  `player-action` with the right `kind` exactly once per action, at its fire site,
  with no emit when the action doesn't fire.
- **Build**: `npm run build` clean (catches TS errors tests miss).
- **Visual**: scene-preview screenshot of `TutorialScene` with the overlay showing.

## Out of scope (YAGNI)

- Per-mechanic analytics / completion funnels.
- Multiple tutorial difficulty paths or localization.
- Teaching consumables, the store, upgrades, or multiple heaps — the tutorial covers
  the in-run movement/combat/placement loop only.

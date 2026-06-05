# Movement Joystick — Design Spec

**Date:** 2026-06-05
**Feature:** Playtest feedback item #1 — on-screen virtual joystick as a toggleable
alternative to phone-tilt movement.
**Branch:** `feat/movement-joystick`

## Goal

Let players choose, in settings, between **tilt** controls (current) and an
**on-screen virtual joystick** for movement. The joystick is *full-directional*:
it drives left/right, jump (up), and dive (down), with a dedicated dash button
and double-tap-to-dash. Tilt mode is left completely unchanged.

Player movement code stays untouched: the joystick writes the *same*
`InputManager` channels (`tiltFactor` / `goLeft` / `goRight` / impulses /
ladder-drag) that tilt and swipe gestures produce today.

## Decisions (resolved during brainstorming)

| Question | Decision |
|---|---|
| Library vs custom | Use **rexrainbow `VirtualJoystick`** (single-file tree-shaken import) wrapped in our own `JoystickController`. rex handles drag/recenter/render/hit-area/**multi-touch**; our controller owns game-specific mapping. |
| Scope of stick | **Full directional** — L/R + up=jump + down=dive. |
| Placement | **Fixed base, configurable side** (`joystickSide: 'left' \| 'right'`). |
| Dash input | **Dash button + double-tap**, both always active (no config toggle). Flick was rejected (false-fires on a small stick). |
| Dash button position | **Opposite bottom corner from the stick**, mirrors `joystickSide`. Direction follows stick tilt, falls back to facing. |
| Gestures in joystick mode | **Stick-only**: device-tilt and the window swipe/tap handlers are gated OFF. GRAB/PLACE/dash stay as Phaser buttons (native multi-touch). |
| Scenes | Joystick mounted in **both** GameScene and InfiniteGameScene (they share the InputManager singleton; gating tilt globally would otherwise leave Infinite with no input). |

## The InputManager contract (what the joystick must satisfy)

How the player consumes input today — the joystick maps onto exactly these:

| Action | Channel | Type | Player site |
|---|---|---|---|
| Move L/R (ground) | `tiltFactor` | analog −1..1 | `Player.ts:395` |
| Move L/R (air) | `tiltFactor` | analog | `Player.ts:402` |
| Jump | `jumpJustPressed` + `jumpVx` | pulse (1 frame) | `Player.ts:240` |
| Dash | `dashJustFired` + `dashDir` | pulse | `Player.ts:448` |
| Dive | `diveJustFired` (burst) OR `holdingDown` (sustain) | pulse / continuous | `Player.ts:548` |
| Ladder climb | `dragUp` / `dragDown` (continuous); `goLeft/goRight` exits | continuous | `Player.ts:259-266` |

## Architecture

### New: `src/systems/JoystickController.ts`
Owns one rex `VirtualJoystick` and translates its state into `InputManager` each
frame. Phaser-aware (it creates game objects); keeps its *math* in
`joystickMath.ts` so the logic is unit-testable without rex/Phaser.

rex config: `dir: '8dir'`, `fixed: true` (scrollFactor 0), custom-styled base +
thumb game objects to match the existing UI palette (translucent dark base
`0x000000`@~0.5, stroke `0x8899bb`, lighter thumb), `radius` ~64px, `forceMin`
~`radius*0.2`.

Per-frame `update(delta)` (called **before** `im.update()`):
- **Axis:** `tiltFactor = curveDeadzone(forceX / radius)` → `im.setAxis(t)`.
- **Jump:** rising edge of `.up` → `im.pulseJump(jumpVx)` where `jumpVx` is
  derived from `forceX` (diagonal launch). While `.up` held → `dragUp = true`.
- **Dive:** rising edge of `.down` → `im.pulseDive()`. While `.down` held →
  continuous down-held signal (sustains dive) + `dragDown = true`.
- **Dash (double-tap):** direction crosses the dash threshold, recenters, and
  crosses again same-direction within a window → `im.pulseDash(dir)`.

Other methods: `setSide(side)`, `setVisible(v)`, `destroy()`.

### New: `src/systems/joystickMath.ts` (pure, tested)
- `axisFromForce(forceX, radius, deadZone, curveExp) → tiltFactor`
- up/down rising-edge detection helper (prev vs current boolean)
- double-tap state machine: `step(state, dir, now) → { state, fired, dir }`

### Changed: `src/systems/InputManager.ts`
- Add `controlMode: 'tilt' | 'joystick'` + `setControlMode()`.
- **Gate on mode:** in joystick mode, `update()` skips the gamma→`tiltFactor`
  computation, and the window `touchstart/move/end` handlers no-op (early return).
  Tilt mode behavior is byte-for-byte unchanged.
- **Injection methods** the controller calls (set the *same* pending/continuous
  fields the touch handlers use): `setAxis(f)`, `pulseJump(vx)`, `pulseDash(dir)`,
  `pulseDive()`, `setLadderDrag(up, down)`, and a continuous `diveHeld` flag.

### Changed: `src/entities/Player.ts` (minimal)
- `updateDive`: extend the `holdingDown` check to also honor the controller's
  continuous down-held signal (`im.diveHeld`), so a held stick-down sustains the
  dive exactly like the keyboard Down key. No other player changes.

### New: dash button (in GameScene & InfiniteGameScene, via shared helper)
Phaser button like GRAB/PLACE. Opposite bottom corner from the stick, mirrors
`joystickSide`. Visible only when joystick mode AND `player.dashEnabled`. On tap →
`im.pulseDash(dir)` where `dir = sign(tiltFactor)` else current facing. Registers
a suppression rect (reusing `setSuppressionRect`).

### New: `mountJoystick(scene, im)` shared helper
Used by both gameplay scenes. When `controlMode === 'joystick'`, constructs the
`JoystickController` + dash button, positioned per `joystickSide`. Each scene:
- calls `controller.update(delta)` **before** `im.update(delta)` (frame ordering:
  `im.update()` transfers `pending*`→active and clears them at frame start, so the
  controller must set them first — same timing the async touch handlers rely on);
- calls `controller.destroy()` on shutdown.

### Changed: settings (SaveData + MenuScene)
- `RawSave` gains optional `controlMode?` and `joystickSide?` (default via `??`,
  **no schema bump / migration** — matches `soundSettings`/`adRunTarget`).
- Getter/setter pairs: `getControlMode`/`setControlMode`,
  `getJoystickSide`/`setJoystickSide`.
- MenuScene settings panel: **2 tabs → 3** (`Sounds | Controls | Dev`), narrowing
  `TAB_W` to fit three across `PANEL_W` 360. New Controls tab content:
  - **Control Mode** toggle: `Tilt` / `Joystick`
  - **Joystick Side** toggle: `Left` / `Right` — greyed out unless joystick mode
  - one-line hint
- The "Enable Tilt Controls" prompt (`MenuScene.ts:483`) hides in joystick mode.

## Data flow (joystick mode, one frame)

```
touch → rex VirtualJoystick (Phaser pointer, multi-touch)
      → JoystickController.update(delta)
          forceX → setAxis(tiltFactor)
          .up edge → pulseJump(jumpVx);  .up held → dragUp
          .down edge → pulseDive();      .down held → diveHeld + dragDown
          double-tap dir → pulseDash(dir)
      → InputManager.update(delta)   [tilt calc skipped; pending→active]
      → Player.update()              [reads same channels as always]

dash button tap  → pulseDash(sign(tiltFactor)||facing)
GRAB / PLACE     → unchanged Phaser buttons
```

## Edge cases & interplay

- **Ladders:** `handleLadder()` runs before jump/dive and reads `dragUp/dragDown`,
  so up/down on the stick climbs while on a ladder and jumps/dives off it. A jump
  pulse that fires while on a ladder is harmlessly buffered and expires (ladder
  consumes the frame; `tryGroundOrAirJump` isn't reached).
- **No double jump-fire:** jump is rising-edge only; holding up does not re-jump.
- **Dash direction at center:** falls back to `sprite.flipX` facing.
- **Multi-touch:** stick (rex/Phaser pointer) + dash/GRAB/PLACE (Phaser buttons)
  coexist; the single-active-touch window handler is gated off in joystick mode,
  so no contention.
- **Mode switch mid-session:** changing mode in settings then entering a gameplay
  scene mounts/omits the joystick accordingly; tilt prompt visibility follows mode.

## Testing

Pure, Phaser-free where it matters:
- `joystickMath.test.ts`: `axisFromForce` (deadzone, curve, clamp, sign), edge
  detection, double-tap state machine (threshold, window, same-direction).
- `InputManager.test.ts`: control-mode gating — gamma ignored and window handlers
  no-op in joystick mode; tilt mode unchanged; injection methods set the right
  fields.
- `SaveData.test.ts`: `controlMode`/`joystickSide` defaults + round-trip persist.

rex itself is not unit-tested (vetted dependency); the controller's thin glue is
covered via the pure helpers. `npm run build` must pass (TS).

## Out of scope / follow-ups

- Configurable dash button size/opacity.
- Haptics on dash/jump.
- A "flick" dash mode (rejected: unreliable on a small stick).
- Joystick opacity/size sliders in settings.

## Dependency

`npm i phaser3-rex-plugins` — import only
`phaser3-rex-plugins/plugins/virtualjoystick.js` (tree-shaken single plugin, MIT).

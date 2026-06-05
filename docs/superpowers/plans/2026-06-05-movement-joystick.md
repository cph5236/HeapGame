# Movement Joystick Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggleable on-screen virtual joystick (full-directional: move / jump / dive, plus a dash button and double-tap dash) as a per-device alternative to phone-tilt movement, with a Controls tab in settings.

**Architecture:** Wrap rexrainbow's `VirtualJoystick` in a `JoystickController` that writes the *same* `InputManager` channels tilt/swipe produce today (player code untouched). Pure mapping math lives in `joystickMath.ts` (unit-tested); the rex glue and Phaser UI are verified by build + smoke. `controlMode`/`joystickSide` are device-local prefs on `RawSave`. The stick is mounted in both gameplay scenes via a shared `mountJoystick` helper; in joystick mode the window swipe/tap handlers and device-tilt are gated off.

**Tech Stack:** Phaser 3.90, TypeScript 5.9, Vite 6, Vitest, `phaser3-rex-plugins` (single-plugin import).

**Spec:** `docs/superpowers/specs/2026-06-05-movement-joystick-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | add `phaser3-rex-plugins` dependency |
| `src/constants.ts` (modify) | joystick tuning constants |
| `src/systems/joystickMath.ts` (create) | pure mapping: axis curve + double-tap state machine |
| `src/systems/__tests__/joystickMath.test.ts` (create) | unit tests for the pure math |
| `src/systems/SaveData.ts` (modify) | `controlMode`/`joystickSide` getters/setters + device-local merge |
| `src/systems/__tests__/SaveData.test.ts` (modify) | defaults, round-trip, merge-preserve regression |
| `src/systems/InputManager.ts` (modify) | `controlMode` gating + injection methods + `diveHeld` |
| `src/systems/__tests__/InputManager.test.ts` (modify) | gating + injection behavior |
| `src/entities/Player.ts` (modify) | `updateDive` honors `im.diveHeld` |
| `src/systems/JoystickController.ts` (create) | rex wrapper → InputManager each frame |
| `src/systems/mountJoystick.ts` (create) | builds controller + dash button; owns teardown |
| `src/ui/controlHelp.ts` (create) | single source of mode-aware CONTROLS help copy (both overlays) |
| `src/scenes/GameScene.ts` (modify) | mount / update-before-im / destroy; mode-aware in-run help |
| `src/scenes/InfiniteGameScene.ts` (modify) | mount / update-before-im / destroy |
| `src/scenes/MenuScene.ts` (modify) | Controls tab; tilt prompt as a field refreshed on toggle; help overlay regenerated on open; close() hides Controls widgets |

---

## Task 1: Add the rex dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the plugin**

Run: `npm i phaser3-rex-plugins`
Expected: `package.json` gains `"phaser3-rex-plugins"` under dependencies; install succeeds.

- [ ] **Step 2: Verify the single-plugin import path resolves**

Run: `node -e "require.resolve('phaser3-rex-plugins/plugins/virtualjoystick.js'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(joystick): add phaser3-rex-plugins dependency"
```

---

## Task 2: Joystick tuning constants

**Files:**
- Modify: `src/constants.ts` (append near the tilt constants around line 79-81)

- [ ] **Step 1: Add constants**

Append after the `TILT_CURVE_EXP` line:

```ts
// ── Virtual joystick (controlMode === 'joystick') ───────────────────────────
export const JOYSTICK_RADIUS         = 64;   // px radius of the stick base hit-area
export const JOYSTICK_DEAD_ZONE      = 0.2;  // fraction of radius ignored near center
export const JOYSTICK_CURVE_EXP      = 0.3;  // axis power curve (matches tilt feel)
export const JOYSTICK_TAP_THRESHOLD  = 0.85; // |axis| that counts as a directional tap
export const JOYSTICK_DOUBLETAP_MS   = 300;  // window for the second tap to fire a dash
export const JOYSTICK_MARGIN         = 28;   // px from screen edge to stick/button center
export const JOYSTICK_FORCE_MIN_FRAC = 0.4;  // rex forceMin as fraction of radius (up/down)
export const DASH_BUTTON_RADIUS      = 34;   // px radius of the on-screen dash button
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS (no TS errors).

- [ ] **Step 3: Commit**

```bash
git add src/constants.ts
git commit -m "feat(joystick): add joystick tuning constants"
```

---

## Task 3: Pure mapping math (`joystickMath.ts`)

**Files:**
- Create: `src/systems/joystickMath.ts`
- Test: `src/systems/__tests__/joystickMath.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/systems/__tests__/joystickMath.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { axisFromForce, initDoubleTap, stepDoubleTap, zoneFromAxis } from '../joystickMath';

describe('axisFromForce', () => {
  it('returns 0 inside the dead zone', () => {
    expect(axisFromForce(10, 64, 0.2, 0.3)).toBe(0); // 10/64 = 0.156 < 0.2
  });
  it('clamps to +1 at/beyond full radius', () => {
    expect(axisFromForce(64, 64, 0.2, 0.3)).toBeCloseTo(1, 5);
    expect(axisFromForce(200, 64, 0.2, 0.3)).toBeCloseTo(1, 5);
  });
  it('clamps to -1 at negative full radius', () => {
    expect(axisFromForce(-64, 64, 0.2, 0.3)).toBeCloseTo(-1, 5);
  });
  it('preserves sign and is monotonic between dead zone and max', () => {
    const a = axisFromForce(30, 64, 0.2, 0.3);
    const b = axisFromForce(50, 64, 0.2, 0.3);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(axisFromForce(-30, 64, 0.2, 0.3)).toBeCloseTo(-a, 5);
  });
});

describe('zoneFromAxis', () => {
  it('is 0 below threshold, ±1 at/above', () => {
    expect(zoneFromAxis(0.5, 0.85)).toBe(0);
    expect(zoneFromAxis(0.9, 0.85)).toBe(1);
    expect(zoneFromAxis(-0.9, 0.85)).toBe(-1);
  });
});

describe('stepDoubleTap', () => {
  it('does not fire on a single tap', () => {
    const s = initDoubleTap();
    expect(stepDoubleTap(s, 0, 0, 300).fired).toBe(false);
    expect(stepDoubleTap(s, 1, 10, 300).fired).toBe(false); // first engage from center
  });
  it('fires on a second same-direction engage within the window', () => {
    const s = initDoubleTap();
    stepDoubleTap(s, 0, 0, 300);    // center
    stepDoubleTap(s, 1, 10, 300);   // first tap (engage)
    stepDoubleTap(s, 0, 20, 300);   // recenter
    const r = stepDoubleTap(s, 1, 30, 300); // second tap within window
    expect(r.fired).toBe(true);
    expect(r.dir).toBe(1);
  });
  it('does not fire if the second tap is the opposite direction', () => {
    const s = initDoubleTap();
    stepDoubleTap(s, 0, 0, 300);
    stepDoubleTap(s, 1, 10, 300);
    stepDoubleTap(s, 0, 20, 300);
    expect(stepDoubleTap(s, -1, 30, 300).fired).toBe(false);
  });
  it('does not fire if the second tap is too late', () => {
    const s = initDoubleTap();
    stepDoubleTap(s, 0, 0, 300);
    stepDoubleTap(s, 1, 10, 300);
    stepDoubleTap(s, 0, 20, 300);
    expect(stepDoubleTap(s, 1, 500, 300).fired).toBe(false); // 490ms > window
  });
  it('only engages on a rise from center (held direction does not re-fire)', () => {
    const s = initDoubleTap();
    stepDoubleTap(s, 0, 0, 300);
    stepDoubleTap(s, 1, 10, 300);   // first engage
    const held = stepDoubleTap(s, 1, 20, 300); // still held, no recenter
    expect(held.fired).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- joystickMath`
Expected: FAIL — `Cannot find module '../joystickMath'`.

- [ ] **Step 3: Implement `joystickMath.ts`**

Create `src/systems/joystickMath.ts`:

```ts
/** Pure, Phaser-free joystick mapping helpers. Unit-tested in isolation. */

/** Map a horizontal force (px) to a normalized −1..1 axis with dead zone + curve.
 *  Mirrors the tilt curve in InputManager so movement feel matches. */
export function axisFromForce(
  forceX: number, radius: number, deadZone: number, curveExp: number,
): number {
  const raw = Math.max(-1, Math.min(1, forceX / radius));
  const abs = Math.abs(raw);
  if (abs < deadZone) return 0;
  const t = (abs - deadZone) / (1 - deadZone);
  return Math.sign(raw) * Math.pow(t, curveExp);
}

/** Discrete horizontal zone for double-tap detection: −1, 0, or +1. */
export function zoneFromAxis(axis: number, tapThreshold: number): -1 | 0 | 1 {
  if (axis >= tapThreshold) return 1;
  if (axis <= -tapThreshold) return -1;
  return 0;
}

export interface DoubleTapState {
  prevZone:   -1 | 0 | 1; // zone last frame, to detect a rise from center
  pendingDir: -1 | 0 | 1; // direction of a first tap awaiting its partner
  pendingTime: number;    // timestamp of that first tap
}

export function initDoubleTap(): DoubleTapState {
  return { prevZone: 0, pendingDir: 0, pendingTime: 0 };
}

/** Step the double-tap machine with the current zone and time.
 *  A "tap" is a rise from center (0 → ±1). Two same-direction taps within
 *  `windowMs` fire a dash. Mutates `state`. */
export function stepDoubleTap(
  state: DoubleTapState, zone: -1 | 0 | 1, now: number, windowMs: number,
): { fired: boolean; dir: -1 | 1 } {
  let fired = false;
  let dir: -1 | 1 = 1;
  const engaged = zone !== 0 && state.prevZone === 0;

  if (engaged) {
    if (state.pendingDir === zone && now - state.pendingTime <= windowMs) {
      fired = true;
      dir = zone as -1 | 1;
      state.pendingDir = 0;
      state.pendingTime = 0;
    } else {
      state.pendingDir = zone;
      state.pendingTime = now;
    }
  } else if (state.pendingDir !== 0 && now - state.pendingTime > windowMs) {
    state.pendingDir = 0; // expire a stale first tap
  }

  state.prevZone = zone;
  return { fired, dir };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- joystickMath`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/systems/joystickMath.ts src/systems/__tests__/joystickMath.test.ts
git commit -m "feat(joystick): pure axis curve + double-tap state machine"
```

---

## Task 4: SaveData control prefs (device-local)

**Files:**
- Modify: `src/systems/SaveData.ts` (RawSave interface ~line 37; mergeCloudSave return ~line 443; add getters near the sound-settings section ~line 468)
- Test: `src/systems/__tests__/SaveData.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/systems/__tests__/SaveData.test.ts`:

```ts
import {
  getControlMode, setControlMode, getJoystickSide, setJoystickSide,
  getRawSaveForCloudSync, mergeCloudSave, resetCacheForTests,
} from '../SaveData';

describe('control prefs (device-local)', () => {
  beforeEach(() => { localStorage.clear(); resetCacheForTests(); });

  it('defaults to tilt / left', () => {
    expect(getControlMode()).toBe('tilt');
    expect(getJoystickSide()).toBe('left');
  });

  it('round-trips controlMode and joystickSide', () => {
    setControlMode('joystick');
    setJoystickSide('right');
    resetCacheForTests();
    expect(getControlMode()).toBe('joystick');
    expect(getJoystickSide()).toBe('right');
  });

  it('mergeCloudSave keeps LOCAL control prefs even when cloud differs and wins balance', () => {
    setControlMode('joystick');
    setJoystickSide('right');
    const local = getRawSaveForCloudSync();
    const cloud = { ...local, controlMode: 'tilt' as const, joystickSide: 'left' as const, balance: local.balance + 999 };
    const merged = mergeCloudSave(local, cloud);
    expect(merged.controlMode).toBe('joystick');
    expect(merged.joystickSide).toBe('right');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- SaveData`
Expected: FAIL — `getControlMode` / `setControlMode` not exported.

- [ ] **Step 3: Add the fields to `RawSave`**

In the `RawSave` interface (after `adRunTarget?: number;` ~line 52):

```ts
  controlMode?:  'tilt' | 'joystick';
  joystickSide?: 'left' | 'right';
```

- [ ] **Step 4: Preserve them in `mergeCloudSave`**

In the `return { ... }` of `mergeCloudSave` (after `adRunTarget: local.adRunTarget,` ~line 456) add:

```ts
    controlMode:  local.controlMode,   // device-local — local always wins
    joystickSide: local.joystickSide,  // device-local — local always wins
```

- [ ] **Step 5: Add getters/setters**

Above the `// ── Sound settings` section (~line 468):

```ts
// ── Control settings (device-local) ─────────────────────────────────────────

export function getControlMode(): 'tilt' | 'joystick' {
  return load().controlMode ?? 'tilt';
}

export function setControlMode(mode: 'tilt' | 'joystick'): void {
  const data = load();
  data.controlMode = mode;
  persist(data);
}

export function getJoystickSide(): 'left' | 'right' {
  return load().joystickSide ?? 'left';
}

export function setJoystickSide(side: 'left' | 'right'): void {
  const data = load();
  data.joystickSide = side;
  persist(data);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- SaveData`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/systems/SaveData.ts src/systems/__tests__/SaveData.test.ts
git commit -m "feat(joystick): device-local controlMode + joystickSide prefs"
```

---

## Task 5: InputManager — control-mode gating + injection

**Files:**
- Modify: `src/systems/InputManager.ts`
- Test: `src/systems/__tests__/InputManager.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/systems/__tests__/InputManager.test.ts`:

```ts
describe('InputManager — controlMode gating + injection', () => {
  it('defaults to tilt mode', async () => {
    const { InputManager } = await import('../InputManager');
    expect(InputManager.getInstance().controlMode).toBe('tilt');
  });

  it('setAxis writes tiltFactor and derives goLeft/goRight', async () => {
    const { InputManager } = await import('../InputManager');
    const im = InputManager.getInstance();
    im.setAxis(-0.5);
    expect(im.tiltFactor).toBe(-0.5);
    expect(im.goLeft).toBe(true);
    expect(im.goRight).toBe(false);
  });

  it('pulseJump primes jumpJustPressed + jumpVx on next update()', async () => {
    const { InputManager } = await import('../InputManager');
    const im = InputManager.getInstance();
    im.setControlMode('joystick');
    im.pulseJump(120);
    im.update(16, false);
    expect(im.jumpJustPressed).toBe(true);
    expect(im.jumpVx).toBe(120);
  });

  it('pulseDash primes dash + direction on next update()', async () => {
    const { InputManager } = await import('../InputManager');
    const im = InputManager.getInstance();
    im.setControlMode('joystick');
    im.pulseDash(-1);
    im.update(16, false);
    expect(im.dashJustFired).toBe(true);
    expect(im.dashDir).toBe(-1);
  });

  it('joystick mode does not overwrite injected tiltFactor from gamma', async () => {
    const im = await makeMobileIM();
    im.setControlMode('joystick');
    im.setAxis(0.7);
    im.update(16, false);           // gamma path must be skipped
    expect(im.tiltFactor).toBe(0.7);
  });

  it('setLadderDrag sets dragUp/dragDown', async () => {
    const { InputManager } = await import('../InputManager');
    const im = InputManager.getInstance();
    im.setLadderDrag(true, false);
    expect(im.dragUp).toBe(true);
    expect(im.dragDown).toBe(false);
  });
});
```

> Note: `makeMobileIM()` already exists in this test file (returns a tilt-attached mobile InputManager). If it doesn't return the instance, capture it via `InputManager.getInstance()` after calling it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- InputManager`
Expected: FAIL — `controlMode` / `setAxis` / `pulseJump` undefined.

- [ ] **Step 3: Add the field and `diveHeld`**

In the class fields, near `tiltFactor` (~line 26):

```ts
  controlMode: 'tilt' | 'joystick' = 'tilt';
  diveHeld = false;   // continuous "stick down held" — sustains dive like keyboard Down
```

- [ ] **Step 4: Gate the gamma tilt computation**

In `update()`, change the tilt block guard (~line 112) from:

```ts
    if (this.tiltListenerAttached) {
```
to:
```ts
    if (this.tiltListenerAttached && this.controlMode === 'tilt') {
```

- [ ] **Step 5: Gate the window touch handlers**

Add an early return at the top of each handler body. In `onTouchStart` (~line 202), `onTouchMove` (~line 217), and `onTouchEnd` (~line 253), add as the first line:

```ts
    if (this.controlMode === 'joystick') return;
```

- [ ] **Step 6: Add injection methods**

After `setSuppressionRect` / `isInSuppressionZone` (~line 154), add:

```ts
  /** Set the control scheme. Joystick mode gates device-tilt and window gestures
   *  off; a JoystickController becomes the sole movement source. */
  setControlMode(mode: 'tilt' | 'joystick'): void {
    this.controlMode = mode;
  }

  /** Joystick: write the analog horizontal axis (−1..1) directly. */
  setAxis(factor: number): void {
    this.tiltFactor = factor;
    this.goLeft  = factor < -0.01;
    this.goRight = factor >  0.01;
  }

  /** Joystick: queue a jump pulse for the next frame (vx = horizontal launch). */
  pulseJump(vx = 0): void {
    this.pendingJump   = true;
    this.pendingJumpVx = vx;
  }

  /** Joystick: queue a dash pulse for the next frame. */
  pulseDash(dir: 1 | -1): void {
    this.pendingDash    = true;
    this.pendingDashDir = dir;
  }

  /** Joystick: queue a dive burst for the next frame. */
  pulseDive(): void {
    this.pendingDive = true;
  }

  /** Joystick: continuous ladder-climb signals (up/down held on the stick). */
  setLadderDrag(up: boolean, down: boolean): void {
    this.dragUp   = up;
    this.dragDown = down;
  }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- InputManager`
Expected: PASS.

- [ ] **Step 8: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/systems/InputManager.ts src/systems/__tests__/InputManager.test.ts
git commit -m "feat(joystick): InputManager control-mode gating + injection API"
```

---

## Task 6: Player dive honors `diveHeld`

**Files:**
- Modify: `src/entities/Player.ts:545`

- [ ] **Step 1: Make held stick-down sustain the dive**

In `updateDive`, change (line ~545):

```ts
    const holdingDown = this.downKeys.some(k => k.isDown);
```
to:
```ts
    const holdingDown = this.downKeys.some(k => k.isDown) || im.diveHeld;
```

(`im` is already obtained at the top of `updateDive` at line 544.)

- [ ] **Step 2: Verify build + existing tests still pass**

Run: `npm run build && npm test -- Player`
Expected: build PASS; Player tests PASS (or "no tests" — acceptable; this is exercised by smoke test in Task 12).

- [ ] **Step 3: Commit**

```bash
git add src/entities/Player.ts
git commit -m "feat(joystick): held stick-down sustains dive like keyboard"
```

---

## Task 7: `JoystickController` (rex wrapper)

**Files:**
- Create: `src/systems/JoystickController.ts`

> rex's own types are not relied upon — a minimal structural interface keeps TS
> happy regardless of the plugin's shipped `.d.ts`.

- [ ] **Step 1: Implement the controller**

Create `src/systems/JoystickController.ts`:

```ts
import Phaser from 'phaser';
// Single-plugin import — tree-shaken, not the whole rex bundle.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plugin ships JS; we type it structurally below.
import VirtualJoystick from 'phaser3-rex-plugins/plugins/virtualjoystick.js';
import { InputManager } from './InputManager';
import {
  axisFromForce, zoneFromAxis, initDoubleTap, stepDoubleTap,
} from './joystickMath';
import type { DoubleTapState } from './joystickMath';
import {
  JOYSTICK_RADIUS, JOYSTICK_DEAD_ZONE, JOYSTICK_CURVE_EXP,
  JOYSTICK_TAP_THRESHOLD, JOYSTICK_DOUBLETAP_MS, JOYSTICK_FORCE_MIN_FRAC,
  SWIPE_JUMP_HORIZONTAL_MAX,
} from '../constants';

/** The subset of rex VirtualJoystick we use. */
interface RexJoystick {
  forceX: number;
  up: boolean;
  down: boolean;
  enable: boolean;
  setPosition(x: number, y: number): RexJoystick;
  setVisible(v: boolean): RexJoystick;
  destroy(): void;
}

export class JoystickController {
  private joy: RexJoystick;
  private base: Phaser.GameObjects.Arc;
  private thumb: Phaser.GameObjects.Arc;
  private im = InputManager.getInstance();

  private prevUp = false;
  private prevDown = false;
  private dt: DoubleTapState = initDoubleTap();

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.base = scene.add.circle(x, y, JOYSTICK_RADIUS, 0x000000, 0.45)
      .setStrokeStyle(2, 0x8899bb).setScrollFactor(0).setDepth(40);
    this.thumb = scene.add.circle(x, y, JOYSTICK_RADIUS * 0.42, 0x6688ff, 0.9)
      .setScrollFactor(0).setDepth(41);

    this.joy = new VirtualJoystick(scene, {
      x, y,
      radius: JOYSTICK_RADIUS,
      base: this.base,
      thumb: this.thumb,
      dir: '8dir',
      fixed: true,
      forceMin: JOYSTICK_RADIUS * JOYSTICK_FORCE_MIN_FRAC,
      enable: true,
    }) as unknown as RexJoystick;
  }

  /** Read rex state and write InputManager. Call BEFORE im.update() each frame. */
  update(_delta: number): void {
    const axis = axisFromForce(
      this.joy.forceX, JOYSTICK_RADIUS, JOYSTICK_DEAD_ZONE, JOYSTICK_CURVE_EXP,
    );
    this.im.setAxis(axis);

    const up = this.joy.up;
    const down = this.joy.down;

    // Jump: rising edge of up; jumpVx carries the horizontal lean for diagonals.
    if (up && !this.prevUp) this.im.pulseJump(axis * SWIPE_JUMP_HORIZONTAL_MAX);
    // Dive: rising edge of down (burst); held down sustains via diveHeld.
    if (down && !this.prevDown) this.im.pulseDive();
    this.im.diveHeld = down;

    // Ladder climb signals (continuous).
    this.im.setLadderDrag(up, down);

    // Dash: double-tap a horizontal direction.
    const zone = zoneFromAxis(axis, JOYSTICK_TAP_THRESHOLD);
    const r = stepDoubleTap(this.dt, zone, performance.now(), JOYSTICK_DOUBLETAP_MS);
    if (r.fired) this.im.pulseDash(r.dir);

    this.prevUp = up;
    this.prevDown = down;
  }

  setVisible(v: boolean): void {
    this.base.setVisible(v);
    this.thumb.setVisible(v);
    this.joy.enable = v;
  }

  destroy(): void {
    this.joy.destroy();   // detaches rex pointer handlers
    this.base.destroy();
    this.thumb.destroy();
    this.im.diveHeld = false;
    this.im.setLadderDrag(false, false);
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS. If TS errors on the rex import, confirm the `@ts-ignore` is directly above the `import VirtualJoystick` line.

- [ ] **Step 3: Commit**

```bash
git add src/systems/JoystickController.ts
git commit -m "feat(joystick): JoystickController wrapping rex VirtualJoystick"
```

---

## Task 8: `mountJoystick` helper (controller + dash button)

**Files:**
- Create: `src/systems/mountJoystick.ts`

- [ ] **Step 1: Implement the helper**

Create `src/systems/mountJoystick.ts`:

```ts
import Phaser from 'phaser';
import { InputManager } from './InputManager';
import { JoystickController } from './JoystickController';
import { Player } from '../entities/Player';
import { getControlMode, getJoystickSide } from './SaveData';
import { JOYSTICK_RADIUS, JOYSTICK_MARGIN, DASH_BUTTON_RADIUS } from '../constants';

export interface JoystickHandle {
  update(delta: number): void;
  destroy(): void;
}

const DASH_SUPPRESS_ID = 'dash';

/** When controlMode === 'joystick', build the stick + dash button for `scene`.
 *  The stick sits in one bottom corner (per joystickSide); the dash button in the
 *  opposite corner. Returns null in tilt mode. Caller updates BEFORE im.update()
 *  and calls destroy() on scene shutdown. */
export function mountJoystick(
  scene: Phaser.Scene, im: InputManager, player: Player,
): JoystickHandle | null {
  if (getControlMode() !== 'joystick') return null;

  const side = getJoystickSide();
  const w = scene.scale.width;
  const h = scene.scale.height;

  const stickX = side === 'left'
    ? JOYSTICK_MARGIN + JOYSTICK_RADIUS
    : w - JOYSTICK_MARGIN - JOYSTICK_RADIUS;
  const stickY = h - JOYSTICK_MARGIN - JOYSTICK_RADIUS;
  const controller = new JoystickController(scene, stickX, stickY);

  // Dash button: opposite bottom corner from the stick.
  const dashX = side === 'left'
    ? w - JOYSTICK_MARGIN - DASH_BUTTON_RADIUS
    : JOYSTICK_MARGIN + DASH_BUTTON_RADIUS;
  const dashY = h - JOYSTICK_MARGIN - DASH_BUTTON_RADIUS;

  const dashBtn = scene.add.circle(dashX, dashY, DASH_BUTTON_RADIUS, 0x331a1a, 0.55)
    .setStrokeStyle(2, 0xff7755).setScrollFactor(0).setDepth(40)
    .setVisible(player.hasDash);
  const dashLabel = scene.add.text(dashX, dashY, '»', {
    fontSize: '26px', color: '#ffbbaa', fontStyle: 'bold',
  }).setOrigin(0.5).setScrollFactor(0).setDepth(41).setVisible(player.hasDash);

  if (player.hasDash) {
    dashBtn.setInteractive({ useHandCursor: true });
    dashBtn.on('pointerdown', () => {
      const dir: 1 | -1 = im.tiltFactor > 0.05 ? 1
        : im.tiltFactor < -0.05 ? -1
        : (player.sprite.flipX ? -1 : 1);
      im.pulseDash(dir);
    });
    // Suppress so the tap never leaks into a gesture (belt-and-suspenders).
    im.setSuppressionRect(DASH_SUPPRESS_ID, {
      x: dashX - DASH_BUTTON_RADIUS, y: dashY - DASH_BUTTON_RADIUS,
      w: DASH_BUTTON_RADIUS * 2, h: DASH_BUTTON_RADIUS * 2,
    });
  }

  return {
    update: (delta: number) => controller.update(delta),
    destroy: () => {
      controller.destroy();
      dashBtn.destroy();
      dashLabel.destroy();
      im.setSuppressionRect(DASH_SUPPRESS_ID, null);
    },
  };
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS. (Confirm `Player` exposes `hasDash` and `sprite` publicly — it does: `Player.ts:142`, `sprite` is public.)

- [ ] **Step 3: Commit**

```bash
git add src/systems/mountJoystick.ts
git commit -m "feat(joystick): mountJoystick helper with dash button + cleanup"
```

---

## Task 9: Shared help copy + wire into GameScene

**Files:**
- Create: `src/ui/controlHelp.ts`
- Modify: `src/scenes/GameScene.ts` (import; field; mount after `this.im` ~line 307; update before `im.update` ~line 396; in-run help overlay ~line 829-854; destroy in `shutdown` ~line 872)

- [ ] **Step 1: Create the shared control-help module**

Both the menu and in-run help overlays must show the same mode-aware copy. Create
`src/ui/controlHelp.ts`:

```ts
/** Mode-aware CONTROLS help copy, shared by MenuScene + GameScene info overlays.
 *  Single source of truth so both surfaces stay consistent across control modes. */
export function controlHelpLines(isMobile: boolean, mode: 'tilt' | 'joystick'): string[] {
  if (!isMobile) {
    return [
      'CONTROLS', '',
      'Move     ← →  /  A  D',
      'Jump     ↑  /  W',
      'Dash     SHIFT',
      'Dive     ↓  /  S  (airborne)',
      'Place    SPACE',
      '', 'TIP', '',
      'Left & right edges wrap around!',
    ];
  }
  const actions = mode === 'joystick' ? [
    'Move     Joystick left / right',
    'Jump     Push joystick up',
    'Dash     Dash button / double-tap',
    'Dive     Push joystick down',
    'Place    PLACE BLOCK button',
    'Ladder   Push up / down',
  ] : [
    'Move     Tilt phone left / right',
    'Jump     Tap or swipe up',
    'Dash     Swipe left / right',
    'Dive     Swipe down',
    'Place    PLACE BLOCK button',
    'Ladder   Drag up / down',
  ];
  return ['CONTROLS', '', ...actions, '', 'TIP', '', 'Left & right edges wrap around!'];
}
```

- [ ] **Step 2: Import into GameScene**

Add near the other imports at the top of `GameScene.ts`:

```ts
import { mountJoystick } from '../systems/mountJoystick';
import type { JoystickHandle } from '../systems/mountJoystick';
import { controlHelpLines } from '../ui/controlHelp';
import { getControlMode } from '../systems/SaveData';
```
(Merge `getControlMode` into the existing `from '../systems/SaveData'` import if one exists.)

- [ ] **Step 3: Add the field**

In the class fields (near other private members):

```ts
  private joystick: JoystickHandle | null = null;
```

- [ ] **Step 4: Mount after the player + InputManager exist**

After `this.im = InputManager.getInstance();` (~line 307) — ensure this is placed AFTER `this.player` is created (move below player construction if needed):

```ts
    this.joystick = mountJoystick(this, this.im, this.player);
```

- [ ] **Step 5: Update the controller before `im.update`**

Immediately before `im.update(delta, inLiveZone);` (~line 396):

```ts
    this.joystick?.update(delta);
```

- [ ] **Step 6: Branch the in-run help overlay on control mode**

Control mode can't change during a run, so a single read at create time is correct.
Replace the entire `const lines = isMobile ? [ ... ] : [ ... ];` block (~line 829-854)
with:

```ts
    const lines = controlHelpLines(isMobile, getControlMode());
```

- [ ] **Step 7: Destroy on shutdown**

In `shutdown()` (~line 872), alongside the existing `setSuppressionRect('place', null)`:

```ts
    this.joystick?.destroy();
    this.joystick = null;
```

- [ ] **Step 8: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/ui/controlHelp.ts src/scenes/GameScene.ts
git commit -m "feat(joystick): shared help copy + mount joystick in GameScene"
```

---

## Task 10: Wire into InfiniteGameScene

**Files:**
- Modify: `src/scenes/InfiniteGameScene.ts` (import; field; mount after `this.im` ~line 277; update before `this.im.update` ~line 326; destroy in `shutdown` ~line 532)

- [ ] **Step 1: Import + field**

Add import:

```ts
import { mountJoystick } from '../systems/mountJoystick';
import type { JoystickHandle } from '../systems/mountJoystick';
```
Add field:
```ts
  private joystick: JoystickHandle | null = null;
```

- [ ] **Step 2: Mount after player + InputManager**

After `this.im = InputManager.getInstance();` (~line 277), placed AFTER `this.player` is created (~line 163):

```ts
    this.joystick = mountJoystick(this, this.im, this.player);
```

- [ ] **Step 3: Update before `this.im.update`**

Immediately before `this.im.update(delta, false);` (~line 326):

```ts
    this.joystick?.update(delta);
```

- [ ] **Step 4: Destroy on shutdown**

In `shutdown()` (~line 532) add:

```ts
    this.joystick?.destroy();
    this.joystick = null;
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/scenes/InfiniteGameScene.ts
git commit -m "feat(joystick): mount joystick in InfiniteGameScene"
```

---

## Task 11: MenuScene — Controls tab, tilt prompt, help overlay

**Files:**
- Modify: `src/scenes/MenuScene.ts` (tilt prompt ~line 483; settings tab bar ~line 702-782; close path ~line 804-812; info overlay ~line 864-895)

- [ ] **Step 1: Import the control-pref accessors + help copy**

Add to the imports in `MenuScene.ts`:

```ts
import {
  getControlMode, setControlMode, getJoystickSide, setJoystickSide,
} from '../systems/SaveData';
import { controlHelpLines } from '../ui/controlHelp';
```
(Merge the SaveData names into the existing `from '../systems/SaveData'` import if one exists.)

- [ ] **Step 2: Make the tilt prompt a refreshable field**

The prompt lives on the menu *behind* the settings panel, so toggling control mode
in the panel must update it live (not just at scene build). Add a class field:

```ts
  private tiltPrompt?: Phaser.GameObjects.Text;
```

At the tilt prompt block (~line 483), keep creating it whenever the device could use
tilt, store the ref, and drive **visibility** by the current mode (the alpha tween
still runs; `setVisible` gates show/hide):

```ts
    if (im.isMobile && !im.tiltPermissionGranted) {
      const tiltBtn = this.add.text(this.scale.width / 2, this.scale.height - 94, 'Enable Tilt Controls', {
        fontSize: '17px',
        color: '#88aaff',
        stroke: '#000000',
        strokeThickness: 2,
      }).setOrigin(0.5).setAlpha(0).setDepth(9).setInteractive({ useHandCursor: true });

      tiltBtn.on('pointerup', () => {
        im.requestTiltPermission().then(() => tiltBtn.setVisible(false));
      });

      this.tweens.add({ targets: tiltBtn, alpha: 1, duration: 300, delay: 2000 });
      tiltBtn.setVisible(getControlMode() === 'tilt');
      this.tiltPrompt = tiltBtn;
    }
```

- [ ] **Step 3: Add the third tab to the tab bar**

The tab bar currently centers two tabs (`Sounds | Dev`) at `cx ± (TAB_W/2 + 4)` with `TAB_W = 140`. Replace the two-tab geometry (~line 704-710) with three evenly-spaced tabs:

```ts
    const TAB_W = 108;
    const TAB_H = 32;
    const TAB_GAP = 6;
    const tabXs = [cx - (TAB_W + TAB_GAP), cx, cx + (TAB_W + TAB_GAP)];

    const soundsTabBg   = this.add.rectangle(tabXs[0], TAB_Y, TAB_W, TAB_H, 0x2244aa).setDepth(32).setVisible(false);
    const soundsTabText = this.add.text(tabXs[0], TAB_Y, 'Sounds', { fontSize: '13px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(33).setVisible(false);
    const controlsTabBg   = this.add.rectangle(tabXs[1], TAB_Y, TAB_W, TAB_H, 0x1a1a2e).setDepth(32).setVisible(false);
    const controlsTabText = this.add.text(tabXs[1], TAB_Y, 'Controls', { fontSize: '13px', color: '#888888' }).setOrigin(0.5).setDepth(33).setVisible(false);
    const devTabBg      = this.add.rectangle(tabXs[2], TAB_Y, TAB_W, TAB_H, 0x1a1a2e).setDepth(32).setVisible(false);
    const devTabText    = this.add.text(tabXs[2], TAB_Y, 'Dev', { fontSize: '13px', color: '#888888' }).setOrigin(0.5).setDepth(33).setVisible(false);
```

- [ ] **Step 4: Build the Controls tab content**

After the Sounds-tab content block (~after line 761, before "Tab switching"), add:

```ts
    // ── Controls tab content ──────────────────────────────────────────────────
    let ctrlMode = getControlMode();
    let ctrlSide = getJoystickSide();

    const modeLabel = this.add.text(cx - 130, CONTENT_TOP + 20, 'Control Mode', {
      fontSize: '14px', color: '#aaaacc',
    }).setOrigin(0, 0.5).setDepth(33).setVisible(false);
    const tiltOpt = this.add.text(cx + 16, CONTENT_TOP + 20, 'Tilt', {
      fontSize: '15px', color: '#ffffff', fontStyle: 'bold', backgroundColor: '#2244aa', padding: { x: 10, y: 4 },
    }).setOrigin(0.5).setDepth(33).setVisible(false).setInteractive({ useHandCursor: true });
    const joyOpt = this.add.text(cx + 96, CONTENT_TOP + 20, 'Joystick', {
      fontSize: '15px', color: '#888888', backgroundColor: '#1a1a2e', padding: { x: 10, y: 4 },
    }).setOrigin(0.5).setDepth(33).setVisible(false).setInteractive({ useHandCursor: true });

    const sideLabel = this.add.text(cx - 130, CONTENT_TOP + 64, 'Joystick Side', {
      fontSize: '14px', color: '#aaaacc',
    }).setOrigin(0, 0.5).setDepth(33).setVisible(false);
    const leftOpt = this.add.text(cx + 16, CONTENT_TOP + 64, 'Left', {
      fontSize: '15px', color: '#ffffff', fontStyle: 'bold', backgroundColor: '#2244aa', padding: { x: 10, y: 4 },
    }).setOrigin(0.5).setDepth(33).setVisible(false).setInteractive({ useHandCursor: true });
    const rightOpt = this.add.text(cx + 96, CONTENT_TOP + 64, 'Right', {
      fontSize: '15px', color: '#888888', backgroundColor: '#1a1a2e', padding: { x: 10, y: 4 },
    }).setOrigin(0.5).setDepth(33).setVisible(false).setInteractive({ useHandCursor: true });

    const ctrlHint = this.add.text(cx, CONTENT_TOP + 120,
      'Joystick: drag to move, push up to jump,\ndown to dive. Dash button + double-tap.',
      { fontSize: '12px', color: '#8888aa', align: 'center' },
    ).setOrigin(0.5, 0).setDepth(33).setVisible(false);

    const controlsItems = [modeLabel, tiltOpt, joyOpt, sideLabel, leftOpt, rightOpt, ctrlHint];

    const paintMode = () => {
      tiltOpt.setColor(ctrlMode === 'tilt' ? '#ffffff' : '#888888').setBackgroundColor(ctrlMode === 'tilt' ? '#2244aa' : '#1a1a2e').setFontStyle(ctrlMode === 'tilt' ? 'bold' : 'normal');
      joyOpt.setColor(ctrlMode === 'joystick' ? '#ffffff' : '#888888').setBackgroundColor(ctrlMode === 'joystick' ? '#2244aa' : '#1a1a2e').setFontStyle(ctrlMode === 'joystick' ? 'bold' : 'normal');
      const sideDim = ctrlMode !== 'joystick';
      [sideLabel, leftOpt, rightOpt].forEach(o => o.setAlpha(sideDim ? 0.4 : 1));
    };
    const paintSide = () => {
      leftOpt.setColor(ctrlSide === 'left' ? '#ffffff' : '#888888').setBackgroundColor(ctrlSide === 'left' ? '#2244aa' : '#1a1a2e').setFontStyle(ctrlSide === 'left' ? 'bold' : 'normal');
      rightOpt.setColor(ctrlSide === 'right' ? '#ffffff' : '#888888').setBackgroundColor(ctrlSide === 'right' ? '#2244aa' : '#1a1a2e').setFontStyle(ctrlSide === 'right' ? 'bold' : 'normal');
    };
    paintMode(); paintSide();

    // Toggling mode also refreshes the tilt prompt behind the panel (it only
    // applies to tilt mode, and only when the device hasn't granted permission).
    const refreshTiltPrompt = () => {
      const im2 = InputManager.getInstance();
      this.tiltPrompt?.setVisible(ctrlMode === 'tilt' && im2.isMobile && !im2.tiltPermissionGranted);
    };

    tiltOpt.on('pointerup', () => { ctrlMode = 'tilt'; setControlMode('tilt'); paintMode(); refreshTiltPrompt(); });
    joyOpt.on('pointerup',  () => { ctrlMode = 'joystick'; setControlMode('joystick'); paintMode(); refreshTiltPrompt(); });
    leftOpt.on('pointerup',  () => { if (ctrlMode !== 'joystick') return; ctrlSide = 'left'; setJoystickSide('left'); paintSide(); });
    rightOpt.on('pointerup', () => { if (ctrlMode !== 'joystick') return; ctrlSide = 'right'; setJoystickSide('right'); paintSide(); });
```

- [ ] **Step 5: Add the tab-switching wiring**

Update the tab-switching block (~line 763-782). Replace `showSoundsTab`/`showDevTab` and the listeners with three:

```ts
    const showSoundsTab = () => {
      soundsTabBg.setFillStyle(0x2244aa);  soundsTabText.setColor('#ffffff').setFontStyle('bold');
      controlsTabBg.setFillStyle(0x1a1a2e); controlsTabText.setColor('#888888').setFontStyle('normal');
      devTabBg.setFillStyle(0x1a1a2e);      devTabText.setColor('#888888').setFontStyle('normal');
      controlsItems.forEach(o => o.setVisible(false));
      devItems.forEach(o => o.setVisible(false));
      soundsItems.forEach(o => (o as any).setVisible(true));
    };
    const showControlsTab = () => {
      controlsTabBg.setFillStyle(0x2244aa); controlsTabText.setColor('#ffffff').setFontStyle('bold');
      soundsTabBg.setFillStyle(0x1a1a2e);   soundsTabText.setColor('#888888').setFontStyle('normal');
      devTabBg.setFillStyle(0x1a1a2e);       devTabText.setColor('#888888').setFontStyle('normal');
      soundsItems.forEach(o => (o as any).setVisible(false));
      devItems.forEach(o => o.setVisible(false));
      controlsItems.forEach(o => o.setVisible(true));
      paintMode(); paintSide();
    };
    const showDevTab = () => {
      devTabBg.setFillStyle(0x2244aa);       devTabText.setColor('#ffffff').setFontStyle('bold');
      soundsTabBg.setFillStyle(0x1a1a2e);    soundsTabText.setColor('#888888').setFontStyle('normal');
      controlsTabBg.setFillStyle(0x1a1a2e);  controlsTabText.setColor('#888888').setFontStyle('normal');
      soundsItems.forEach(o => (o as any).setVisible(false));
      controlsItems.forEach(o => o.setVisible(false));
      devItems.forEach(o => o.setVisible(true));
    };

    soundsTabBg.setInteractive({ useHandCursor: true }).on('pointerup', showSoundsTab);
    soundsTabText.setInteractive({ useHandCursor: true }).on('pointerup', showSoundsTab);
    controlsTabBg.setInteractive({ useHandCursor: true }).on('pointerup', showControlsTab);
    controlsTabText.setInteractive({ useHandCursor: true }).on('pointerup', showControlsTab);
    devTabBg.setInteractive({ useHandCursor: true }).on('pointerup', showDevTab);
    devTabText.setInteractive({ useHandCursor: true }).on('pointerup', showDevTab);
```

- [ ] **Step 6: Add the new tab objects to `alwaysVisible`**

In the `alwaysVisible` array (~line 798), add `controlsTabBg, controlsTabText`:

```ts
    const alwaysVisible = [overlayBg, panel, title, closeBtn, soundsTabBg, soundsTabText, controlsTabBg, controlsTabText, devTabBg, devTabText];
```

- [ ] **Step 7: Hide Controls widgets in `close()`**

`close()` (~line 804-812) currently hides only sounds/dev items, so closing while the
Controls tab is active leaves its widgets floating over the menu. Add to `close()`,
next to the existing `soundsItems`/`devItems` hides:

```ts
      controlsItems.forEach(o => o.setVisible(false));
```

- [ ] **Step 8: Regenerate the help overlay copy on open**

The info overlay is a separate surface from the settings panel, so it must refresh
when reopened after a mode change. Replace the `mobileLines`/`desktopLines` arrays and
the `overlayText` creation (~line 864-901) with a single helper-driven build:

```ts
    const overlayText = this.add.text(
      this.scale.width / 2 - 160, this.scale.height / 2 - 130,
      controlHelpLines(im.isMobile, getControlMode()).join('\n'),
      {
        fontSize: '17px', color: '#ccccdd',
        stroke: '#000000', strokeThickness: 1,
        lineSpacing: 5,
      },
    ).setScrollFactor(0).setDepth(16).setVisible(false);
```

Then in the overlay's `toggle` (~line 906), refresh the text whenever it opens:

```ts
    const toggle = () => {
      open = !open;
      if (open) overlayText.setText(controlHelpLines(im.isMobile, getControlMode()).join('\n'));
      for (const p of parts) p.setVisible(open);
    };
```

- [ ] **Step 9: Verify build + full test suite**

Run: `npm run build && npm test`
Expected: build PASS; all tests PASS.

- [ ] **Step 10: Commit**

```bash
git add src/scenes/MenuScene.ts
git commit -m "feat(joystick): Controls settings tab + live-refreshed tilt prompt and help"
```

---

## Task 12: Smoke test

**Files:** none (manual verification)

> **Scene-preview caveat:** the dev preview uses the Canvas renderer and bakes
> composite tiles differently than WebGL; use `window.game` in the dev console and
> a real `npm run dev` session for input testing, not just a static screenshot.

- [ ] **Step 1: Static preview of the settings panel**

Run: `npm run scene-preview -- MenuScene '{}' pixel7`
Expected: MenuScene renders at phone size without errors. (The settings panel/tab is opened via interaction, so also do Step 2.)

- [ ] **Step 2: Live dev verification**

Run: `npm run dev` and open the game in a touch-emulated browser (DevTools device mode).
Verify:
- Settings → **Controls** tab appears; switching **Joystick** persists across reload (device-local).
- In joystick mode: the stick shows in the chosen corner; the dash button shows in the opposite corner (only when dash is owned).
- Drag → player moves analog L/R; push **up** → jump (diagonal up gives an angled jump); push **down** → dive, and *holding* down sustains the dive.
- **Dash button** dashes in the stick/facing direction; **double-tap** a direction also dashes.
- On a ladder, up/down climbs (does not jump/dive).
- The "Enable Tilt Controls" prompt is hidden in joystick mode; the menu help overlay shows joystick copy.
- **Lifecycle:** toggle Tilt↔Joystick *inside the open settings panel* — the tilt
  prompt behind the panel updates immediately, and reopening the **?** info overlay
  shows the matching copy (no scene rebuild needed).
- **No leak:** open the **Controls** tab, then close the settings panel — no Controls
  widgets remain floating over the menu.
- **In-run help:** start a run in joystick mode and open the in-game **?** overlay — it
  shows joystick copy, not tilt/swipe.
- Switch back to **Tilt**: tilt + swipe gestures work exactly as before; no joystick shown.
- Repeat a quick check in **Infinite** mode — stick works there too.

- [ ] **Step 3: Final full build + tests**

Run: `npm run build && npm test`
Expected: build PASS; all tests PASS.

---

## Done criteria
- `controlMode`/`joystickSide` persist per-device and survive a simulated cloud merge.
- Joystick drives move/jump/dive + dash (button & double-tap) with player code unchanged except the `diveHeld` line.
- Tilt mode is byte-for-byte unchanged.
- Stick works in both GameScene and InfiniteGameScene; suppression rect is cleaned up on shutdown in both.
- Help copy is single-sourced (`controlHelp.ts`); menu prompt/help refresh live on in-session mode toggle; Controls tab doesn't leak on close; in-run help is mode-aware.
- `npm run build` and `npm test` pass.

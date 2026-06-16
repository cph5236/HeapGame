# Tilt Prompt Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the confusing single-link tilt prompt on the main menu with a clear two-button choice when tilt can work, and auto-enable joystick with an explanatory popup when tilt is impossible (cross-origin iframe / itch.io).

**Architecture:** Add a `tiltPermissionBlocked` signal to `InputManager` (true only when iOS requires a permission gesture AND the page runs in a cross-origin iframe, where the iOS permission dialog can never appear). `MenuScene.createPrompts` branches on it: blocked → no buttons, auto session-joystick + popup; otherwise → a two-button prompt ("Enable Tilt Controls" / "Keep Joystick Controls") rendered as real backed buttons. The saved control-mode preference is never changed implicitly (session-only override, as today).

**Tech Stack:** TypeScript 5.9, Phaser 3.90, Vitest. Spec: `docs/superpowers/specs/2026-06-15-tilt-prompt-redesign-design.md`.

---

## File Structure

- `src/systems/InputManager.ts` — add `tiltPermissionBlocked` field + `isCrossOriginFrame()` module helper; set the field in `setupTilt()`.
- `src/systems/__tests__/InputManager.test.ts` — unit coverage for the `tiltPermissionBlocked` decision matrix.
- `src/scenes/MenuScene.ts` — two-button prompt container, blocked-case branch, `fallbackToJoystick(message?)` param, `refreshTiltPrompt` guard, `tiltPrompt` field type change + `setTiltPromptVisible` helper.

---

## Task 1: InputManager — `tiltPermissionBlocked` detection (TDD)

**Files:**
- Modify: `src/systems/InputManager.ts` (field near line 61; `setupTilt` at lines 256-266)
- Test: `src/systems/__tests__/InputManager.test.ts`

- [ ] **Step 1: Write the failing tests**

Add this block to the end of `src/systems/__tests__/InputManager.test.ts` (before the final closing of the file). It defines a `buildWindow` helper and the four-case matrix. Note the existing test file already has the `beforeEach`/`afterEach` `vi.stubGlobal('window', {})` setup — these tests override `window`/`DeviceOrientationEvent` per-case after `vi.resetModules()` ran in `beforeEach`.

```typescript
describe('InputManager — tiltPermissionBlocked', () => {
  // Minimal mobile window stub. `selfTop`/`top` control iframe detection;
  // addEventListener is needed because the mobile constructor + tilt setup attach listeners.
  function buildWindow(opts: { self: unknown; top: unknown }) {
    const w: Record<string, unknown> = {
      ontouchstart: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    w.self = opts.self === 'w' ? w : opts.self;
    w.top  = opts.top  === 'w' ? w : opts.top;
    return w;
  }

  // A DeviceOrientationEvent whose presence of requestPermission decides iOS-vs-Android.
  function stubIos() {
    vi.stubGlobal('DeviceOrientationEvent', { requestPermission: () => Promise.resolve('granted') });
  }
  function stubAndroid() {
    vi.stubGlobal('DeviceOrientationEvent', {}); // no requestPermission
  }

  it('iOS top-level (not in iframe): not blocked', async () => {
    vi.stubGlobal('window', buildWindow({ self: 'w', top: 'w' })); // self === top
    vi.stubGlobal('navigator', { maxTouchPoints: 1 });
    stubIos();
    const { InputManager } = await import('../InputManager');
    const im = InputManager.getInstance();
    expect(im.requiresPermissionGesture).toBe(true);
    expect(im.tiltPermissionBlocked).toBe(false);
  });

  it('iOS in cross-origin iframe: blocked', async () => {
    const crossOriginTop = { get location() { throw new Error('cross-origin'); } };
    vi.stubGlobal('window', buildWindow({ self: 'w', top: crossOriginTop }));
    vi.stubGlobal('navigator', { maxTouchPoints: 1 });
    stubIos();
    const { InputManager } = await import('../InputManager');
    const im = InputManager.getInstance();
    expect(im.tiltPermissionBlocked).toBe(true);
  });

  it('iOS in same-origin iframe: not blocked', async () => {
    const sameOriginTop = { location: { href: 'http://localhost/' } };
    vi.stubGlobal('window', buildWindow({ self: 'w', top: sameOriginTop }));
    vi.stubGlobal('navigator', { maxTouchPoints: 1 });
    stubIos();
    const { InputManager } = await import('../InputManager');
    const im = InputManager.getInstance();
    expect(im.tiltPermissionBlocked).toBe(false);
  });

  it('Android (no permission gesture): not blocked', async () => {
    const crossOriginTop = { get location() { throw new Error('cross-origin'); } };
    vi.stubGlobal('window', buildWindow({ self: 'w', top: crossOriginTop }));
    vi.stubGlobal('navigator', { maxTouchPoints: 1 });
    stubAndroid();
    const { InputManager } = await import('../InputManager');
    const im = InputManager.getInstance();
    expect(im.requiresPermissionGesture).toBe(false);
    expect(im.tiltPermissionBlocked).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/systems/__tests__/InputManager.test.ts -t "tiltPermissionBlocked"`
Expected: FAIL — `tiltPermissionBlocked` is `undefined` (property does not exist yet), so the `toBe(false)`/`toBe(true)` assertions fail.

- [ ] **Step 3: Add the `tiltPermissionBlocked` field**

In `src/systems/InputManager.ts`, immediately after the `requiresPermissionGesture = false;` field (line 61), add:

```typescript
  // True when tilt permission can never be granted in this context: iOS requires a
  // user-gesture grant AND we're inside a cross-origin iframe (e.g. itch.io), where
  // DeviceOrientationEvent.requestPermission() is blocked and the dialog never appears.
  // The menu uses this to skip the tilt prompt and auto-enable the joystick instead.
  tiltPermissionBlocked = false;
```

- [ ] **Step 4: Add the cross-origin detection helper**

In `src/systems/InputManager.ts`, add this module-level function just below the `ScreenTransform` interface (after line 21, before `export class InputManager`):

```typescript
/** True when the page runs inside a cross-origin iframe (e.g. itch.io). In that
 *  context iOS blocks DeviceOrientationEvent.requestPermission(), so tilt is
 *  unreachable. Reading a property of window.top throws when it's cross-origin. */
function isCrossOriginFrame(): boolean {
  try {
    if (window.self === window.top) return false;   // top-level browsing context
    void (window.top as Window).location.href;        // same-origin parent: readable
    return false;
  } catch {
    return true;                                       // access threw → cross-origin
  }
}
```

- [ ] **Step 5: Set the field in `setupTilt()`**

In `src/systems/InputManager.ts`, change the iOS branch of `setupTilt()` (lines 256-266). Replace:

```typescript
  private setupTilt(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      // iOS 13+ — must wait for user gesture
      this.requiresPermissionGesture = true;
    } else {
```

with:

```typescript
  private setupTilt(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      // iOS 13+ — must wait for user gesture
      this.requiresPermissionGesture = true;
      // In a cross-origin iframe the gesture grant is blocked outright (no dialog).
      this.tiltPermissionBlocked = isCrossOriginFrame();
    } else {
```

(Leave the `else` body — `attachTiltListener()` + `tiltPermissionGranted = true` — unchanged.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/systems/__tests__/InputManager.test.ts -t "tiltPermissionBlocked"`
Expected: PASS — all 4 cases green.

- [ ] **Step 7: Commit**

```bash
git add src/systems/InputManager.ts src/systems/__tests__/InputManager.test.ts
git commit -m "feat(controls): detect tilt-permission-blocked in cross-origin iframe

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: MenuScene — two-button prompt + blocked-case popup

**Files:**
- Modify: `src/scenes/MenuScene.ts` — field at line 44; tilt-prompt block at 601-624 (inside `createPrompts`); `fallbackToJoystick` at 643-654; `refreshTiltPrompt` at 927-930.

No unit test: `MenuScene` is a Phaser scene with no existing unit tests in this codebase; it's verified by `npm run build` (TS) and the scene-preview tool (Task 3). Follow the existing pattern.

- [ ] **Step 1: Change the `tiltPrompt` field type to a Container**

In `src/scenes/MenuScene.ts`, line 44, replace:

```typescript
  private tiltPrompt?: Phaser.GameObjects.Text;
```

with:

```typescript
  private tiltPrompt?: Phaser.GameObjects.Container;
```

- [ ] **Step 2: Add a visibility helper that also toggles child input**

In `src/scenes/MenuScene.ts`, add this private method immediately AFTER the `createPrompts` method's closing brace (right before `startTiltWatchdog`, i.e. just before line 629's doc comment). It hides/shows the prompt container and enables/disables its interactive children so hidden buttons can't be tapped:

```typescript
  /** Show/hide the tilt-prompt container and toggle its buttons' interactivity in
   *  step, so a hidden prompt can never receive taps. */
  private setTiltPromptVisible(visible: boolean): void {
    if (!this.tiltPrompt) return;
    this.tiltPrompt.setVisible(visible);
    for (const child of this.tiltPrompt.list) {
      const input = (child as Phaser.GameObjects.GameObject).input;
      if (input) input.enabled = visible;
    }
  }
```

- [ ] **Step 3: Replace the tilt-prompt block with the branch + two-button container**

In `src/scenes/MenuScene.ts`, replace the entire block at lines 601-624 (from `if (im.isMobile && !im.tiltPermissionGranted) {` through its closing `}` just before `this.startTiltWatchdog(im);`) with:

```typescript
    if (im.isMobile && !im.tiltPermissionGranted) {
      if (im.tiltPermissionBlocked) {
        // Cross-origin iframe (e.g. itch.io): the iOS tilt-permission dialog can never
        // appear, so don't offer it. Auto-use the joystick and explain why.
        this.fallbackToJoystick(
          'Joystick controls enabled — your browser blocks tilt steering. Change controls in Settings.',
        );
      } else {
        const cx = logicalWidth(this) / 2;
        const mkBtn = (y: number, label: string, bg: string, color: string) =>
          this.add.text(cx, y, label, {
            fontSize: '17px',
            color,
            backgroundColor: bg,
            padding: { x: 14, y: 8 },
            stroke: '#000000',
            strokeThickness: 2,
          }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        const enableBtn = mkBtn(logicalHeight(this) - 116, 'Enable Tilt Controls', '#2244aa', '#ffffff');
        const keepBtn   = mkBtn(logicalHeight(this) - 66,  'Keep Joystick Controls', '#1a1a2e', '#cccccc');

        enableBtn.on('pointerup', () => {
          im.requestTiltPermission().then((granted) => {
            this.setTiltPromptVisible(false);
            // iOS: if permission was blocked, or granted but no orientation data
            // arrives, fall back to the joystick.
            if (!granted) { this.fallbackToJoystick(); return; }
            this.time.delayedCall(TILT_WATCHDOG_MS, () => {
              if (getEffectiveControlMode() === 'tilt' && !im.tiltDataReceived) this.fallbackToJoystick();
            });
          });
        });

        keepBtn.on('pointerup', () => {
          // Explicit dismiss: switch to the joystick for this session only (saved pref
          // untouched) and hide the prompt. No "unavailable" toast — this is a choice.
          setSessionControlMode('joystick');
          this.setTiltPromptVisible(false);
        });

        const container = this.add.container(0, 0, [enableBtn, keepBtn]).setDepth(9).setAlpha(0);
        this.tweens.add({ targets: container, alpha: 1, duration: 300, delay: 2000 });
        this.tiltPrompt = container;
        this.setTiltPromptVisible(getEffectiveControlMode() === 'tilt');
      }
    }
```

- [ ] **Step 4: Parameterize `fallbackToJoystick` with a message + use the visibility helper**

In `src/scenes/MenuScene.ts`, replace the `fallbackToJoystick` method (lines 643-654). Change the signature to take an optional message (defaulting to the watchdog/denial wording) and use `setTiltPromptVisible`:

```typescript
  /** Switch to the joystick for this session (does NOT overwrite the saved pref),
   *  hide the tilt prompt, and briefly notify the player. */
  private fallbackToJoystick(
    message = 'Tilt unavailable — joystick controls enabled. Change controls in Settings.',
  ): void {
    if (getEffectiveControlMode() === 'joystick') return;
    setSessionControlMode('joystick');
    this.setTiltPromptVisible(false);
    const notice = this.add.text(logicalWidth(this) / 2, logicalHeight(this) - 94,
      message, {
        fontSize: '15px', color: '#ffd070', stroke: '#000000', strokeThickness: 2,
        align: 'center', wordWrap: { width: logicalWidth(this) - 40 },
      }).setOrigin(0.5).setDepth(10).setAlpha(0);
    this.tweens.add({ targets: notice, alpha: 1, duration: 250, hold: 2600, yoyo: true,
      onComplete: () => notice.destroy() });
  }
```

- [ ] **Step 5: Guard `refreshTiltPrompt` against the blocked case + use the helper**

In `src/scenes/MenuScene.ts`, replace the `refreshTiltPrompt` closure (lines 927-930) with:

```typescript
    const refreshTiltPrompt = () => {
      const im2 = InputManager.getInstance();
      this.setTiltPromptVisible(
        ctrlMode === 'tilt' && im2.isMobile && !im2.tiltPermissionGranted && !im2.tiltPermissionBlocked,
      );
    };
```

- [ ] **Step 6: Verify the build compiles**

Run: `npm run build`
Expected: succeeds with no TypeScript errors. (In particular: `this.tiltPrompt` is now a `Container`, and the only other references are via `setTiltPromptVisible`.)

- [ ] **Step 7: Confirm no stale `tiltPrompt?.setVisible` references remain**

Run: `grep -n "tiltPrompt" src/scenes/MenuScene.ts`
Expected: references are only the field declaration (Step 1), the assignment in `createPrompts` (Step 3), and reads inside `setTiltPromptVisible`. There must be NO remaining `this.tiltPrompt?.setVisible(` calls (they were replaced by `setTiltPromptVisible`). If any remain, replace them with `this.setTiltPromptVisible(...)`.

- [ ] **Step 8: Commit**

```bash
git add src/scenes/MenuScene.ts
git commit -m "feat(menu): two-button tilt prompt + auto-joystick popup when blocked

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass (including the 4 new `tiltPermissionBlocked` cases).

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: succeeds, no TS errors.

- [ ] **Step 3: Visual check of the menu prompt at phone size**

Run: `npm run scene-preview -- MenuScene '{}' iphone14`
Expected: a screenshot renders. (On desktop/non-mobile preview the prompt won't show because `isMobile` is false — that's expected; the goal is to confirm the scene still renders without errors after the refactor. Manual device/itch.io smoke is required to confirm the two-button prompt and the blocked-case popup visually.)

- [ ] **Step 4: Report results**

Summarize: test count, build status, and that device/itch.io smoke is still pending (two-button prompt on standalone iOS; auto-joystick popup on itch.io).

---

## Self-Review Notes

- **Spec coverage:** §1 detection → Task 1. §2 branch → Task 2 Step 3. §3 two-button UI → Task 2 Step 3. §4 copy → Task 2 Steps 3-4. §5 saved-pref untouched → preserved (`setSessionControlMode` only; `fallbackToJoystick` early-returns if already joystick). §refreshTiltPrompt guard → Task 2 Step 5. Testing → Task 1 + Task 3.
- **Type consistency:** `tiltPermissionBlocked` (InputManager) used identically in MenuScene; `setTiltPromptVisible` defined in Task 2 Step 2 and called in Steps 3/4/5; `tiltPrompt` is a `Container` everywhere after Step 1.
- **Popup-once behavior:** on the blocked path, the first menu visit sets the session override to joystick; on subsequent scene restarts `fallbackToJoystick` early-returns (effective mode already joystick), so the popup shows once per session — no nagging.

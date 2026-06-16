# Tilt Prompt Redesign — Design

**Date:** 2026-06-15
**Status:** Approved, ready for implementation plan

## Problem

On a fresh mobile install the saved control mode defaults to `tilt`
(`getControlMode()` returns `'tilt'` when unset). On the main menu this surfaces an
"Enable Tilt Controls" text prompt near the bottom of the screen
(`MenuScene.createTiltPrompt`, ~`MenuScene.ts:601`).

Observed on an iPhone running the game through **itch.io**:

- itch.io embeds the game in a **cross-origin iframe**. On iOS,
  `DeviceOrientationEvent.requestPermission()` is blocked in a cross-origin iframe,
  so the native permission dialog **can never appear**. Tapping the prompt silently
  falls through to joystick with a terse "Tilt unavailable" toast.
- The prompt is a faint text link (no background) that blends into the menu text and
  is unclear about what it's asking.
- It *looked* like the saved preference had changed. It had not — `fallbackToJoystick()`
  sets a **session-only** override (`setSessionControlMode`, `MenuScene.ts:645`) that
  resets each launch and never calls the persisting `setControlMode`. The Settings
  panel reflects `getEffectiveControlMode()` (session override included), which is why
  it appeared changed. **No data bug — perception only.**

## Goals

1. When tilt *can* work, present a clear, real **two-button** prompt (with backgrounds)
   that lets the player choose tilt or stay on joystick.
2. When tilt *cannot* work (cross-origin iframe), skip the prompt entirely, auto-use
   joystick, and show a clear popup that explains it and points to Settings.
3. Keep the session-only model — the saved preference must never change implicitly.

Non-goals: changing the default saved control mode; removing tilt from Settings;
changing native-app behavior (Capacitor app is not in an iframe, so its flow is
unchanged).

## Design

### 1. Detect when tilt permission can't be requested — `InputManager`

Add a read-only flag computed once at construction:

```
tiltPermissionBlocked = false;
```

Set `true` when **both**:
- `requiresPermissionGesture` is true (iOS 13+, where `requestPermission` exists), AND
- we are in a **cross-origin iframe**.

Cross-origin iframe detection (synchronous, no side effects):

```
function inCrossOriginFrame(): boolean {
  if (window.self === window.top) return false;   // top-level: fine
  try { void window.top!.location.href; return false; } // same-origin: accessible
  catch { return true; }                          // access threw → cross-origin
}
```

Compute in `setupTilt()` after `requiresPermissionGesture` is decided. On the native
Capacitor app and same-origin web, `tiltPermissionBlocked` stays `false`.

### 2. Branch the menu flow — `MenuScene.createTiltPrompt`

Replace the single text-link prompt with:

- **`tiltPermissionBlocked === true`** → show **no buttons**. Call the existing
  `fallbackToJoystick()` (session-only joystick) and show the clearer popup (see §4).
- **`tiltPermissionBlocked === false`** (and `im.isMobile && !im.tiltPermissionGranted`
  and effective mode is `tilt`) → show the **two-button prompt** (see §3).

The watchdog (`startTiltWatchdog`) and the iOS "wait for the tap" guard
(`MenuScene.ts:635`) are unchanged.

### 3. Two-button prompt UI

Render two real buttons (rounded-rect background + border) reusing the Settings-toggle
palette (`#2244aa` active / `#1a1a2e` idle, `MenuScene.ts:913-914`), **stacked
vertically** near the bottom of the menu (phone logical width ~448px is too tight for
two backed buttons side-by-side):

- **"Enable Tilt Controls"** (primary) — `requestTiltPermission()`, then the existing
  watchdog logic. On grant + no data within `TILT_WATCHDOG_MS`, `fallbackToJoystick()`.
  On denial, `fallbackToJoystick()`.
- **"Keep Joystick Controls"** (dismiss) — `fallbackToJoystick()` (session-only),
  hide the prompt. No saved-pref change.

Both buttons hide once a choice is made. Wording stays plain/logical (no flavor text).
Keep the existing fade-in tween. Track the buttons so the existing show/hide logic
(`tiltPrompt` references, `refreshTiltPrompt` in the Settings panel) can hide them.

`refreshTiltPrompt` (Settings panel, `MenuScene.ts:927`) must also respect
`tiltPermissionBlocked` — the prompt must never appear when tilt is blocked, even if
the user picks "Tilt" in Settings.

### 4. Copy

- Button: **"Enable Tilt Controls"**
- Button: **"Keep Joystick Controls"**
- Blocked-case popup: **"Joystick controls enabled — your browser blocks tilt steering.
  Change controls in Settings."**
- Watchdog-fallback toast (`fallbackToJoystick`): update from "Tilt unavailable —
  joystick controls enabled" to mention Settings, e.g. **"Tilt unavailable — joystick
  controls enabled. Change controls in Settings."**

Popup/toast style stays the existing lightweight fading notice (no blocking modal).

### 5. Saved preference

Unchanged. `fallbackToJoystick` remains session-only. No migration, no persistence
change.

## Testing

- **Unit (Vitest):** `tiltPermissionBlocked` decision in `InputManager` — cover the
  matrix of {top-level vs iframe (same/cross-origin)} × {requiresPermissionGesture
  true/false}. The cross-origin branch is the only one that yields `true`.
- **Visual:** verify the stacked two-button prompt at phone size via the scene-preview
  tool, and the blocked-case popup on device / itch.io.
- `npm run build` must pass (TS) before claiming done.

## Files touched

- `src/systems/InputManager.ts` — add `tiltPermissionBlocked` + cross-origin detection.
- `src/scenes/MenuScene.ts` — two-button prompt, blocked-case branch, copy,
  `refreshTiltPrompt` guard.
- `src/systems/__tests__/InputManager.test.ts` — `tiltPermissionBlocked` coverage.

---
name: smoke-testing-heap
description: Use when a HeapGame change needs verifying in the actual running game — live browser smoke test of gameplay, scene flow, or runtime behavior that unit tests and static scene screenshots can't cover.
---

# Smoke-Testing Heap in the Browser

Drive the real game at `http://localhost:3000` with the Playwright browser tools.
For a **static screenshot of one scene's layout**, use the `heap-scene-preview`
skill instead — this skill is for live, interactive verification.

## Prerequisites

The user runs their own Vite dev server — **never start or kill one**. Check it:
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
```
If it's not up, stop and ask the user to start it.

## Boot the game

- Navigate to **`http://localhost:3000/?canvas`** — headless Chromium has no GPU
  framebuffer, so WebGL fails ("Framebuffer Unsupported") and the game never
  starts; `?canvas` forces the Canvas renderer at real DPR.
- Use a phone viewport: resize the browser to **448×970** (pixel7, the reference device).
- Wait for boot before interacting (via browser_evaluate / wait):
  `window.game?.isRunning === true`
- Jump straight into a scene, skipping the menu (dev-mode only):
  `http://localhost:3000/?canvas&dev=<SceneName>&params=<urlencoded json>`
  (note: `?dev` alone also forces Canvas but caps DPR at 1 — fine for logic, not
  for DPR-sensitive checks).

## Inspect runtime state

`window.game` is exposed in dev builds (`src/main.ts`). Useful probes via
`browser_evaluate`:

```js
game.scene.getScenes(true).map(s => s.scene.key)      // active scenes
game.registry.get('heapCatalog')                       // registry values
game.scene.getScene('GameScene').player?.body?.center  // player position
```

Console errors matter: check browser console messages after each step — the game
logs errors there before they'd ever reach crash triage.

## Interaction notes

- Keyboard works for movement — arrows or WASD (Up/W = jump), Shift = dash
  (`src/entities/Player.ts` key bindings) — prefer it over synthesizing touch. Touch-specific behavior (joystick, swipes, GRAB/PLACE
  buttons) needs real pointer events at the control's screen position.
- Give physics a beat between actions — assert on state via `browser_evaluate`
  polling, not fixed sleeps, when timing matters.

## What a smoke test must produce

A pass/fail report of the specific behaviors exercised (with what was observed),
plus any console errors — not just "the game loaded". If the change can't be
reached this way (device-only: ads, GPGS, haptics), say so explicitly rather
than claiming it's verified.

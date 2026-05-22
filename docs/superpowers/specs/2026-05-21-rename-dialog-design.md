# Rename Dialog Design

**Date:** 2026-05-21  
**Branch:** feature/GameplayImprovements  
**Status:** Approved

## Problem

The player name "edit" flow calls `window.prompt()` — a plain browser/OS dialog with no styling. It breaks the visual immersion of the dark atmospheric game UI and looks especially jarring on mobile.

## Solution

Replace `promptNameChange()` in `MenuScene` with a custom `openNameDialog()` method that renders a styled in-game overlay using a Phaser DOM element.

## Visual Design

- Full-screen semi-transparent black overlay (matches the Settings panel pattern)
- Centered panel: `#0d0d20` background, `2px solid #ff9922` border, `border-radius: 12px`, subtle orange `box-shadow` glow
- `HEAP` in small orange monospace caps at the top
- `"What do they call you?"` in italic `#cc9966` beneath it
- Large underline-only `<input>`: transparent background, `border-bottom: 2px solid #ff9922`, centered text, monospace font, pre-filled with current name
- Live character counter bottom-right: `N / 20` — neutral color until 18, turns `#ff4444` at 19–20
- `CONFIRM` button: full-width, orange fill (`#ff9922`), dark text (`#0a0818`), `border-radius: 8px`
- `cancel` in small muted text below the button

## Behavior

| Action | Result |
|---|---|
| Dialog opens | Input auto-focused (triggers mobile keyboard) |
| Tap outside panel | Closes silently, name unchanged |
| Tap `cancel` | Closes silently, name unchanged |
| Tap `CONFIRM` or press Enter | If empty/whitespace → close silently, keep old name. Otherwise → `setPlayerName(trimmed)`, update label, close. |
| Type beyond 20 chars | Blocked by `maxlength="20"` on the input |

## Implementation

**File:** `src/scenes/MenuScene.ts`

**Changes:**
1. Replace `promptNameChange()` with `openNameDialog()`.
2. `openNameDialog()` creates a Phaser DOM element (`this.add.dom()`) containing the full dialog HTML+CSS.
3. Wire `pointerdown` on the overlay background to close. Wire `cancel` text click to close. Wire `CONFIRM` button click (and `keydown Enter` on the input) to confirm.
4. Live counter: `input` event on the `<input>` updates the counter span, toggling red at 19–20 chars.
5. On close: call `domElement.destroy()` to remove from the DOM. No lingering elements.
6. The `playerNameText` update after confirm uses the existing pattern: `this.playerNameText.setText(\`${getPlayerName()}  [edit]\`)`.

**No new files. No new scenes.**

## Out of Scope

- GPGS name editing (already handled separately via `PlayGamesClient.showPlayerProfile()`)
- Animating the panel in/out (static show/hide is sufficient)
- Persisting name across sessions (already handled by `setPlayerName` / `getPlayerName` in SaveData)

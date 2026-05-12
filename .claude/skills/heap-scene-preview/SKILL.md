---
name: heap-scene-preview
description: Use when working on HeapGame UI and needing to see how a scene looks — before and after visual changes, checking layout at phone dimensions, or verifying scene state without manually playing through the game.
---

# HeapGame Scene Preview

Take a screenshot of any game scene at real phone dimensions without playing through the game.

## Prerequisites

Dev server must be running in a separate terminal:
```bash
cd /home/connor/Documents/Repos/HeapGame && npm run dev
```

## The Command

```bash
npm run scene-preview -- <SceneName> '<paramsJSON>' <device|all>
```

- Single device → writes `screenshots/preview.png`
- `all` → runs all devices in parallel, writes `screenshots/SceneName-{device}.png`

## Device Presets

| Name | Dimensions | Use for |
|---|---|---|
| `pixel7` | 448×970 | default — matches the actual test phone |
| `browser` | 480×1042 | browser pane size |
| `iphone14` | 390×844 | iOS reference |
| `desktop` | 1280×800 | wide layout check |
| `all` | — | runs all four in parallel |
| `headed` | — | opens interactive browser — use when you need to click or test animations |

Default is `pixel7` if omitted.

## Reading screenshots

- Single device: `Read screenshots/preview.png`
- All devices: `Read screenshots/ScoreScene-pixel7.png`, `Read screenshots/ScoreScene-iphone14.png`, etc.

## ScoreScene Examples

```bash
# Single device (quick iteration)
npm run scene-preview -- ScoreScene '{"score":5000}' pixel7

# All devices at once (layout audit)
npm run scene-preview -- ScoreScene '{"score":5000}' all

# Failure with checkpoint
npm run scene-preview -- ScoreScene '{"score":171,"isFailure":true,"checkpointAvailable":true}' pixel7

# Peak run, new high score
npm run scene-preview -- ScoreScene '{"score":9000,"isPeak":true}' pixel7
```

### Showing the leaderboard in previews

The leaderboard requires a live API call and `heapId`. Pass `mockLeaderboard` instead to render it without a server:

```bash
npm run scene-preview -- ScoreScene '{"score":171,"isFailure":true,"checkpointAvailable":true,"mockLeaderboard":{"top":[{"rank":1,"playerId":"a","name":"105; Drop Table test","score":9819},{"rank":2,"playerId":"b","name":"Trashbag#44217","score":6186},{"rank":3,"playerId":"c","name":"Mincono","score":4393},{"rank":4,"playerId":"d","name":"Trashbag#06230","score":2641},{"rank":5,"playerId":"e","name":"Trashbag#08567","score":904}],"player":{"rank":6,"playerId":"you","name":"You","score":171}}}' all
```

### Forcing the score breakdown panel open

Pass `forceBreakdownOpen: true` along with `baseHeightPx` / `kills` / `elapsedMs` to make the breakdown overlay visible without tapping:

```bash
npm run scene-preview -- ScoreScene '{"score":5240,"baseHeightPx":4800,"kills":{"percher":3,"ghost":1},"elapsedMs":95000,"forceBreakdownOpen":true}' all
```

## How It Works

BootScene detects `?dev=SceneName&params={...}` in dev mode and starts that scene directly — skipping the normal menu flow. The params blob maps directly to each scene's existing `init(data)` signature. No scene changes needed.

## The Iteration Loop

```
make UI change in ScoreScene.ts
  → npm run scene-preview -- ScoreScene '{"score":5000}' pixel7
  → Read screenshots/preview.png
  → see result, make next change
  → repeat

# When checking cross-device layout:
  → npm run scene-preview -- ScoreScene '{"score":5000}' all
  → Read all four screenshots
```

## DO NOT

- Write your own Playwright script — `npm run scene-preview` already handles this
- Use physical pixel dimensions (1080×2400) — the presets use CSS pixels with correct deviceScaleFactor
- Use `preview.png` path when you ran `all` — the files are named `SceneName-{device}.png`

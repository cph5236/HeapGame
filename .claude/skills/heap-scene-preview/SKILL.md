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
npm run scene-preview -- <SceneName> '<paramsJSON>' <device>
```

Screenshot always saves to `screenshots/preview.png`. Read it with the Read tool.

## Device Presets

| Name | Dimensions | Use for |
|---|---|---|
| `pixel7` | 448×970 | default — matches the actual test phone |
| `browser` | 480×1042 | browser pane size |
| `iphone14` | 390×844 | iOS reference |
| `desktop` | 1280×800 | wide layout check |

Default is `pixel7` if omitted.

## ScoreScene Examples

```bash
# Success run
npm run scene-preview -- ScoreScene '{"score":5000}' pixel7

# Failure with checkpoint
npm run scene-preview -- ScoreScene '{"score":171,"isFailure":true,"checkpointAvailable":true}' pixel7

# Peak run, new high score
npm run scene-preview -- ScoreScene '{"score":9000,"isPeak":true}' pixel7
```

### Showing the leaderboard in previews

The leaderboard requires a live API call and `heapId`. Pass `mockLeaderboard` instead to render it without a server:

```bash
npm run scene-preview -- ScoreScene '{"score":171,"isFailure":true,"checkpointAvailable":true,"mockLeaderboard":{"top":[{"rank":1,"playerId":"a","name":"105; Drop Table test","score":9819},{"rank":2,"playerId":"b","name":"Trashbag#44217","score":6186},{"rank":3,"playerId":"c","name":"Mincono","score":4393},{"rank":4,"playerId":"d","name":"Trashbag#06230","score":2641},{"rank":5,"playerId":"e","name":"Trashbag#08567","score":904}],"player":{"rank":6,"playerId":"you","name":"You","score":171}}}' pixel7
```

## How It Works

BootScene detects `?dev=SceneName&params={...}` in dev mode and starts that scene directly — skipping the normal menu flow. The params blob maps directly to each scene's existing `init(data)` signature. No scene changes needed.

## The Iteration Loop

```
make UI change in ScoreScene.ts
  → npm run scene-preview -- ScoreScene '{"score":5000}' pixel7
  → Read tool on screenshots/preview.png
  → see result, make next change
  → repeat
```

## DO NOT

- Write your own Playwright script — `npm run scene-preview` already handles this
- Use physical pixel dimensions (1080×2400) — the presets use CSS pixels with correct deviceScaleFactor
- Save screenshots anywhere other than `screenshots/preview.png` — that's where the Read tool expects them

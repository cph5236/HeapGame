# Score Screen Podium Layout — Design

**Date:** 2026-07-13 · **Branch:** `feature/score-podium-layout` · **Bug:** Todo/Bugs.md #

## Problem

The three enlarged avatar-showcase rows (50px each) added by the cosmetics preview
stack ~150px in the ScoreScene leaderboard panel, pushing the panel and bottom
buttons down into the "tap for menu" prompt (the button already rides its 0.91·H
clamp with a tall coins panel).

## Decision (mockup option C — staggered podium)

Chosen from five mockups (see artifact "Score Screen Layout Mockups"):

- **Top 3 → side-by-side podium boxes in 2–1–3 order**: #1 center and taller
  (118px) with a slightly larger avatar; #2 left / #3 right (96px), bottom-aligned.
- **Medal tints, prominent** (user feedback: less transparency than the mockup):
  gold `0xffd54a`, silver `0xc4cede`, bronze `0xd98d4a` fills at ~0.26–0.30 alpha
  with strong matching borders. Rank + score text take the medal color.
- **Rows #4/#5 dropped** from the score-screen panel. The compact "your rank" row
  now appears whenever the player is not in the rendered top 3 (previously top 5).
- Names center under the avatar, ellipsis-truncated to the box width.

Net panel height: ~240px → ~150px on the worst case.

## Scope

- `src/scenes/scoreLayout.ts`: new pure `podiumSlots(count, bodyW)` (+ constants),
  unit-tested; existing helpers untouched — **LeaderboardScene keeps its current
  enlarged-row layout** and is out of scope.
- `src/scenes/ScoreScene.ts`: `createLeaderboardPanel` reserved-height math and
  `renderLeaderboardEntries` switch to the podium for the first ≤3 entries.
- API request stays `LEADERBOARD_TOP_N = 5`; the panel simply renders a slice
  (server contract and LeaderboardScene unchanged).

## Edge cases

- Fewer than 3 entries: render only the boxes for existing ranks (#1 keeps the
  center slot); positions are fixed so the podium never re-flows.
- Player in top 3: no extra row. Player at rank 4–6+: compact row below podium.
- Offline / no context: unchanged (panel silently absent).
